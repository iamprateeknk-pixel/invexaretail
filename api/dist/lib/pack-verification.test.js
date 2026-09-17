"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pack_verification_js_1 = require("./pack-verification.js");
(0, node_test_1.default)('scanning exactly what was ordered is ready to seal', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([{ itemId: 'item-1', lotId: 'lot-1', requestedQty: 3 }], [{ itemId: 'item-1', lotId: 'lot-1', quantity: 3 }]);
    strict_1.default.equal(result.readyToSeal, true);
    strict_1.default.equal(result.lines[0].status, 'MATCHED');
});
(0, node_test_1.default)('an empty carton is never ready to seal', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([{ itemId: 'item-1', requestedQty: 1 }], []);
    strict_1.default.equal(result.readyToSeal, false);
    strict_1.default.equal(result.lines[0].status, 'SHORT');
});
(0, node_test_1.default)('scanning less than ordered blocks sealing (short)', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([{ itemId: 'item-1', requestedQty: 5 }], [{ itemId: 'item-1', quantity: 3 }]);
    strict_1.default.equal(result.readyToSeal, false);
    strict_1.default.equal(result.lines[0].status, 'SHORT');
    strict_1.default.equal(result.lines[0].scannedQty, 3);
});
(0, node_test_1.default)('scanning more than ordered blocks sealing (over) instead of silently accepting it', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([{ itemId: 'item-1', requestedQty: 2 }], [{ itemId: 'item-1', quantity: 4 }]);
    strict_1.default.equal(result.readyToSeal, false);
    strict_1.default.equal(result.lines[0].status, 'OVER');
});
(0, node_test_1.default)('scanning an item that is not on the order is flagged unexpected, not silently ignored', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([{ itemId: 'item-1', requestedQty: 1 }], [{ itemId: 'item-1', quantity: 1 }, { itemId: 'item-wrong', quantity: 1 }]);
    strict_1.default.equal(result.readyToSeal, false);
    const wrong = result.lines.find((line) => line.itemId === 'item-wrong');
    strict_1.default.equal(wrong?.status, 'UNEXPECTED');
});
(0, node_test_1.default)('multiple scans of the same item/lot accumulate before comparing', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([{ itemId: 'item-1', requestedQty: 5 }], [{ itemId: 'item-1', quantity: 2 }, { itemId: 'item-1', quantity: 3 }]);
    strict_1.default.equal(result.readyToSeal, true);
    strict_1.default.equal(result.lines[0].scannedQty, 5);
});
(0, node_test_1.default)('different lots of the same item are tracked separately', () => {
    const result = (0, pack_verification_js_1.verifyPackScan)([
        { itemId: 'item-1', lotId: 'lot-a', requestedQty: 2 },
        { itemId: 'item-1', lotId: 'lot-b', requestedQty: 1 },
    ], [{ itemId: 'item-1', lotId: 'lot-a', quantity: 2 }]);
    strict_1.default.equal(result.readyToSeal, false);
    const lotB = result.lines.find((line) => line.lotId === 'lot-b');
    strict_1.default.equal(lotB?.status, 'SHORT');
});
