// Phase 5 (DB-first stock reads, R1/R4) — step 0 characterization pins.
//
// These tests are the oracle for Phase 5 steps 2-6: they pin what the
// stock surfaces serve TODAY, at the layers those steps convert (the repo's
// Postgres suites work at the function layer; HTTP suites run in memory
// mode). Where today's behaviour is one of the plan's §2.5 defects, the pin
// is labelled KNOWN-DIVERGENCE and the converting step flips it deliberately
// in its own commit — it is documentation of a defect, not truth to preserve.
//
// Fixture (lib/repositories/stock-parity-harness.ts): company A has a
// fully-bucketed ledger row (onHand 10, reserved 4, inTransit 2, quarantine 1,
// damaged 1), an all-zero row, a second location with stock but no BinStock
// rows, and one BinStock row; company B has its own row that must never leak.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../lib/db.js';
import { hydrateRepositoryFromDatabase } from '../lib/persistence.js';
import { findStockLedgerEntry, listStockLedger, listStockLedgerForLocation } from '../lib/repository.js';
import { canonicalLedgerRows, diffJson, seedStockParityFixture, stockParityCtx, type StockParityFixture } from '../lib/repositories/stock-parity-harness.js';
import { findStockEntry, listBinStockForLocation, listStockForCompany, listStockForLocation } from '../lib/repositories/stock-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

let fixture: StockParityFixture;

test('diffJson names the field that moved and stays silent on parity', () => {
  assert.deepEqual(diffJson({ a: 1, b: [{ c: 'x' }] }, { a: 1, b: [{ c: 'x' }] }), []);
  assert.deepEqual(diffJson({ a: 1 }, { a: 2 }), ['$.a: expected 1, got 2']);
  assert.deepEqual(diffJson({ a: 1 }, {}), ['$.a: missing in actual']);
  assert.deepEqual(diffJson([1], [1, 2]), ['$: expected 1 entries, got 2']);
});

integration('step 0 fixture seeds (shared by every Phase 5 stock suite)', async () => {
  fixture = await seedStockParityFixture();
  const rows = await prisma.stockLedger.findMany({ where: { companyId: { in: [fixture.companyA, fixture.companyB] } } });
  assert.equal(rows.length, 4);
});

integration('GET /stock/:locationId: the repository rows map to the pinned response shape (route field mapping, step 2)', async () => {
  // The route maps stock-repository records through exactly this field
  // mapping; pinning it here keeps the response contract under test at the
  // layer the Postgres suites can reach.
  const rows = (await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA)).map((row) => ({
    itemId: row.itemId,
    lotId: row.lotId,
    locationId: row.locationId,
    bookQuantity: row.onHand,
    physicalQuantity: row.onHand,
    variance: 0,
    stockValue: 0,
    quarantineQuantity: row.quarantine,
    damagedQuantity: row.damaged ?? 0,
    reservedQuantity: row.reserved ?? 0,
    availableQuantity: Math.max(0, row.onHand - (row.reserved ?? 0)),
  }));
  const sorted = [...rows].sort((a, b) => a.itemId.localeCompare(b.itemId));
  assert.deepEqual(sorted, [
    {
      itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA,
      bookQuantity: 10, physicalQuantity: 10, variance: 0, stockValue: 0,
      quarantineQuantity: 1, damagedQuantity: 1, reservedQuantity: 4,
      // Blueprint §7.2: available = onHand - reserved.
      availableQuantity: 6,
    },
    {
      itemId: fixture.itemA2, lotId: fixture.lotA2, locationId: fixture.locationA,
      bookQuantity: 0, physicalQuantity: 0, variance: 0, stockValue: 0,
      quarantineQuantity: 0, damagedQuantity: 0, reservedQuantity: 0, availableQuantity: 0,
    },
  ]);
});

integration('plan §2.5a FIXED at step 2: the stock read behind GET /stock is tenant-scoped in the query itself', async () => {
  // Was a KNOWN-DIVERGENCE pin at step 0: listStockFromDatabase filtered by
  // location alone and the only barrier between companies was the route's
  // canAccessLocation check over the in-memory ownership map. That function
  // is deleted; the route now reads through listStockForLocation, whose
  // query carries the caller's companyId.
  assert.deepEqual(await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationB), []);
  assert.deepEqual(await listStockForLocation(stockParityCtx(fixture.companyB), fixture.locationA), []);
  const own = await listStockForLocation(stockParityCtx(fixture.companyB), fixture.locationB);
  assert.equal(own.length, 1);
  assert.equal(own[0].itemId, fixture.itemB1);
  assert.equal(own[0].reserved, 1);
});

integration('plan §2.5c RESOLVED at step 15: hydration no longer loads stock into the snapshot at all', async () => {
  await hydrateRepositoryFromDatabase();
  // History of this pin: at step 0 the snapshot record had no fields for
  // reserved/inTransit/damaged (KNOWN-DIVERGENCE); step 1 fixed the mapper
  // so the buckets survived hydration; step 15 removes the snapshot from
  // the stock read path entirely — after hydration it holds no stock rows,
  // and the only way to read stock is the tenant-scoped repository.
  assert.equal(findStockLedgerEntry(fixture.itemA1, fixture.lotA1, fixture.locationA), undefined);
  const entry = await findStockEntry(stockParityCtx(fixture.companyA), fixture.itemA1, fixture.lotA1, fixture.locationA);
  assert.equal(entry?.onHand, 10);
  assert.equal(entry?.quarantine, 1);
  assert.equal(entry?.reserved, 4);
  assert.equal(entry?.inTransit, 2);
  assert.equal(entry?.damaged, 1);
});

