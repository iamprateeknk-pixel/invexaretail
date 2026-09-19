"use strict";
// Blueprint "Returns/RMA: a formal customer-return/RMA/inspection flow" -
// deterministic quantity validation and status state machine. Never
// touches the ledger itself; the route decides what to do with a
// RESTOCK-disposition line once a return reaches RECEIVED.
Object.defineProperty(exports, "__esModule", { value: true });
exports.QC_FAILED = exports.PENDING_INSPECTION = void 0;
exports.validateReturnLines = validateReturnLines;
exports.nextReturnStatus = nextReturnStatus;
exports.isRestockDisposition = isRestockDisposition;
exports.planReturnLine = planReturnLine;
exports.isPendingDisposition = isPendingDisposition;
exports.canCloseReturn = canCloseReturn;
exports.parseRefundDecision = parseRefundDecision;
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
// ---------------------------------------------------------------------------
// Blueprint v4 §24: "Returned stock must not automatically become sellable
// before QC/disposition when policy requires inspection." A received return
// is held in quarantine until a disposition is decided; RESTOCK is only
// allowed once QC passed wherever a QC template applies to the item.
// ---------------------------------------------------------------------------
exports.PENDING_INSPECTION = 'PENDING_INSPECTION';
exports.QC_FAILED = 'QC_FAILED';
/** What to do with one returned line. `requested` empty means "decide later" - the goods are held, never restocked by default. */
function planReturnLine(input) {
    const requested = (input.requested ?? '').trim().toUpperCase();
    if (!requested || requested === exports.PENDING_INSPECTION) {
        return { ok: true, action: 'HOLD', disposition: exports.PENDING_INSPECTION, note: 'Held in quarantine until inspected.' };
    }
    if (requested === 'SCRAP')
        return { ok: true, action: 'SCRAP', disposition: 'SCRAP' };
    if (requested === 'RETURN_TO_VENDOR')
        return { ok: true, action: 'VENDOR', disposition: 'RETURN_TO_VENDOR' };
    if (requested !== 'RESTOCK')
        return { ok: false, message: `Unknown disposition "${requested}". Use RESTOCK, SCRAP or RETURN_TO_VENDOR.` };
    if (!input.qcRequired)
        return { ok: true, action: 'RESTOCK', disposition: 'RESTOCK' };
    if (input.verdict === 'PASS')
        return { ok: true, action: 'RESTOCK', disposition: 'RESTOCK' };
    if (input.verdict === 'FAIL')
        return { ok: true, action: 'HOLD', disposition: exports.QC_FAILED, note: 'QC failed: held in quarantine. Scrap it or return it to the vendor.' };
    return { ok: false, message: 'A QC inspection is required before this return can be restocked. Record the inspection, or hold it in quarantine.' };
}
function isPendingDisposition(disposition) {
    return !disposition || disposition === exports.PENDING_INSPECTION || disposition === exports.QC_FAILED;
}
/** A return can only be closed once nothing is still waiting for a disposition. */
function canCloseReturn(lines) {
    const waiting = lines.filter((line) => isPendingDisposition(line.disposition)).length;
    return waiting ? { ok: false, message: `${waiting} returned line(s) are still in quarantine awaiting a disposition.` } : { ok: true };
}
function parseRefundDecision(value) {
    return value === 'REFUNDED' || value === 'DENIED' ? value : null;
}
