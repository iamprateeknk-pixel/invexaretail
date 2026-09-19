import test from 'node:test';
import assert from 'node:assert/strict';
import { planLateMovementReconciliation, reconciliationNote, type CountForLate, type LateMovement } from './late-movements.js';

const count = (over: Partial<CountForLate> = {}): CountForLate => ({
  id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', createdAt: '2026-09-18T10:00:00.000Z', status: 'PENDING_REVIEW', ...over,
});
const move = (over: Partial<LateMovement> = {}): LateMovement => ({
  key: 'k1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', transactionAt: '2026-09-18T08:00:00.000Z', qtyDelta: -4, ...over,
});

test('a movement dated before the count changes what the book quantity should have been', () => {
  const [outcome] = planLateMovementReconciliation([count()], [move(), move({ key: 'k2', qtyDelta: 10, transactionAt: '2026-09-18T09:59:59.000Z' })]);
  assert.deepEqual([outcome.countId, outcome.lateDelta, outcome.action, outcome.keys], ['c1', 6, 'ADJUST_PENDING', ['k1', 'k2']]);
});

test('movements after the count, or for another item, lot or branch, are not late for it', () => {
  const counts = [count()];
  assert.deepEqual(planLateMovementReconciliation(counts, [move({ transactionAt: '2026-09-18T10:00:01.000Z' })]), []);
  assert.deepEqual(planLateMovementReconciliation(counts, [move({ itemId: 'i2' })]), []);
  assert.deepEqual(planLateMovementReconciliation(counts, [move({ lotId: 'l2' })]), []);
  assert.deepEqual(planLateMovementReconciliation(counts, [move({ locationId: 'loc-2' })]), []);
  assert.deepEqual(planLateMovementReconciliation(counts, [move({ lotId: undefined })]), []);
  assert.deepEqual(planLateMovementReconciliation(counts, [move({ transactionAt: 'not a date' })]), []);
  // A movement at exactly the count time was already part of that moment's book.
  assert.equal(planLateMovementReconciliation(counts, [move({ transactionAt: '2026-09-18T10:00:00.000Z' })]).length, 1);
});

test('an approved count is flagged, never rewritten; rejected and recount ones are left alone', () => {
  assert.equal(planLateMovementReconciliation([count({ status: 'APPROVED' })], [move()])[0].action, 'FLAG_REVIEWED');
  assert.deepEqual(planLateMovementReconciliation([count({ status: 'REJECTED' }), count({ id: 'c2', status: 'RECOUNT' })], [move()]), []);
});

test('re-importing the same movements never applies them twice', () => {
  assert.deepEqual(planLateMovementReconciliation([count({ lateMovementKeys: ['k1'] })], [move()]), []);
  const [again] = planLateMovementReconciliation([count({ lateMovementKeys: ['k1'] })], [move(), move({ key: 'k3', qtyDelta: -1 })]);
  assert.deepEqual([again.lateDelta, again.keys], [-1, ['k3']]);
  // The same key twice in one file is counted once.
  assert.equal(planLateMovementReconciliation([count()], [move(), move()])[0].lateDelta, -4);
});

test('the reviewer is told what changed in plain words', () => {
  const pending = reconciliationNote({ countId: 'c', lateDelta: -4, keys: ['k'], action: 'ADJUST_PENDING' }, 28, 24, 'sales');
  assert.match(pending, /sales movement\(s\).*-4: 28 -> 24/);
  const approved = reconciliationNote({ countId: 'c', lateDelta: 5, keys: ['k'], action: 'FLAG_REVIEWED' }, 28, 28, 'purchase');
  assert.match(approved, /already approved|after it was approved/);
  assert.match(approved, /\+5/);
});
