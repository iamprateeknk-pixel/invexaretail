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

test('seed loc-1 stock: costed yoghurt and bread rank A; uncosted rice, milk and flour are held in B (unknown value is not top priority and not ignorable)', () => {
  const aggregated = aggregateLocationStock(seedItems, seedStockLedger.filter((row) => row.locationId === 'loc-1'));
  const byId = Object.fromEntries(aggregated.map((row) => [row.itemId, row]));
  assert.equal(byId['item-1004'].extendedValue, 180);
  assert.equal(byId['item-1005'].extendedValue, 90);
  // Uncosted stock no longer contributes its unit COUNT as if it were rupees (audit P1-5).
  assert.equal(byId['item-1001'].extendedValue, 0);
  assert.equal(byId['item-1001'].valueSource, 'qty_proxy');
  assert.equal(byId['item-1004'].valueSource, 'purchase');

  const classified = classifyAbcItems(aggregated);
  assert.equal(classified.get('item-1004')?.abcClass, 'A');
  assert.equal(classified.get('item-1005')?.abcClass, 'A');
  assert.equal(classified.get('item-1001')?.abcClass, 'B');
  assert.equal(classified.get('item-1002')?.abcClass, 'B');
  assert.equal(classified.get('item-1006')?.abcClass, 'B');
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
  // B now holds the three uncosted items (rice assigned; milk and flour eligible).
  assert.equal(plan.summary.B.count, 3);
  assert.equal(plan.summary.B.assigned, 1);
  assert.equal(plan.summary.B.eligible, 2);
  assert.equal(plan.items[0].itemId, 'item-1004');
  assert.equal(plan.items[0].priority, 'HIGH');
  assert.equal(plan.items[0].dueDate, addDaysIso(now, 7));
  const rice = plan.items.find((item) => item.itemId === 'item-1001');
  assert.equal(rice?.assigned, true);
  assert.equal(rice?.eligible, false);
  assert.equal(rice?.priority, 'NORMAL');
  assert.equal(rice?.dueDate, addDaysIso(now, ABC_CADENCE.B.dueInDays));
  const flour = plan.items.find((item) => item.itemId === 'item-1006');
  assert.equal(flour?.abcClass, 'B');
  assert.equal(flour?.priority, 'NORMAL');

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

// Audit P1-6: the cadence used to set only a due date; it never gated eligibility.
test('an item counted within its cadence is not due again; never-counted and overdue items are', () => {
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const plan = buildCycleCountPlan({
    locationId: 'loc-1', items: seedItems, stock: seedStockLedger, assignments: [], now,
    counts: [
      { itemId: 'item-1004', locationId: 'loc-1', createdAt: daysAgo(2) },   // A (weekly): counted 2 days ago -> not due
      { itemId: 'item-1005', locationId: 'loc-1', createdAt: daysAgo(9) },   // A: 9 days ago -> due
      { itemId: 'item-1005', locationId: 'loc-1', createdAt: daysAgo(30) },  // older count must not mask the newer one
      { itemId: 'item-1004', locationId: 'other', createdAt: daysAgo(1) },   // other location: irrelevant
    ],
  });
  const byId = Object.fromEntries(plan.items.map((item) => [item.itemId, item]));
  assert.equal(byId['item-1004'].due, false);
  assert.equal(byId['item-1004'].eligible, false);
  assert.equal(byId['item-1004'].daysSinceCounted, 2);
  assert.equal(byId['item-1005'].due, true);
  assert.equal(byId['item-1005'].daysSinceCounted, 9);
  assert.equal(byId['item-1001'].due, true, 'never counted');
  assert.equal(byId['item-1001'].lastCountedAt, null);
  assert.deepEqual(selectEligibleCycleCountItems(plan.items, { classes: ['A'] }).map((item) => item.itemId), ['item-1005']);
});

test('when NOTHING has a cost, quantity is the ranking unit for everyone (never mixed with currency)', () => {
  const bare = seedItems.map((item) => ({ ...item, lots: item.lots.map((lot) => ({ ...lot, attributes: {} })) }));
  const aggregated = aggregateLocationStock(bare, seedStockLedger.filter((row) => row.locationId === 'loc-1'));
  assert.ok(aggregated.every((row) => row.valueSource === 'qty_proxy' && row.extendedValue === row.onHand));
  const classes = classifyAbcItems(aggregated);
  assert.ok([...classes.values()].some((value) => value.abcClass === 'A'), 'ranking still produces an A class');
});
