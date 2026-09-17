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
