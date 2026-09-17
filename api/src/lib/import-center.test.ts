import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidBatchTransition,
  InvalidBatchTransitionError,
  computeFileHash,
  ImportDuplicateGuard,
  DuplicateImportBatchError,
  ImportTemplateRegistry,
  suggestFixFor,
  buildImportErrorReport,
  errorReportToCsv,
} from './import-center.js';
import {
  createPreviewBatch,
  findDuplicateBatch,
  resetImportBatchStore,
  transitionBatch,
} from './import-batch-store.js';

test('batch lifecycle allows the documented forward path', () => {
  assert.doesNotThrow(() => assertValidBatchTransition('DRAFT', 'PREVIEWED'));
  assert.doesNotThrow(() => assertValidBatchTransition('PREVIEWED', 'VALIDATED'));
  assert.doesNotThrow(() => assertValidBatchTransition('VALIDATED', 'POSTED'));
  assert.doesNotThrow(() => assertValidBatchTransition('POSTED', 'REVERSED'));
});

test('a batch cannot be posted twice', () => {
  assert.throws(() => assertValidBatchTransition('POSTED', 'POSTED'), InvalidBatchTransitionError);
});

test('posted history cannot be skipped back to draft or edited in place', () => {
  assert.throws(() => assertValidBatchTransition('POSTED', 'DRAFT'));
  assert.throws(() => assertValidBatchTransition('POSTED', 'VALIDATED'));
});

test('a reversed batch is terminal', () => {
  assert.throws(() => assertValidBatchTransition('REVERSED', 'POSTED'));
  assert.throws(() => assertValidBatchTransition('REVERSED', 'DRAFT'));
});

test('a failed batch can be retried from draft', () => {
  assert.doesNotThrow(() => assertValidBatchTransition('FAILED', 'DRAFT'));
});

