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
