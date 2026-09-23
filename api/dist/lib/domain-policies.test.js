"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 7: transition-map coverage for the six named entities. Pure logic
// (allowed*Moves tables) runs in memory mode; the async assert* wrappers
// also write an audit-log row when DB-backed, covered separately by the
// .postgres.test.ts suites for the modules they wrap.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const domain_policies_js_1 = require("./domain-policies.js");
const errors_js_1 = require("./errors.js");
(0, node_test_1.default)('StockCount review: PENDING_REVIEW can move to APPROVED, REJECTED or RECOUNT, never directly to itself', () => {
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedCountReviewMoves)('PENDING_REVIEW').sort(), ['APPROVED', 'RECOUNT', 'REJECTED']);
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedCountReviewMoves)('APPROVED'), []);
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedCountReviewMoves)('REJECTED'), []);
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedCountReviewMoves)('RECOUNT'), ['PENDING_REVIEW']);
});
(0, node_test_1.default)('StockCount review: an illegal transition is rejected as a stable, catalogued DomainError with a trace ID', async () => {
    await strict_1.default.rejects(() => (0, domain_policies_js_1.assertValidCountReviewTransition)('APPROVED', 'REJECTED', 'count-1', { actorId: 'u1', actorRole: 'ADMIN' }), (error) => {
        strict_1.default.ok((0, errors_js_1.isDomainError)(error));
        strict_1.default.ok(error instanceof domain_policies_js_1.InvalidTransitionError);
        strict_1.default.equal(error.code, 'INVALID_TRANSITION');
        strict_1.default.ok(error.traceId, 'a trace ID must always be present, generated if the caller did not supply one');
        return true;
    });
});
(0, node_test_1.default)('StockCount review: a legal transition does not throw', async () => {
    await strict_1.default.doesNotReject(() => (0, domain_policies_js_1.assertValidCountReviewTransition)('PENDING_REVIEW', 'APPROVED', 'count-2', { actorId: 'u1', actorRole: 'ADMIN' }));
});
(0, node_test_1.default)('Order: RESERVED can move to FULFILLED, CANCELLED, EXPIRED or BACKORDERED', () => {
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedOrderMoves)('RESERVED').sort(), ['BACKORDERED', 'CANCELLED', 'EXPIRED', 'FULFILLED']);
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedOrderMoves)('FULFILLED'), [], 'FULFILLED is terminal - stock has physically shipped, it cannot un-fulfil');
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedOrderMoves)('CANCELLED'), []);
    strict_1.default.deepEqual((0, domain_policies_js_1.allowedOrderMoves)('EXPIRED'), []);
});
(0, node_test_1.default)('Order: a fulfilled order cannot be cancelled - the exact rule the old ad hoc check in orders.ts enforced, now centrally', async () => {
    await strict_1.default.rejects(() => (0, domain_policies_js_1.assertValidOrderTransition)('FULFILLED', 'CANCELLED', 'order-1', { actorId: 'system', actorRole: 'SYSTEM' }), domain_policies_js_1.InvalidTransitionError);
});
(0, node_test_1.default)('Order: reusing a supplied trace ID keeps the same trace ID on the thrown error', async () => {
    const traceId = 'trace-abc-123';
    await strict_1.default.rejects(() => (0, domain_policies_js_1.assertValidOrderTransition)('FULFILLED', 'RESERVED', 'order-2', { actorId: 'system', actorRole: 'SYSTEM' }, traceId), (error) => {
        strict_1.default.equal(error.traceId, traceId);
        return true;
    });
});
(0, node_test_1.default)('QcInspection: overallResult is write-once - setting it once is fine, changing an existing result throws', () => {
    strict_1.default.doesNotThrow(() => (0, domain_policies_js_1.assertInspectionResultImmutable)(null, 'insp-1'));
    strict_1.default.doesNotThrow(() => (0, domain_policies_js_1.assertInspectionResultImmutable)(undefined, 'insp-1'));
    strict_1.default.throws(() => (0, domain_policies_js_1.assertInspectionResultImmutable)('PASS', 'insp-1'), domain_policies_js_1.InvalidTransitionError);
});
