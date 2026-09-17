"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const stock_import_js_1 = require("./stock-import.js");
const import_token_flow_js_1 = require("./import-token-flow.js");
function csvBuffer(rows) {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}
(0, node_test_1.default)('a second report line for the same branch/item/lot is staged VALID (merged), not "could not be mapped"', async () => {
    const rows = [
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
        ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 3],
        ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 2],
    ];
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer(rows), 'stock.csv');
    strict_1.default.equal(preview.duplicateRows, 1);
    // Both rows resolve to one aggregated plan entry (mirrors planStockUpdate's
    // aggregateOpeningStock() grouping), attributed to the first row.
    const merged = {
        row: preview.validRows[0],
        item: { id: 'item-1', code: 'Q1', name: 'Split Lot Item' },
        location: { id: 'loc-1', name: 'Main Store' },
        lotId: 'lot-1',
        lotNo: '999',
        expiryDate: '2027-01-31T00:00:00.000Z',
        isNewLot: true,
        currentQty: 0,
        qtyDelta: 5,
        resultingQty: 5,
    };
    const plan = { errors: [], prepared: [merged] };
    const staged = (0, import_token_flow_js_1.stageStockAdjustment)(preview, plan, 'SET');
    strict_1.default.equal(staged.length, 2);
    for (const row of staged) {
        strict_1.default.equal(row.status, 'VALID');
        strict_1.default.equal(row.errors, null);
    }
    strict_1.default.equal(staged[0].mappedData?.mergedIntoRow, null);
    strict_1.default.equal(staged[1].mappedData?.mergedIntoRow, staged[0].rowNumber);
    strict_1.default.equal(staged[1].mappedData?.resultingQty, 5);
});
(0, node_test_1.default)('openingPreviewFromStagedRows normalizes an ADJUSTMENT_SET staged row into a StockImportRow and does not double-count a merged duplicate', async () => {
    const rows = [
        ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
        ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 3],
        ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 2],
    ];
    const preview = await (0, stock_import_js_1.parseStockImport)(csvBuffer(rows), 'stock.csv');
    const merged = {
        row: preview.validRows[0],
        item: { id: 'item-1', code: 'Q1', name: 'Split Lot Item' },
        location: { id: 'loc-1', name: 'Main Store' },
        lotId: 'lot-1',
        lotNo: '999',
        expiryDate: '2027-01-31T00:00:00.000Z',
        isNewLot: true,
        currentQty: 0,
        qtyDelta: 5,
        resultingQty: 5,
    };
    const plan = { errors: [], prepared: [merged] };
    const staged = (0, import_token_flow_js_1.stageStockAdjustment)(preview, plan, 'SET');
    const batch = {
        id: 'batch-1', type: 'ADJUSTMENT_SET', fileName: 'stock.csv', sourceFormat: preview.format,
        importedById: 'user-1', importedAt: new Date().toISOString(), totalRows: preview.totalRows,
        validRows: staged.length, invalidRows: 0, duplicateRows: preview.duplicateRows,
        metadata: { sheetName: preview.sheetName, headerRow: preview.headerRow, format: preview.format, snapshotAt: preview.snapshotAt },
        status: 'PREVIEWED', branchId: null, fileHash: null, sourceDateFrom: null, sourceDateTo: null,
    };
    // This used to throw "Cannot read properties of undefined (reading
    // 'toLowerCase')" because it blindly cast the adjustment mappedData shape
    // (itemCode/resultingQty) to StockImportRow (code/quantity).
    const openingPreview = (0, import_token_flow_js_1.openingPreviewFromStagedRows)(batch, staged);
    strict_1.default.equal(openingPreview.validRows.length, 1, 'the merged duplicate row must not appear a second time');
    strict_1.default.equal(openingPreview.validRows[0].code, 'Q1');
    strict_1.default.equal(openingPreview.validRows[0].quantity, 5);
    // And feeding it through the same aggregation persistOpeningStockImport()
    // applies must not double the quantity again.
    const aggregated = (0, stock_import_js_1.aggregateOpeningStock)(openingPreview.validRows);
    strict_1.default.equal(aggregated.length, 1);
    strict_1.default.equal(aggregated[0].quantity, 5);
});
