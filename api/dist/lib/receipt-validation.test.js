"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const receipt_validation_js_1 = require("./receipt-validation.js");
(0, node_test_1.default)('only operational admins and store users can receive transfers', () => {
    for (const role of ['ADMIN', 'ADMIN_USER', 'STORE_USER'])
        strict_1.default.equal((0, receipt_validation_js_1.canReceiveTransfer)(role), true);
    for (const role of ['AUDITOR', 'WAREHOUSE_PICKER', '', 'UNKNOWN'])
        strict_1.default.equal((0, receipt_validation_js_1.canReceiveTransfer)(role), false);
});
(0, node_test_1.default)('receipt reconciles good, damaged and shortage quantities', () => {
    strict_1.default.equal((0, receipt_validation_js_1.receiptQuantitiesMatch)(10, 7, 1, 2), true);
    strict_1.default.equal((0, receipt_validation_js_1.receiptQuantitiesMatch)(10, 10, 0, 1), false);
    strict_1.default.equal((0, receipt_validation_js_1.receiptQuantitiesMatch)(0.3, 0.1, 0.2, 0), true);
});
(0, node_test_1.default)('lot-wise partial receipts respect cumulative remaining quantity', () => {
    const lines = [
        { id: 'a', itemId: 'xyz', lotId: '210', quantity: 2, receivedQty: 1 },
        { id: 'b', itemId: 'xyz', lotId: '340', quantity: 4 },
        { id: 'c', itemId: 'xyz', lotId: '415', quantity: 2 },
    ];
    strict_1.default.equal((0, receipt_validation_js_1.validateReceiptLines)(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 1, damagedQty: 0, shortageQty: 0 }]).complete, false);
    const final = (0, receipt_validation_js_1.validateReceiptLines)(lines, [
        { lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 1, damagedQty: 0, shortageQty: 0 },
        { lineId: 'b', itemId: 'xyz', lotId: '340', receivedQty: 4, damagedQty: 0, shortageQty: 0 },
        { lineId: 'c', itemId: 'xyz', lotId: '415', receivedQty: 2, damagedQty: 0, shortageQty: 0 },
    ]);
    strict_1.default.equal(final.complete, true);
    strict_1.default.equal(final.receivedQty, 7);
});
(0, node_test_1.default)('receipt rejects over-receipt and duplicate lot rows', () => {
    const lines = [{ id: 'a', itemId: 'xyz', lotId: '210', quantity: 2, receivedQty: 1 }];
    strict_1.default.throws(() => (0, receipt_validation_js_1.validateReceiptLines)(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 2, damagedQty: 0, shortageQty: 0 }]), /exceeds/);
    strict_1.default.throws(() => (0, receipt_validation_js_1.validateReceiptLines)(lines, [
        { lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 0.5, damagedQty: 0, shortageQty: 0 },
        { lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 0.5, damagedQty: 0, shortageQty: 0 },
    ]), /only once/);
});
(0, node_test_1.default)('excess receipt is never absorbed into the requested cap and always flags a discrepancy', () => {
    const lines = [{ id: 'a', itemId: 'xyz', lotId: '210', quantity: 2 }];
    // Requesting more than the line's own quantity for received+damaged+shortage
    // still throws - excess must be declared explicitly, not smuggled in here.
    strict_1.default.throws(() => (0, receipt_validation_js_1.validateReceiptLines)(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 3, damagedQty: 0, shortageQty: 0 }]), /exceeds/);
    // Declared explicitly via excessQty, it is accepted beyond the line quantity.
    const result = (0, receipt_validation_js_1.validateReceiptLines)(lines, [{ lineId: 'a', itemId: 'xyz', lotId: '210', receivedQty: 2, damagedQty: 0, shortageQty: 0, excessQty: 1 }]);
    strict_1.default.equal(result.excessQty, 1);
    strict_1.default.equal(result.complete, true);
    strict_1.default.equal(result.hasDiscrepancy, true);
});
(0, node_test_1.default)('receiptQuantitiesMatch allows a reconciled excess quantity beyond the expected total', () => {
    strict_1.default.equal((0, receipt_validation_js_1.receiptQuantitiesMatch)(10, 7, 1, 2), true);
    strict_1.default.equal((0, receipt_validation_js_1.receiptQuantitiesMatch)(10, 12, 0, 0, 2), true);
    strict_1.default.equal((0, receipt_validation_js_1.receiptQuantitiesMatch)(10, 9, 0, 0, 0), false);
});
