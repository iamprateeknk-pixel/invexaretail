import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPackScan } from './pack-verification.js';

test('scanning exactly what was ordered is ready to seal', () => {
  const result = verifyPackScan(
    [{ itemId: 'item-1', lotId: 'lot-1', requestedQty: 3 }],
    [{ itemId: 'item-1', lotId: 'lot-1', quantity: 3 }],
  );
  assert.equal(result.readyToSeal, true);
  assert.equal(result.lines[0].status, 'MATCHED');
});

test('an empty carton is never ready to seal', () => {
  const result = verifyPackScan([{ itemId: 'item-1', requestedQty: 1 }], []);
  assert.equal(result.readyToSeal, false);
  assert.equal(result.lines[0].status, 'SHORT');
});

test('scanning less than ordered blocks sealing (short)', () => {
  const result = verifyPackScan(
    [{ itemId: 'item-1', requestedQty: 5 }],
    [{ itemId: 'item-1', quantity: 3 }],
  );
  assert.equal(result.readyToSeal, false);
  assert.equal(result.lines[0].status, 'SHORT');
  assert.equal(result.lines[0].scannedQty, 3);
});

test('scanning more than ordered blocks sealing (over) instead of silently accepting it', () => {
  const result = verifyPackScan(
    [{ itemId: 'item-1', requestedQty: 2 }],
    [{ itemId: 'item-1', quantity: 4 }],
  );
  assert.equal(result.readyToSeal, false);
  assert.equal(result.lines[0].status, 'OVER');
});

test('scanning an item that is not on the order is flagged unexpected, not silently ignored', () => {
  const result = verifyPackScan(
    [{ itemId: 'item-1', requestedQty: 1 }],
    [{ itemId: 'item-1', quantity: 1 }, { itemId: 'item-wrong', quantity: 1 }],
  );
  assert.equal(result.readyToSeal, false);
  const wrong = result.lines.find((line) => line.itemId === 'item-wrong');
  assert.equal(wrong?.status, 'UNEXPECTED');
});

test('multiple scans of the same item/lot accumulate before comparing', () => {
  const result = verifyPackScan(
    [{ itemId: 'item-1', requestedQty: 5 }],
    [{ itemId: 'item-1', quantity: 2 }, { itemId: 'item-1', quantity: 3 }],
  );
  assert.equal(result.readyToSeal, true);
  assert.equal(result.lines[0].scannedQty, 5);
});

test('different lots of the same item are tracked separately', () => {
  const result = verifyPackScan(
    [
      { itemId: 'item-1', lotId: 'lot-a', requestedQty: 2 },
      { itemId: 'item-1', lotId: 'lot-b', requestedQty: 1 },
    ],
    [{ itemId: 'item-1', lotId: 'lot-a', quantity: 2 }],
  );
  assert.equal(result.readyToSeal, false);
  const lotB = result.lines.find((line) => line.lotId === 'lot-b');
  assert.equal(lotB?.status, 'SHORT');
});
