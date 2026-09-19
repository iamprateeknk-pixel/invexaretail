"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const returns_rma_js_1 = require("./returns-rma.js");
(0, node_test_1.default)('a return line within the fulfilled/not-yet-returned quantity is valid', () => {
    const result = (0, returns_rma_js_1.validateReturnLines)([{ orderLineId: 'l1', quantity: 2, fulfilledQty: 5, alreadyReturnedQty: 0 }]);
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.errors.length, 0);
});
(0, node_test_1.default)('requesting more than the remaining eligible quantity is rejected', () => {
    const result = (0, returns_rma_js_1.validateReturnLines)([{ orderLineId: 'l1', quantity: 4, fulfilledQty: 5, alreadyReturnedQty: 2 }]);
    strict_1.default.equal(result.ok, false);
    strict_1.default.match(result.errors[0], /only 3/);
});
(0, node_test_1.default)('a non-positive return quantity is rejected', () => {
    const result = (0, returns_rma_js_1.validateReturnLines)([{ orderLineId: 'l1', quantity: 0, fulfilledQty: 5, alreadyReturnedQty: 0 }]);
    strict_1.default.equal(result.ok, false);
});
(0, node_test_1.default)('an empty line list is rejected', () => {
    strict_1.default.equal((0, returns_rma_js_1.validateReturnLines)([]).ok, false);
});
(0, node_test_1.default)('the return status machine allows REQUESTED -> APPROVED -> RECEIVED -> CLOSED', () => {
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REQUESTED', 'APPROVE'), 'APPROVED');
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('APPROVED', 'RECEIVE'), 'RECEIVED');
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('RECEIVED', 'CLOSE'), 'CLOSED');
});
(0, node_test_1.default)('the return status machine allows REQUESTED -> REJECTED as a terminal state', () => {
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REQUESTED', 'REJECT'), 'REJECTED');
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REJECTED', 'APPROVE'), null);
});
(0, node_test_1.default)('an out-of-order transition is rejected, not silently skipped', () => {
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REQUESTED', 'RECEIVE'), null);
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('CLOSED', 'CLOSE'), null);
});
(0, node_test_1.default)('isRestockDisposition narrows only the RESTOCK value', () => {
    strict_1.default.equal((0, returns_rma_js_1.isRestockDisposition)('RESTOCK'), true);
    strict_1.default.equal((0, returns_rma_js_1.isRestockDisposition)('SCRAP'), false);
});
const returns_rma_js_2 = require("./returns-rma.js");
(0, node_test_1.default)('a received return is held, never restocked by default', () => {
    strict_1.default.deepEqual((0, returns_rma_js_2.planReturnLine)({ requested: undefined, qcRequired: false, verdict: null }), { ok: true, action: 'HOLD', disposition: 'PENDING_INSPECTION', note: 'Held in quarantine until inspected.' });
    strict_1.default.equal((0, returns_rma_js_2.planReturnLine)({ requested: '', qcRequired: true, verdict: null }).ok && (0, returns_rma_js_2.planReturnLine)({ requested: '', qcRequired: true, verdict: null }).action, 'HOLD');
});
(0, node_test_1.default)('restock needs a passing QC where QC applies; a failure holds it for scrap or vendor return', () => {
    strict_1.default.equal((0, returns_rma_js_2.planReturnLine)({ requested: 'RESTOCK', qcRequired: false, verdict: null }).action, 'RESTOCK');
    strict_1.default.equal((0, returns_rma_js_2.planReturnLine)({ requested: 'restock', qcRequired: true, verdict: 'PASS' }).action, 'RESTOCK');
    const failed = (0, returns_rma_js_2.planReturnLine)({ requested: 'RESTOCK', qcRequired: true, verdict: 'FAIL' });
    strict_1.default.deepEqual([failed.ok && failed.action, failed.ok && failed.disposition], ['HOLD', 'QC_FAILED']);
    const missing = (0, returns_rma_js_2.planReturnLine)({ requested: 'RESTOCK', qcRequired: true, verdict: null });
    strict_1.default.equal(missing.ok, false);
    strict_1.default.match(missing.ok ? '' : missing.message, /QC inspection is required/);
});
(0, node_test_1.default)('scrap and vendor return never need QC; unknown dispositions are refused', () => {
    strict_1.default.equal((0, returns_rma_js_2.planReturnLine)({ requested: 'SCRAP', qcRequired: true, verdict: null }).action, 'SCRAP');
    strict_1.default.equal((0, returns_rma_js_2.planReturnLine)({ requested: 'RETURN_TO_VENDOR', qcRequired: true, verdict: 'FAIL' }).action, 'VENDOR');
    strict_1.default.equal((0, returns_rma_js_2.planReturnLine)({ requested: 'GIVE_AWAY', qcRequired: false, verdict: null }).ok, false);
});
(0, node_test_1.default)('a return closes only when every line has a real disposition', () => {
    strict_1.default.equal((0, returns_rma_js_2.isPendingDisposition)(null), true);
    strict_1.default.equal((0, returns_rma_js_2.isPendingDisposition)('QC_FAILED'), true);
    strict_1.default.equal((0, returns_rma_js_2.isPendingDisposition)('RESTOCK'), false);
    strict_1.default.equal((0, returns_rma_js_2.canCloseReturn)([{ disposition: 'RESTOCK' }, { disposition: 'SCRAP' }]).ok, true);
    strict_1.default.equal((0, returns_rma_js_2.canCloseReturn)([{ disposition: 'RESTOCK' }, { disposition: 'PENDING_INSPECTION' }]).ok, false);
});
(0, node_test_1.default)('a refund decision is one of two explicit values', () => {
    strict_1.default.equal((0, returns_rma_js_2.parseRefundDecision)('REFUNDED'), 'REFUNDED');
    strict_1.default.equal((0, returns_rma_js_2.parseRefundDecision)('DENIED'), 'DENIED');
    strict_1.default.equal((0, returns_rma_js_2.parseRefundDecision)('PENDING'), null);
    strict_1.default.equal((0, returns_rma_js_2.parseRefundDecision)(undefined), null);
});
