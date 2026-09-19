"use strict";
// Blueprint v4 §13.2 Loose KG / item-weight counting: the user enters ONE
// decimal total for the item and never chooses or splits lots. The server
// spreads that total over the item's lots deterministically.
//
// Example from the blueprint: book lots 2kg + 2kg + 2kg, physical count 5kg
// -> 2 + 2 + 1, total variance -1kg.
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderLots = orderLots;
exports.allocateWeightCount = allocateWeightCount;
exports.totalVariance = totalVariance;
const round3 = (value) => Math.round(value * 1000) / 1000;
/** FEFO: earliest expiry first (no expiry last); FIFO: the order the lots were created. */
function orderLots(lots, strategy) {
    if (strategy === 'FIFO')
        return [...lots];
    return [...lots].sort((a, b) => {
        const left = a.expiryDate ? Date.parse(a.expiryDate) : Number.POSITIVE_INFINITY;
        const right = b.expiryDate ? Date.parse(b.expiryDate) : Number.POSITIVE_INFINITY;
        if (left !== right)
            return left < right ? -1 : 1;
        return a.lotNo.localeCompare(b.lotNo);
    });
}
/**
 * Fills each eligible lot up to its book quantity in strategy order, so a
 * shortfall lands on the lots consumed last and matches "we sold the old
 * stock first". Anything counted beyond the total book quantity is an
 * excess and goes on the last lot in the order (its variance shows it).
 */
function allocateWeightCount(total, lots, strategy) {
    if (!Number.isFinite(total) || total < 0)
        throw new Error('Counted quantity must be a non-negative number.');
    const eligible = orderLots(lots.filter((lot) => (lot.status ?? 'AVAILABLE') === 'AVAILABLE' && lot.bookQty > 0), strategy);
    if (!eligible.length)
        throw new Error('This item has no counted-in lots with stock at this location.');
    let remaining = round3(total);
    const allocation = eligible.map((lot) => {
        const take = round3(Math.min(remaining, lot.bookQty));
        remaining = round3(remaining - take);
        return { lotId: lot.lotId, lotNo: lot.lotNo, bookQty: lot.bookQty, physicalQty: take };
    });
    if (remaining > 0) {
        const last = allocation[allocation.length - 1];
        last.physicalQty = round3(last.physicalQty + remaining);
    }
    return allocation;
}
function totalVariance(allocation) {
    return round3(allocation.reduce((sum, row) => sum + (row.physicalQty - row.bookQty), 0));
}
