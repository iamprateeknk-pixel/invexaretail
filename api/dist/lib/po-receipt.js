"use strict";
// Blueprint v4 §22 Receiving: "Lot/expiry, QC, discrepancy, partial receipt",
// and §18 "exactly-once receipt posting using requestId". This decides what a
// PO receipt means; the route posts it. Pure so it can be tested without a
// database.
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPoLotNo = defaultPoLotNo;
exports.planPoReceipt = planPoReceipt;
exports.statusAfterReceipt = statusAfterReceipt;
const round3 = (value) => Math.round(value * 1000) / 1000;
function defaultPoLotNo(orderNumber) {
    return `PO-${orderNumber}`;
}
function parseExpiry(value) {
    if (value === undefined || value === null || value === '')
        return { date: null };
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return { error: 'Expiry date must be a valid date.' };
    return { date: new Date(parsed).toISOString().slice(0, 10) };
}
function planPoReceipt(input) {
    const today = (input.today ?? new Date()).toISOString().slice(0, 10);
    if (!input.receipt.length)
        return { ok: false, message: 'At least one receipt line is required.' };
    const seen = new Set();
    const postings = [];
    for (const row of input.receipt) {
        if (seen.has(row.lineId))
            return { ok: false, message: 'Each purchase order line can appear only once in a receipt.', lineId: row.lineId };
        seen.add(row.lineId);
        const line = input.lines.find((candidate) => candidate.id === row.lineId);
        if (!line)
            return { ok: false, message: `Purchase order line ${row.lineId} was not found.`, lineId: row.lineId };
        const good = Number(row.receivedQty ?? 0);
        const damaged = Number(row.damagedQty ?? 0);
        const excess = Number(row.excessQty ?? 0);
        if ([good, damaged, excess].some((value) => !Number.isFinite(value) || value < 0)) {
            return { ok: false, message: 'Receipt quantities must be non-negative numbers.', lineId: row.lineId };
        }
        if (good + damaged + excess <= 0)
            continue;
        const remaining = round3(line.quantity - line.receivedQty);
        if (round3(good + damaged) > remaining + 1e-8) {
            return { ok: false, message: `Only ${remaining} is still open on this line. Declare anything beyond that as excess.`, lineId: row.lineId };
        }
        const rules = input.items.get(line.itemId) ?? { code: line.itemId };
        const lotNo = (row.lotNo ?? '').trim();
        if (rules.lotRequired && !lotNo)
            return { ok: false, message: `${rules.code} needs a lot number to be received.`, lineId: row.lineId };
        const expiry = parseExpiry(row.expiryDate);
        if ('error' in expiry)
            return { ok: false, message: expiry.error, lineId: row.lineId };
        if (rules.expiryRequired && good > 0 && !expiry.date)
            return { ok: false, message: `${rules.code} needs an expiry date to be received.`, lineId: row.lineId };
        if (good > 0 && expiry.date && expiry.date < today) {
            return { ok: false, message: `${rules.code} is already expired (${expiry.date}); receive it as damaged, not sellable.`, lineId: row.lineId };
        }
        postings.push({
            lineId: line.id, itemId: line.itemId, lotNo: lotNo || defaultPoLotNo(input.orderNumber), expiryDate: expiry.date,
            goodQty: round3(good), damagedQty: round3(damaged), excessQty: round3(excess), arrivedQty: round3(good + damaged),
        });
    }
    if (!postings.length)
        return { ok: false, message: 'A receipt must account for a positive quantity.' };
    return { ok: true, postings };
}
/** Order status after this receipt: everything ordered has arrived -> RECEIVED, otherwise still open. */
function statusAfterReceipt(lines, postings) {
    const arrived = new Map(postings.map((posting) => [posting.lineId, posting.arrivedQty]));
    const complete = lines.every((line) => round3(line.receivedQty + (arrived.get(line.id) ?? 0)) >= line.quantity - 1e-8);
    return complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}
