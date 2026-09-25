// Week 6: count-variance approval and transfer pick-confirm post through the
// canonical service inside their own transactions (journal + ledger + audit +
// outbox together, idempotent). Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { persistConfirmedPickAllocations, persistCountReview } from './persistence.js';
import type { CountRecord } from './repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function fixture(onHand: number | null) {
  const companyId = `pcp-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `pcp-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'P', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const loc = await prisma.location.create({ data: { id: `pcp-loc-${randomUUID()}`, code: `pcp-${randomUUID()}`, name: 'L', type: 'store', companyId } });
  const dst = await prisma.location.create({ data: { id: `pcp-dst-${randomUUID()}`, code: `pcp-${randomUUID()}`, name: 'D', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `PCP-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  if (onHand !== null) await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand, companyId } });
  return { companyId, userId, loc, dst, item, lot };
}

async function pendingCount(f: Awaited<ReturnType<typeof fixture>>, physical: number, book: number) {
  const id = `count-${randomUUID()}`;
  await prisma.stockCount.create({ data: { id, itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, physicalQty: physical, bookQty: book, submittedById: f.userId, companyId: f.companyId } as never });
  const record: CountRecord = {
    id, itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, physicalQuantity: physical, bookQty: book, mode: 'manual',
    submittedBy: f.userId, role: 'ADMIN', createdAt: new Date().toISOString(), status: 'APPROVED', reviewedBy: f.userId, reviewedAt: new Date().toISOString(), reviewReason: 'ok',
  };
  return record;
}

integration('an approved count variance posts one COUNT_VARIANCE journal row that matches the ledger; a second review cannot post again', async () => {
  const f = await fixture(10);
  const count = await pendingCount(f, 7, 10);
  const other = await fixture(1);
  await assert.rejects(persistCountReview(count, other.companyId));
  assert.equal((await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } })).reviewStatus, 'PENDING_REVIEW');
  await persistCountReview(count, f.companyId);
  await assert.rejects(persistCountReview(count, f.companyId), 'a second review of the same count must not post again');
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(ledger.onHand, 7);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'COUNT_VARIANCE');
  assert.equal(rows[0].qtyDelta, -3);
  assert.equal(rows[0].companyId, f.companyId);
  assert.equal(rows[0].idempotencyKey, `count-variance:${count.id}`);
});

integration('a count on a lot with no ledger row yet establishes stock at the physical quantity', async () => {
  const f = await fixture(null);
  await persistCountReview(await pendingCount(f, 6, 0), f.companyId);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(ledger.onHand, 6);
  assert.equal((await prisma.stockMovement.count({ where: { itemId: f.item.id } })), 1);
});

integration('transfer pick-confirm posts TRANSFER_OUT, blocks insufficient stock atomically, and cannot deduct twice', async () => {
  const f = await fixture(10);
  const transfer = await prisma.transfer.create({
    data: { sourceLocationId: f.loc.id, destinationLocationId: f.dst.id, status: 'REQUESTED', requestedById: f.userId, companyId: f.companyId },
  });
  const tenant = { companyId: f.companyId, tenantId: 'tenant-invexa', userId: f.userId, role: 'ADMIN' as const };
  const other = await fixture(1);
  const otherTenant = { companyId: other.companyId, tenantId: 'tenant-invexa', userId: other.userId, role: 'ADMIN' as const };
  const alloc = (quantity: number) => [{ itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, quantity }];

  await assert.rejects(persistConfirmedPickAllocations(transfer.id, alloc(1), otherTenant), /not found/i);
  assert.equal((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } })).onHand, 10);
  await assert.rejects(persistConfirmedPickAllocations(transfer.id, alloc(99), tenant), /Insufficient/);
  assert.equal((await prisma.stockMovement.count({ where: { itemId: f.item.id } })), 0, 'nothing posted on a rejected confirm');

  await persistConfirmedPickAllocations(transfer.id, alloc(4), tenant);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(ledger.onHand, 6);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'TRANSFER_OUT');
  assert.equal(rows[0].qtyDelta, -4);

  await assert.rejects(persistConfirmedPickAllocations(transfer.id, alloc(4), tenant), /already confirmed/);
  assert.equal((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } })).onHand, 6);
});
