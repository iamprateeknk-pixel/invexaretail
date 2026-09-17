"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const daily_stock_sync_js_1 = require("./daily-stock-sync.js");
function csv(rows) { return Buffer.from(rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')); }
(0, node_test_1.default)('maps the supplied sales structure and keeps bill timestamp', async () => {
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(csv([['S_No.', 'BRANCH NAME', 'BILL DATE', 'BILL NO.', 'BILL TIME', 'ITEM NAME', 'PACK / SIZE', 'RATE', 'TOTAL QTY'], [1, 'DRY FRUIT FARM GOPALPURA', '11/09/2026', 'DGR-1', '10:18 AM', 'CASHEW 240', 'KG', 1290, 0.2]]), 'sales.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    strict_1.default.equal(result.errors.length, 0);
    strict_1.default.equal(result.validRows[0].movementType, 'SALE_OUT');
    strict_1.default.equal(result.validRows[0].transactionAt, '2026-09-11T04:48:00.000Z');
});
(0, node_test_1.default)('keeps sales rows routed to their own Branch Name', async () => {
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(csv([
        ['S_No.', 'BRANCH NAME', 'BILL DATE', 'BILL NO.', 'ITEM CODE', 'ITEM NAME', 'LOT NO.', 'TOTAL QTY'],
        [1, 'Main Store', '11/09/2026', 'MS-1', 'XYZ-001', 'xyz', '210', 2],
        [2, 'Gopalpura', '11/09/2026', 'GP-1', 'XYZ-001', 'xyz', '340', 4],
    ]), 'branch-sales.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    strict_1.default.equal(result.errors.length, 0);
    strict_1.default.deepEqual(result.validRows.map((row) => row.locationName), ['Main Store', 'Gopalpura']);
    strict_1.default.notEqual(result.validRows[0].dedupeKey, result.validRows[1].dedupeKey);
});
(0, node_test_1.default)('maps purchase to the configured warehouse and assumes receipt time when source has no time', async () => {
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(csv([['SNO.', 'BILL DATE', 'BILL NO.', 'PARTY NAME', 'ITEM NAME', 'PACK/GRADE', 'LOT NO.', 'TOTAL QTY'], [1, '11/09/2026', 'HOST-474', 'H.O BASNI', 'ALMOND', 'KG', '1', 2.5]]), 'purchase.csv', 'PURCHASE', { purchaseLocationName: 'H.O BASNI', purchaseTime: '09:30' });
    strict_1.default.equal(result.validRows[0].locationName, 'H.O BASNI');
    strict_1.default.equal(result.validRows[0].timeAssumed, true);
    strict_1.default.equal(result.validRows[0].movementType, 'PURCHASE_IN');
});
(0, node_test_1.default)('sales return is an additive movement and duplicate lines are skipped', async () => {
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(csv([['S_No.', 'BRANCH NAME', 'BILL DATE', 'BILL NO.', 'BILL TIME', 'ITEM NAME', 'TOTAL QTY', 'TRANSACTION TYPE'], [1, 'Store', '11/09/2026', 'CN-9', '10:18 AM', 'CASHEW', -1, 'RETURN'], [1, 'Store', '11/09/2026', 'CN-9', '10:18 AM', 'CASHEW', -1, 'RETURN']]), 'sales.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    strict_1.default.equal(result.validRows.length, 1);
    strict_1.default.equal(result.duplicateRows, 1);
    strict_1.default.equal(result.duplicates[0].rowNumber, 3);
    strict_1.default.equal(result.validRows[0].movementType, 'SALES_RETURN');
    strict_1.default.equal(result.validRows[0].quantity, 1);
});
(0, node_test_1.default)('blank line numbers keep two distinct rows of the same bill', async () => {
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(csv([
        ['BRANCH NAME', 'BILL DATE', 'BILL NO.', 'ITEM NAME', 'TOTAL QTY'],
        ['Main Store', '11/09/2026', 'MS-9', 'Rice 5kg', 1],
        ['Main Store', '11/09/2026', 'MS-9', 'Rice 5kg', 2],
    ]), 'same-bill.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    strict_1.default.equal(result.errors.length, 0);
    strict_1.default.equal(result.validRows.length, 2);
    strict_1.default.equal(result.duplicateRows, 0);
    strict_1.default.notEqual(result.validRows[0].dedupeKey, result.validRows[1].dedupeKey);
});
(0, node_test_1.default)('Row Source is parsed and carried on each valid row', async () => {
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(csv([
        ['S_No.', 'BRANCH NAME', 'BILL DATE', 'BILL NO.', 'ITEM NAME', 'TOTAL QTY', 'ROW SOURCE'],
        [1, 'Main Store', '11/09/2026', 'MS-1', 'Rice 5kg', 1, 'Logic ERP'],
    ]), 'row-source.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    strict_1.default.equal(result.validRows[0].rowSource, 'Logic ERP');
});
(0, node_test_1.default)('a 5,000-row sales file previews without dropping totals', async () => {
    const { salesCsvBuffer } = await import('./import-fixtures.js');
    const started = Date.now();
    const result = await (0, daily_stock_sync_js_1.parseDailyStockImport)(salesCsvBuffer(5000), 'sales-5000.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    const elapsed = Date.now() - started;
    strict_1.default.equal(result.validRows.length, 5000);
    strict_1.default.equal(result.duplicateRows, 0);
    strict_1.default.equal(result.errors.length, 0);
    strict_1.default.ok(elapsed < 5000, `preview took ${elapsed}ms`);
});
(0, node_test_1.default)('maps branded ERP branch names to one unambiguous configured location', () => {
    const locations = [{ id: 'loc-gp', name: 'Gopalpura' }, { id: 'loc-vn', name: 'Vaishali Nagar' }];
    strict_1.default.equal((0, daily_stock_sync_js_1.matchImportLocation)('DRY FRUIT FARM GOPALPURA', locations)?.id, 'loc-gp');
    strict_1.default.equal((0, daily_stock_sync_js_1.matchImportLocation)('Vaishali Nagar', locations)?.id, 'loc-vn');
});
(0, node_test_1.default)('rejects ambiguous partial branch aliases', () => {
    const locations = [{ id: 'one', name: 'Main Store' }, { id: 'two', name: 'Dry Fruit Farm Main Store' }];
    strict_1.default.equal((0, daily_stock_sync_js_1.matchImportLocation)('Main Store', locations)?.id, 'one');
    strict_1.default.equal((0, daily_stock_sync_js_1.matchImportLocation)('Farm Main Store', locations), undefined);
});
