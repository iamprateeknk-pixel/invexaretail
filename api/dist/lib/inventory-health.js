"use strict";
// Inventory valuation and health KPIs (audit O-5). Before this the system could not answer the
// first questions an owner asks: how much money is sitting in stock, how fast does it turn, what
// is dead, how old is it. Deterministic and read-only: every number is a plain aggregate over the
// ledger rows and the sales movements passed in.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLOW_COVER_DAYS = void 0;
exports.buildInventoryHealth = buildInventoryHealth;
exports.lotUnitCost = lotUnitCost;
exports.summarizeServiceLevel = summarizeServiceLevel;
const round2 = (value) => Math.round(value * 100) / 100;
const DAY = 86_400_000;
/** More than this many days of cover at the current sales rate is slow-moving stock. */
exports.SLOW_COVER_DAYS = 180;
function bucketFor(ageDays) {
    if (ageDays <= 30)
        return '0-30';
    if (ageDays <= 90)
        return '31-90';
    if (ageDays <= 180)
        return '91-180';
    return '181+';
}
function buildInventoryHealth(input) {
    const hasSalesData = input.hasSalesData ?? input.sales.size > 0;
    const now = input.now ?? new Date();
    const windowDays = Math.max(1, input.windowDays);
    const byItem = new Map();
    const byCategory = new Map();
    const ageing = new Map(['0-30', '31-90', '91-180', '181+'].map((bucket) => [bucket, { value: 0, units: 0 }]));
    let totalValue = 0;
    let valuedUnits = 0;
    let unvaluedUnits = 0;
    for (const row of input.rows) {
        if (!(row.onHand > 0))
            continue;
        const value = row.unitCost !== null ? row.onHand * row.unitCost : 0;
        if (row.unitCost !== null) {
            totalValue += value;
            valuedUnits += row.onHand;
        }
        else
            unvaluedUnits += row.onHand;
        const item = byItem.get(row.itemId) ?? { code: row.code, name: row.name, onHand: 0, value: 0 };
        item.onHand += row.onHand;
        item.value += value;
        byItem.set(row.itemId, item);
        const category = row.category?.trim() || 'Uncategorised';
        const cat = byCategory.get(category) ?? { value: 0, units: 0 };
        cat.value += value;
        cat.units += row.onHand;
        byCategory.set(category, cat);
        const created = row.lotCreatedAt ? new Date(row.lotCreatedAt).getTime() : NaN;
        const age = Number.isFinite(created) ? Math.max(0, Math.floor((now.getTime() - created) / DAY)) : 0;
        const bucket = ageing.get(bucketFor(age));
        bucket.value += value;
        bucket.units += row.onHand;
    }
    let cogs = 0;
    let pricedRevenue = 0;
    let pricedCogs = 0;
    let unitsSoldUnpriced = 0;
    for (const sale of input.sales.values()) {
        cogs += sale.cogs;
        if (sale.revenue == null) {
            unitsSoldUnpriced += sale.units;
            continue;
        }
        pricedRevenue += sale.revenue;
        pricedCogs += sale.cogs;
    }
    const turns = totalValue > 0 && cogs > 0 ? round2((cogs * (365 / windowDays)) / totalValue) : null;
    const daysOfInventory = totalValue > 0 && cogs > 0 ? round2(totalValue / (cogs / windowDays)) : null;
    const gmroi = totalValue > 0 && pricedRevenue > 0 ? round2(((pricedRevenue - pricedCogs) * (365 / windowDays)) / totalValue) : null;
    const items = [...byItem.entries()].map(([itemId, item]) => {
        const sold = input.sales.get(itemId)?.units ?? 0;
        const avgDailyDemand = sold / windowDays;
        const daysOfCover = avgDailyDemand > 0 ? round2(item.onHand / avgDailyDemand) : null;
        const status = item.onHand <= 0 ? 'NO_STOCK' : !hasSalesData ? 'NO_DATA' : sold <= 0 ? 'DEAD' : (daysOfCover ?? 0) > exports.SLOW_COVER_DAYS ? 'SLOW' : 'HEALTHY';
        return { itemId, code: item.code, name: item.name, onHand: item.onHand, value: round2(item.value), unitsSold: sold, avgDailyDemand: round2(avgDailyDemand), daysOfCover, status };
    }).sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
    const sum = (status) => {
        const rows = items.filter((item) => item.status === status);
        return { items: rows.length, value: round2(rows.reduce((total, row) => total + row.value, 0)), units: rows.reduce((total, row) => total + row.onHand, 0) };
    };
    return {
        windowDays,
        valuation: {
            totalValue: round2(totalValue), valuedUnits, unvaluedUnits,
            byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, value: round2(v.value), units: v.units })).sort((a, b) => b.value - a.value),
        },
        turns,
        daysOfInventory,
        gmroi,
        unitsSoldUnpriced,
        ageing: [...ageing.entries()].map(([bucket, v]) => ({ bucket: bucket, value: round2(v.value), units: v.units })),
        items,
        deadStock: sum('DEAD'),
        slowStock: sum('SLOW'),
    };
}
/** Unit cost from lot attributes: landed cost first, then the purchase rate; null when neither is recorded. */
function lotUnitCost(attributes) {
    for (const key of ['landedUnitCost', 'purchaseRate']) {
        const value = Number(attributes?.[key]);
        if (Number.isFinite(value) && value > 0)
            return value;
    }
    return null;
}
/**
 * Service level from orders (audit O-5). Only orders that reached an outcome count: FULFILLED is a
 * success; BACKORDERED (still waiting) and EXPIRED (reservation lapsed unfulfilled) are the stock
 * failing the customer. Open RESERVED orders and CANCELLED ones say nothing about availability.
 * Line fill rate weighs quantity: units fulfilled over units requested on those orders.
 */
function summarizeServiceLevel(orders) {
    const decided = orders.filter((order) => ['FULFILLED', 'BACKORDERED', 'EXPIRED'].includes(order.status));
    const fulfilled = decided.filter((order) => order.status === 'FULFILLED').length;
    let requested = 0;
    let delivered = 0;
    for (const order of decided)
        for (const line of order.lines) {
            requested += line.requestedQty;
            delivered += Math.min(line.fulfilledQty, line.requestedQty);
        }
    const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : null);
    return {
        orders: decided.length,
        fulfilledOrders: fulfilled,
        backorderedOrders: decided.filter((order) => order.status === 'BACKORDERED').length,
        expiredOrders: decided.filter((order) => order.status === 'EXPIRED').length,
        orderFillRatePercent: pct(fulfilled, decided.length),
        unitFillRatePercent: pct(delivered, requested),
    };
}
