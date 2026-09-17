"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const import_center_js_1 = require("./import-center.js");
const import_batch_store_js_1 = require("./import-batch-store.js");
(0, node_test_1.default)('batch lifecycle allows the documented forward path', () => {
    strict_1.default.doesNotThrow(() => (0, import_center_js_1.assertValidBatchTransition)('DRAFT', 'PREVIEWED'));
    strict_1.default.doesNotThrow(() => (0, import_center_js_1.assertValidBatchTransition)('PREVIEWED', 'VALIDATED'));
    strict_1.default.doesNotThrow(() => (0, import_center_js_1.assertValidBatchTransition)('VALIDATED', 'POSTED'));
    strict_1.default.doesNotThrow(() => (0, import_center_js_1.assertValidBatchTransition)('POSTED', 'REVERSED'));
});
(0, node_test_1.default)('a batch cannot be posted twice', () => {
    strict_1.default.throws(() => (0, import_center_js_1.assertValidBatchTransition)('POSTED', 'POSTED'), import_center_js_1.InvalidBatchTransitionError);
});
(0, node_test_1.default)('posted history cannot be skipped back to draft or edited in place', () => {
    strict_1.default.throws(() => (0, import_center_js_1.assertValidBatchTransition)('POSTED', 'DRAFT'));
    strict_1.default.throws(() => (0, import_center_js_1.assertValidBatchTransition)('POSTED', 'VALIDATED'));
});
(0, node_test_1.default)('a reversed batch is terminal', () => {
    strict_1.default.throws(() => (0, import_center_js_1.assertValidBatchTransition)('REVERSED', 'POSTED'));
    strict_1.default.throws(() => (0, import_center_js_1.assertValidBatchTransition)('REVERSED', 'DRAFT'));
});
(0, node_test_1.default)('a failed batch can be retried from draft', () => {
    strict_1.default.doesNotThrow(() => (0, import_center_js_1.assertValidBatchTransition)('FAILED', 'DRAFT'));
});
(0, node_test_1.default)('computeFileHash is stable for identical content and differs for different content', () => {
    const a = (0, import_center_js_1.computeFileHash)(Buffer.from('same content'));
    const b = (0, import_center_js_1.computeFileHash)(Buffer.from('same content'));
    const c = (0, import_center_js_1.computeFileHash)(Buffer.from('different content'));
    strict_1.default.equal(a, b);
    strict_1.default.notEqual(a, c);
});
(0, node_test_1.default)('the same file for the same branch and date range is rejected as a duplicate batch', () => {
    const guard = new import_center_js_1.ImportDuplicateGuard();
    const fingerprint = {
        sourceType: 'SALES',
        branchCode: 'HO-BASNI',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('sales-file')),
        sourceDateFrom: '2026-09-01',
        sourceDateTo: '2026-09-01',
    };
    guard.register(fingerprint, 'batch-1');
    strict_1.default.throws(() => guard.register(fingerprint, 'batch-2'), import_center_js_1.DuplicateImportBatchError);
});
(0, node_test_1.default)('duplicate detection is case-insensitive on branch code but distinguishes different files', () => {
    const guard = new import_center_js_1.ImportDuplicateGuard();
    const base = {
        sourceType: 'SALES',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('file-a')),
        sourceDateFrom: '2026-09-01',
        sourceDateTo: '2026-09-01',
    };
    guard.register({ ...base, branchCode: 'ho-basni' }, 'batch-1');
    strict_1.default.throws(() => guard.register({ ...base, branchCode: 'HO-BASNI' }, 'batch-2'));
    // A different file for the same branch/date is not a duplicate.
    strict_1.default.doesNotThrow(() => guard.register({ ...base, branchCode: 'HO-BASNI', fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('file-b')) }, 'batch-3'));
});
(0, node_test_1.default)('store-backed duplicate lookup only blocks a POSTED batch - PREVIEWED/VALIDATED have not touched real stock', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const fingerprint = {
        type: 'SALES',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('store-backed-sales')),
        branchId: 'loc-1',
        sourceDateFrom: '2026-09-11T00:00:00.000Z',
        sourceDateTo: '2026-09-11T00:00:00.000Z',
    };
    const batch = await (0, import_batch_store_js_1.createPreviewBatch)({
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
    // Re-uploading the same file while it is only PREVIEWED must recompute
    // fresh, not reuse a stale staged batch.
    strict_1.default.equal(await (0, import_batch_store_js_1.findDuplicateBatch)(fingerprint), undefined);
    await (0, import_batch_store_js_1.transitionBatch)(batch.id, 'VALIDATED');
    strict_1.default.equal(await (0, import_batch_store_js_1.findDuplicateBatch)(fingerprint), undefined);
    await (0, import_batch_store_js_1.transitionBatch)(batch.id, 'POSTED');
    strict_1.default.equal((await (0, import_batch_store_js_1.findDuplicateBatch)(fingerprint))?.status, 'POSTED');
});
(0, node_test_1.default)('store-backed duplicate lookup ignores FAILED batches so the same file can be previewed again', async () => {
    (0, import_batch_store_js_1.resetImportBatchStore)();
    const fingerprint = {
        type: 'PURCHASE',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('abandoned-purchase')),
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
(0, node_test_1.default)('findExisting reports the batch id a fingerprint was already registered under', () => {
    const guard = new import_center_js_1.ImportDuplicateGuard();
    const fingerprint = {
        sourceType: 'PURCHASE',
        branchCode: 'HO-BASNI',
        fileHash: (0, import_center_js_1.computeFileHash)(Buffer.from('purchase-file')),
        sourceDateFrom: '2026-09-05',
        sourceDateTo: '2026-09-05',
    };
    strict_1.default.equal(guard.findExisting(fingerprint), undefined);
    guard.register(fingerprint, 'batch-42');
    strict_1.default.equal(guard.findExisting(fingerprint), 'batch-42');
});
(0, node_test_1.default)('a saved template matches a file whose headers line up with its mapping', () => {
    const registry = new import_center_js_1.ImportTemplateRegistry();
    registry.save({
        id: 'tpl-1',
        name: 'Logic ERP Sales',
        importType: 'SALES',
        columnMapping: { reference: 'Bill No.', itemName: 'Item Name', quantity: 'Total Qty', locationName: 'Branch Name' },
    });
    const match = registry.findBestMatch(['Branch Name', 'Bill No.', 'Item Name', 'Total Qty'], 'SALES');
    strict_1.default.ok(match);
    strict_1.default.equal(match?.template.id, 'tpl-1');
    strict_1.default.equal(match?.confidence, 1);
});
(0, node_test_1.default)('findBestMatch picks the higher-scoring template and ignores a different import type', () => {
    const registry = new import_center_js_1.ImportTemplateRegistry();
    registry.save({
        id: 'tpl-sales',
        name: 'Logic ERP Sales',
        importType: 'SALES',
        columnMapping: { reference: 'Bill No.', itemName: 'Item Name', quantity: 'Total Qty' },
    });
    registry.save({
        id: 'tpl-purchase',
        name: 'Logic ERP Purchase',
        importType: 'PURCHASE',
        columnMapping: { reference: 'GRN No.', itemName: 'Item Name', quantity: 'Qty Received' },
    });
    const match = registry.findBestMatch(['Bill No.', 'Item Name', 'Total Qty', 'Extra Column'], 'SALES');
    strict_1.default.equal(match?.template.id, 'tpl-sales');
    const noMatch = registry.findBestMatch(['Completely', 'Different', 'Headers'], 'SALES');
    strict_1.default.equal(noMatch?.confidence, 0);
});
(0, node_test_1.default)('suggestFixFor maps known error patterns to actionable guidance', () => {
    strict_1.default.match((0, import_center_js_1.suggestFixFor)('Item Name is required.'), /missing value/i);
    strict_1.default.match((0, import_center_js_1.suggestFixFor)('EXPIRY DATE "13/13/2026" is invalid; expected DD/MM/YYYY.'), /DD\/MM\/YYYY/);
    strict_1.default.match((0, import_center_js_1.suggestFixFor)('CLOSING STOCK must be a valid number.'), /quantity column/i);
});
(0, node_test_1.default)('suggestFixFor falls back to a generic message for unrecognized errors', () => {
    strict_1.default.match((0, import_center_js_1.suggestFixFor)('Some completely novel failure mode.'), /Review the source file/i);
});
(0, node_test_1.default)('buildImportErrorReport pairs every error with row number, reason and a suggested fix', () => {
    const report = (0, import_center_js_1.buildImportErrorReport)([
        { rowNumber: 5, message: 'Item Name is required.' },
        { rowNumber: 9, message: 'Duplicate row for this item and lot.' },
    ]);
    strict_1.default.equal(report.length, 2);
    strict_1.default.equal(report[0].rowNumber, 5);
    strict_1.default.equal(report[0].reason, 'Item Name is required.');
    strict_1.default.ok(report[0].suggestedFix.length > 0);
    strict_1.default.match(report[1].suggestedFix, /duplicate/i);
});
(0, node_test_1.default)('errorReportToCsv produces a header row and escapes commas/quotes', () => {
    const csv = (0, import_center_js_1.errorReportToCsv)([{ rowNumber: 3, reason: 'Contains, a comma', suggestedFix: 'Say "fix" it' }]);
    const lines = csv.split('\n');
    strict_1.default.equal(lines[0], 'Row Number,Reason,Suggested Fix');
    strict_1.default.equal(lines[1], '3,"Contains, a comma","Say ""fix"" it"');
});
