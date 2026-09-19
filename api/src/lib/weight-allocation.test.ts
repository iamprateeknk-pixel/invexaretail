import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateWeightCount, orderLots, totalVariance, type AllocationLot } from './weight-allocation.js';

const lot = (id: string, bookQty: number, over: Partial<AllocationLot> = {}): AllocationLot => ({ lotId: id, lotNo: `LOT-${id}`, bookQty, ...over });

test('the blueprint example: book 2+2+2, counted 5 -> 2+2+1 and variance -1', () => {
  const allocation = allocateWeightCount(5, [lot('a', 2), lot('b', 2), lot('c', 2)], 'FIFO');
  assert.deepEqual(allocation.map((row) => row.physicalQty), [2, 2, 1]);
  assert.equal(totalVariance(allocation), -1);
});

test('FEFO fills the earliest-expiring lots first; lots with no expiry go last', () => {
  const lots = [lot('late', 2, { expiryDate: '2027-03-01' }), lot('none', 2), lot('soon', 2, { expiryDate: '2026-10-01' })];
  const allocation = allocateWeightCount(3, lots, 'FEFO');
  assert.deepEqual(allocation.map((row) => [row.lotId, row.physicalQty]), [['soon', 2], ['late', 1], ['none', 0]]);
  // FIFO ignores expiry and keeps creation order.
  assert.deepEqual(allocateWeightCount(3, lots, 'FIFO').map((row) => row.lotId), ['late', 'none', 'soon']);
});

test('a count above the book total puts the excess on the last lot, so the variance shows it', () => {
  const allocation = allocateWeightCount(7.5, [lot('a', 2), lot('b', 2), lot('c', 2)], 'FIFO');
  assert.deepEqual(allocation.map((row) => row.physicalQty), [2, 2, 3.5]);
  assert.equal(totalVariance(allocation), 1.5);
});

test('decimals are exact and the same input always gives the same split', () => {
  const lots = [lot('a', 0.1), lot('b', 0.2), lot('c', 0.3)];
  const first = allocateWeightCount(0.35, lots, 'FIFO');
  assert.deepEqual(first.map((row) => row.physicalQty), [0.1, 0.2, 0.05]);
  assert.deepEqual(allocateWeightCount(0.35, [...lots], 'FIFO'), first);
  assert.equal(totalVariance(first), -0.25);
  // Zero counted is a valid count: every lot is short.
  assert.deepEqual(allocateWeightCount(0, lots, 'FIFO').map((row) => row.physicalQty), [0, 0, 0]);
});

test('zero-stock, blocked, expired and quarantined lots never take part', () => {
  const lots = [lot('zero', 0), lot('blocked', 5, { status: 'BLOCKED' }), lot('expired', 5, { status: 'EXPIRED' }), lot('quar', 5, { status: 'QUARANTINE' }), lot('ok', 4)];
  const allocation = allocateWeightCount(3, lots, 'FEFO');
  assert.deepEqual(allocation.map((row) => row.lotId), ['ok']);
  assert.throws(() => allocateWeightCount(3, [lot('zero', 0), lot('blocked', 5, { status: 'BLOCKED' })], 'FEFO'), /no counted-in lots/);
});

test('bad totals are rejected', () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => allocateWeightCount(bad, [lot('a', 1)], 'FIFO'), /non-negative/);
  assert.deepEqual(orderLots([], 'FEFO'), []);
});
