// Stock-update commit crashed with "Cannot move import batch from POSTED to POSTED": the opening-stock and daily
// persist functions stamp the batch POSTED inside the stock transaction, and the route then asked transitionBatch
// to POSTED it again - after the stock was already written. completeBatchPosting must accept that state.
// Real Postgres; skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { parseStockImport } from './stock-import.js';
import { persistOpeningStockImport } from './persistence.js';
import { completeBatchPosting, createPreviewBatch, getBatch, transitionBatch } from './import-batch-store.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function setup() {
  const companyId = `ibp-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ibp-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'u', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const code = `IBP-${randomUUID().slice(0, 8)}`;
  const preview = await parseStockImport(Buffer.from(`BRANCH NAME,COMPANY NAME,ITEM NAME,ITEM CODE,LOT CODE,CLOSING STOCK\nBranch ${code},Co,Item ${code},${code},L1,9`), 'stock.csv');
  const batch = await createPreviewBatch({
    companyId, type: 'OPENING_STOCK', fileName: 'stock.csv', sourceFormat: preview.format, importedById: userId, fileHash: randomUUID(),
    totalRows: 1, validRows: 1, invalidRows: 0, duplicateRows: 0, rows: [{ rowNumber: 2, status: 'VALID', rawData: {} }],
  });
  await transitionBatch(companyId, batch.id, 'VALIDATED');
  return { companyId, userId, batch, preview };
}

integration('a batch the stock write already marked POSTED is completed, not rejected, and keeps its stock', async () => {
  const { companyId, userId, batch, preview } = await setup();
  const result = await persistOpeningStockImport(preview, 'stock.csv', userId, { batchId: batch.id, companyId });
  assert.equal((await getBatch(companyId, batch.id))?.status, 'POSTED', 'the stock transaction stamped it POSTED');

  await assert.rejects(transitionBatch(companyId, batch.id, 'POSTED'), /POSTED to POSTED/, 'the old call is the reported bug');
  const done = await completeBatchPosting(companyId, batch.id, { committedRows: result.stockRows });
  assert.equal(done.status, 'POSTED');
  assert.equal(done.metadata?.committedRows, result.stockRows);
  assert.equal(await prisma.stockLedger.count({ where: { companyId } }), 1, 'stock was written exactly once');
});

integration('a batch still VALIDATED goes through the normal transition, and another company cannot complete it', async () => {
  const { companyId, batch } = await setup();
  await assert.rejects(completeBatchPosting(`other-${randomUUID()}`, batch.id, { committedRows: 1 }), /not found/);
  assert.equal((await getBatch(companyId, batch.id))?.status, 'VALIDATED');
  const done = await completeBatchPosting(companyId, batch.id, { committedRows: 1 });
  assert.equal(done.status, 'POSTED');
});
