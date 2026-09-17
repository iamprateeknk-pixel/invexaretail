import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeImportBatchProgress, interpretImportResponse, buildLocalImportErrorCsv } from './import-batch.js';

test('mergeImportBatchProgress overlays GET /imports/:token counts onto the preview payload', () => {
  const preview = {
    batchToken: 'imp-1',
    status: 'PREVIEWED',
    totalRows: 3,
    validRows: 2,
    invalidRows: 1,
    duplicateRows: 0,
    sample: [{ rowNumber: 2, itemName: 'Rice 5kg' }],
    errors: [{ rowNumber: 4, message: 'Unknown item.' }],
  };
  const live = {
    batchToken: 'imp-1',
    status: 'PREVIEWED',
    totalRows: 3,
    validRows: 2,
    invalidRows: 1,
    duplicateRows: 0,
    errors: [{ rowNumber: 4, message: 'Unknown item.' }],
    sample: [{ rowNumber: 2, itemCode: 'SKU-1001', qtyDelta: -1 }],
  };
  const merged = mergeImportBatchProgress(preview, live);
  assert.equal(merged.status, 'PREVIEWED');
  assert.equal(merged.validRows, 2);
  assert.equal(merged.invalidRows, 1);
  assert.equal(merged.sample[0].itemCode, 'SKU-1001');
});

test('mergeImportBatchProgress keeps the preview sample when the live payload has none', () => {
  const preview = { batchToken: 'imp-1', sample: [{ rowNumber: 2 }], validRows: 1 };
  const merged = mergeImportBatchProgress(preview, { batchToken: 'imp-1', status: 'PREVIEWED', validRows: 1, sample: [] });
  assert.equal(merged.status, 'PREVIEWED');
  assert.equal(merged.sample[0].rowNumber, 2);
});

test('import responses keep a 409 preview and reject other failures', () => {
  const conflict = interpretImportResponse(409, { preview: { batchToken: 'imp-1' }, message: 'Duplicate file.' });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.result.preview.batchToken, 'imp-1');
  const ok = interpretImportResponse(200, { validRows: 4 });
  assert.equal(ok.conflict, false);
  assert.equal(ok.result.validRows, 4);
  assert.throws(() => interpretImportResponse(400, { message: 'Unknown item.' }), /Unknown item/);
});

test('local import error CSV keeps row numbers', () => {
  const csv = buildLocalImportErrorCsv([{ rowNumber: 4, message: 'Unknown item.' }]);
  assert.match(csv, /"Row","Error"/);
  assert.match(csv, /"4","Unknown item."/);
});
