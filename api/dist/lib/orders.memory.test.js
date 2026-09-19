"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const orders_js_1 = require("./orders.js");
(0, node_test_1.default)('memory mode reserves a channel order without a database', async () => {
    strict_1.default.equal(Boolean(process.env.DATABASE_URL), false);
    const before = (0, orders_js_1.listMemoryOrders)().length;
    const order = await (0, orders_js_1.createOrderWithReservation)({
        channel: 'WEBSITE',
        createdById: 'test',
        allowSplit: true,
        lines: [{ itemId: 'item-1001', quantity: 1 }],
    });
    strict_1.default.equal(order.status, 'RESERVED');
    strict_1.default.ok(order.fulfillmentLocationId);
    strict_1.default.equal(order.lines[0].itemId, 'item-1001');
    strict_1.default.equal((0, orders_js_1.listMemoryOrders)().length, before + 1);
});
(0, node_test_1.default)('memory mode splits a line that one location cannot fill alone', async () => {
    strict_1.default.equal(Boolean(process.env.DATABASE_URL), false);
    try {
        const order = await (0, orders_js_1.createOrderWithReservation)({
            channel: 'AMAZON',
            createdById: 'test',
            allowSplit: true,
            lines: [{ itemId: 'item-1001', quantity: 1 }],
        });
        const locations = new Set(order.lines.map((line) => line.fulfillmentLocationId));
        strict_1.default.ok(locations.size >= 1);
    }
    catch (error) {
        strict_1.default.equal(error instanceof orders_js_1.OrderShortageError, true);
    }
});
(0, node_test_1.default)('the same platform order delivered twice reserves once (idempotent on platform + external id)', async () => {
    const input = { channel: 'FLIPKART', externalReference: ' FK-1001 ', createdById: 'connector', allowSplit: true, lines: [{ itemId: 'item-1001', quantity: 1 }] };
    const before = (0, orders_js_1.listMemoryOrders)().length;
    const first = await (0, orders_js_1.createOrderWithReservation)(input);
    strict_1.default.equal(first.duplicate, undefined);
    const again = await (0, orders_js_1.createOrderWithReservation)({ ...input, externalReference: 'FK-1001' });
    strict_1.default.equal(again.duplicate, true);
    strict_1.default.equal(again.id, first.id);
    strict_1.default.equal((0, orders_js_1.listMemoryOrders)().length, before + 1);
    // Two deliveries arriving together still make one order.
    const [a, b] = await Promise.all([
        (0, orders_js_1.createOrderWithReservation)({ ...input, externalReference: 'FK-2002' }),
        (0, orders_js_1.createOrderWithReservation)({ ...input, externalReference: 'FK-2002' }),
    ]);
    strict_1.default.equal(a.id, b.id);
    strict_1.default.equal([a, b].filter((order) => order.duplicate).length, 1);
    strict_1.default.equal((0, orders_js_1.listMemoryOrders)().length, before + 2);
    // The same number on another platform is a different order; no reference never dedupes.
    const other = await (0, orders_js_1.createOrderWithReservation)({ ...input, channel: 'AMAZON', externalReference: 'FK-1001' });
    strict_1.default.notEqual(other.id, first.id);
    const x = await (0, orders_js_1.createOrderWithReservation)({ ...input, externalReference: null });
    const y = await (0, orders_js_1.createOrderWithReservation)({ ...input, externalReference: null });
    strict_1.default.notEqual(x.id, y.id);
});
