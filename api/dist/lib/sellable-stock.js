"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sellableQuantity = sellableQuantity;
exports.totalSellable = totalSellable;
exports.sellableParts = sellableParts;
const expiry_date_js_1 = require("./expiry-date.js");
function sellableQuantity(row, now = new Date()) {
    const status = row.lot?.status ?? 'AVAILABLE';
    if (status !== 'AVAILABLE')
        return 0;
    if ((0, expiry_date_js_1.isExpiredOn)(row.lot?.expiryDate ?? null, now))
        return 0;
    return Math.max(0, row.onHand - Math.max(0, row.reserved ?? 0));
}
function totalSellable(rows, now = new Date()) {
    return rows.reduce((sum, row) => sum + sellableQuantity(row, now), 0);
}
/** On-hand and reserved restricted to lots that can be sold (for callers that show both). */
function sellableParts(rows, now = new Date()) {
    let onHand = 0;
    let reserved = 0;
    for (const row of rows) {
        if ((row.lot?.status ?? 'AVAILABLE') !== 'AVAILABLE' || (0, expiry_date_js_1.isExpiredOn)(row.lot?.expiryDate ?? null, now))
            continue;
        onHand += row.onHand;
        reserved += Math.max(0, row.reserved ?? 0);
    }
    return { onHand, reserved };
}
