// Phase 5 (DB-first stock reads, R1/R4) — step 1: the stock repository.
// Proves (a) parity: repository output equals the hydrated snapshot for the
// same company now that both use lib/stock-ledger-mapper.ts, (b) tenant
// isolation: another company's rows are invisible under every function,
// (c) post-boot visibility: a row written after hydration is read back
// without rehydrating — the property the snapshot never had, and the reason
// this repository exists. Fixture: lib/repositories/stock-parity-harness.ts.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { listStockLedger, listStockLedgerForLocation } from '../repository.js';
import { canonicalLedgerRows, seedStockParityFixture, stockParityCtx, type StockParityFixture } from './stock-parity-harness.js';
import { findStockEntry, listBinStockForLocation, listRecentMovementItemIds, listRecentMovements, listStockForCompany, listStockForLocation } from './stock-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

let fixture: StockParityFixture;

integration('fixture seeds (stock-parity-harness)', async () => {
  fixture = await seedStockParityFixture();
});

integration('listStockForLocation returns the full buckets for the caller\'s company only', async () => {
  const mine = await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA);
  assert.deepEqual(canonicalLedgerRows(mine), [
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA, onHand: 10, reserved: 4, inTransit: 2, quarantine: 1, damaged: 1, version: 3 },
    { itemId: fixture.itemA2, lotId: fixture.lotA2, locationId: fixture.locationA, onHand: 0, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 0 },
  ]);
  // Another company asking for this location gets nothing — not an error,
  // not the rows: the companyId is in the query, not checked afterwards.
  assert.deepEqual(await listStockForLocation(stockParityCtx(fixture.companyB), fixture.locationA), []);
  assert.deepEqual(await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationB), []);
});

integration('findStockEntry resolves the tenant-qualified key and nothing else', async () => {
  const hit = await findStockEntry(stockParityCtx(fixture.companyA), fixture.itemA1, fixture.lotA1, fixture.locationA);
  assert.equal(hit?.onHand, 10);
  assert.equal(hit?.reserved, 4);
  // The same tuple under company B does not exist, even though it exists under A.
  assert.equal(await findStockEntry(stockParityCtx(fixture.companyB), fixture.itemA1, fixture.lotA1, fixture.locationA), null);
  assert.equal(await findStockEntry(stockParityCtx(fixture.companyA), fixture.itemA1, fixture.lotA1, fixture.locationB), null);
});

integration('listStockForCompany is bounded to the caller\'s company', async () => {
  const a = await listStockForCompany(stockParityCtx(fixture.companyA));
  assert.equal(a.length, 3);
  assert.ok(a.every((row) => row.locationId !== fixture.locationB));
  const b = await listStockForCompany(stockParityCtx(fixture.companyB));
  assert.deepEqual(canonicalLedgerRows(b), [
    { itemId: fixture.itemB1, lotId: fixture.lotB1, locationId: fixture.locationB, onHand: 5, reserved: 1, inTransit: 0, quarantine: 0, damaged: 0, version: 2 },
  ]);
});

integration('parity: the repository equals the hydrated snapshot for the same company', async () => {
  await hydrateRepositoryFromDatabase();
  const fromDb = await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA);
  const fromSnapshot = listStockLedgerForLocation(fixture.locationA);
  assert.deepEqual(canonicalLedgerRows(fromDb), canonicalLedgerRows(fromSnapshot));
  const companyFromDb = await listStockForCompany(stockParityCtx(fixture.companyA));
  const companyFromSnapshot = listStockLedger().filter((row) => [fixture.locationA, fixture.locationA2].includes(row.locationId));
  assert.deepEqual(canonicalLedgerRows(companyFromDb), canonicalLedgerRows(companyFromSnapshot));
});

