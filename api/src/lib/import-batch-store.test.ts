import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFileHash, InvalidBatchTransitionError } from './import-center.js';
import {
  countRowsByStatus,
  createPreviewBatch,
  findDuplicateBatch,
  getBatch,
  listRows,
  resetImportBatchStore,
  transitionBatch,
} from './import-batch-store.js';
import { movementsFromStagedDailyRows, stageDailyImport } from './import-token-flow.js';
import { parseDailyStockImport } from './daily-stock-sync.js';
import { salesCsvBuffer } from './import-fixtures.js';

const COMPANY_ID = 'import-store-test-company';

test('preview creates a PREVIEWED batch with staged rows', async () => {
  resetImportBatchStore();
  const batch = await createPreviewBatch({
    companyId: COMPANY_ID,
    type: 'SALES',
    fileName: 'sales.csv',
    sourceFormat: 'daily-erp-export',
    importedById: 'user-admin-1',
    fileHash: computeFileHash(Buffer.from('sales-file')),
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
  assert.equal(batch.status, 'PREVIEWED');
  const counts = await countRowsByStatus(COMPANY_ID, batch.id);
  assert.equal(counts.VALID, 1);
  assert.equal(counts.INVALID, 1);
  assert.equal((await listRows(COMPANY_ID, batch.id, 'INVALID'))[0].errors?.[0], 'Item Name is required.');
});

test('a merely-previewed batch never blocks re-uploading the same file (nothing was applied to stock yet)', async () => {
  resetImportBatchStore();
  const fingerprint = {
    companyId: COMPANY_ID,
    type: 'SALES',
    fileHash: computeFileHash(Buffer.from('same-bytes')),
    branchId: null,
    sourceDateFrom: '2026-09-11T00:00:00.000Z',
    sourceDateTo: '2026-09-11T00:00:00.000Z',
  };
  await createPreviewBatch({
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
  assert.equal(await findDuplicateBatch(fingerprint), undefined);
});

test('the same file hash, type and date range cannot start a second live batch once POSTED', async () => {
  resetImportBatchStore();
  const fingerprint = {
    companyId: COMPANY_ID,
    type: 'SALES',
    fileHash: computeFileHash(Buffer.from('same-bytes')),
    branchId: null,
    sourceDateFrom: '2026-09-11T00:00:00.000Z',
    sourceDateTo: '2026-09-11T00:00:00.000Z',
  };
  const first = await createPreviewBatch({
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
  await transitionBatch(COMPANY_ID, first.id, 'VALIDATED');
  await transitionBatch(COMPANY_ID, first.id, 'POSTED', { committedRows: 1 });
  const duplicate = await findDuplicateBatch(fingerprint);
  assert.equal(duplicate?.id, first.id);
});

test('abandoning a preview frees the fingerprint so the file can be uploaded again', async () => {
  resetImportBatchStore();
  const fingerprint = {
    companyId: COMPANY_ID,
    type: 'PURCHASE',
    fileHash: computeFileHash(Buffer.from('purchase-bytes')),
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
  await transitionBatch(COMPANY_ID, batch.id, 'FAILED');
  assert.equal(await findDuplicateBatch(fingerprint), undefined);
});

test('posted batches cannot be posted a second time through the lifecycle', async () => {
  resetImportBatchStore();
  const batch = await createPreviewBatch({
    companyId: COMPANY_ID,
    type: 'SALES',
    fileName: 'sales.csv',
    sourceFormat: 'daily-erp-export',
    importedById: 'user-admin-1',
    fileHash: computeFileHash(Buffer.from('posted')),
    totalRows: 1,
    validRows: 1,
    invalidRows: 0,
    duplicateRows: 0,
    rows: [{ rowNumber: 2, status: 'VALID', rawData: {} }],
  });
  await transitionBatch(COMPANY_ID, batch.id, 'VALIDATED');
  await transitionBatch(COMPANY_ID, batch.id, 'POSTED', { committedRows: 1 });
  const posted = await getBatch(COMPANY_ID, batch.id);
  assert.equal(posted?.status, 'POSTED');
  assert.equal(posted?.metadata?.committedRows, 1);
  await assert.rejects(() => transitionBatch(COMPANY_ID, batch.id, 'POSTED'), InvalidBatchTransitionError);
});

test('preview batches, staged rows, duplicate checks, and transitions fail closed across companies', async () => {
  resetImportBatchStore();
  const ownerCompanyId = 'import-owner-company';
  const otherCompanyId = 'import-other-company';
  const batch = await createPreviewBatch({
    companyId: ownerCompanyId,
    type: 'SALES', fileName: 'tenant.csv', sourceFormat: 'daily-erp-export', importedById: 'user-owner',
    fileHash: computeFileHash(Buffer.from('tenant-file')), totalRows: 1, validRows: 1, invalidRows: 0, duplicateRows: 0,
    rows: [{ rowNumber: 2, status: 'VALID', rawData: { itemName: 'Rice' } }],
  });

  assert.equal(await getBatch(otherCompanyId, batch.id), undefined);
  assert.deepEqual(await listRows(otherCompanyId, batch.id), []);
  assert.deepEqual(await countRowsByStatus(otherCompanyId, batch.id), { VALID: 0, INVALID: 0, DUPLICATE: 0 });
  await assert.rejects(() => transitionBatch(otherCompanyId, batch.id, 'FAILED'), /not found/i);
  assert.equal(await findDuplicateBatch({ companyId: otherCompanyId, type: batch.type, fileHash: batch.fileHash!, branchId: null }), undefined);

  await transitionBatch(ownerCompanyId, batch.id, 'VALIDATED');
  assert.equal((await getBatch(ownerCompanyId, batch.id))?.status, 'VALIDATED');
});

test('commit reconstructs one movement per staged allocation and keeps the previewed lot', async () => {
  const movements = movementsFromStagedDailyRows('imp-1', 'user-admin-1', 'SALES', [{
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
  assert.equal(movements.movements.length, 1);
  assert.equal(movements.movements[0].qtyDelta, -1);
  assert.equal(movements.movements[0].lotId, 'lot-1001');
  assert.equal(movements.movements[0].metadata?.rowSource, 'ERP');
  assert.match(movements.movements[0].dedupeKey, /lot-1001$/);
});

test('staging a daily preview keeps parser errors and planned allocations on the same row numbers', async () => {
  const preview = await parseDailyStockImport(
    salesCsvBuffer(2),
    'sales.csv',
    'SALES',
    { purchaseLocationName: 'H.O BASNI' },
  );
  const staged = stageDailyImport(preview, {
    errors: [{ rowNumber: preview.validRows[1]?.rowNumber ?? 3, message: 'Unknown item.' }],
    prepared: preview.validRows.slice(0, 1).map((row) => ({
      row,
      item: { id: 'item-1001', code: 'SKU-1001', name: 'Rice 5kg' },
      locationId: 'loc-1',
      lotId: 'lot-1001',
      qtyDelta: -0.01,
    })),
  });
  assert.equal(staged.filter((row) => row.status === 'VALID').length, 1);
  assert.equal(staged.filter((row) => row.status === 'INVALID').length, 1);
});
