import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyReceiptLine, poActions, receiptBody, receiptProgress, urgencyVariant } from './procurement.js';

test('each stage offers only its next moves, and only admins act', () => {
  assert.deepEqual(poActions('ADMIN', 'DRAFT').moves.map((move) => move.to), ['SUBMITTED', 'CANCELLED']);
  assert.deepEqual(poActions('ADMIN', 'SUBMITTED').moves.map((move) => move.label), ['Approve', 'Send back', 'Cancel']);
  assert.equal(poActions('ADMIN', 'DRAFT').receive, false);
  assert.equal(poActions('ADMIN', 'SENT').receive, true);
  assert.equal(poActions('ADMIN_USER', 'PARTIALLY_RECEIVED').moves[0].needsNote, true);
  assert.deepEqual(poActions('STORE_USER', 'APPROVED'), { moves: [], receive: false });
  assert.deepEqual(poActions('ADMIN', 'CLOSED').moves, []);
});

const order = { lines: [{ id: 'l1', itemId: 'a', quantity: 10, receivedQty: 4, item: { name: 'Milk' } }, { id: 'l2', itemId: 'b', quantity: 3, receivedQty: 0 }] };

test('a receipt body carries the request id, skips empty lines and refuses more than is open', () => {
  const filled = { l1: { ...emptyReceiptLine(), received: '5', damaged: '1', lotNo: ' B7 ', expiryDate: '2027-02-01' }, l2: emptyReceiptLine() };
  assert.deepEqual(receiptBody(order, filled, 'req-1'), {
    requestId: 'req-1',
    lines: [{ lineId: 'l1', receivedQty: 5, damagedQty: 1, excessQty: 0, lotNo: 'B7', expiryDate: '2027-02-01' }],
  });
  assert.throws(() => receiptBody(order, { l1: { ...emptyReceiptLine(), received: '6', damaged: '1' } }, 'r'), /only 6 is still open/);
  assert.deepEqual(receiptBody(order, { l1: { ...emptyReceiptLine(), received: '6', excess: '2' } }, 'r').lines[0].excessQty, 2);
  assert.throws(() => receiptBody(order, {}, 'r'), /at least one line/);
  assert.throws(() => receiptBody(order, { l2: { ...emptyReceiptLine(), received: '-1' } }, 'r'), /valid quantities/);
});

test('progress and urgency labels', () => {
  assert.deepEqual(receiptProgress(order), { ordered: 13, received: 4, percent: 31 });
  assert.deepEqual(receiptProgress({}), { ordered: 0, received: 0, percent: 0 });
  assert.deepEqual([urgencyVariant('CRITICAL'), urgencyVariant('HIGH'), urgencyVariant('NORMAL')], ['destructive', 'warning', 'outline']);
});
