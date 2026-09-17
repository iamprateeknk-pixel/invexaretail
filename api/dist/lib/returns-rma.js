"use strict";
// Blueprint "Returns/RMA: a formal customer-return/RMA/inspection flow" -
// deterministic quantity validation and status state machine. Never
// touches the ledger itself; the route decides what to do with a
// RESTOCK-disposition line once a return reaches RECEIVED.
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateReturnLines = validateReturnLines;
exports.nextReturnStatus = nextReturnStatus;
exports.isRestockDisposition = isRestockDisposition;
function validateReturnLines(lines) {
    const errors = [];
    if (!lines.length)
        errors.push('At least one return line is required.');
    for (const line of lines) {
        if (!(line.quantity > 0)) {
            errors.push(`Line ${line.orderLineId}: return quantity must be positive.`);
            continue;
        }
        const remaining = line.fulfilledQty - line.alreadyReturnedQty;
        if (line.quantity > remaining) {
            errors.push(`Line ${line.orderLineId}: cannot return ${line.quantity}, only ${remaining} of the fulfilled quantity remains eligible.`);
        }
    }
    return { ok: errors.length === 0, errors };
}
const TRANSITIONS = {
    REQUESTED: { APPROVE: 'APPROVED', REJECT: 'REJECTED' },
    APPROVED: { RECEIVE: 'RECEIVED' },
    REJECTED: {},
    RECEIVED: { CLOSE: 'CLOSED' },
    CLOSED: {},
};
// Returns the next status, or null when that action is not legal from the
// current status - the caller turns null into a 409, it never silently
// no-ops a status change.
function nextReturnStatus(current, action) {
    return TRANSITIONS[current][action] ?? null;
}
function isRestockDisposition(disposition) {
    return disposition === 'RESTOCK';
}
