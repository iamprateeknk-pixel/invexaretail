import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReplenishmentIntelligence, listReorderRules, resetReorderStore, upsertReorderRule } from './reorder-store.js';

test('seed reorder rules prefer warehouse transfer then purchase', () => {
  resetReorderStore();
  const intelligence = buildReplenishmentIntelligence('loc-1');
  const rice = intelligence.recommendations.find((entry) => entry.itemId === 'item-1001');
  const flour = intelligence.recommendations.find((entry) => entry.itemId === 'item-1006');
  assert.ok(rice);
  assert.equal(rice.suggestedAction, 'TRANSFER');
  assert.equal(rice.sourceLocationId, 'wh-1');
  assert.equal(rice.suggestedOrderQty, 22);
  assert.equal(rice.suggestedTransferQty, 22);
  assert.ok(flour);
  assert.equal(flour.suggestedAction, 'PURCHASE');
  assert.match(intelligence.executiveSummary, /transfer/i);
});

test('reorder rules can be upserted for a location', () => {
  resetReorderStore();
  const created = upsertReorderRule({ itemId: 'item-1002', locationId: 'loc-1', minQty: 5, targetQty: 12 });
  assert.equal(created.minQty, 5);
  const updated = upsertReorderRule({ itemId: 'item-1002', locationId: 'loc-1', minQty: 6, targetQty: 15 });
  assert.equal(updated.targetQty, 15);
  assert.equal(listReorderRules('loc-1').filter((rule) => rule.itemId === 'item-1002').length, 1);
  assert.throws(() => upsertReorderRule({ itemId: 'item-1002', locationId: 'loc-1', minQty: 20, targetQty: 10 }));
  resetReorderStore();
});

import { validateReorderQuantities } from './reorder-store.js';

test('reorder quantities: whole numbers for counted items, up to 3 decimals for loose/KG items', () => {
  assert.equal(validateReorderQuantities(5, 12, false), null);
  assert.match(validateReorderQuantities(2.5, 12, false) ?? '', /whole numbers/);
  assert.equal(validateReorderQuantities(2.5, 10.25, true), null, 'a 2.5 kg minimum is now possible');
  assert.match(validateReorderQuantities(2.5555, 10, true) ?? '', /3 decimal/);
  assert.match(validateReorderQuantities(8, 5, true) ?? '', /not be below/);
  assert.match(validateReorderQuantities(-1, 5, false) ?? '', /non-negative/);
  assert.match(validateReorderQuantities(Number.NaN, 5, false) ?? '', /non-negative/);
  resetReorderStore();
  const rule = upsertReorderRule({ itemId: 'item-1003', locationId: 'loc-1', minQty: 2.5, targetQty: 9, decimal: true });
  assert.equal(rule.minQty, 2.5);
  assert.throws(() => upsertReorderRule({ itemId: 'item-1003', locationId: 'loc-1', minQty: 2.5, targetQty: 9 }));
  resetReorderStore();
});
