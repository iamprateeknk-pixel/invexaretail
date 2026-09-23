"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_STATUSES = exports.COUNT_REVIEW_STATUSES = exports.PO_STATUSES = exports.InvalidTransitionError = void 0;
exports.assertValidTransferTransitionAudited = assertValidTransferTransitionAudited;
exports.assertValidPurchaseOrderTransition = assertValidPurchaseOrderTransition;
exports.assertValidReturnTransition = assertValidReturnTransition;
exports.allowedCountReviewMoves = allowedCountReviewMoves;
exports.assertValidCountReviewTransition = assertValidCountReviewTransition;
exports.allowedOrderMoves = allowedOrderMoves;
exports.assertValidOrderTransition = assertValidOrderTransition;
exports.assertInspectionResultImmutable = assertInspectionResultImmutable;
// ADR-006 / Week 7: one place that says which state transitions are legal
// for the six entities the guide names (Transfer, StockCount, PurchaseOrder,
// Order, ReturnRequest, QcInspection), and one shape for rejecting an
// illegal one: a `DomainError` with a stable `code`, a `traceId`, and a
// best-effort audit-log row naming the actor, the entity, and the reason -
// so a rejected transition is explainable from logs alone.
//
// Three of the six already had a dedicated lifecycle module before this
// week (`transfer-lifecycle.ts`, `po-lifecycle.ts`, `returns-rma.ts`) - this
// module does not replace them (their role-aware/action-aware logic stays
// where it is, and existing call sites keep calling them directly), it
// wraps their rejection into the shared `DomainError` shape and adds the
// audit-log side effect Week 7 asks for centrally, rather than duplicating
// three known-good state machines. StockCount's review workflow and Order's
// status field had no transition map at all before this week; both are new
// here. QcInspection is the one entity where "transition map" does not
// apply - see the note below.
const node_crypto_1 = require("node:crypto");
const errors_js_1 = require("./errors.js");
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
const transfer_lifecycle_js_1 = require("./transfer-lifecycle.js");
const po_lifecycle_js_1 = require("./po-lifecycle.js");
Object.defineProperty(exports, "PO_STATUSES", { enumerable: true, get: function () { return po_lifecycle_js_1.PO_STATUSES; } });
const returns_rma_js_1 = require("./returns-rma.js");
class InvalidTransitionError extends errors_js_1.DomainError {
    entity;
    from;
    to;
    constructor(entity, from, to, traceId) {
        super('INVALID_TRANSITION', `Cannot move ${entity} from ${from} to ${to}.`, traceId);
        this.entity = entity;
        this.from = from;
        this.to = to;
        this.name = 'InvalidTransitionError';
    }
}
exports.InvalidTransitionError = InvalidTransitionError;
async function logRejection(entity, entityId, from, to, ctx, traceId) {
    if (!persistence_js_1.databaseEnabled)
        return;
    try {
        await db_js_1.prisma.auditLog.create({
            data: {
                id: (0, node_crypto_1.randomUUID)(),
                actorId: ctx.actorId,
                actorRole: ctx.actorRole,
                action: 'TRANSITION_REJECTED',
                entityType: entity,
                entityId,
                reason: ctx.reason,
                correlationId: ctx.correlationId ?? traceId,
                metadata: { from, to, traceId },
            },
        });
    }
    catch (error) {
        // Auditability of a rejection must never itself block the rejection
        // (or, worse, let the caller's transaction fail on something unrelated
        // to the business rule it's enforcing) - log and move on.
        console.error('[domain-policies] failed to record transition-rejection audit log', error);
    }
}
// --- Transfer -----------------------------------------------------------
// Delegates to transfer-lifecycle.ts's existing role+status map.
async function assertValidTransferTransitionAudited(role, from, to, entityId, ctx, traceId = (0, errors_js_1.newTraceId)()) {
    if ((0, transfer_lifecycle_js_1.allowedTransferTransitions)(role, from).includes(to))
        return;
    await logRejection('Transfer', entityId, from, to, ctx, traceId);
    throw new InvalidTransitionError('Transfer', from, to, traceId);
}
// --- PurchaseOrder --------------------------------------------------------
// Delegates to po-lifecycle.ts's existing MOVES table.
async function assertValidPurchaseOrderTransition(from, to, entityId, ctx, traceId = (0, errors_js_1.newTraceId)()) {
    if ((0, po_lifecycle_js_1.allowedPoMoves)(from).includes(to))
        return;
    await logRejection('PurchaseOrder', entityId, from, to, ctx, traceId);
    throw new InvalidTransitionError('PurchaseOrder', from, to, traceId);
}
// --- ReturnRequest --------------------------------------------------------
// Delegates to returns-rma.ts's existing action-keyed TRANSITIONS table.
async function assertValidReturnTransition(from, action, entityId, ctx, traceId = (0, errors_js_1.newTraceId)()) {
    const to = (0, returns_rma_js_1.nextReturnStatus)(from, action);
    if (to)
        return to;
    await logRejection('ReturnRequest', entityId, from, action, ctx, traceId);
    throw new InvalidTransitionError('ReturnRequest', from, action, traceId);
}
exports.COUNT_REVIEW_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RECOUNT'];
const COUNT_REVIEW_MOVES = {
    PENDING_REVIEW: ['APPROVED', 'REJECTED', 'RECOUNT'],
    RECOUNT: ['PENDING_REVIEW'],
    APPROVED: [],
    REJECTED: [],
};
function allowedCountReviewMoves(from) {
    return COUNT_REVIEW_MOVES[from] ?? [];
}
async function assertValidCountReviewTransition(from, to, entityId, ctx, traceId = (0, errors_js_1.newTraceId)()) {
    if (allowedCountReviewMoves(from).includes(to))
        return;
    await logRejection('StockCount', entityId, from, to, ctx, traceId);
    throw new InvalidTransitionError('StockCount', from, to, traceId);
}
exports.ORDER_STATUSES = ['RESERVED', 'BACKORDERED', 'FULFILLED', 'CANCELLED', 'EXPIRED'];
const ORDER_MOVES = {
    RESERVED: ['FULFILLED', 'CANCELLED', 'EXPIRED', 'BACKORDERED'],
    BACKORDERED: ['RESERVED', 'CANCELLED'],
    FULFILLED: [],
    CANCELLED: [],
    EXPIRED: [],
};
function allowedOrderMoves(from) {
    return ORDER_MOVES[from] ?? [];
}
async function assertValidOrderTransition(from, to, entityId, ctx, traceId = (0, errors_js_1.newTraceId)()) {
    if (allowedOrderMoves(from).includes(to))
        return;
    await logRejection('Order', entityId, from, to, ctx, traceId);
    throw new InvalidTransitionError('Order', from, to, traceId);
}
// --- QcInspection -----------------------------------------------------
// Not a state machine: the Prisma model has no `.status` field, only a
// single `overallResult` ('PASS' | 'FAIL') computed once by
// `lib/qc-inspection.ts`'s `evaluateInspection` at creation time and never
// updated afterward - there is no later transition for this policy to
// police. Documented here (rather than silently having no sixth entity)
// so a reader auditing the six named in the Week 7 scope finds an explicit
// decision instead of a gap: this module exports the invariant that
// `overallResult` is write-once, so anything that ever tries to *update* an
// existing inspection's result should route through this assertion instead
// of a bare `prisma.qcInspection.update`.
function assertInspectionResultImmutable(existingResult, entityId, traceId = (0, errors_js_1.newTraceId)()) {
    if (existingResult === null || existingResult === undefined)
        return;
    throw new InvalidTransitionError('QcInspection', existingResult, existingResult, traceId);
}
