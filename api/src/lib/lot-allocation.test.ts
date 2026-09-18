import assert from 'node:assert/strict';
import test from 'node:test';

import { allocatePhysicalAcrossLots } from './lot-allocation.js';

test('FIFO allocates a 5kg item count over three 2kg lots as 2 + 2 + 1', () => {
  const result = allocatePhysicalAcrossLots({
    physicalQty: 5,
    strategy: 'FIFO',
    lots: [
      { lotId: 'lot-1', onHand: 2, receivedAt: '2026-09-01T10:00:00Z' },
      { lotId: 'lot-2', onHand: 2, receivedAt: '2026-09-02T10:00:00Z' },
      { lotId: 'lot-3', onHand: 2, receivedAt: '2026-09-03T10:00:00Z' },
    ],
  });

  assert.deepEqual(result.allocations.map((row) => row.physicalQty), [2, 2, 1]);
  assert.deepEqual(result.allocations.map((row) => row.variance), [0, 0, -1]);
  assert.equal(result.totalBookQty, 6);
  assert.equal(result.physicalQty, 5);
  assert.equal(result.totalVariance, -1);
  assert.equal(result.excessQty, 0);
});

test('quantity above book stock is surfaced as excess instead of creating a fake negative/overflow lot', () => {
  const result = allocatePhysicalAcrossLots({
    physicalQty: 7,
    lots: [
      { lotId: 'lot-1', onHand: 2 },
      { lotId: 'lot-2', onHand: 2 },
      { lotId: 'lot-3', onHand: 2 },
    ],
  });

  assert.deepEqual(result.allocations.map((row) => row.physicalQty), [2, 2, 2]);
  assert.equal(result.allocatedQty, 6);
  assert.equal(result.excessQty, 1);
  assert.equal(result.totalVariance, 1);
});

test('FEFO consumes the earliest-expiring lot first', () => {
  const result = allocatePhysicalAcrossLots({
    physicalQty: 3,
    strategy: 'FEFO',
    lots: [
      { lotId: 'late', onHand: 2, expiryDate: '2027-06-01' },
      { lotId: 'early', onHand: 2, expiryDate: '2026-10-01' },
    ],
  });

  assert.deepEqual(result.allocations.map((row) => row.lotId), ['early', 'late']);
  assert.deepEqual(result.allocations.map((row) => row.physicalQty), [2, 1]);
});

test('decimal KG quantities respect configured precision', () => {
  const result = allocatePhysicalAcrossLots({
    physicalQty: 4.375,
    precision: 3,
    lots: [
      { lotId: 'a', onHand: 2.125 },
      { lotId: 'b', onHand: 3.25 },
    ],
  });

  assert.deepEqual(result.allocations.map((row) => row.physicalQty), [2.125, 2.25]);
  assert.equal(result.totalVariance, -1);
});
