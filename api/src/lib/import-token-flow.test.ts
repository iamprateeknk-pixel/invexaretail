import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStockImport, aggregateOpeningStock } from './stock-import.js';
import { openingPreviewFromStagedRows, stageStockAdjustment, type AdjustmentPlanEntry } from './import-token-flow.js';
import type { ImportBatchRecord } from './import-batch-store.js';

function csvBuffer(rows: unknown[][]): Buffer {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}

test('a second report line for the same branch/item/lot is staged VALID (merged), not "could not be mapped"', async () => {
  const rows = [
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 3],
    ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 2],
  ];
  const preview = await parseStockImport(csvBuffer(rows), 'stock.csv');
  assert.equal(preview.duplicateRows, 1);

  // Both rows resolve to one aggregated plan entry (mirrors planStockUpdate's
  // aggregateOpeningStock() grouping), attributed to the first row.
  const merged: AdjustmentPlanEntry = {
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
  const staged = stageStockAdjustment(preview, plan, 'SET');

  assert.equal(staged.length, 2);
  for (const row of staged) {
    assert.equal(row.status, 'VALID');
    assert.equal(row.errors, null);
  }
  assert.equal(staged[0].mappedData?.mergedIntoRow, null);
  assert.equal(staged[1].mappedData?.mergedIntoRow, staged[0].rowNumber);
  assert.equal(staged[1].mappedData?.resultingQty, 5);
});

test('openingPreviewFromStagedRows normalizes an ADJUSTMENT_SET staged row into a StockImportRow and does not double-count a merged duplicate', async () => {
  const rows = [
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'EXPIRY DATE', 'CLOSING STOCK'],
    ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 3],
    ['Main Store', 'TEST COMPANY', 'Split Lot Item', 'Q1', '999', '31/01/2027', 2],
  ];
  const preview = await parseStockImport(csvBuffer(rows), 'stock.csv');
  const merged: AdjustmentPlanEntry = {
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
  const staged = stageStockAdjustment(preview, plan, 'SET');

  const batch: ImportBatchRecord = {
    id: 'batch-1', type: 'ADJUSTMENT_SET', fileName: 'stock.csv', sourceFormat: preview.format,
    importedById: 'user-1', importedAt: new Date().toISOString(), totalRows: preview.totalRows,
    validRows: staged.length, invalidRows: 0, duplicateRows: preview.duplicateRows,
    metadata: { sheetName: preview.sheetName, headerRow: preview.headerRow, format: preview.format, snapshotAt: preview.snapshotAt },
    status: 'PREVIEWED', branchId: null, fileHash: null, sourceDateFrom: null, sourceDateTo: null,
  };

  // This used to throw "Cannot read properties of undefined (reading
  // 'toLowerCase')" because it blindly cast the adjustment mappedData shape
  // (itemCode/resultingQty) to StockImportRow (code/quantity).
  const openingPreview = openingPreviewFromStagedRows(batch, staged);
  assert.equal(openingPreview.validRows.length, 1, 'the merged duplicate row must not appear a second time');
  assert.equal(openingPreview.validRows[0].code, 'Q1');
  assert.equal(openingPreview.validRows[0].quantity, 5);

  // And feeding it through the same aggregation persistOpeningStockImport()
  // applies must not double the quantity again.
  const aggregated = aggregateOpeningStock(openingPreview.validRows);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].quantity, 5);
});
