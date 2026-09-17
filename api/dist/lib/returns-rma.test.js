"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const returns_rma_js_1 = require("./returns-rma.js");
(0, node_test_1.default)('a return line within the fulfilled/not-yet-returned quantity is valid', () => {
    const result = (0, returns_rma_js_1.validateReturnLines)([{ orderLineId: 'l1', quantity: 2, fulfilledQty: 5, alreadyReturnedQty: 0 }]);
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.errors.length, 0);
});
(0, node_test_1.default)('requesting more than the remaining eligible quantity is rejected', () => {
    const result = (0, returns_rma_js_1.validateReturnLines)([{ orderLineId: 'l1', quantity: 4, fulfilledQty: 5, alreadyReturnedQty: 2 }]);
    strict_1.default.equal(result.ok, false);
    strict_1.default.match(result.errors[0], /only 3/);
});
(0, node_test_1.default)('a non-positive return quantity is rejected', () => {
    const result = (0, returns_rma_js_1.validateReturnLines)([{ orderLineId: 'l1', quantity: 0, fulfilledQty: 5, alreadyReturnedQty: 0 }]);
    strict_1.default.equal(result.ok, false);
});
(0, node_test_1.default)('an empty line list is rejected', () => {
    strict_1.default.equal((0, returns_rma_js_1.validateReturnLines)([]).ok, false);
});
(0, node_test_1.default)('the return status machine allows REQUESTED -> APPROVED -> RECEIVED -> CLOSED', () => {
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REQUESTED', 'APPROVE'), 'APPROVED');
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('APPROVED', 'RECEIVE'), 'RECEIVED');
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('RECEIVED', 'CLOSE'), 'CLOSED');
});
(0, node_test_1.default)('the return status machine allows REQUESTED -> REJECTED as a terminal state', () => {
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REQUESTED', 'REJECT'), 'REJECTED');
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REJECTED', 'APPROVE'), null);
});
(0, node_test_1.default)('an out-of-order transition is rejected, not silently skipped', () => {
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('REQUESTED', 'RECEIVE'), null);
    strict_1.default.equal((0, returns_rma_js_1.nextReturnStatus)('CLOSED', 'CLOSE'), null);
});
(0, node_test_1.default)('isRestockDisposition narrows only the RESTOCK value', () => {
    strict_1.default.equal((0, returns_rma_js_1.isRestockDisposition)('RESTOCK'), true);
    strict_1.default.equal((0, returns_rma_js_1.isRestockDisposition)('SCRAP'), false);
});
