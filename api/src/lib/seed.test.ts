import test from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, seedLocations, seedItems, seedCounts, seedTransfers, seedReorderRules } from './seed.js';

test('seed data includes all required roles and locations', () => {
  assert.ok(seedUsers.some((user) => user.role === 'ADMIN'));
  assert.ok(seedUsers.some((user) => user.role === 'BRANCH_MANAGER'));
  assert.ok(seedUsers.some((user) => user.role === 'STORE_USER'));
  assert.ok(seedUsers.some((user) => user.role === 'WAREHOUSE_PICKER'));
  assert.ok(seedUsers.some((user) => user.role === 'AUDITOR'));
  assert.ok(seedLocations.some((location) => location.id === 'wh-1'));
});

test('seed data includes stock and transfer records', () => {
  assert.ok(seedItems.length >= 2);
  assert.ok(seedCounts.length >= 1);
  assert.ok(seedTransfers.length >= 1);
});

test('seed lots include expired, near-expiry and missing dates plus reorder rules', () => {
  assert.ok(seedItems.some((item) => item.lots.some((lot) => lot.expiryDate === '2026-09-01')));
  assert.ok(seedItems.some((item) => item.lots.some((lot) => lot.expiryDate === '2026-09-18')));
  assert.ok(seedItems.some((item) => item.lots.some((lot) => lot.expiryDate == null)));
  assert.ok(seedReorderRules.some((rule) => rule.itemId === 'item-1001' && rule.targetQty === 50));
});