test('computeFileHash is stable for identical content and differs for different content', () => {
  const a = computeFileHash(Buffer.from('same content'));
  const b = computeFileHash(Buffer.from('same content'));
  const c = computeFileHash(Buffer.from('different content'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('the same file for the same branch and date range is rejected as a duplicate batch', () => {
  const guard = new ImportDuplicateGuard();
  const fingerprint = {
    sourceType: 'SALES',
    branchCode: 'HO-BASNI',
    fileHash: computeFileHash(Buffer.from('sales-file')),
    sourceDateFrom: '2026-09-01',
    sourceDateTo: '2026-09-01',
  };

  guard.register(fingerprint, 'batch-1');
  assert.throws(() => guard.register(fingerprint, 'batch-2'), DuplicateImportBatchError);
});

test('duplicate detection is case-insensitive on branch code but distinguishes different files', () => {
  const guard = new ImportDuplicateGuard();
  const base = {
    sourceType: 'SALES',
    fileHash: computeFileHash(Buffer.from('file-a')),
    sourceDateFrom: '2026-09-01',
    sourceDateTo: '2026-09-01',
  };

  guard.register({ ...base, branchCode: 'ho-basni' }, 'batch-1');
  assert.throws(() => guard.register({ ...base, branchCode: 'HO-BASNI' }, 'batch-2'));

  // A different file for the same branch/date is not a duplicate.
  assert.doesNotThrow(() =>
    guard.register({ ...base, branchCode: 'HO-BASNI', fileHash: computeFileHash(Buffer.from('file-b')) }, 'batch-3'),
  );
});

test('store-backed duplicate lookup only blocks a POSTED batch - PREVIEWED/VALIDATED have not touched real stock', async () => {
  resetImportBatchStore();
  const fingerprint = {
    type: 'SALES',
    fileHash: computeFileHash(Buffer.from('store-backed-sales')),
    branchId: 'loc-1',
    sourceDateFrom: '2026-09-11T00:00:00.000Z',
    sourceDateTo: '2026-09-11T00:00:00.000Z',
  };
  const batch = await createPreviewBatch({
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
  assert.equal(await findDuplicateBatch(fingerprint), undefined);

  await transitionBatch(batch.id, 'VALIDATED');
  assert.equal(await findDuplicateBatch(fingerprint), undefined);

  await transitionBatch(batch.id, 'POSTED');
  assert.equal((await findDuplicateBatch(fingerprint))?.status, 'POSTED');
});

test('store-backed duplicate lookup ignores FAILED batches so the same file can be previewed again', async () => {
  resetImportBatchStore();
  const fingerprint = {
    type: 'PURCHASE',
    fileHash: computeFileHash(Buffer.from('abandoned-purchase')),
    branchId: 'wh-1',
    sourceDateFrom: '2026-09-11T00:00:00.000Z',
    sourceDateTo: '2026-09-11T00:00:00.000Z',
  };
  const batch = await createPreviewBatch({
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
  await transitionBatch(batch.id, 'FAILED');
  assert.equal(await findDuplicateBatch(fingerprint), undefined);
});

test('findExisting reports the batch id a fingerprint was already registered under', () => {
  const guard = new ImportDuplicateGuard();
  const fingerprint = {
    sourceType: 'PURCHASE',
    branchCode: 'HO-BASNI',
    fileHash: computeFileHash(Buffer.from('purchase-file')),
    sourceDateFrom: '2026-09-05',
    sourceDateTo: '2026-09-05',
  };
  assert.equal(guard.findExisting(fingerprint), undefined);
  guard.register(fingerprint, 'batch-42');
  assert.equal(guard.findExisting(fingerprint), 'batch-42');
});

test('a saved template matches a file whose headers line up with its mapping', () => {
  const registry = new ImportTemplateRegistry();
  registry.save({
    id: 'tpl-1',
    name: 'Logic ERP Sales',
    importType: 'SALES',
    columnMapping: { reference: 'Bill No.', itemName: 'Item Name', quantity: 'Total Qty', locationName: 'Branch Name' },
  });

  const match = registry.findBestMatch(['Branch Name', 'Bill No.', 'Item Name', 'Total Qty'], 'SALES');
  assert.ok(match);
  assert.equal(match?.template.id, 'tpl-1');
  assert.equal(match?.confidence, 1);
});

test('findBestMatch picks the higher-scoring template and ignores a different import type', () => {
  const registry = new ImportTemplateRegistry();
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
  assert.equal(match?.template.id, 'tpl-sales');

  const noMatch = registry.findBestMatch(['Completely', 'Different', 'Headers'], 'SALES');
  assert.equal(noMatch?.confidence, 0);
});

test('suggestFixFor maps known error patterns to actionable guidance', () => {
  assert.match(suggestFixFor('Item Name is required.'), /missing value/i);
  assert.match(suggestFixFor('EXPIRY DATE "13/13/2026" is invalid; expected DD/MM/YYYY.'), /DD\/MM\/YYYY/);
  assert.match(suggestFixFor('CLOSING STOCK must be a valid number.'), /quantity column/i);
});

test('suggestFixFor falls back to a generic message for unrecognized errors', () => {
  assert.match(suggestFixFor('Some completely novel failure mode.'), /Review the source file/i);
});

test('buildImportErrorReport pairs every error with row number, reason and a suggested fix', () => {
  const report = buildImportErrorReport([
    { rowNumber: 5, message: 'Item Name is required.' },
    { rowNumber: 9, message: 'Duplicate row for this item and lot.' },
  ]);
  assert.equal(report.length, 2);
  assert.equal(report[0].rowNumber, 5);
  assert.equal(report[0].reason, 'Item Name is required.');
  assert.ok(report[0].suggestedFix.length > 0);
  assert.match(report[1].suggestedFix, /duplicate/i);
});

test('errorReportToCsv produces a header row and escapes commas/quotes', () => {
  const csv = errorReportToCsv([{ rowNumber: 3, reason: 'Contains, a comma', suggestedFix: 'Say "fix" it' }]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Row Number,Reason,Suggested Fix');
  assert.equal(lines[1], '3,"Contains, a comma","Say ""fix"" it"');
});
