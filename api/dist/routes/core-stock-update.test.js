"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const stock_import_js_1 = require("../lib/stock-import.js");
const core_js_1 = require("./core.js");
function csvBuffer(rows) {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}
(0, node_test_1.default)('SET stock import prepares missing item, branch and separate lot rows for upsert', async () => {
    const rows = [
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
        ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'UNIQUE IMPORT ITEM', '210', '31/01/2027', 2],
        ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'UNIQUE IMPORT ITEM', '340', '28/02/2027', 4],
        ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'UNIQUE IMPORT ITEM', '415', '31/03/2027', 2],
    ];
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer(rows), 'stock.csv');
    const plan = (0, core_js_1.planStockUpdate)(preview, 'SET');
    strict_1.default.equal(plan.errors.length, 0);
    strict_1.default.equal(plan.prepared.length, 3);
    strict_1.default.equal(plan.newItems, 1);
    strict_1.default.equal(plan.newLocations, 1);
    strict_1.default.equal(new Set(plan.prepared.map((entry) => entry.lotId)).size, 3);
    strict_1.default.equal(plan.prepared.reduce((total, entry) => total + entry.resultingQty, 0), 8);
});
(0, node_test_1.default)('SET stock import accepts a negative closing-stock balance from the source ERP export', async () => {
    const rows = [
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
        ['DRY FRUIT FARM TEST', 'TEST COMPANY', 'NEGATIVE LOT ITEM', '999', '31/01/2027', -0.255],
    ];
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer(rows), 'stock.csv');
    const plan = (0, core_js_1.planStockUpdate)(preview, 'SET');
    strict_1.default.equal(plan.errors.length, 0);
    strict_1.default.equal(plan.prepared.length, 1);
    strict_1.default.equal(plan.prepared[0].resultingQty, -0.255);
});
(0, node_test_1.default)('ADD/REMOVE stock import still rejects a non-positive quantity on an existing item', async () => {
    const rows = [
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'CLOSING STOCK'],
        ['Main Store', 'TEST COMPANY', 'Rice 5kg', 'LOT-01', -1],
    ];
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer(rows), 'stock.csv');
    const addPlan = (0, core_js_1.planStockUpdate)(preview, 'ADD');
    const removePlan = (0, core_js_1.planStockUpdate)(preview, 'REMOVE');
    strict_1.default.match(addPlan.errors[0]?.message ?? '', /positive number/);
    strict_1.default.match(removePlan.errors[0]?.message ?? '', /positive number/);
});
(0, node_test_1.default)('ADD stock import still rejects unknown item masters', async () => {
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer([
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'LOT CODE', 'CLOSING STOCK'],
        ['UNKNOWN BRANCH FOR ADD', 'TEST COMPANY', 'UNKNOWN ITEM FOR ADD', 'L1', 1],
    ]), 'stock.csv');
    const plan = (0, core_js_1.planStockUpdate)(preview, 'ADD');
    strict_1.default.equal(plan.prepared.length, 0);
    strict_1.default.match(plan.errors[0]?.message ?? '', /Unknown item/);
});
