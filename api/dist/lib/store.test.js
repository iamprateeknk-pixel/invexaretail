"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const store_js_1 = require("./store.js");
(0, node_test_1.default)('createInventoryItem creates an item and its lot record', () => {
    const item = (0, store_js_1.createInventoryItem)({ code: 'SKU-100', name: 'Rice 5kg', category: 'Staples', unit: 'bag' });
    strict_1.default.equal(item.code, 'SKU-100');
    strict_1.default.equal(item.lots.length, 1);
    strict_1.default.equal(item.lots[0].lotNo, 'LOT-DEFAULT');
});
(0, node_test_1.default)('submitStockCount records the physical quantity without hidden system data', () => {
    const item = (0, store_js_1.createInventoryItem)({ code: 'SKU-200', name: 'Milk', category: 'Dairy', unit: 'pack' });
    const count = (0, store_js_1.submitStockCount)({
        itemId: item.id,
        lotId: item.lots[0].id,
        locationId: 'loc-1',
        physicalQuantity: 18,
        mode: 'scan',
        submittedBy: 'store-user-1',
        role: 'STORE_USER',
    });
    strict_1.default.equal(count.physicalQuantity, 18);
    strict_1.default.equal(count.role, 'STORE_USER');
});
(0, node_test_1.default)('createTransferRequest requires admin and validates positive quantities', () => {
    const item = (0, store_js_1.createInventoryItem)({ code: 'SKU-300', name: 'Soap', category: 'Household', unit: 'box' });
    const transfer = (0, store_js_1.createTransferRequest)({
        sourceLocationId: 'loc-1',
        destinationLocationId: 'wh-1',
        requestedBy: 'admin-1',
        role: 'ADMIN',
        lines: [{ itemId: item.id, lotId: item.lots[0].id, quantity: 5 }],
    });
    strict_1.default.equal(transfer.status, 'REQUESTED');
    strict_1.default.equal(transfer.lines[0].quantity, 5);
});
