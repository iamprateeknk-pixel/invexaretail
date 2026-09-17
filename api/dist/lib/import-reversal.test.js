"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const import_reversal_js_1 = require("./import-reversal.js");
(0, node_test_1.default)('reversal plan nets movements by item lot and branch', () => {
    const plan = (0, import_reversal_js_1.buildReversalPlan)([
        { id: 'a', itemId: 'xyz', lotId: '210', locationId: 'basni', qtyDelta: 2, movementType: 'PURCHASE_RECEIPT' },
        { id: 'b', itemId: 'xyz', lotId: '210', locationId: 'basni', qtyDelta: 3, movementType: 'PURCHASE_RECEIPT' },
        { id: 'c', itemId: 'xyz', lotId: '340', locationId: 'store-1', qtyDelta: -4, movementType: 'SALES_DEDUCTION' },
    ]);
    strict_1.default.deepEqual(plan, [
        { itemId: 'xyz', lotId: '210', locationId: 'basni', qtyDelta: -5, sourceMovementIds: ['a', 'b'] },
        { itemId: 'xyz', lotId: '340', locationId: 'store-1', qtyDelta: 4, sourceMovementIds: ['c'] },
    ]);
});
(0, node_test_1.default)('opening-stock snapshots reverse by subtracting the posted quantity', () => {
    const plan = (0, import_reversal_js_1.buildOpeningSnapshotReversalPlan)([
        { id: 's1', itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1', qty: 28 },
        { id: 's2', itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-2', qty: 0 },
    ]);
    strict_1.default.deepEqual(plan, [
        { itemId: 'item-1', lotId: 'lot-1', locationId: 'loc-1', qtyDelta: -28, sourceMovementIds: ['s1'] },
    ]);
});
(0, node_test_1.default)('reversal plan ignores non-lot and zero-net rows', () => {
    strict_1.default.deepEqual((0, import_reversal_js_1.buildReversalPlan)([
        { id: 'a', itemId: 'x', lotId: null, locationId: 'l', qtyDelta: 2, movementType: 'X' },
        { id: 'b', itemId: 'x', lotId: '1', locationId: 'l', qtyDelta: 2, movementType: 'X' },
        { id: 'c', itemId: 'x', lotId: '1', locationId: 'l', qtyDelta: -2, movementType: 'X' },
    ]), []);
});
