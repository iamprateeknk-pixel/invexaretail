// Week 7 mandatory verification: "Two concurrent users cannot reserve more
// than available stock." Exercised against real Postgres, not the
// in-memory test mode - see AGENTS.md "Required tests". Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { reserveStockForTransfer, releaseReservedStock, InsufficientStockError } from './reservation.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture(onHand: number) {
  const companyId = `reservation-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const locationId = `reservation-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `reservation-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Reservation Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand, companyId } });
  return { companyId, locationId, itemId, lotId: lot.id };
}

integration('two concurrent reservations for the same lot cannot together exceed on-hand stock', async () => {
  const { locationId, itemId, lotId } = await makeFixture(10);

  // Both requests ask for 7 of a 10-unit lot: sequentially only one can
  // succeed. This is the exact defect class the Week 6 read-then-write
  // version of this function had - see reservation.ts's Week 7 comment.
  const attempt = () => reserveStockForTransfer([{ itemId, lotId, locationId, quantity: 7 }]);
  const results = await Promise.allSettled([attempt(), attempt()]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one of the two concurrent reservations must succeed');
  assert.equal(rejected.length, 1, 'exactly one of the two concurrent reservations must be rejected');
  assert.ok(
    (rejected[0] as PromiseRejectedResult).reason instanceof InsufficientStockError,
    'the losing request must fail with the stable InsufficientStockError, not a generic error or a silent partial reservation',
  );

  const ledger = await prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
  assert.equal(ledger?.reserved, 7, 'reserved must reflect exactly one successful reservation, never both (which would oversubscribe 14 > 10)');
});

integration('ten concurrent reservations against exactly enough stock for five never oversubscribe', async () => {
  const { locationId, itemId, lotId } = await makeFixture(5);
  const attempts = Array.from({ length: 10 }, () => reserveStockForTransfer([{ itemId, lotId, locationId, quantity: 1 }]));
  const results = await Promise.allSettled(attempts);
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  assert.equal(succeeded, 5, 'exactly 5 of the 10 concurrent 1-unit requests can succeed against 5 units on hand');
  assert.equal(failed, 5);

  const ledger = await prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
  assert.equal(ledger?.reserved, 5, 'SQL evidence: reserved never exceeds onHand even under concurrent load');
  assert.ok(ledger!.reserved <= ledger!.onHand, 'available stock must never become oversubscribed');
});

integration('a multi-line reservation is all-or-nothing: a shortfall on one line rolls back lines already reserved in the same call', async () => {
  const a = await makeFixture(10);
  const b = await makeFixture(2);
  await assert.rejects(
    () => reserveStockForTransfer([
      { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, quantity: 5 },
      { itemId: b.itemId, lotId: b.lotId, locationId: b.locationId, quantity: 5 },
    ]),
    InsufficientStockError,
  );
  const ledgerA = await prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId } } });
  assert.equal(ledgerA?.reserved, 0, 'line A must not stay reserved when line B in the same call fails - no partial writes');
});

integration('releasing reserved stock never drives reserved below zero even when released twice', async () => {
  const { locationId, itemId, lotId } = await makeFixture(10);
  await reserveStockForTransfer([{ itemId, lotId, locationId, quantity: 4 }]);
  await releaseReservedStock([{ itemId, lotId, locationId, quantity: 4 }]);
  await releaseReservedStock([{ itemId, lotId, locationId, quantity: 4 }]);
  const ledger = await prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
  assert.equal(ledger?.reserved, 0);
});

integration('reserving against a lot with no StockLedger row at all fails closed instead of reserving negative availability', async () => {
  const companyId = `reservation-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const locationId = `reservation-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `reservation-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await assert.rejects(() => reserveStockForTransfer([{ itemId, lotId: lot.id, locationId, quantity: 1 }]), InsufficientStockError);
});
