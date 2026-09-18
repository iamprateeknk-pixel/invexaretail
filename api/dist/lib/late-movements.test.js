"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const late_movements_js_1 = require("./late-movements.js");
const count = (over = {}) => ({
    id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', createdAt: '2026-09-18T10:00:00.000Z', status: 'PENDING_REVIEW', ...over,
});
const move = (over = {}) => ({
    key: 'k1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', transactionAt: '2026-09-18T08:00:00.000Z', qtyDelta: -4, ...over,
});
(0, node_test_1.default)('a movement dated before the count changes what the book quantity should have been', () => {
    const [outcome] = (0, late_movements_js_1.planLateMovementReconciliation)([count()], [move(), move({ key: 'k2', qtyDelta: 10, transactionAt: '2026-09-18T09:59:59.000Z' })]);
    strict_1.default.deepEqual([outcome.countId, outcome.lateDelta, outcome.action, outcome.keys], ['c1', 6, 'ADJUST_PENDING', ['k1', 'k2']]);
});
(0, node_test_1.default)('movements after the count, or for another item, lot or branch, are not late for it', () => {
    const counts = [count()];
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ transactionAt: '2026-09-18T10:00:01.000Z' })]), []);
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ itemId: 'i2' })]), []);
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ lotId: 'l2' })]), []);
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ locationId: 'loc-2' })]), []);
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ lotId: undefined })]), []);
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ transactionAt: 'not a date' })]), []);
    // A movement at exactly the count time was already part of that moment's book.
    strict_1.default.equal((0, late_movements_js_1.planLateMovementReconciliation)(counts, [move({ transactionAt: '2026-09-18T10:00:00.000Z' })]).length, 1);
});
(0, node_test_1.default)('an approved count is flagged, never rewritten; rejected and recount ones are left alone', () => {
    strict_1.default.equal((0, late_movements_js_1.planLateMovementReconciliation)([count({ status: 'APPROVED' })], [move()])[0].action, 'FLAG_REVIEWED');
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)([count({ status: 'REJECTED' }), count({ id: 'c2', status: 'RECOUNT' })], [move()]), []);
});
(0, node_test_1.default)('re-importing the same movements never applies them twice', () => {
    strict_1.default.deepEqual((0, late_movements_js_1.planLateMovementReconciliation)([count({ lateMovementKeys: ['k1'] })], [move()]), []);
    const [again] = (0, late_movements_js_1.planLateMovementReconciliation)([count({ lateMovementKeys: ['k1'] })], [move(), move({ key: 'k3', qtyDelta: -1 })]);
    strict_1.default.deepEqual([again.lateDelta, again.keys], [-1, ['k3']]);
    // The same key twice in one file is counted once.
    strict_1.default.equal((0, late_movements_js_1.planLateMovementReconciliation)([count()], [move(), move()])[0].lateDelta, -4);
});
(0, node_test_1.default)('the reviewer is told what changed in plain words', () => {
    const pending = (0, late_movements_js_1.reconciliationNote)({ countId: 'c', lateDelta: -4, keys: ['k'], action: 'ADJUST_PENDING' }, 28, 24, 'sales');
    strict_1.default.match(pending, /sales movement\(s\).*-4: 28 -> 24/);
    const approved = (0, late_movements_js_1.reconciliationNote)({ countId: 'c', lateDelta: 5, keys: ['k'], action: 'FLAG_REVIEWED' }, 28, 28, 'purchase');
    strict_1.default.match(approved, /already approved|after it was approved/);
    strict_1.default.match(approved, /\+5/);
});
