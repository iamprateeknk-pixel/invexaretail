// Wave 3 (P1-2) regression: deleting a transfer must release the stock it
// reserved. The release lives inside persistTransferDeletion's own delete
// transaction (per-line decrement via transferReservationTotals) - the
// route handler deliberately does NOT call releaseReservedStock on top of
// it, because that helper's GREATEST(0, ...) clamp would silently eat
// other transfers' reservations on the same ledger row if both ran.
// This test locks the persistence behaviour in. Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { persistTransferDeletion } from './persistence.js';
import type { TransferRecord } from './repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('persistTransferDeletion releases the reservation and removes the transfer in one transaction', async () => {
  const companyId = `del-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `del-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'D', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const source = await prisma.location.create({ data: { id: `del-loc-${randomUUID()}`, code: `del-${randomUUID()}`, name: 'S', type: 'warehouse', companyId } });
  const dest = await prisma.location.create({ data: { id: `del-loc-${randomUUID()}`, code: `del-${randomUUID()}`, name: 'D', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `DEL-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: source.id, onHand: 100, reserved: 50, companyId } });
  const transfer = await prisma.transfer.create({
    data: {
      sourceLocationId: source.id, destinationLocationId: dest.id, requestedById: userId,
      status: 'REQUESTED', companyId,
      lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 50 }] },
    },
  });

  const record: TransferRecord = {
    id: transfer.id,
    sourceLocationId: source.id,
    destinationLocationId: dest.id,
    requestedBy: userId,
    role: 'ADMIN',
    status: 'REQUESTED',
    lines: [{ itemId: item.id, lotId: lot.id, quantity: 50 }],
    createdAt: new Date().toISOString(),
    companyId,
  };
  await persistTransferDeletion(record, companyId);

  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: source.id } });
  assert.equal(Number(ledger.reserved), 0, 'the deleted transfer\u2019s reservation is fully released');
  assert.equal(Number(ledger.onHand), 100, 'on-hand is untouched by a deletion');
  assert.equal(await prisma.transfer.findUnique({ where: { id: transfer.id } }), null, 'the transfer row is gone');
  assert.equal(await prisma.transferLine.count({ where: { transferId: transfer.id } }), 0, 'its lines are gone too');
});
