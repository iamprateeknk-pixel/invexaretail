"use strict";
// Blueprint v4 §22 Purchase orders:
//   Reorder signal -> Draft PO -> Supplier selection -> Approval -> Send ->
//   Expected receipt -> Partial/full receive -> Invoice match -> Close
// PATCH /purchase-orders/:id/status used to accept any status from any status.
// This is the one place that says which moves are legal.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PO_STATUSES = void 0;
exports.isPoStatus = isPoStatus;
exports.allowedPoMoves = allowedPoMoves;
exports.isReceivablePo = isReceivablePo;
exports.checkPoMove = checkPoMove;
exports.PO_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];
const MOVES = {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['APPROVED', 'DRAFT', 'CANCELLED'],
    APPROVED: ['SENT', 'CANCELLED'],
    SENT: ['CANCELLED'],
    // Receiving moves these; the status route only offers the closing moves.
    PARTIALLY_RECEIVED: ['CLOSED'],
    RECEIVED: ['CLOSED'],
    CLOSED: [],
    CANCELLED: [],
};
function isPoStatus(value) {
    return typeof value === 'string' && exports.PO_STATUSES.includes(value);
}
function allowedPoMoves(from) {
    return MOVES[from] ?? [];
}
/** Goods can arrive once the order is approved - and only until it is closed or cancelled. */
function isReceivablePo(status) {
    return ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(status);
}
function checkPoMove(input) {
    if (!allowedPoMoves(input.from).includes(input.to)) {
        return { ok: false, message: `A purchase order cannot move from ${input.from} to ${input.to}.` };
    }
    if (input.to === 'CANCELLED' && input.anyReceived) {
        return { ok: false, message: 'Goods were already received against this order, so it cannot be cancelled. Close it instead.' };
    }
    const note = (input.note ?? '').trim();
    if (input.to === 'CLOSED') {
        if (input.from === 'PARTIALLY_RECEIVED' && note.length < 5) {
            return { ok: false, message: 'Closing an order that is only partly received (short close) needs a reason of at least 5 characters.' };
        }
        // Blueprint: close follows the invoice match. Without a matched invoice the
        // finance team must say why it is closing anyway.
        if (!input.invoiceStatuses.includes('MATCHED') && note.length < 5) {
            return { ok: false, message: 'No supplier invoice has been matched to this order. Match one, or give a reason of at least 5 characters to close without it.' };
        }
    }
    return { ok: true };
}