integration('stock inputs for /dashboard, /expiry-dashboard, /intelligence and picker detail, post-step-15: snapshot empty, repository serves the pinned rows', async () => {
  await hydrateRepositoryFromDatabase();
  // The inputs these surfaces used to take from the snapshot (converted at
  // steps 4-6) no longer exist there: hydration loads no stock (step 15).
  assert.deepEqual(listStockLedgerForLocation(fixture.locationA), []);
  const fixtureLocations = new Set([fixture.locationA, fixture.locationA2, fixture.locationB]);
  assert.deepEqual(listStockLedger().filter((row) => fixtureLocations.has(row.locationId)), []);
  // The same pinned rows, now served by the repository reads the routes use.
  assert.deepEqual(canonicalLedgerRows(await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA)), [
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA, onHand: 10, reserved: 4, inTransit: 2, quarantine: 1, damaged: 1, version: 3 },
    { itemId: fixture.itemA2, lotId: fixture.lotA2, locationId: fixture.locationA, onHand: 0, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 0 },
  ]);
  assert.deepEqual(canonicalLedgerRows(await listStockForCompany(stockParityCtx(fixture.companyA))), [
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA, onHand: 10, reserved: 4, inTransit: 2, quarantine: 1, damaged: 1, version: 3 },
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA2, onHand: 6, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 1 },
    { itemId: fixture.itemA2, lotId: fixture.lotA2, locationId: fixture.locationA, onHand: 0, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 0 },
  ]);
});

integration('plan §2.5b FIXED at step 3: a stocked location with zero BinStock rows now answers [] in DB mode — no memory fallback, no seeding', async () => {
  await hydrateRepositoryFromDatabase();
  // The precondition is unchanged: no BinStock rows at locationA2, while
  // the database holds onHand 6 there. (Post-step-15 the snapshot no longer
  // holds the row at all — hydration slimming — so the old serializeMemory()
  // seeding source is gone twice over; the snapshot assertion pins that.)
  const binRows = await prisma.binStock.findMany({ where: { companyId: fixture.companyA, locationId: fixture.locationA2 } });
  assert.deepEqual(binRows, []);
  const seedRows = (await listStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA2)).filter((row) => row.onHand > 0);
  assert.equal(seedRows.length, 1);
  assert.deepEqual(listStockLedgerForLocation(fixture.locationA2), []);
  // Was a KNOWN-DIVERGENCE pin at step 0: the handler's serializeMemory()
  // seeded those snapshot rows into the staging bin inside the GET and
  // served them as if they were bin stock. The route's database branch is
  // now exactly this repository read, so the GET answers { bins: [] }.
  assert.deepEqual(await listBinStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA2), []);
  // And the populated location still serves its real bin rows.
  const populated = await listBinStockForLocation(stockParityCtx(fixture.companyA), fixture.locationA);
  assert.equal(populated.length, 1);
  assert.equal(populated[0].binId, fixture.binA);
  assert.equal(populated[0].onHand, 10);
});

integration('step 5: the memory intelligence builder, fed by the stock repository, now agrees with the DB branch on availability', async () => {
  // Step 5a pinned the divergence: over the fixture row (onHand 10,
  // reserved 4, AVAILABLE lot) the DB branch reports availability 6 and
  // the old builder reported 10 — a gap of exactly the reserved bucket,
  // widened further by lot status (a BLOCKED lot is 0 to the DB branch).
  // Step 5b fed the builder from the stock repository and reconciled its
  // accumulation with the DB branch's sellable/reserved math; this is the
  // flipped pin, exercising the real builder end to end.
  const { sellableQuantity } = await import('../lib/sellable-stock.js');
  const { buildReplenishmentIntelligence, upsertReorderRule } = await import('../lib/reorder-store.js');
  const lot = { status: 'AVAILABLE', expiryDate: null };
  assert.equal(sellableQuantity({ onHand: 10, reserved: 4, lot }), 6, 'DB branch availability for the fixture row');
  assert.equal(sellableQuantity({ onHand: 10, reserved: 0, lot: { status: 'BLOCKED', expiryDate: null } }), 0);

  await hydrateRepositoryFromDatabase();
  upsertReorderRule({ itemId: fixture.itemA1, locationId: fixture.locationA, minQty: 8, targetQty: 20 });
  const ledger = await listStockForCompany(stockParityCtx(fixture.companyA));
  const result = buildReplenishmentIntelligence(fixture.locationA, ledger);
  const recommendation = result.recommendations.find((row) => row.itemId === fixture.itemA1);
  assert.ok(recommendation, 'the seeded rule must produce a recommendation');
  assert.equal(recommendation.available, 6, 'position = sellable on-hand 10 - reserved 4, no incoming');
  assert.equal(recommendation.suggestedOrderQty, 14, 'position 6 <= min 8, so order up to target 20');
});
