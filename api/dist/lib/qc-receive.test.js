"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const qc_receive_js_1 = require("./qc-receive.js");
const templates = [
    { id: 'global', category: null, active: true },
    { id: 'dairy', category: 'Dairy', active: true },
];
(0, node_test_1.default)('receiptLineRequiresQc is false for zero-qty lines even when a template exists', () => {
    strict_1.default.equal((0, qc_receive_js_1.receiptLineRequiresQc)({ itemId: 'i1', receivedQty: 0, hasInspection: false, itemCategory: 'Dairy' }, templates), false);
});
(0, node_test_1.default)('receiptLineRequiresQc is true when a matching template exists and qty was received', () => {
    strict_1.default.equal((0, qc_receive_js_1.receiptLineRequiresQc)({ itemId: 'i1', receivedQty: 4, hasInspection: false, itemCategory: 'Dairy' }, templates), true);
});
(0, node_test_1.default)('assertReceiptQcComplete blocks a received line with no inspection', () => {
    const blocked = (0, qc_receive_js_1.assertReceiptQcComplete)([{ itemId: 'i1', lineId: 'line-1', receivedQty: 2, hasInspection: false, itemCategory: 'Dairy' }], templates);
    strict_1.default.equal(blocked.ok, false);
});
(0, node_test_1.default)('assertReceiptQcComplete passes when every received line already has an inspection', () => {
    const ok = (0, qc_receive_js_1.assertReceiptQcComplete)([
        { itemId: 'i1', receivedQty: 2, hasInspection: true, itemCategory: 'Dairy' },
        { itemId: 'i2', receivedQty: 0, hasInspection: false, itemCategory: 'Dairy' },
    ], templates);
    strict_1.default.equal(ok.ok, true);
});
(0, node_test_1.default)('assertReceiptQcComplete is a no-op when no QC templates are published', () => {
    const ok = (0, qc_receive_js_1.assertReceiptQcComplete)([{ itemId: 'i1', receivedQty: 5, hasInspection: false, itemCategory: 'Dairy' }], []);
    strict_1.default.equal(ok.ok, true);
});
