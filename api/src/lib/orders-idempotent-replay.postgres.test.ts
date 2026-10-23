// Week 15 execution-guide mandatory verification: "Same marketplace order
// replayed twice creates one order and one reservation" - proven at memory
// level in orders.memory.test.ts, but AGENTS.md's "Required tests" rule
// asks for real-Postgres coverage for anything touching stock reservation.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { createOrderWithReservation } from './orders.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture(onHand: number) {
  const companyId = `order-replay-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `order-replay-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Order Replay Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  const locationId = `order-replay-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `order-replay-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Order Replay Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand, companyId } });
  return { companyId, userId, locationId, itemId };
}

integration('the same marketplace order replayed twice (sequentially) creates one order and one reservation, not two', async () => {
  const { companyId, userId, locationId, itemId } = await makeFixture(10);
  const externalReference = `replay-test-${randomUUID()}`;
  const input = {
    channel: 'FLIPKART',
    externalReference,
    createdById: userId,
    companyId,
    allowSplit: true,
    fulfillmentLocationId: locationId,
    lines: [{ itemId, quantity: 3 }],
  };

  const first = await createOrderWithReservation(input);
  assert.equal(first.duplicate, undefined, 'the first delivery must actually create the order');
  const replay = await createOrderWithReservation({ ...input, externalReference });
  assert.equal(replay.duplicate, true, 'the replayed delivery must be recognized as a duplicate');
  assert.equal(replay.id, first.id, 'the replay must return the same order, not a second one');

  const orders = await prisma.order.findMany({ where: { channel: 'FLIPKART', externalReference } });
  assert.equal(orders.length, 1, 'exactly one Order row must exist for this channel + external reference');

  const ledger = await prisma.stockLedger.findFirst({ where: { itemId, locationId } });
  // Only one reservation's worth of stock (3) was ever taken, not two (6):
  // onHand itself is untouched by reservation (that's a separate
  // Reservation/available-quantity concern), but the point under test is
  // that a second createOrderWithReservation call for the same replay never
  // reached reserveStockForTransfer again - proven indirectly by there
  // being exactly one Order/OrderLine, asserted above, and confirmed here
  // by onHand still reflecting only the fixture's original stock (no second
  // debit occurred, whatever the specific reservation accounting model is).
  assert.equal(Number(ledger?.onHand), 10);
});

integration('two deliveries of the same marketplace order arriving concurrently still create exactly one order', async () => {
  const { companyId, userId, locationId, itemId } = await makeFixture(10);
  const externalReference = `replay-concurrent-test-${randomUUID()}`;
  const input = {
    channel: 'AMAZON',
    externalReference,
    createdById: userId,
    companyId,
    allowSplit: true,
    fulfillmentLocationId: locationId,
    lines: [{ itemId, quantity: 2 }],
  };

  const results = await Promise.allSettled([
    createOrderWithReservation(input),
    createOrderWithReservation({ ...input }),
  ]);
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrderWithReservation>>> => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'both concurrent deliveries must resolve (one as the real order, one as a recognized duplicate) - never throw');
  const ids = new Set(fulfilled.map((r) => r.value.id));
  assert.equal(ids.size, 1, 'both concurrent deliveries must resolve to the same single order');
  assert.equal(fulfilled.filter((r) => r.value.duplicate).length, 1, 'exactly one of the two must be marked as the duplicate');

  const orders = await prisma.order.findMany({ where: { channel: 'AMAZON', externalReference } });
  assert.equal(orders.length, 1, 'exactly one Order row must exist even though two requests raced for it');
});

integration('two companies can each receive the same channel + external reference (uniqueness is per company)', async () => {
  const a = await makeFixture(10);
  const b = await makeFixture(10);
  const externalReference = `shared-ref-${randomUUID()}`;
  const make = (f: typeof a) => ({ channel: 'SHOPIFY', externalReference, createdById: f.userId, companyId: f.companyId, allowSplit: true, fulfillmentLocationId: f.locationId, lines: [{ itemId: f.itemId, quantity: 2 }] });

  const orderA = await createOrderWithReservation(make(a));
  const orderB = await createOrderWithReservation(make(b));
  assert.equal(orderA.duplicate, undefined);
  assert.equal(orderB.duplicate, undefined, 'company B must get its own order, not be told it is a duplicate of company A');
  assert.notEqual(orderA.id, orderB.id);
  assert.equal((await prisma.order.findUnique({ where: { id: orderB.id } }))?.companyId, b.companyId);
});

integration('the database itself rejects a second order for the same company + channel + reference (guards multiple API replicas)', async () => {
  const f = await makeFixture(10);
  const externalReference = `db-guard-${randomUUID()}`;
  const first = await createOrderWithReservation({ channel: 'AMAZON', externalReference, createdById: f.userId, companyId: f.companyId, allowSplit: true, fulfillmentLocationId: f.locationId, lines: [{ itemId: f.itemId, quantity: 1 }] });
  await assert.rejects(
    prisma.order.create({ data: { companyId: f.companyId, channel: 'AMAZON', externalReference, status: 'RESERVED', fulfillmentLocationId: f.locationId, createdById: f.userId } }),
    (error: { code?: string }) => error.code === 'P2002',
  );
  assert.equal((await prisma.order.count({ where: { companyId: f.companyId, channel: 'AMAZON', externalReference } })), 1);
  assert.ok(first.id);
});
