"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyExpiryBoard = emptyExpiryBoard;
exports.calendarDaysUntilExpiry = calendarDaysUntilExpiry;
exports.classifyExpiryHorizon = classifyExpiryHorizon;
exports.recommendedExpiryActionForHorizon = recommendedExpiryActionForHorizon;
exports.estimateLotValue = estimateLotValue;
exports.matchesExpiryHorizon = matchesExpiryHorizon;
exports.buildExpiryBoard = buildExpiryBoard;
const EMPTY_SUMMARY = {
    expiredLots: 0,
    expiredQty: 0,
    expiredValue: 0,
    criticalLots: 0,
    criticalQty: 0,
    warningLots: 0,
    warningQty: 0,
    upcomingLots: 0,
    upcomingQty: 0,
    datedLots: 0,
    missingLots: 0,
    missingQty: 0,
    atRiskLots: 0,
    atRiskQty: 0,
    atRiskValue: 0,
    datedOnHandLots: 0,
};
function emptyExpiryBoard() {
    return { lots: [], summary: { ...EMPTY_SUMMARY }, categories: [] };
}
function calendarDaysUntilExpiry(expiryDate, now = new Date()) {
    if (!expiryDate)
        return null;
    const expiry = expiryDate instanceof Date ? new Date(expiryDate) : new Date(expiryDate);
    if (Number.isNaN(expiry.getTime()))
        return null;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.ceil((expiry.getTime() - start.getTime()) / 86_400_000);
}
function classifyExpiryHorizon(daysUntilExpiry) {
    if (daysUntilExpiry === null)
        return 'MISSING';
    if (daysUntilExpiry < 0)
        return 'EXPIRED';
    if (daysUntilExpiry <= 7)
        return 'CRITICAL';
    if (daysUntilExpiry <= 30)
        return 'WARNING';
    if (daysUntilExpiry <= 90)
        return 'UPCOMING';
    return 'DATED';
}
function recommendedExpiryActionForHorizon(horizon) {
    if (horizon === 'EXPIRED')
        return 'Block sale and post a controlled write-off.';
    if (horizon === 'CRITICAL')
        return 'Prioritise sale or FEFO transfer to a faster branch today.';
    if (horizon === 'WARNING')
        return 'Keep this lot first in FEFO and plan branch redistribution.';
    if (horizon === 'UPCOMING')
        return 'Monitor under FEFO and avoid over-ordering.';
    if (horizon === 'MISSING')
        return 'Add an expiry date before FEFO can allocate or sell this lot safely.';
    return 'Dated beyond 90 days. Keep FEFO order and continue monitoring.';
}
function numericAttribute(attributes, key) {
    const value = Number(attributes?.[key]);
    return Number.isFinite(value) && value > 0 ? value : null;
}
function estimateLotValue(attributes, quantity) {
    const purchaseValue = numericAttribute(attributes, 'purchaseValue');
    if (purchaseValue !== null)
        return purchaseValue;
    const purchaseRate = numericAttribute(attributes, 'purchaseRate');
    if (purchaseRate !== null && quantity > 0)
        return purchaseRate * quantity;
    const saleValue = numericAttribute(attributes, 'saleValue');
    if (saleValue !== null)
        return saleValue;
    const saleRate = numericAttribute(attributes, 'saleRate');
    if (saleRate !== null && quantity > 0)
        return saleRate * quantity;
    return null;
}
function matchesExpiryHorizon(horizon, filter) {
    if (filter === 'all')
        return true;
    if (filter === 'dated')
        return horizon !== 'MISSING';
    if (filter === 'action')
        return horizon === 'EXPIRED' || horizon === 'CRITICAL' || horizon === 'WARNING' || horizon === 'MISSING';
    if (filter === 'risk')
        return horizon === 'EXPIRED' || horizon === 'CRITICAL' || horizon === 'WARNING' || horizon === 'UPCOMING';
    return horizon === filter;
}
function buildExpiryBoard(input) {
    const itemMap = new Map(input.items.map((item) => [item.id, item]));
    const lotMap = new Map(input.lots.map((lot) => [lot.id, lot]));
    const categories = new Set();
    const lots = [];
    for (const row of input.stock) {
        if (!(row.quantity > 0))
            continue;
        const item = itemMap.get(row.itemId);
        const lot = lotMap.get(row.lotId);
        if (!item || !lot)
            continue;
        const daysUntilExpiry = calendarDaysUntilExpiry(lot.expiryDate, input.now);
        const horizon = classifyExpiryHorizon(daysUntilExpiry);
        const category = String(item.category || '').trim();
        if (category)
            categories.add(category);
        const attributes = lot.attributes ?? null;
        lots.push({
            id: `lot-expiry-${row.itemId}-${row.lotId}-${row.locationId}`,
            itemId: row.itemId,
            itemCode: String(item.code || row.itemId),
            itemName: String(item.name || item.code || row.itemId),
            category: category || 'Uncategorised',
            subcategory: String(item.subcategory || '').trim(),
            company: String(item.company || '').trim(),
            unit: String(item.unit || '').trim() || 'PCS',
            lotId: lot.id,
            lotNo: lot.lotNo,
            lotStatus: lot.status || 'AVAILABLE',
            locationId: row.locationId,
            quantity: row.quantity,
            expiryDate: lot.expiryDate ? new Date(lot.expiryDate).toISOString() : null,
            daysUntilExpiry,
            horizon,
            recommendedAction: recommendedExpiryActionForHorizon(horizon),
            purchaseValue: estimateLotValue(attributes, row.quantity),
            saleValue: numericAttribute(attributes, 'saleValue'),
        });
    }
    lots.sort((a, b) => {
        const aDays = a.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
        const bDays = b.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
        if (aDays !== bDays)
            return aDays - bDays;
        return b.quantity - a.quantity;
    });
    const summary = lots.reduce((result, lot) => {
        const value = lot.purchaseValue ?? 0;
        if (lot.horizon === 'EXPIRED') {
            result.expiredLots += 1;
            result.expiredQty += lot.quantity;
            result.expiredValue += value;
        }
        else if (lot.horizon === 'CRITICAL') {
            result.criticalLots += 1;
            result.criticalQty += lot.quantity;
        }
        else if (lot.horizon === 'WARNING') {
            result.warningLots += 1;
            result.warningQty += lot.quantity;
        }
        else if (lot.horizon === 'UPCOMING') {
            result.upcomingLots += 1;
            result.upcomingQty += lot.quantity;
        }
        else if (lot.horizon === 'DATED') {
            result.datedLots += 1;
        }
        else {
            result.missingLots += 1;
            result.missingQty += lot.quantity;
        }
        if (lot.horizon !== 'MISSING')
            result.datedOnHandLots += 1;
        if (lot.horizon === 'EXPIRED' || lot.horizon === 'CRITICAL' || lot.horizon === 'WARNING' || lot.horizon === 'UPCOMING') {
            result.atRiskLots += 1;
            result.atRiskQty += lot.quantity;
            result.atRiskValue += value;
        }
        return result;
    }, { ...EMPTY_SUMMARY });
    return {
        lots,
        summary,
        categories: [...categories].sort((a, b) => a.localeCompare(b)),
    };
}
