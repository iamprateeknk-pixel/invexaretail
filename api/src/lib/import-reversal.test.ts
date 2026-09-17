import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpeningSnapshotReversalPlan, buildReversalPlan } from './import-reversal.js';

test('reversal plan nets movements by item lot and branch', () => {
  const plan = buildReversalPlan([
    { id: 'a', itemId: 'xyz', lotId: '210', locationId: 'basni', qtyDelta: 2, movementType: 'PURCHASE_RECEIPT' },
    { id: 'b', itemId: 'xyz', lotId: '210', locationId: 'basni', qtyDelta: 3, movementType: 'PURCHASE_RECEIPT' },
    { id: 'c', itemId: 'xyz', lotId: '340', locationId: 'store-1', qtyDelta: -4, movementType: 'SALES_DEDUCTION' },
  ]);
  assert.deepEqual(plan, [
    { itemId: 'xyz', lotId: '210', locationId: 'basni', qtyDelta: -5, sourceMovementIds: ['a', 'b'] },
    { itemId: 'xyz', lotId: '340', locationId: 'store-1', qtyDelta: 4, sourceMovementIds: ['c'] },
  ]);
});

test('opening-stock snapshots reverse by subtracting the posted quantity', () => {
  const plan = buildOpeningSnapshotReversalPlan([
    { id: 's1', itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1', qty: 28 },
    { id: 's2', itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-2', qty: 0 },
  ]);
  assert.deepEqual(plan, [
    { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1', qtyDelta: -28, sourceMovementIds: ['s1'] },
  ]);
});

test('reversal plan ignores non-lot and zero-net rows', () => {
  assert.deepEqual(buildReversalPlan([
    { id: 'a', itemId: 'x', lotId: null, locationId: 'l', qtyDelta: 2, movementType: 'X' },
    { id: 'b', itemId: 'x', lotId: '1', locationId: 'l', qtyDelta: 2, movementType: 'X' },
    { id: 'c', itemId: 'x', lotId: '1', locationId: 'l', qtyDelta: -2, movementType: 'X' },
  ]), []);
});
