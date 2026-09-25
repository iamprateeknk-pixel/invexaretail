import test from 'node:test';
import assert from 'node:assert/strict';
import { routeReplenishment } from './replenishment.js';

test('warehouse stock is preferred for branch replenishment', () => {
  assert.deepEqual(routeReplenishment('store-a', 8, [
    { locationId: 'store-b', locationName: 'Store B', locationType: 'store', available: 20 },
    { locationId: 'basni', locationName: 'H.O. Basni', locationType: 'warehouse', available: 10 },
  ]), {
    action: 'TRANSFER', sourceLocationId: 'basni', sourceLocationName: 'H.O. Basni',
    suggestedTransferQty: 8, reason: 'Target can be restored from network stock.',
  });
});

test('partial network stock is used before purchase', () => {
  const route = routeReplenishment('store-a', 8, [
    { locationId: 'basni', locationName: 'H.O. Basni', locationType: 'warehouse', available: 3 },
  ]);
  assert.equal(route.action, 'TRANSFER');
  assert.equal(route.suggestedTransferQty, 3);
  assert.match(route.reason, /purchase the remaining/);
});

test('purchase is recommended only when the network has no stock', () => {
  assert.equal(routeReplenishment('store-a', 5, []).action, 'PURCHASE');
  assert.equal(routeReplenishment('store-a', 0, []).action, 'NONE');
});

// Audit P1-1 (min-max policy) and P1-2 (donor protection, stock already in flight).
import { planRuleReplenishment } from './replenishment.js';

const wh = { locationId: 'wh', locationName: 'Warehouse', locationType: 'warehouse', available: 50 };

test('an item between its minimum and target is HEALTHY: no order is recommended (only at or below min)', () => {
  const plan = planRuleReplenishment({ destinationLocationId: 'store', availableHere: 8, incoming: 0, minQty: 5, targetQty: 20, network: [wh] });
  assert.equal(plan.risk, 'HEALTHY');
  assert.equal(plan.suggestedOrderQty, 0);
  assert.equal(plan.route.action, 'NONE');
});

test('at or below the minimum it orders up to the target', () => {
  const plan = planRuleReplenishment({ destinationLocationId: 'store', availableHere: 5, incoming: 0, minQty: 5, targetQty: 20, network: [wh] });
  assert.equal(plan.risk, 'HIGH');
  assert.equal(plan.suggestedOrderQty, 15);
  assert.equal(plan.route.action, 'TRANSFER');
});

test('stock already dispatched to the store counts toward its position, so it is not re-ordered', () => {
  const plan = planRuleReplenishment({ destinationLocationId: 'store', availableHere: 2, incoming: 15, minQty: 5, targetQty: 20, network: [wh] });
  assert.equal(plan.position, 17);
  assert.equal(plan.suggestedOrderQty, 0);
});

test('a donor is never drained below its own minimum', () => {
  const plan = planRuleReplenishment({
    destinationLocationId: 'store-a', availableHere: 0, incoming: 0, minQty: 5, targetQty: 10,
    network: [{ locationId: 'store-b', locationName: 'Store B', locationType: 'store', available: 12, protectedQty: 9 }],
  });
  assert.equal(plan.route.action, 'TRANSFER');
  assert.equal(plan.route.suggestedTransferQty, 3, 'only the 3 above store B\'s own minimum of 9');
  const none = planRuleReplenishment({
    destinationLocationId: 'store-a', availableHere: 0, incoming: 0, minQty: 5, targetQty: 10,
    network: [{ locationId: 'store-b', locationName: 'Store B', locationType: 'store', available: 9, protectedQty: 9 }],
  });
  assert.equal(none.route.action, 'PURCHASE', 'a donor at its minimum gives nothing, so the shortage becomes a purchase');
});
