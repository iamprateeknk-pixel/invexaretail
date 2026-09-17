import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ABC_CADENCE,
  addDaysIso,
  aggregateLocationStock,
  buildCycleCountPlan,
  classifyAbcClass,
  classifyAbcItems,
  parseAbcClasses,
  selectEligibleCycleCountItems,
} from './abc-cycle-count.js';
import { seedItems, seedStockLedger } from './seed.js';

const now = new Date('2026-09-14T12:00:00.000Z');

test('Pareto cut-offs put the crossing item in the class being filled', () => {
  assert.equal(classifyAbcClass(0), 'A');
  assert.equal(classifyAbcClass(0.799), 'A');
  assert.equal(classifyAbcClass(0.8), 'B');
  assert.equal(classifyAbcClass(0.949), 'B');
  assert.equal(classifyAbcClass(0.95), 'C');
});

test('classes default to A and reject unknown values', () => {
  assert.deepEqual(parseAbcClasses(undefined), ['A']);
  assert.deepEqual(parseAbcClasses([]), ['A']);
  assert.deepEqual(parseAbcClasses(['c', 'A', 'A', 'nope']), ['A', 'C']);
  assert.throws(() => parseAbcClasses('A'), /array of A, B, or C/);
  assert.throws(() => parseAbcClasses(['Z']), /include A, B, or C/);
});

test('seed loc-1 stock ranks yoghurt and bread as A, rice and milk as B, flour as C', () => {
  const aggregated = aggregateLocationStock(seedItems, seedStockLedger.filter((row) => row.locationId === 'loc-1'));
  const byId = Object.fromEntries(aggregated.map((row) => [row.itemId, row]));
  assert.equal(byId['item-1004'].extendedValue, 180);
  assert.equal(byId['item-1005'].extendedValue, 90);
  assert.equal(byId['item-1001'].extendedValue, 28);
  assert.equal(byId['item-1001'].valueSource, 'qty_proxy');
  assert.equal(byId['item-1004'].valueSource, 'purchase');

  const classified = classifyAbcItems(aggregated);
  assert.equal(classified.get('item-1004')?.abcClass, 'A');
  assert.equal(classified.get('item-1005')?.abcClass, 'A');
  assert.equal(classified.get('item-1001')?.abcClass, 'B');
  assert.equal(classified.get('item-1002')?.abcClass, 'B');
  assert.equal(classified.get('item-1006')?.abcClass, 'C');
});

test('cycle-count plan applies cadence and skips items already ASSIGNED', () => {
  const plan = buildCycleCountPlan({
    locationId: 'loc-1',
    items: seedItems,
    stock: seedStockLedger,
    assignments: [
      {
        id: 'assign-rice',
        locationId: 'loc-1',
        itemId: 'item-1001',
        assignedToId: 'user-store-1',
        assignedById: 'user-admin-1',
        countDate: now.toISOString(),
        status: 'ASSIGNED',
        createdAt: now.toISOString(),
      },
    ],
    now,
  });

  assert.equal(plan.items.length, 5);
  assert.equal(plan.summary.A.count, 2);
  assert.equal(plan.summary.B.assigned, 1);
  assert.equal(plan.summary.B.eligible, 1);
  assert.equal(plan.items[0].itemId, 'item-1004');
  assert.equal(plan.items[0].priority, 'HIGH');
  assert.equal(plan.items[0].dueDate, addDaysIso(now, 7));
  const rice = plan.items.find((item) => item.itemId === 'item-1001');
  assert.equal(rice?.assigned, true);
  assert.equal(rice?.eligible, false);
  assert.equal(rice?.priority, 'NORMAL');
  assert.equal(rice?.dueDate, addDaysIso(now, ABC_CADENCE.B.dueInDays));
  const flour = plan.items.find((item) => item.itemId === 'item-1006');
  assert.equal(flour?.abcClass, 'C');
  assert.equal(flour?.priority, 'LOW');

  const classA = selectEligibleCycleCountItems(plan.items, { classes: ['A'] });
  assert.deepEqual(classA.map((item) => item.itemId), ['item-1004', 'item-1005']);
  const skippedRice = selectEligibleCycleCountItems(plan.items, { classes: ['B'], itemIds: ['item-1001'] });
  assert.equal(skippedRice.length, 0);
});

test('zero-stock locations produce an empty plan', () => {
  const plan = buildCycleCountPlan({
    locationId: 'loc-empty',
    items: seedItems,
    stock: [],
    assignments: [],
    now,
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.totalValue, 0);
  assert.equal(plan.summary.A.count, 0);
});
