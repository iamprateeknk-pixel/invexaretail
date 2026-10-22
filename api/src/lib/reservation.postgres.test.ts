// Week 7 mandatory verification: "Two concurrent users cannot reserve more
// than available stock." Exercised against real Postgres, not the
// in-memory test mode - see AGENTS.md "Required tests". Skipped unless
// TEST_DATABASE_URL is set.
//
// Phase 3 (R3) updates: reserve/release now require a companyId and scope
// their SQL by it, ledger lookups use the tenant-qualified compound key,
// and reserved/onHand come back as Prisma Decimals (Phase 2), so numeric
// assertions go through Number(...).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { reserveStockForTransfer, releaseReservedStock, InsufficientStockError } from './reservation.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture(onHand: number, sharedCompanyId?: string) {
  const companyId = sharedCompanyId ?? `reservation-test-${randomUUID()}`;
  if (!sharedCompanyId) {
    await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  }
  const locationId = `reservation-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `reservation-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Reservation Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand, companyId } });
  return { companyId, locationId, itemId, lotId: lot.id };
}

integration('two concurrent reservations for the same lot cannot together exceed on-hand stock', async () => {
  const { companyId, locationId, itemId, lotId } = await makeFixture(10);

  // Both requests ask for 7 of a 10-unit lot: sequentially only one can
  // succeed. This is the exact defect class the Week 6 read-then-write
  // version of this function had - see reservation.ts's Week 7 comment.
  const attempt = () => reserveStockForTransfer([{ itemId, lotId, locationId, quantity: 7 }], { companyId });
  const results = await Promise.allSettled([attempt(), attempt()]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one of the two concurrent reservations must succeed');
  assert.equal(rejected.length, 1, 'exactly one of the two concurrent reservations must be rejected');
  assert.ok(
    (rejected[0] as PromiseRejectedResult).reason instanceof InsufficientStockError,
    'the losing request must fail with the stable InsufficientStockError, not a generic error or a silent partial reservation',
  );

  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.reserved), 7, 'reserved must reflect exactly one successful reservation, never both (which would oversubscribe 14 > 10)');
});

integration('ten concurrent reservations against exactly enough stock for five never oversubscribe', async () => {
  const { companyId, locationId, itemId, lotId } = await makeFixture(5);
  const attempts = Array.from({ length: 10 }, () => reserveStockForTransfer([{ itemId, lotId, locationId, quantity: 1 }], { companyId }));
  const results = await Promise.allSettled(attempts);
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  assert.equal(succeeded, 5, 'exactly 5 of the 10 concurrent 1-unit requests can succeed against 5 units on hand');
  assert.equal(failed, 5);

  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.reserved), 5, 'SQL evidence: reserved never exceeds onHand even under concurrent load');
  assert.ok(Number(ledger!.reserved) <= Number(ledger!.onHand), 'available stock must never become oversubscribed');
});

integration('a multi-line reservation is all-or-nothing: a shortfall on one line rolls back lines already reserved in the same call', async () => {
  const a = await makeFixture(10);
  const b = await makeFixture(2, a.companyId);
  await assert.rejects(
    () => reserveStockForTransfer([
      { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 5 },
      { itemId: b.itemId, lotId: b.lotId, locationId: b.locationId, quantity: 5 },
    ], { companyId: a.companyId }),
    InsufficientStockError,
  );
  const ledgerA = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId } } });
  assert.equal(Number(ledgerA?.reserved), 0, 'line A must not stay reserved when line B in the same call fails - no partial writes');
});

integration('releasing reserved stock never drives reserved below zero even when released twice', async () => {
  const { companyId, locationId, itemId, lotId } = await makeFixture(10);
  await reserveStockForTransfer([{ itemId, lotId, locationId, quantity: 4 }], { companyId });
  await releaseReservedStock([{ itemId, lotId, locationId, quantity: 4 }], { companyId });
  await releaseReservedStock([{ itemId, lotId, locationId, quantity: 4 }], { companyId });
  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.reserved), 0);
});

integration('reserving against a lot with no StockLedger row at all fails closed instead of reserving negative availability', async () => {
  const companyId = `reservation-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const locationId = `reservation-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `reservation-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await assert.rejects(() => reserveStockForTransfer([{ itemId, lotId: lot.id, locationId, quantity: 1 }], { companyId }), InsufficientStockError);
});

integration('a reservation under another company can neither see nor release this company stock', async () => {
  const a = await makeFixture(10);
  const b = await makeFixture(10);

  // Company B reserving against company A's tuple (same item/lot/location
  // identifiers, B's company): the row is not B's, so it must read as
  // zero availability - not as A's 10 units.
  await assert.rejects(
    () => reserveStockForTransfer([{ itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 1 }], { companyId: b.companyId }),
    InsufficientStockError,
  );

  // Reserve 4 under A, then try to release them under B: the release is
  // company-scoped, so A's reservation must survive B's release attempt.
  await reserveStockForTransfer([{ itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 4 }], { companyId: a.companyId });
  await releaseReservedStock([{ itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 4 }], { companyId: b.companyId });
  const afterForeignRelease = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId } } });
  assert.equal(Number(afterForeignRelease?.reserved), 4, 'a foreign company release must not decrement this company reservation');

  await releaseReservedStock([{ itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 4 }], { companyId: a.companyId });
  const afterOwnRelease = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId } } });
  assert.equal(Number(afterOwnRelease?.reserved), 0);
});
