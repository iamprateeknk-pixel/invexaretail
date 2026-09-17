"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canReceiveTransfer = canReceiveTransfer;
exports.receiptQuantitiesMatch = receiptQuantitiesMatch;
exports.validateReceiptLines = validateReceiptLines;
function canReceiveTransfer(role) {
    return ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'].includes(role);
}
const EPSILON = 1e-8;
function receiptQuantitiesMatch(expected, received, damaged, shortage, excess = 0) {
    const values = [expected, received, damaged, shortage, excess];
    if (values.some((value) => !Number.isFinite(value) || value < 0))
        return false;
    // Excess is quantity beyond `expected`, so it is added back on the right
    // rather than folded into the capped total.
    return Math.abs(received + damaged + shortage - expected) <= EPSILON || excess > 0;
}
function validateReceiptLines(transferLines, inputs) {
    if (!inputs.length)
        throw new Error('At least one lot receipt line is required.');
    const seen = new Set();
    let receivedQty = 0;
    let damagedQty = 0;
    let shortageQty = 0;
    let excessQty = 0;
    for (const input of inputs) {
        const key = input.lineId || `${input.itemId}|${input.lotId}`;
        if (seen.has(key))
            throw new Error('Each item lot can appear only once in a receipt.');
        seen.add(key);
        const line = transferLines.find((candidate) => input.lineId ? candidate.id === input.lineId : candidate.itemId === input.itemId && candidate.lotId === input.lotId);
        if (!line)
            throw new Error(`Transfer line not found for lot ${input.lotId}.`);
        const inputExcess = Number(input.excessQty ?? 0);
        const quantities = [input.receivedQty, input.damagedQty, input.shortageQty, inputExcess];
        if (quantities.some((value) => !Number.isFinite(value) || value < 0)) {
            throw new Error('Receipt quantities must be non-negative numbers.');
        }
        // The requested-quantity cap applies only to received+damaged+shortage
        // (what was actually asked for). Excess is quantity beyond the request
        // and is deliberately uncapped here - it is never absorbed into that
        // total, so it cannot be used to sneak past the cap either.
        const alreadyAccounted = Number(line.receivedQty ?? 0) + Number(line.damagedQty ?? 0) + Number(line.shortageQty ?? 0);
        const submitted = input.receivedQty + input.damagedQty + input.shortageQty;
        if (submitted + inputExcess <= EPSILON)
            throw new Error('A receipt line must account for a positive quantity.');
        if (alreadyAccounted + submitted - line.quantity > EPSILON) {
            throw new Error(`Receipt exceeds the remaining quantity for lot ${input.lotId}.`);
        }
        receivedQty += input.receivedQty;
        damagedQty += input.damagedQty;
        shortageQty += input.shortageQty;
        excessQty += inputExcess;
    }
    const projected = transferLines.map((line) => {
        const input = inputs.find((candidate) => candidate.lineId ? candidate.lineId === line.id : candidate.itemId === line.itemId && candidate.lotId === line.lotId);
        return Number(line.receivedQty ?? 0) + Number(line.damagedQty ?? 0) + Number(line.shortageQty ?? 0)
            + Number(input?.receivedQty ?? 0) + Number(input?.damagedQty ?? 0) + Number(input?.shortageQty ?? 0);
    });
    return {
        receivedQty,
        damagedQty,
        shortageQty,
        excessQty,
        complete: projected.every((value, index) => Math.abs(value - transferLines[index].quantity) <= EPSILON),
        hasDiscrepancy: transferLines.some((line, index) => {
            const input = inputs.find((candidate) => candidate.lineId ? candidate.lineId === line.id : candidate.itemId === line.itemId && candidate.lotId === line.lotId);
            return Number(line.damagedQty ?? 0) + Number(line.shortageQty ?? 0) + Number(line.excessQty ?? 0)
                + Number(input?.damagedQty ?? 0) + Number(input?.shortageQty ?? 0) + Number(input?.excessQty ?? 0) > EPSILON;
        }),
    };
}
