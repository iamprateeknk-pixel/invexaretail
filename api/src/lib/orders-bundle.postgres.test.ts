// Selling a virtual bundle consumes its components: the order line for the kit
// becomes component lines, stock is reserved and then decremented on the
// components, and the kit item itself never holds stock. Real Postgres only
// (AGENTS.md: reservation/posting changes). Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { createOrderWithReservation, fulfillOrder, OrderShortageError } from './orders.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture() {
  const companyId = `order-bundle-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `order-bundle-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Bundle Order Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  const locationId = `order-bundle-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const mkItem = async (name: string, onHand: number | null) => {
    const id = `order-bundle-item-${randomUUID()}`;
    await prisma.item.create({ data: { id, code: id, name, unit: 'ea', companyId } });
    if (onHand !== null) {
      const lot = await prisma.lot.create({ data: { itemId: id, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
      await prisma.stockLedger.create({ data: { itemId: id, lotId: lot.id, locationId, onHand, companyId } });
    }
    return id;
  };
  const kitId = await mkItem('Kit', null);
  const riceId = await mkItem('Rice', 20);
  const dalId = await mkItem('Dal', 20);
  await prisma.itemBundleComponent.createMany({
    data: [
      { bundleItemId: kitId, componentItemId: riceId, quantity: 2, companyId },
      { bundleItemId: kitId, componentItemId: dalId, quantity: 3, companyId },
    ],
  });
  return { companyId, userId, locationId, kitId, riceId, dalId };
}

const ledger = (itemId: string, locationId: string) => prisma.stockLedger.findFirstOrThrow({ where: { itemId, locationId } });

integration('an order for 4 kits reserves 8 rice and 12 dal; fulfilling it takes them off the components', async () => {
  const f = await makeFixture();
  const order = await createOrderWithReservation({
    channel: 'WEB', externalReference: `bundle-${randomUUID()}`, createdById: f.userId, companyId: f.companyId,
    fulfillmentLocationId: f.locationId, lines: [{ itemId: f.kitId, quantity: 4 }],
  });
  const quantities = Object.fromEntries(order.lines.map((line) => [line.itemId, Number(line.requestedQty)]));
  assert.deepEqual(quantities, { [f.riceId]: 8, [f.dalId]: 12 }, 'the kit line is replaced by component lines');
  assert.equal(order.lines.some((line: { itemId: string }) => line.itemId === f.kitId), false, 'no line may reference the kit itself');
  assert.equal((await ledger(f.riceId, f.locationId)).reserved, 8);
  assert.equal((await ledger(f.dalId, f.locationId)).reserved, 12);

  await fulfillOrder(f.companyId, order.id, f.userId);
  const rice = await ledger(f.riceId, f.locationId);
  const dal = await ledger(f.dalId, f.locationId);
  assert.equal(rice.onHand, 12);
  assert.equal(dal.onHand, 8);
  assert.equal(rice.reserved, 0);
  assert.equal(dal.reserved, 0);
  assert.equal(await prisma.stockLedger.count({ where: { itemId: f.kitId } }), 0, 'the kit never holds stock of its own');
  const movements = await prisma.stockMovement.findMany({ where: { itemId: { in: [f.riceId, f.dalId] }, locationId: f.locationId } });
  assert.ok(movements.length >= 2, 'each component movement is journalled');
});

integration('a kit that the scarcest component cannot cover is refused, and nothing is reserved', async () => {
  const f = await makeFixture();
  await prisma.stockLedger.updateMany({ where: { itemId: f.dalId, locationId: f.locationId }, data: { onHand: 5 } });
  await assert.rejects(
    createOrderWithReservation({
      channel: 'WEB', externalReference: `bundle-${randomUUID()}`, createdById: f.userId, companyId: f.companyId,
      fulfillmentLocationId: f.locationId, lines: [{ itemId: f.kitId, quantity: 4 }], // needs 12 dal, only 5
    }),
    (error: unknown) => error instanceof OrderShortageError,
  );
  assert.equal((await ledger(f.riceId, f.locationId)).reserved, 0);
  assert.equal((await ledger(f.dalId, f.locationId)).reserved, 0);
});

integration('a kit and one of its components on the same order are merged into one component line', async () => {
  const f = await makeFixture();
  const order = await createOrderWithReservation({
    channel: 'WEB', externalReference: `bundle-${randomUUID()}`, createdById: f.userId, companyId: f.companyId,
    fulfillmentLocationId: f.locationId, lines: [{ itemId: f.kitId, quantity: 1 }, { itemId: f.riceId, quantity: 5 }],
  });
  const rice = order.lines.filter((line: { itemId: string }) => line.itemId === f.riceId);
  assert.equal(rice.length, 1);
  assert.equal(rice[0].requestedQty, 7);
});

integration('another company cannot expand this company\'s bundle (a foreign kit id is just an unknown item)', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await assert.rejects(
    createOrderWithReservation({
      channel: 'WEB', externalReference: `bundle-${randomUUID()}`, createdById: b.userId, companyId: b.companyId,
      fulfillmentLocationId: b.locationId, lines: [{ itemId: a.kitId, quantity: 1 }],
    }),
    /not found/i,
  );
});

integration('items that are not bundles still order exactly as before', async () => {
  const f = await makeFixture();
  const order = await createOrderWithReservation({
    channel: 'WEB', externalReference: `plain-${randomUUID()}`, createdById: f.userId, companyId: f.companyId,
    fulfillmentLocationId: f.locationId, lines: [{ itemId: f.riceId, quantity: 3 }],
  });
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].requestedQty, 3);
});
