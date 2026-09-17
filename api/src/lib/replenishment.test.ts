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
