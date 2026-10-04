"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sellable_stock_js_1 = require("./sellable-stock.js");
const now = new Date('2026-09-26T06:30:00Z');
(0, node_test_1.default)('only AVAILABLE, unexpired lots count, net of reservations', () => {
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 10, reserved: 3, lot: { status: 'AVAILABLE', expiryDate: '2026-12-01T00:00:00Z' } }, now), 7);
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 10, lot: { status: 'BLOCKED' } }, now), 0);
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 10, lot: { status: 'QUARANTINE' } }, now), 0);
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 10, lot: { status: 'AVAILABLE', expiryDate: '2026-09-20T00:00:00Z' } }, now), 0, 'lapsed lot is not cover');
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 10, lot: { status: 'AVAILABLE', expiryDate: '2026-09-26T00:00:00Z' } }, now), 10, 'usable through its expiry date');
});
(0, node_test_1.default)('undated lots with no status data are treated as sellable; over-reservation never goes negative', () => {
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 4 }, now), 4);
    strict_1.default.equal((0, sellable_stock_js_1.sellableQuantity)({ onHand: 4, reserved: 9 }, now), 0);
});
(0, node_test_1.default)('an item whose stock is all expired or blocked has zero cover even though on-hand is positive', () => {
    const rows = [
        { onHand: 40, lot: { status: 'AVAILABLE', expiryDate: '2026-09-01T00:00:00Z' } },
        { onHand: 25, lot: { status: 'BLOCKED' } },
        { onHand: 5, reserved: 1, lot: { status: 'AVAILABLE', expiryDate: '2027-01-01T00:00:00Z' } },
    ];
    strict_1.default.equal((0, sellable_stock_js_1.totalSellable)(rows, now), 4);
});
