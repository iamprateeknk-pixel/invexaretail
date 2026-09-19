import test from 'node:test';
import assert from 'node:assert/strict';
import { isRestockDisposition, nextReturnStatus, validateReturnLines } from './returns-rma.js';

test('a return line within the fulfilled/not-yet-returned quantity is valid', () => {
  const result = validateReturnLines([{ orderLineId: 'l1', quantity: 2, fulfilledQty: 5, alreadyReturnedQty: 0 }]);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test('requesting more than the remaining eligible quantity is rejected', () => {
  const result = validateReturnLines([{ orderLineId: 'l1', quantity: 4, fulfilledQty: 5, alreadyReturnedQty: 2 }]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /only 3/);
});

test('a non-positive return quantity is rejected', () => {
  const result = validateReturnLines([{ orderLineId: 'l1', quantity: 0, fulfilledQty: 5, alreadyReturnedQty: 0 }]);
  assert.equal(result.ok, false);
});

test('an empty line list is rejected', () => {
  assert.equal(validateReturnLines([]).ok, false);
});

test('the return status machine allows REQUESTED -> APPROVED -> RECEIVED -> CLOSED', () => {
  assert.equal(nextReturnStatus('REQUESTED', 'APPROVE'), 'APPROVED');
  assert.equal(nextReturnStatus('APPROVED', 'RECEIVE'), 'RECEIVED');
  assert.equal(nextReturnStatus('RECEIVED', 'CLOSE'), 'CLOSED');
});

test('the return status machine allows REQUESTED -> REJECTED as a terminal state', () => {
  assert.equal(nextReturnStatus('REQUESTED', 'REJECT'), 'REJECTED');
  assert.equal(nextReturnStatus('REJECTED', 'APPROVE'), null);
});

test('an out-of-order transition is rejected, not silently skipped', () => {
  assert.equal(nextReturnStatus('REQUESTED', 'RECEIVE'), null);
  assert.equal(nextReturnStatus('CLOSED', 'CLOSE'), null);
});

test('isRestockDisposition narrows only the RESTOCK value', () => {
  assert.equal(isRestockDisposition('RESTOCK'), true);
  assert.equal(isRestockDisposition('SCRAP'), false);
});

import { canCloseReturn, isPendingDisposition, parseRefundDecision, planReturnLine } from './returns-rma.js';

test('a received return is held, never restocked by default', () => {
  assert.deepEqual(planReturnLine({ requested: undefined, qcRequired: false, verdict: null }), { ok: true, action: 'HOLD', disposition: 'PENDING_INSPECTION', note: 'Held in quarantine until inspected.' });
  assert.equal(planReturnLine({ requested: '', qcRequired: true, verdict: null }).ok && (planReturnLine({ requested: '', qcRequired: true, verdict: null }) as { action: string }).action, 'HOLD');
});

test('restock needs a passing QC where QC applies; a failure holds it for scrap or vendor return', () => {
  assert.equal((planReturnLine({ requested: 'RESTOCK', qcRequired: false, verdict: null }) as { action: string }).action, 'RESTOCK');
  assert.equal((planReturnLine({ requested: 'restock', qcRequired: true, verdict: 'PASS' }) as { action: string }).action, 'RESTOCK');
  const failed = planReturnLine({ requested: 'RESTOCK', qcRequired: true, verdict: 'FAIL' });
  assert.deepEqual([failed.ok && failed.action, failed.ok && failed.disposition], ['HOLD', 'QC_FAILED']);
  const missing = planReturnLine({ requested: 'RESTOCK', qcRequired: true, verdict: null });
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? '' : missing.message, /QC inspection is required/);
});

test('scrap and vendor return never need QC; unknown dispositions are refused', () => {
  assert.equal((planReturnLine({ requested: 'SCRAP', qcRequired: true, verdict: null }) as { action: string }).action, 'SCRAP');
  assert.equal((planReturnLine({ requested: 'RETURN_TO_VENDOR', qcRequired: true, verdict: 'FAIL' }) as { action: string }).action, 'VENDOR');
  assert.equal(planReturnLine({ requested: 'GIVE_AWAY', qcRequired: false, verdict: null }).ok, false);
});

test('a return closes only when every line has a real disposition', () => {
  assert.equal(isPendingDisposition(null), true);
  assert.equal(isPendingDisposition('QC_FAILED'), true);
  assert.equal(isPendingDisposition('RESTOCK'), false);
  assert.equal(canCloseReturn([{ disposition: 'RESTOCK' }, { disposition: 'SCRAP' }]).ok, true);
  assert.equal(canCloseReturn([{ disposition: 'RESTOCK' }, { disposition: 'PENDING_INSPECTION' }]).ok, false);
});

test('a refund decision is one of two explicit values', () => {
  assert.equal(parseRefundDecision('REFUNDED'), 'REFUNDED');
  assert.equal(parseRefundDecision('DENIED'), 'DENIED');
  assert.equal(parseRefundDecision('PENDING'), null);
  assert.equal(parseRefundDecision(undefined), null);
});
