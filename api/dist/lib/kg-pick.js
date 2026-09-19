"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPickableLot = isPickableLot;
exports.allocatePick = allocatePick;
exports.isPooledPick = isPooledPick;
const weight_allocation_js_1 = require("./weight-allocation.js");
const round3 = (value) => Math.round(value * 1000) / 1000;
/** A lot a picker may take from: available status, stock on the shelf, and not past its expiry. */
function isPickableLot(lot, today = new Date()) {
    if ((lot.status ?? 'AVAILABLE') !== 'AVAILABLE')
        return false;
    if (!(lot.available > 0))
        return false;
    if (lot.expiryDate && Date.parse(lot.expiryDate) < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
        return false;
    return true;
}
function allocatePick(input) {
    const requested = round3(Number(input.requested));
    if (!Number.isFinite(requested) || requested <= 0)
        throw new Error('Picked quantity must be greater than zero.');
    const eligible = (0, weight_allocation_js_1.orderLots)(input.lots.filter((lot) => isPickableLot(lot, input.today)).map((lot) => ({ lotId: lot.lotId, lotNo: lot.lotNo, bookQty: lot.available, expiryDate: lot.expiryDate, status: 'AVAILABLE' })), input.strategy);
    let remaining = requested;
    const allocations = [];
    for (const lot of eligible) {
        if (remaining <= 0)
            break;
        const take = round3(Math.min(remaining, lot.bookQty));
        allocations.push({ lotId: lot.lotId, lotNo: lot.lotNo, quantity: take, expiryDate: lot.expiryDate });
        remaining = round3(remaining - take);
    }
    return { allocations, shortfall: remaining };
}
/** Items picked by weight from the whole pool rather than from one named lot. */
function isPooledPick(item) {
    return item.pickMethod === 'ITEM_QTY_FIFO';
}
