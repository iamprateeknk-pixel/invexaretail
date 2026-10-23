// Week 6 / guide Week 15: order fulfilment deducts onHand through the
// canonical service in the fulfilment transaction (journal + ledger together)
// and releases the reservation; a second fulfil cannot deduct again. Skipped
// unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { fulfillOrder } from './orders.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('fulfillOrder posts a SALES_DEDUCTION journal row, releases the reservation, and cannot deduct twice', async () => {
  const companyId = `ord-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ord-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'O', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const loc = await prisma.location.create({ data: { id: `ord-loc-${randomUUID()}`, code: `ord-${randomUUID()}`, name: 'L', type: 'warehouse', companyId } });
  const item = await prisma.item.create({ data: { code: `ORD-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand: 10, reserved: 3, companyId } });
  const order = await prisma.order.create({
    data: { channel: 'WEBSITE', status: 'RESERVED', fulfillmentLocationId: loc.id, createdById: userId, companyId,
      lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 3, fulfillmentLocationId: loc.id }] } },
  });

  const otherCompanyId = `ord-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: otherCompanyId, name: otherCompanyId } });
  const otherUserId = `ord-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: otherUserId, name: 'Other', email: `${otherUserId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId: otherCompanyId } });
  await assert.rejects(fulfillOrder(otherCompanyId, order.id, otherUserId), /not found/i);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'RESERVED', 'a cross-tenant attempt must not mutate the order');

  await fulfillOrder(companyId, order.id, userId);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: loc.id } });
  assert.equal(Number(ledger.onHand), 7);
  assert.equal(Number(ledger.reserved), 0);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: item.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'SALES_DEDUCTION');
  assert.equal(Number(rows[0].qtyDelta), -3);
  assert.equal(rows[0].companyId, companyId);

  await assert.rejects(fulfillOrder(companyId, order.id, userId), 'a fulfilled order cannot be fulfilled again');
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: loc.id } })).onHand), 7);
  assert.equal(await prisma.stockMovement.count({ where: { itemId: item.id } }), 1);
});
