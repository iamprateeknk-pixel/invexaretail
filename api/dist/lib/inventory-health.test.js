"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const inventory_health_js_1 = require("./inventory-health.js");
const now = new Date('2026-09-26T06:30:00Z');
const ago = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
const row = (over) => ({ itemId: 'i1', code: 'A', name: 'A', category: 'Dairy', onHand: 10, unitCost: 5, lotCreatedAt: ago(10), ...over });
(0, node_test_1.default)('valuation multiplies on-hand by unit cost, never guesses a price, and rolls up by category', () => {
    const health = (0, inventory_health_js_1.buildInventoryHealth)({
        rows: [row({}), row({ itemId: 'i2', code: 'B', onHand: 4, unitCost: 25, category: 'Staples' }), row({ itemId: 'i3', code: 'C', onHand: 7, unitCost: null })],
        sales: new Map(), windowDays: 30, now,
    });
    strict_1.default.equal(health.valuation.totalValue, 150);
    strict_1.default.equal(health.valuation.valuedUnits, 14);
    strict_1.default.equal(health.valuation.unvaluedUnits, 7, 'uncosted stock is reported, not priced');
    strict_1.default.deepEqual(health.valuation.byCategory.map((c) => [c.category, c.value]), [['Staples', 100], ['Dairy', 50]]);
});
(0, node_test_1.default)('turns and days of inventory come from cost of goods sold over the window, annualised', () => {
    // Value 1000; sold 300 of cost in 30 days -> annualised COGS 3650 -> 3.65 turns, 100 days of inventory.
    const health = (0, inventory_health_js_1.buildInventoryHealth)({ rows: [row({ onHand: 200, unitCost: 5 })], sales: new Map([['i1', { units: 60, cogs: 300 }]]), windowDays: 30, now });
    strict_1.default.equal(health.turns, 3.65);
    strict_1.default.equal(health.daysOfInventory, 100);
    strict_1.default.equal((0, inventory_health_js_1.buildInventoryHealth)({ rows: [row({})], sales: new Map(), windowDays: 30, now }).turns, null, 'no sales means turns is unknown, not zero');
});
(0, node_test_1.default)('gmroi is annualised (priced revenue - cogs on that same priced revenue) over current value; unpriced sales are excluded, not guessed at zero margin', () => {
    // Value 1000 (200 x 5). Item sold 60 units, cogs 300 (matches the turns test). Priced at 12/unit -> revenue 720, margin 420.
    const priced = (0, inventory_health_js_1.buildInventoryHealth)({
        rows: [row({ onHand: 200, unitCost: 5 })],
        sales: new Map([['i1', { units: 60, cogs: 300, revenue: 720 }]]),
        windowDays: 30, now,
    });
    strict_1.default.equal(priced.gmroi, 5.11, '(720-300) margin annualised x365/30 = 5110, over value 1000');
    strict_1.default.equal(priced.unitsSoldUnpriced, 0);
    const unpriced = (0, inventory_health_js_1.buildInventoryHealth)({
        rows: [row({ onHand: 200, unitCost: 5 })],
        sales: new Map([['i1', { units: 60, cogs: 300, revenue: null }]]),
        windowDays: 30, now,
    });
    strict_1.default.equal(unpriced.gmroi, null, 'no priced sales: gmroi is unknown, not a guessed margin');
    strict_1.default.equal(unpriced.unitsSoldUnpriced, 60);
    strict_1.default.equal((0, inventory_health_js_1.buildInventoryHealth)({ rows: [row({})], sales: new Map(), windowDays: 30, now }).gmroi, null, 'no sales at all: gmroi is unknown');
});
(0, node_test_1.default)('dead stock has stock and no sales; slow stock has more than 180 days of cover; healthy is neither', () => {
    const health = (0, inventory_health_js_1.buildInventoryHealth)({
        rows: [row({ itemId: 'd', code: 'D', onHand: 10 }), row({ itemId: 's', code: 'S', onHand: 400 }), row({ itemId: 'h', code: 'H', onHand: 30 })],
        sales: new Map([['s', { units: 30, cogs: 150 }], ['h', { units: 30, cogs: 150 }]]), windowDays: 30, now,
    });
    const status = Object.fromEntries(health.items.map((i) => [i.code, i.status]));
    strict_1.default.deepEqual(status, { S: 'SLOW', D: 'DEAD', H: 'HEALTHY' });
    strict_1.default.equal(health.deadStock.items, 1);
    strict_1.default.equal(health.deadStock.value, 50);
    strict_1.default.equal(health.slowStock.units, 400);
    strict_1.default.equal(health.items.find((i) => i.code === 'H')?.daysOfCover, 30);
});
(0, node_test_1.default)('stock ageing buckets by how long the lot has been held', () => {
    const health = (0, inventory_health_js_1.buildInventoryHealth)({
        rows: [row({ lotCreatedAt: ago(5), onHand: 1 }), row({ lotCreatedAt: ago(60), onHand: 2 }), row({ lotCreatedAt: ago(120), onHand: 3 }), row({ lotCreatedAt: ago(400), onHand: 4 })],
        sales: new Map(), windowDays: 30, now,
    });
    strict_1.default.deepEqual(health.ageing.map((b) => [b.bucket, b.units]), [['0-30', 1], ['31-90', 2], ['91-180', 3], ['181+', 4]]);
});
(0, node_test_1.default)('unit cost prefers landed cost over purchase rate and is null when neither exists', () => {
    strict_1.default.equal((0, inventory_health_js_1.lotUnitCost)({ landedUnitCost: 12.5, purchaseRate: 10 }), 12.5);
    strict_1.default.equal((0, inventory_health_js_1.lotUnitCost)({ purchaseRate: 10 }), 10);
    strict_1.default.equal((0, inventory_health_js_1.lotUnitCost)({ purchaseValue: 500 }), null, 'a total value cannot be turned into a unit cost without the quantity');
    strict_1.default.equal((0, inventory_health_js_1.lotUnitCost)(null), null);
});
(0, node_test_1.default)('with no sales data at all nothing is called dead - it is NO_DATA', () => {
    const health = (0, inventory_health_js_1.buildInventoryHealth)({ rows: [row({})], sales: new Map(), windowDays: 30, now });
    strict_1.default.equal(health.items[0].status, 'NO_DATA');
    strict_1.default.equal(health.deadStock.items, 0);
});
(0, node_test_1.default)('service level counts only decided orders and weighs units for the line fill rate', async () => {
    const { summarizeServiceLevel } = await import('./inventory-health.js');
    const r = summarizeServiceLevel([
        { status: 'FULFILLED', lines: [{ requestedQty: 10, fulfilledQty: 10 }] },
        { status: 'FULFILLED', lines: [{ requestedQty: 10, fulfilledQty: 10 }] },
        { status: 'BACKORDERED', lines: [{ requestedQty: 10, fulfilledQty: 0 }] },
        { status: 'EXPIRED', lines: [{ requestedQty: 10, fulfilledQty: 0 }] },
        { status: 'RESERVED', lines: [{ requestedQty: 99, fulfilledQty: 0 }] },
        { status: 'CANCELLED', lines: [{ requestedQty: 99, fulfilledQty: 0 }] },
    ]);
    strict_1.default.equal(r.orders, 4);
    strict_1.default.equal(r.orderFillRatePercent, 50);
    strict_1.default.equal(r.unitFillRatePercent, 50);
    strict_1.default.equal(summarizeServiceLevel([]).orderFillRatePercent, null);
});
