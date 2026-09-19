import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePick, isPickableLot, isPooledPick } from './kg-pick.js';

const today = new Date('2026-09-19T00:00:00Z');
const lots = [
  { lotId: 'a', lotNo: 'A', available: 2, expiryDate: '2027-03-01' },
  { lotId: 'b', lotNo: 'B', available: 3, expiryDate: '2026-11-01' },
  { lotId: 'c', lotNo: 'C', available: 4, expiryDate: null },
];

test('FEFO takes the earliest expiry first, FIFO keeps the lot order; the picker never splits lots', () => {
  const fefo = allocatePick({ requested: 4, lots, strategy: 'FEFO', today });
  assert.deepEqual(fefo.allocations.map((row) => [row.lotNo, row.quantity]), [['B', 3], ['A', 1]]);
  assert.equal(fefo.shortfall, 0);
  const fifo = allocatePick({ requested: 4, lots, strategy: 'FIFO', today });
  assert.deepEqual(fifo.allocations.map((row) => [row.lotNo, row.quantity]), [['A', 2], ['B', 2]]);
});

test('blocked, expired, quarantined and empty lots are never offered', () => {
  const messy = [
    { lotId: 'x', lotNo: 'X', available: 5, status: 'BLOCKED' as const },
    { lotId: 'y', lotNo: 'Y', available: 5, expiryDate: '2026-09-01' },
    { lotId: 'z', lotNo: 'Z', available: 0 },
    { lotId: 'q', lotNo: 'Q', available: 5, status: 'QUARANTINE' as const },
    { lotId: 'ok', lotNo: 'OK', available: 1.5, expiryDate: '2026-09-19' },
  ];
  assert.deepEqual(allocatePick({ requested: 1, lots: messy, strategy: 'FEFO', today }).allocations.map((row) => row.lotNo), ['OK']);
  assert.equal(isPickableLot({ available: 5, expiryDate: '2026-09-18' }, today), false);
  assert.equal(isPickableLot({ available: 5, expiryDate: '2026-09-19' }, today), true, 'a lot is good through its expiry day');
});

test('a request the shelf cannot cover reports the shortfall, decimals stay exact, and a bad quantity is refused', () => {
  const short = allocatePick({ requested: 10, lots, strategy: 'FEFO', today });
  assert.equal(short.allocations.reduce((sum, row) => sum + row.quantity, 0), 9);
  assert.equal(short.shortfall, 1);
  const decimals = allocatePick({ requested: 0.3, lots: [{ lotId: 'a', lotNo: 'A', available: 0.1 }, { lotId: 'b', lotNo: 'B', available: 0.2 }], strategy: 'FIFO', today });
  assert.deepEqual(decimals.allocations.map((row) => row.quantity), [0.1, 0.2]);
  assert.equal(decimals.shortfall, 0);
  assert.throws(() => allocatePick({ requested: 0, lots, strategy: 'FIFO' }), /greater than zero/);
  assert.throws(() => allocatePick({ requested: Number.NaN, lots, strategy: 'FIFO' }), /greater than zero/);
});

test('only pooled items are picked by weight from the whole shelf', () => {
  assert.equal(isPooledPick({ pickMethod: 'ITEM_QTY_FIFO' }), true);
  assert.equal(isPooledPick({ pickMethod: 'LOT_SCAN' }), false);
  assert.equal(isPooledPick({}), false);
});
