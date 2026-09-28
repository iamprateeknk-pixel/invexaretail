import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ABC_CADENCE,
  addDaysIso,
  aggregateLocationStock,
  aggregateUsageValue,
  buildCountTriggers,
  buildCycleCountPlan,
  classifyAbcClass,
  classifyAbcItems,
  parseAbcClasses,
  selectEligibleCycleCountItems,
} from './abc-cycle-count.js';
import { seedItems, seedStockLedger } from './seed.js';
import type { ItemRecord, StockLedgerRecord } from './repository.js';

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

// Audit C-4: cadence used to be the fixed ABC_CADENCE constant for every tenant.
test('cadenceDays overrides ABC_CADENCE per class; a class left out keeps the default', () => {
  const plan = buildCycleCountPlan({
    locationId: 'loc-1', items: seedItems, stock: seedStockLedger, assignments: [], now,
    cadenceDays: { A: 14 }, // B/C fall back to the 30/90 default
  });
  const yoghurt = plan.items.find((item) => item.itemId === 'item-1004');
  assert.equal(yoghurt?.abcClass, 'A');
  assert.equal(yoghurt?.dueInDays, 14);
  assert.equal(yoghurt?.dueDate, addDaysIso(now, 14));
  assert.equal(plan.summary.A.dueInDays, 14);
  const flour = plan.items.find((item) => item.itemId === 'item-1006');
  assert.equal(flour?.abcClass, 'B');
  assert.equal(flour?.dueInDays, ABC_CADENCE.B.dueInDays, 'B has no override, so it keeps the default');
  assert.equal(plan.summary.C.dueInDays, ABC_CADENCE.C.dueInDays);
});

// Audit C-4: ABC ranking by usage value instead of stock value on hand.
function usageFixture(): { items: ItemRecord[]; stock: StockLedgerRecord[] } {
  const item = (id: string, purchaseValue: number | null, onHand: number): ItemRecord => ({
    id, code: id, name: id,
    lots: [{ id: `lot-${id}`, itemId: id, lotNo: `L-${id}`, attributes: purchaseValue === null ? {} : { purchaseValue: purchaseValue * onHand } }],
  });
  return {
    items: [item('overstock', 1, 1000), item('fastmover', 5, 10)],
    stock: [
      { itemId: 'overstock', lotId: 'lot-overstock', locationId: 'loc-1', onHand: 1000, quarantine: 0, version: 0 },
      { itemId: 'fastmover', lotId: 'lot-fastmover', locationId: 'loc-1', onHand: 10, quarantine: 0, version: 0 },
    ],
  };
}

test('aggregateUsageValue ranks by annualised units sold x unit cost, not on-hand quantity', () => {
  const { items, stock } = usageFixture();
  // overstock: 1000 on hand x cost 1 = stock value 1000, but never sells. fastmover: 10 on hand x
  // cost 5 = stock value only 50, but sells fast - 200 units in a 90-day window.
  const rows = aggregateUsageValue(items, stock, new Map([['fastmover', 200]]), 90);
  const byId = Object.fromEntries(rows.map((row) => [row.itemId, row]));
  assert.equal(byId.overstock.extendedValue, 0, 'never sold: zero usage value regardless of how much is on the shelf');
  assert.ok(byId.fastmover.extendedValue > byId.overstock.extendedValue);
  assert.equal(Math.round(byId.fastmover.extendedValue), Math.round(200 * (365 / 90) * 5), '200 units annualised (x365/90) x unit cost 5');
});

test('buildCycleCountPlan with unitsSoldByItem flips the overstocked-slow-mover-ranks-A bug: usage ranks it C, the fast mover A', () => {
  const { items, stock } = usageFixture();
  const byStockValue = buildCycleCountPlan({ locationId: 'loc-1', items, stock, assignments: [], now });
  assert.equal(byStockValue.items.find((i) => i.itemId === 'overstock')?.abcClass, 'A', 'stock-value mode (no demand given): the audit-reported bug, preserved for backward compatibility');

  const byUsage = buildCycleCountPlan({
    locationId: 'loc-1', items, stock, assignments: [], now,
    unitsSoldByItem: new Map([['fastmover', 200]]), demandWindowDays: 90,
  });
  assert.equal(byUsage.items.find((i) => i.itemId === 'overstock')?.abcClass, 'C', 'usage-value mode: no sales, so it is no longer prioritised');
  assert.equal(byUsage.items.find((i) => i.itemId === 'fastmover')?.abcClass, 'A', 'usage-value mode: the fast mover now ranks by how much it actually sells');
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

// Audit C-2: process-triggered counts the ABC cadence can never surface.
test('negative balances and over-reserved stock trigger an immediate count; the ABC plan still skips them', () => {
  const item = seedItems[0];
  const lotId = item.lots[0].id;
  const stock = [
    { itemId: item.id, lotId, locationId: 'loc-1', onHand: -4, reserved: 0 },
    { itemId: seedItems[1].id, lotId: seedItems[1].lots[0].id, locationId: 'loc-1', onHand: 2, reserved: 5 },
    { itemId: seedItems[2].id, lotId: seedItems[2].lots[0].id, locationId: 'loc-1', onHand: 8, reserved: 1 },
  ] as never;
  const triggers = buildCountTriggers(seedItems, stock);
  assert.deepEqual(triggers.map((t) => t.reason), ['NEGATIVE_BALANCE', 'OVER_RESERVED']);
  assert.ok(triggers.every((t) => t.priority === 'HIGH'));
  const plan = buildCycleCountPlan({ locationId: 'loc-1', items: seedItems, stock, assignments: [], now });
  assert.equal(plan.triggers.length, 2);
  assert.ok(!plan.items.some((entry) => entry.itemId === item.id), 'the negative item is not on the value-ranked cadence');
});

test('a zero balance on an item that is still selling triggers a count; a zero on a dead item does not (audit C-2)', () => {
  const items = [{ id: 'sell', code: 'SELL', name: 'S', lots: [] }, { id: 'dead', code: 'DEAD', name: 'D', lots: [] }] as never;
  const stock = [{ itemId: 'sell', lotId: 'l1', locationId: 'x', onHand: 0 }, { itemId: 'dead', lotId: 'l2', locationId: 'x', onHand: 0 }] as never;
  const triggers = buildCountTriggers(items, stock, new Set(['sell']));
  assert.deepEqual(triggers.map((t) => [t.code, t.reason]), [['SELL', 'ZERO_BALANCE']]);
  assert.equal(buildCountTriggers(items, stock).length, 0, 'without sales data no zero-balance trigger is raised');
});

test('an item received damaged/short/excess triggers a count once, and a negative balance keeps its own trigger (audit C-2)', () => {
  const items = [{ id: 'a', code: 'A', name: 'A', lots: [] }, { id: 'b', code: 'B', name: 'B', lots: [] }] as never;
  const stock = [{ itemId: 'a', lotId: 'l1', locationId: 'x', onHand: 12 }, { itemId: 'b', lotId: 'l2', locationId: 'x', onHand: -1 }] as never;
  const triggers = buildCountTriggers(items, stock, new Set(), new Set(['a', 'b']));
  assert.deepEqual(triggers.map((t) => [t.code, t.reason]), [['B', 'NEGATIVE_BALANCE'], ['A', 'RECEIPT_DISCREPANCY']]);
});
