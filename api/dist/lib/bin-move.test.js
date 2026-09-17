"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const bin_move_js_1 = require("./bin-move.js");
(0, node_test_1.default)('a legal move between two bins at this location is accepted', () => {
    strict_1.default.doesNotThrow(() => (0, bin_move_js_1.assertValidBinMove)({
        scannedFromBinCode: 'A-01-01',
        scannedToBinCode: 'A-02-01',
        allowedBinCodes: ['A-01-01', 'A-02-01', 'A-03-01'],
        quantity: 5,
    }));
});
(0, node_test_1.default)('rejects a zero or negative quantity', () => {
    strict_1.default.throws(() => (0, bin_move_js_1.assertValidBinMove)({
        scannedFromBinCode: 'A-01-01',
        scannedToBinCode: 'A-02-01',
        allowedBinCodes: ['A-01-01', 'A-02-01'],
        quantity: 0,
    }), bin_move_js_1.BinMoveValidationError);
});
(0, node_test_1.default)('rejects moving a bin into itself', () => {
    strict_1.default.throws(() => (0, bin_move_js_1.assertValidBinMove)({
        scannedFromBinCode: 'A-01-01',
        scannedToBinCode: 'a-01-01',
        allowedBinCodes: ['A-01-01'],
        quantity: 3,
    }), bin_move_js_1.BinMoveValidationError);
});
(0, node_test_1.default)('rejects a destination bin that does not belong to this location', () => {
    strict_1.default.throws(() => (0, bin_move_js_1.assertValidBinMove)({
        scannedFromBinCode: 'A-01-01',
        scannedToBinCode: 'Z-99-99',
        allowedBinCodes: ['A-01-01', 'A-02-01'],
        quantity: 2,
    }), bin_move_js_1.BinMoveValidationError);
});
