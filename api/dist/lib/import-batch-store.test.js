"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const import_center_js_1 = require("./import-center.js");
const import_batch_store_js_1 = require("./import-batch-store.js");
const import_token_flow_js_1 = require("./import-token-flow.js");
const daily_stock_sync_js_1 = require("./daily-stock-sync.js");
const import_fixtures_js_1 = require("./import-fixtures.js");
(0, node_test_1.default)('preview creates a PREVIEWED batch with staged rows', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const batch = await (0, import_batch_store_js_1.createPreviewBatch)({
        type: 'SALES',
        fileName: 'sales.csv',
        sourceFormat: 'daily-erp-export',
        importedById: 'user-admin-1',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('sales-file')),
        branchId: null,
        sourceDateFrom: '2026-09-11T04:48:00.000Z',
        sourceDateTo: '2026-09-11T04:48:00.000Z',
        totalRows: 2,
        validRows: 1,
        invalidRows: 1,
        duplicateRows: 0,
        rows: [
            { rowNumber: 2, status: 'VALID', rawData: { itemName: 'Rice 5kg' }, mappedData: { itemName: 'Rice 5kg' }, sourceKey: 'k1' },
            { rowNumber: 3, status: 'INVALID', rawData: { itemName: '' }, errors: ['Item Name is required.'] },
        ],
    });
    strict_1.default.equal(batch.status, 'PREVIEWED');
    const counts = await (0, import_batch_store_js_1.countRowsByStatus)(batch.id);
    strict_1.default.equal(counts.VALID, 1);
    strict_1.default.equal(counts.INVALID, 1);
    strict_1.default.equal((await (0, import_batch_store_js_1.listRows)(batch.id, 'INVALID'))[0].errors?.[0], 'Item Name is required.');
});
(0, node_test_1.default)('a merely-previewed batch never blocks re-uploading the same file (nothing was applied to stock yet)', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const fingerprint = {
        type: 'SALES',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('same-bytes')),
        branchId: null,
        sourceDateFrom: '2026-09-11T00:00:00.000Z',
        sourceDateTo: '2026-09-11T00:00:00.000Z',
    };
    await (0, import_batch_store_js_1.createPreviewBatch)({
        ...fingerprint,
        fileName: 'sales.csv',
        sourceFormat: 'daily-erp-export',
        importedById: 'user-admin-1',
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        duplicateRows: 0,
        rows: [{ rowNumber: 2, status: 'VALID', rawData: {} }],
    });
    // A PREVIEWED (or VALIDATED) batch has not touched real stock - re-preview
    // must recompute fresh rather than forever return a stale staged preview
    // (e.g. one staged before a bugfix deploy, which would otherwise wedge
    // that upload permanently).
    strict_1.default.equal(await (0, import_batch_store_js_1.findDuplicateBatch)(fingerprint), undefined);
});
(0, node_test_1.default)('the same file hash, type and date range cannot start a second live batch once POSTED', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const fingerprint = {
        type: 'SALES',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('same-bytes')),
        branchId: null,
        sourceDateFrom: '2026-09-11T00:00:00.000Z',
        sourceDateTo: '2026-09-11T00:00:00.000Z',
    };
    const first = await (0, import_batch_store_js_1.createPreviewBatch)({
        ...fingerprint,
        fileName: 'sales.csv',
        sourceFormat: 'daily-erp-export',
        importedById: 'user-admin-1',
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        duplicateRows: 0,
        rows: [{ rowNumber: 2, status: 'VALID', rawData: {} }],
    });
    await (0, import_batch_store_js_1.transitionBatch)(first.id, 'VALIDATED');
    await (0, import_batch_store_js_1.transitionBatch)(first.id, 'POSTED', { committedRows: 1 });
    const duplicate = await (0, import_batch_store_js_1.findDuplicateBatch)(fingerprint);
    strict_1.default.equal(duplicate?.id, first.id);
});
(0, node_test_1.default)('abandoning a preview frees the fingerprint so the file can be uploaded again', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const fingerprint = {
        type: 'PURCHASE',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('purchase-bytes')),
        branchId: 'wh-1',
        sourceDateFrom: '2026-09-11T00:00:00.000Z',
        sourceDateTo: '2026-09-11T00:00:00.000Z',
    };
    const batch = await (0, import_batch_store_js_1.createPreviewBatch)({
        ...fingerprint,
        fileName: 'purchase.csv',
        sourceFormat: 'daily-erp-export',
        importedById: 'user-admin-1',
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        duplicateRows: 0,
        rows: [{ rowNumber: 2, status: 'VALID', rawData: {} }],
    });
    await (0, import_batch_store_js_1.transitionBatch)(batch.id, 'FAILED');
    strict_1.default.equal(await (0, import_batch_store_js_1.findDuplicateBatch)(fingerprint), undefined);
});
(0, node_test_1.default)('posted batches cannot be posted a second time through the lifecycle', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const batch = await (0, import_batch_store_js_1.createPreviewBatch)({
        type: 'SALES',
        fileName: 'sales.csv',
        sourceFormat: 'daily-erp-export',
        importedById: 'user-admin-1',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('posted')),
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        duplicateRows: 0,
        rows: [{ rowNumber: 2, status: 'VALID', rawData: {} }],
    });
    await (0, import_batch_store_js_1.transitionBatch)(batch.id, 'VALIDATED');
    await (0, import_batch_store_js_1.transitionBatch)(batch.id, 'POSTED', { committedRows: 1 });
    const posted = await (0, import_batch_store_js_1.getBatch)(batch.id);
    strict_1.default.equal(posted?.status, 'POSTED');
    strict_1.default.equal(posted?.metadata?.committedRows, 1);
    await strict_1.default.rejects(() => (0, import_batch_store_js_1.transitionBatch)(batch.id, 'POSTED'), import_center_js_1.InvalidBatchTransitionError);
});
(0, node_test_1.default)('commit reconstructs one movement per staged allocation and keeps the previewed lot', async () => {
    const movements = (0, import_token_flow_js_1.movementsFromStagedDailyRows)('imp-1', 'user-admin-1', 'SALES', [{
            rowNumber: 2,
            status: 'VALID',
            rawData: { reference: 'DGR-1' },
            mappedData: {
                reference: 'DGR-1',
                dedupeKey: 'SALES|mainstore|dgr1|sku1001|2|SALE_OUT',
                movementType: 'SALE_OUT',
                transactionAt: '2026-09-11T04:48:00.000Z',
                itemName: 'Rice 5kg',
                rowSource: 'ERP',
                allocations: [{ itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', qtyDelta: -1 }],
            },
            sourceKey: 'SALES|mainstore|dgr1|sku1001|2|SALE_OUT',
        }]);
    strict_1.default.equal(movements.movements.length, 1);
    strict_1.default.equal(movements.movements[0].qtyDelta, -1);
    strict_1.default.equal(movements.movements[0].lotId, 'lot-1001');
    strict_1.default.equal(movements.movements[0].metadata?.rowSource, 'ERP');
    strict_1.default.match(movements.movements[0].dedupeKey, /lot-1001$/);
});
(0, node_test_1.default)('staging a daily preview keeps parser errors and planned allocations on the same row numbers', async () => {
    const preview = await (0, daily_stock_sync_js_1.parseDailyStockImport)((0, import_fixtures_js_1.salesCsvBuffer)(2), 'sales.csv', 'SALES', { purchaseLocationName: 'H.O BASNI' });
    const staged = (0, import_token_flow_js_1.stageDailyImport)(preview, {
        errors: [{ rowNumber: preview.validRows[1]?.rowNumber ?? 3, message: 'Unknown item.' }],
        prepared: preview.validRows.slice(0, 1).map((row) => ({
            row,
            item: { id: 'item-1001', code: 'SKU-1001', name: 'Rice 5kg' },
            locationId: 'loc-1',
            lotId: 'lot-1001',
            qtyDelta: -0.01,
        })),
    });
    strict_1.default.equal(staged.filter((row) => row.status === 'VALID').length, 1);
    strict_1.default.equal(staged.filter((row) => row.status === 'INVALID').length, 1);
});
