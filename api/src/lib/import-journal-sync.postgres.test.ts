// The legacy bulk-stock paths (Stock Update screen: opening stock, daily/adjustment imports, and import
// reversal) used to change StockLedger balances with raw SQL and no movement-journal row, and without a
// companyId on the ledger row. Each import therefore re-opened the "unexplained balance" gap that the
// reconciliation reports, and a non-default company's stock landed under the default company.
//
// Now every such change journals the net difference in the same transaction (lib/import-journal-sync.ts) and
// stamps the real company. Real Postgres; skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { parseStockImport } from './stock-import.js';
import { persistDailyMovementImport, persistOpeningStockImport } from './persistence.js';
import { reverseImportBatch } from './import-reversal.js';
import { reconcileStock } from './stock-reconciliation.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

function csvBuffer(rows: unknown[][]): Buffer {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\n'));
}

async function company(label: string) {
  const companyId = `ijs-${label}-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ijs-user-${label}-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: label, email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  return { companyId, userId };
}

async function importOpening(companyId: string, userId: string, branch: string, code: string, lot: string, qty: number, batchId?: string) {
  const preview = await parseStockImport(csvBuffer([
    ['BRANCH NAME', 'COMPANY NAME', 'ITEM NAME', 'ITEM CODE', 'LOT CODE', 'CLOSING STOCK'],
    [branch, 'Test Co', `Journal Item ${code}`, code, lot, qty],
  ]), 'stock.csv');
  assert.equal(preview.errors.length, 0);
  return persistOpeningStockImport(preview, 'stock.csv', userId, { companyId, batchId });
}

integration('opening-stock import journals the balance and stamps the real company, so reconciliation has nothing unexplained', async () => {
  const a = await company('open-a');
  const b = await company('open-b');
  const code = `JS-${randomUUID().slice(0, 8)}`;
  const lot = `LOT-${randomUUID().slice(0, 8)}`;
  const branch = `Branch ${randomUUID().slice(0, 6)}`;
  await importOpening(a.companyId, a.userId, branch, code, lot, 40);

  const item = await prisma.item.findFirstOrThrow({ where: { code, companyId: a.companyId } });
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id } });
  assert.equal(ledger.companyId, a.companyId, 'the ledger row belongs to the importing company, not the schema default');
  assert.equal(Number(ledger.onHand), 40);

  const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id } });
  assert.equal(movements.length, 1, 'one journal row explains the balance');
  assert.equal(movements[0].companyId, a.companyId);
  assert.equal(Number(movements[0].qtyDelta), 40);
  assert.equal(movements[0].movementType, 'OPENING_STOCK');

  const first = await reconcileStock({ companyId: a.companyId });
  assert.deepEqual([first.mismatches, first.noJournalHistory], [0, 0], 'journal and balance agree');

  // A second opening import with a different quantity journals only the difference.
  await importOpening(a.companyId, a.userId, branch, code, lot, 52);
  const after = await prisma.stockMovement.findMany({ where: { itemId: item.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(after.map((row) => Number(row.qtyDelta)), [40, 12]);
  const second = await reconcileStock({ companyId: a.companyId });
  assert.deepEqual([second.mismatches, second.noJournalHistory], [0, 0]);

  // Company B is unaffected by company A's imports.
  assert.equal((await reconcileStock({ companyId: b.companyId })).ledgerRows, 0);
});

integration('daily/adjustment import and its reversal both keep journal and balance in agreement', async () => {
  const a = await company('daily-a');
  const code = `JD-${randomUUID().slice(0, 8)}`;
  const lotNo = `LOT-${randomUUID().slice(0, 8)}`;
  const branch = `Branch ${randomUUID().slice(0, 6)}`;
  await importOpening(a.companyId, a.userId, branch, code, lotNo, 10);
  const item = await prisma.item.findFirstOrThrow({ where: { code, companyId: a.companyId } });
  const lot = await prisma.lot.findFirstOrThrow({ where: { itemId: item.id, lotNo } });
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id } });

  const batchId = `ijs-daily-${randomUUID()}`;
  await persistDailyMovementImport({
    batchId, importType: 'ADJUSTMENT', fileName: 'adjust.csv', importedBy: a.userId, totalRows: 1, invalidRows: 0, duplicateRows: 0,
    companyId: a.companyId,
    movements: [{ id: `mv-${randomUUID()}`, dedupeKey: `ijs-${randomUUID()}`, itemId: item.id, lotId: lot.id, locationId: ledger.locationId, movementType: 'ADJUSTMENT', qtyDelta: 7, transactionAt: new Date().toISOString(), sourceType: 'ADJUSTMENT', sourceReference: batchId, importBatchId: batchId, createdById: a.userId }],
    lots: [], checkpoints: [],
  });
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { id: ledger.id } })).onHand), 17);
  const afterImport = await reconcileStock({ companyId: a.companyId });
  assert.deepEqual([afterImport.mismatches, afterImport.noJournalHistory], [0, 0], 'the daily import is journalled');

  const reversal = await reverseImportBatch({ batchId, companyId: a.companyId, actorId: a.userId, reason: 'approved correction' });
  assert.equal(reversal.duplicate, false);
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { id: ledger.id } })).onHand), 10);
  const afterReversal = await reconcileStock({ companyId: a.companyId });
  assert.deepEqual([afterReversal.mismatches, afterReversal.noJournalHistory], [0, 0], 'the reversal is journalled too');

  const rows = await prisma.stockMovement.findMany({ where: { itemId: item.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((row) => Number(row.qtyDelta)), [10, 7, -7], 'opening, import, reversal');
});
