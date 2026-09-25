import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { listImportBatches, reverseImportBatch } from './import-reversal.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function fixture() {
  const companyId = `reversal-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `reversal-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Importer', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const location = await prisma.location.create({ data: { id: `reversal-loc-${randomUUID()}`, code: `REV-${randomUUID()}`, name: 'Warehouse', type: 'warehouse', companyId } });
  const item = await prisma.item.create({ data: { code: `REV-${randomUUID().slice(0, 8)}`, name: 'Item', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: location.id, onHand: 10, companyId } });
  const batch = await prisma.importBatch.create({ data: {
    id: `reversal-batch-${randomUUID()}`, type: 'PURCHASE', fileName: 'purchase.csv', sourceFormat: 'csv', importedById: userId,
    totalRows: 1, validRows: 1, invalidRows: 0, status: 'POSTED', companyId,
  } });
  await prisma.inventoryMovement.create({ data: {
    id: `reversal-movement-${randomUUID()}`, dedupeKey: `reversal-source-${randomUUID()}`, itemId: item.id, lotId: lot.id,
    locationId: location.id, movementType: 'PURCHASE', qtyDelta: 5, transactionAt: new Date(), sourceType: 'PURCHASE',
    sourceReference: batch.id, importBatchId: batch.id, createdById: userId,
  } });
  return { companyId, userId, location, item, lot, batch };
}

integration('legacy import history and reversal are tenant-scoped, while the owner can reverse once', async () => {
  const owner = await fixture();
  const other = await fixture();

  assert.ok((await listImportBatches(owner.companyId)).some((batch) => batch.id === owner.batch.id));
  assert.ok(!(await listImportBatches(other.companyId)).some((batch) => batch.id === owner.batch.id));
  await assert.rejects(reverseImportBatch({ batchId: owner.batch.id, companyId: other.companyId, actorId: other.userId, reason: 'wrong tenant attempt' }), /not found/i);
  assert.equal((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: owner.item.id, locationId: owner.location.id } })).onHand, 10);

  const result = await reverseImportBatch({ batchId: owner.batch.id, companyId: owner.companyId, actorId: owner.userId, reason: 'approved correction' });
  assert.equal(result.duplicate, false);
  assert.equal((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: owner.item.id, locationId: owner.location.id } })).onHand, 5);
  assert.equal((await prisma.importBatch.findUniqueOrThrow({ where: { id: owner.batch.id } })).status, 'REVERSED');
  assert.equal((await prisma.importBatch.findUniqueOrThrow({ where: { id: result.reversalBatchId! } })).companyId, owner.companyId);
});
