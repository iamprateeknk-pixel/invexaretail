import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventoryHealth, lotUnitCost } from './inventory-health.js';

const now = new Date('2026-09-26T06:30:00Z');
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const row = (over: Record<string, unknown>) => ({ itemId: 'i1', code: 'A', name: 'A', category: 'Dairy', onHand: 10, unitCost: 5, lotCreatedAt: ago(10), ...over }) as never;

test('valuation multiplies on-hand by unit cost, never guesses a price, and rolls up by category', () => {
  const health = buildInventoryHealth({
    rows: [row({}), row({ itemId: 'i2', code: 'B', onHand: 4, unitCost: 25, category: 'Staples' }), row({ itemId: 'i3', code: 'C', onHand: 7, unitCost: null })],
    sales: new Map(), windowDays: 30, now,
  });
  assert.equal(health.valuation.totalValue, 150);
  assert.equal(health.valuation.valuedUnits, 14);
  assert.equal(health.valuation.unvaluedUnits, 7, 'uncosted stock is reported, not priced');
  assert.deepEqual(health.valuation.byCategory.map((c) => [c.category, c.value]), [['Staples', 100], ['Dairy', 50]]);
});

test('turns and days of inventory come from cost of goods sold over the window, annualised', () => {
  // Value 1000; sold 300 of cost in 30 days -> annualised COGS 3650 -> 3.65 turns, 100 days of inventory.
  const health = buildInventoryHealth({ rows: [row({ onHand: 200, unitCost: 5 })], sales: new Map([['i1', { units: 60, cogs: 300 }]]), windowDays: 30, now });
  assert.equal(health.turns, 3.65);
  assert.equal(health.daysOfInventory, 100);
  assert.equal(buildInventoryHealth({ rows: [row({})], sales: new Map(), windowDays: 30, now }).turns, null, 'no sales means turns is unknown, not zero');
});

test('dead stock has stock and no sales; slow stock has more than 180 days of cover; healthy is neither', () => {
  const health = buildInventoryHealth({
    rows: [row({ itemId: 'd', code: 'D', onHand: 10 }), row({ itemId: 's', code: 'S', onHand: 400 }), row({ itemId: 'h', code: 'H', onHand: 30 })],
    sales: new Map([['s', { units: 30, cogs: 150 }], ['h', { units: 30, cogs: 150 }]]), windowDays: 30, now,
  });
  const status = Object.fromEntries(health.items.map((i) => [i.code, i.status]));
  assert.deepEqual(status, { S: 'SLOW', D: 'DEAD', H: 'HEALTHY' });
  assert.equal(health.deadStock.items, 1);
  assert.equal(health.deadStock.value, 50);
  assert.equal(health.slowStock.units, 400);
  assert.equal(health.items.find((i) => i.code === 'H')?.daysOfCover, 30);
});

test('stock ageing buckets by how long the lot has been held', () => {
  const health = buildInventoryHealth({
    rows: [row({ lotCreatedAt: ago(5), onHand: 1 }), row({ lotCreatedAt: ago(60), onHand: 2 }), row({ lotCreatedAt: ago(120), onHand: 3 }), row({ lotCreatedAt: ago(400), onHand: 4 })],
    sales: new Map(), windowDays: 30, now,
  });
  assert.deepEqual(health.ageing.map((b) => [b.bucket, b.units]), [['0-30', 1], ['31-90', 2], ['91-180', 3], ['181+', 4]]);
});

test('unit cost prefers landed cost over purchase rate and is null when neither exists', () => {
  assert.equal(lotUnitCost({ landedUnitCost: 12.5, purchaseRate: 10 }), 12.5);
  assert.equal(lotUnitCost({ purchaseRate: 10 }), 10);
  assert.equal(lotUnitCost({ purchaseValue: 500 }), null, 'a total value cannot be turned into a unit cost without the quantity');
  assert.equal(lotUnitCost(null), null);
});

test('with no sales data at all nothing is called dead - it is NO_DATA', () => {
  const health = buildInventoryHealth({ rows: [row({})], sales: new Map(), windowDays: 30, now });
  assert.equal(health.items[0].status, 'NO_DATA');
  assert.equal(health.deadStock.items, 0);
});
