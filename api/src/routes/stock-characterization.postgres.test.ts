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
import { hydrateRepositoryFromDatabase, listStockFromDatabase } from '../lib/persistence.js';
import { findStockLedgerEntry, listStockLedger, listStockLedgerForLocation } from '../lib/repository.js';
import { canonicalLedgerRows, diffJson, seedStockParityFixture, type StockParityFixture } from '../lib/repositories/stock-parity-harness.js';

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

integration('GET /stock/:locationId DB branch: listStockFromDatabase returns the pinned row shape', async () => {
  const rows = await listStockFromDatabase(fixture.locationA);
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

integration('KNOWN-DIVERGENCE (plan §2.5a): listStockFromDatabase takes no company — the query is not tenant-scoped', async () => {
  // The only thing standing between companies today is the route's
  // canAccessLocation check over the in-memory ownership map. Phase 5 step 2
  // deletes this function and routes GET /stock through the tenant-scoped
  // stock repository; this pin is removed in that commit.
  const foreign = await listStockFromDatabase(fixture.locationB);
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].itemId, fixture.itemB1);
  assert.equal(foreign[0].reservedQuantity, 1);
});

integration('plan §2.5c FIXED at step 1: the hydrated snapshot now carries reserved/inTransit/damaged via the shared mapper', async () => {
  await hydrateRepositoryFromDatabase();
  const entry = findStockLedgerEntry(fixture.itemA1, fixture.lotA1, fixture.locationA);
  assert.ok(entry, 'the fixture row must be in the hydrated snapshot');
  assert.equal(entry.onHand, 10);
  assert.equal(entry.quarantine, 1);
  // Was a KNOWN-DIVERGENCE pin at step 0: hydration mapped only
  // onHand/quarantine/version, so the DB row's reserved 4 / inTransit 2 /
  // damaged 1 were invisible to every snapshot-fed screen. Hydration and
  // the stock repository now share lib/stock-ledger-mapper.ts.
  assert.equal(entry.reserved, 4);
  assert.equal(entry.inTransit, 2);
  assert.equal(entry.damaged, 1);
});

integration('snapshot stock inputs for /dashboard, /expiry-dashboard, /intelligence and picker detail are pinned (steps 4-6 convert these reads)', async () => {
  await hydrateRepositoryFromDatabase();
  // Per-location input (dashboard reports, picker transfer detail).
  assert.deepEqual(canonicalLedgerRows(listStockLedgerForLocation(fixture.locationA)), [
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA, onHand: 10, reserved: 4, inTransit: 2, quarantine: 1, damaged: 1, version: 3 },
    { itemId: fixture.itemA2, lotId: fixture.lotA2, locationId: fixture.locationA, onHand: 0, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 0 },
  ]);
  // Whole-snapshot input (dashboard totals, intelligence memory branch, webhook low-stock).
  const fixtureLocations = new Set([fixture.locationA, fixture.locationA2, fixture.locationB]);
  const mine = canonicalLedgerRows(listStockLedger().filter((row) => fixtureLocations.has(row.locationId)));
  assert.deepEqual(mine, [
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA, onHand: 10, reserved: 4, inTransit: 2, quarantine: 1, damaged: 1, version: 3 },
    { itemId: fixture.itemA1, lotId: fixture.lotA1, locationId: fixture.locationA2, onHand: 6, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 1 },
    { itemId: fixture.itemA2, lotId: fixture.lotA2, locationId: fixture.locationA, onHand: 0, reserved: 0, inTransit: 0, quarantine: 0, damaged: 0, version: 0 },
    { itemId: fixture.itemB1, lotId: fixture.lotB1, locationId: fixture.locationB, onHand: 5, reserved: 1, inTransit: 0, quarantine: 0, damaged: 0, version: 2 },
  ]);
});

integration('KNOWN-DIVERGENCE (plan §2.5b): bin-stock GET fallback precondition — a stocked location with zero BinStock rows is served from memory in DB mode today', async () => {
  await hydrateRepositoryFromDatabase();
  // The DB side of the precondition: no BinStock rows at locationA2…
  const binRows = await prisma.binStock.findMany({ where: { companyId: fixture.companyA, locationId: fixture.locationA2 } });
  assert.deepEqual(binRows, []);
  // …while the snapshot holds onHand 6 there — exactly what the handler's
  // serializeMemory() seeds into the staging bin inside the GET today.
  // Phase 5 step 3 removes the DB-mode fallback; an empty BinStock then
  // answers { bins: [] } and this pin is flipped in that commit.
  const seedRows = listStockLedgerForLocation(fixture.locationA2).filter((row) => row.onHand > 0);
  assert.deepEqual(seedRows.map((row) => ({ itemId: row.itemId, lotId: row.lotId, onHand: row.onHand })), [
    { itemId: fixture.itemA1, lotId: fixture.lotA1, onHand: 6 },
  ]);
  // And the populated location's DB branch input, pinned for step 3's repository function.
  const populated = await prisma.binStock.findMany({ where: { companyId: fixture.companyA, locationId: fixture.locationA, onHand: { gt: 0 } } });
  assert.equal(populated.length, 1);
  assert.equal(populated[0].binId, fixture.binA);
  assert.equal(Number(populated[0].onHand), 10);
});
