"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const bin_stock_js_1 = require("./bin-stock.js");
(0, node_test_1.default)('BinStockLedger tracks live quantity per bin independently of other bins', () => {
    const ledger = new bin_stock_js_1.BinStockLedger();
    const loc = { itemId: 'item-1', lotId: 'lot-1', locationId: 'wh-1' };
    ledger.apply({ ...loc, binId: bin_stock_js_1.STAGING_BIN_ID }, 12);
    ledger.move({ ...loc, binId: bin_stock_js_1.STAGING_BIN_ID }, 'A-01', 8);
    strict_1.default.equal(ledger.get({ ...loc, binId: 'A-01' }).onHand, 8);
    strict_1.default.equal(ledger.get({ ...loc, binId: bin_stock_js_1.STAGING_BIN_ID }).onHand, 4);
    strict_1.default.equal(ledger.onHandInBin('wh-1', 'A-01', 'item-1'), 8);
});
(0, node_test_1.default)('BinStockLedger refuses to pick more than a bin actually holds', () => {
    const ledger = new bin_stock_js_1.BinStockLedger();
    const key = { itemId: 'item-1', lotId: 'lot-1', locationId: 'wh-1', binId: 'A-01' };
    ledger.apply(key, 3);
    strict_1.default.throws(() => ledger.apply(key, -4), /does not have/);
    strict_1.default.equal(ledger.get(key).onHand, 3);
});