integration('a row written after boot is visible to the repository without rehydration', async () => {
  await hydrateRepositoryFromDatabase();
  const lot = await prisma.lot.create({ data: { itemId: fixture.itemA2, lotNo: `LOT-POSTBOOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({
    data: { companyId: fixture.companyA, itemId: fixture.itemA2, lotId: lot.id, locationId: fixture.locationA, onHand: 7, reserved: 1 },
  });
  const entry = await findStockEntry(stockParityCtx(fixture.companyA), fixture.itemA2, lot.id, fixture.locationA);
  assert.equal(entry?.onHand, 7);
  const all = await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA);
  assert.equal(all.length, 3, 'the post-boot row joins the two seeded rows');
});

integration('listBinStockForLocation serves the populated location and answers [] for the unpopulated one (no memory fallback)', async () => {
  const rows = await listBinStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].binId, fixture.binA);
  assert.equal(rows[0].onHand, 10);
  assert.equal(rows[0].reserved, 4);
  assert.equal(rows[0].item.id, fixture.itemA1);
  // The §2.5b case: stock exists at locationA2 but BinStock was never
  // populated — the repository says so, instead of inventing staging rows.
  assert.deepEqual(await listBinStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA2), []);
  assert.deepEqual(await listBinStockForLocation(stockParityCtx(fixture.companyB), fixture.locationA), []);
});

integration('listRecentMovementItemIds reads the journal, scoped and time-filtered', async () => {
  const now = new Date();
  const longAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
  const move = (companyId: string, itemId: string, lotId: string, locationId: string, timestamp: Date, movementType: 'SALES_DEDUCTION' | 'PURCHASE_RECEIPT') =>
    prisma.stockMovement.create({
      data: { companyId, itemId, lotId, locationId, movementType, qtyDelta: -1, beforeBalance: 10, afterBalance: 9, timestamp },
    });
  await move(fixture.companyA, fixture.itemA1, fixture.lotA1, fixture.locationA, now, 'SALES_DEDUCTION');
  await move(fixture.companyA, fixture.itemA1, fixture.lotA1, fixture.locationA, now, 'SALES_DEDUCTION');
  await move(fixture.companyA, fixture.itemA2, fixture.lotA2, fixture.locationA, longAgo, 'SALES_DEDUCTION');
  await move(fixture.companyB, fixture.itemB1, fixture.lotB1, fixture.locationB, now, 'SALES_DEDUCTION');

  const all = await listRecentMovementItemIds(stockParityCtx(fixture.companyA), { locationId: fixture.locationA });
  assert.deepEqual([...all].sort(), [fixture.itemA1, fixture.itemA2].sort(), 'distinct item ids, both movements eras');
  const recent = await listRecentMovementItemIds(stockParityCtx(fixture.companyA), {
    locationId: fixture.locationA,
    since: new Date(now.getTime() - 3600_000),
  });
  assert.deepEqual(recent, [fixture.itemA1], 'the 30-day-old movement falls outside the window');
  const receipts = await listRecentMovementItemIds(stockParityCtx(fixture.companyA), { locationId: fixture.locationA, movementType: 'PURCHASE_RECEIPT' });
  assert.deepEqual(receipts, [], 'no receipts were seeded');
  assert.deepEqual(await listRecentMovementItemIds(stockParityCtx(fixture.companyB), { locationId: fixture.locationA }), [], "company B sees none of A's journal");
});

integration('listRecentMovements returns signed journal rows, type/time filtered and tenant-scoped', async () => {
  const now = new Date();
  const move = (itemId: string, lotId: string, movementType: 'SALES_DEDUCTION' | 'SALES_RETURN', qtyDelta: number, timestamp: Date) =>
    prisma.stockMovement.create({
      data: { companyId: fixture.companyA, itemId, lotId, locationId: fixture.locationA2, movementType, qtyDelta, beforeBalance: 6, afterBalance: 6 + qtyDelta, timestamp },
    });
  await move(fixture.itemA1, fixture.lotA1, 'SALES_DEDUCTION', -3, now);
  await move(fixture.itemA1, fixture.lotA1, 'SALES_RETURN', 1, new Date(now.getTime() + 60_000));
  await move(fixture.itemA1, fixture.lotA1, 'SALES_DEDUCTION', -2, new Date(now.getTime() - 40 * 24 * 3600_000));

  const rows = await listRecentMovements(stockParityCtx(fixture.companyA), {
    locationId: fixture.locationA2,
    movementTypes: ['SALES_DEDUCTION', 'SALES_RETURN'],
    since: new Date(now.getTime() - 24 * 3600_000),
  });
  assert.deepEqual(rows.map((row) => [row.movementType, row.qtyDelta]), [['SALES_DEDUCTION', -3], ['SALES_RETURN', 1]]);
  assert.deepEqual(await listRecentMovements(stockParityCtx(fixture.companyB), { locationId: fixture.locationA2 }), []);
});
