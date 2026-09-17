import test from 'node:test';
import assert from 'node:assert/strict';
import { canReceiveTransfer, receiptQuantitiesMatch, validateReceiptLines } from './receipt-validation.js';

test('only operational admins and store users can receive transfers', () => {
  for (const role of ['ADMIN', 'ADMIN_USER', 'STORE_USER']) assert.equal(canReceiveTransfer(role), true);
  for (const role of ['AUDITOR', 'WAREHOUSE_PICKER', '', 'UNKNOWN']) assert.equal(canReceiveTransfer(role), false);
});
test('receipt reconciles good, damaged and shortage quantities', () => {
  assert.equal(receiptQuantitiesMatch(10, 7, 1, 2), true);
  assert.equal(receiptQuantitiesMatch(10, 10, 0, 1), false);
  assert.equal(receiptQuantitiesMatch(0.3, 0.1, 0.2, 0), true);
});
test('lot-wise partial receipts respect cumulative remaining quantity', () => {
  const lines = [
    { id: 'a', itemId: 'xyz', lotId: '210', quantity: 2, receivedQty: 1 },
    { id: 'b', itemId: 'xyz', lotId: '340', quantity: 4 },
    { id: 'c', itemId: 'xyz', lotId: '415', quantity: 2 },
  ];
  assert.equal(validateReceiptLines(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 1, damagedQty: 0, shortageQty: 0 }]).complete, false);
  const final = validateReceiptLines(lines, [
    { lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 1, damagedQty: 0, shortageQty: 0 },
    { lineId: 'b', itemId: 'xyz', lotId: '340', receivedQty: 4, damagedQty: 0, shortageQty: 0 },
    { lineId: 'c', itemId: 'xyz', lotId: '415', receivedQty: 2, damagedQty: 0, shortageQty: 0 },
  ]);
  assert.equal(final.complete, true);
  assert.equal(final.receivedQty, 7);
});
test('receipt rejects over-receipt and duplicate lot rows', () => {
  const lines = [{ id: 'a', itemId: 'xyz', lotId: '210', quantity: 2, receivedQty: 1 }];
  assert.throws(() => validateReceiptLines(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 2, damagedQty: 0, shortageQty: 0 }]), /exceeds/);
  assert.throws(() => validateReceiptLines(lines, [
    { lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 0.5, damagedQty: 0, shortageQty: 0 },
    { lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 0.5, damagedQty: 0, shortageQty: 0 },
  ]), /only once/);
});
test('excess receipt is never absorbed into the requested cap and always flags a discrepancy', () => {
  const lines = [{ id: 'a', itemId: 'xyz', lotId: '210', quantity: 2 }];
  // Requesting more than the line's own quantity for received+damaged+shortage
  // still throws - excess must be declared explicitly, not smuggled in here.
  assert.throws(() => validateReceiptLines(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 3, damagedQty: 0, shortageQty: 0 }]), /exceeds/);
  // Declared explicitly via excessQty, it is accepted beyond the line quantity.
  const result = validateReceiptLines(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 2, damagedQty: 0, shortageQty: 0, excessQty: 1 }]);
  assert.equal(result.excessQty, 1);
  assert.equal(result.complete, true);
  assert.equal(result.hasDiscrepancy, true);
});
test('receiptQuantitiesMatch allows a reconciled excess quantity beyond the expected total', () => {
  assert.equal(receiptQuantitiesMatch(10, 7, 1, 2), true);
  assert.equal(receiptQuantitiesMatch(10, 12, 0, 0, 2), true);
  assert.equal(receiptQuantitiesMatch(10, 9, 0, 0, 0), false);
});
