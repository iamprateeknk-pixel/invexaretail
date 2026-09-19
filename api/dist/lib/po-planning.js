"use strict";
// Blueprint v4 §22 PO planning: "Demand + min/max + open PO + in-transit +
// safety stock", §28 "Explain every recommendation: why, data window,
// assumptions, confidence/risk" and "Separate recommendation from execution".
// This only recommends. Creating a draft PO is a separate human action.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COVER_DAYS = exports.DEFAULT_LEAD_TIME_DAYS = void 0;
exports.planPurchases = planPurchases;
exports.groupBySupplier = groupBySupplier;
exports.DEFAULT_LEAD_TIME_DAYS = 7;
exports.DEFAULT_COVER_DAYS = 7;
const round3 = (value) => Math.round(value * 1000) / 1000;
const fmt = (value) => String(round3(value));
function planPurchases(input) {
    const coverDays = input.coverDays ?? exports.DEFAULT_COVER_DAYS;
    const suppliers = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]));
    const suggestions = [];
    const skipped = [];
    for (const item of input.items) {
        const label = item.code ?? item.itemId;
        const supplier = item.supplierId ? suppliers.get(item.supplierId) : undefined;
        if (supplier && supplier.status && supplier.status !== 'ACTIVE') {
            skipped.push({ itemId: item.itemId, reason: `${label}: supplier ${supplier.name} is ${supplier.status.toLowerCase()}; pick another supplier.` });
        }
        const usableSupplier = supplier && (!supplier.status || supplier.status === 'ACTIVE') ? supplier : undefined;
        const lead = usableSupplier?.leadTimeDays && usableSupplier.leadTimeDays > 0 ? usableSupplier.leadTimeDays : exports.DEFAULT_LEAD_TIME_DAYS;
        const daily = Math.max(0, item.avgDailyDemand ?? 0);
        const available = Math.max(0, item.onHand - (item.reserved ?? 0));
        const position = available + Math.max(0, item.openPoQty) + Math.max(0, item.inTransitQty);
        const leadDemand = daily * lead;
        const reorderPoint = Math.ceil(leadDemand) + Math.max(0, item.minQty);
        if (position > reorderPoint) {
            skipped.push({ itemId: item.itemId, reason: `${label}: covered - position ${fmt(position)} is above the reorder point ${fmt(reorderPoint)}.` });
            continue;
        }
        // Nothing to steer by: no rule and no demand means there is no basis to order.
        if (item.minQty <= 0 && item.targetQty <= 0 && daily <= 0) {
            skipped.push({ itemId: item.itemId, reason: `${label}: no reorder rule and no sales history to plan from.` });
            continue;
        }
        const orderUpTo = Math.max(item.targetQty, reorderPoint + Math.ceil(daily * coverDays));
        let quantity = orderUpTo - position;
        const notes = [];
        const moq = usableSupplier?.moq && usableSupplier.moq > 0 ? usableSupplier.moq : 0;
        if (moq && quantity < moq) {
            quantity = moq;
            notes.push(`Raised to the supplier minimum order of ${fmt(moq)}.`);
        }
        quantity = item.decimal ? round3(quantity) : Math.ceil(quantity);
        if (quantity <= 0)
            continue;
        const daysOfCover = daily > 0 ? round3(available / daily) : null;
        const window = item.demandDays ?? 0;
        const confidence = daily <= 0 ? 'LOW' : window >= 28 ? 'HIGH' : window >= 7 ? 'MEDIUM' : 'LOW';
        const urgency = position <= 0 ? 'CRITICAL' : position <= item.minQty ? 'HIGH' : 'NORMAL';
        const explanation = [
            `Position ${fmt(position)} = ${fmt(available)} available${item.reserved ? ` (after ${fmt(item.reserved)} reserved)` : ''} + ${fmt(item.openPoQty)} on open purchase orders + ${fmt(item.inTransitQty)} in transit.`,
            daily > 0
                ? `Reorder point ${fmt(reorderPoint)} = ${fmt(item.minQty)} safety minimum + ${fmt(Math.ceil(leadDemand))} expected sales over the ${lead}-day lead time (${fmt(daily)}/day${window ? ` over the last ${window} days` : ''}).`
                : `Reorder point ${fmt(reorderPoint)} = the ${fmt(item.minQty)} minimum; there is no sales history, so demand is not used.`,
            `Order up to ${fmt(orderUpTo)} (${orderUpTo === item.targetQty ? 'the target quantity' : `reorder point + ${coverDays} days of cover`}).`,
            ...notes,
            usableSupplier ? `Supplier ${usableSupplier.name}, lead time ${lead} days${usableSupplier.leadTimeDays ? '' : ' (default - not set on the supplier)'}.` : `No usable supplier on record; the ${lead}-day default lead time was assumed.`,
        ];
        suggestions.push({
            itemId: item.itemId, code: item.code, name: item.name,
            supplierId: usableSupplier?.id ?? null, supplierName: usableSupplier?.name ?? null,
            quantity, urgency, position: round3(position), reorderPoint, orderUpTo: round3(orderUpTo), leadTimeDays: lead,
            daysOfCover, confidence, estimatedCost: item.unitCost ? round3(quantity * item.unitCost) : null, explanation,
        });
    }
    const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
    suggestions.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity));
    return { suggestions, skipped };
}
/** One proposed draft PO per supplier; items with no supplier are grouped for the buyer to assign. */
function groupBySupplier(suggestions) {
    const groups = new Map();
    for (const suggestion of suggestions) {
        const key = suggestion.supplierId ?? '';
        const group = groups.get(key) ?? { supplierId: suggestion.supplierId, supplierName: suggestion.supplierName, lines: [], estimatedTotal: 0 };
        group.lines.push(suggestion);
        group.estimatedTotal = round3(group.estimatedTotal + (suggestion.estimatedCost ?? 0));
        groups.set(key, group);
    }
    return [...groups.values()];
}
