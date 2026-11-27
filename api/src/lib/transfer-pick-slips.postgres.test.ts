import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from './db.js';
import { pickRevision } from './pick-revision.js';
import { listItemsForCompany } from './repositories/item-repository.js';
import { listStockForLocation } from './repositories/stock-repository.js';
import type { TenantContext } from './tenant-context.js';
import { savePickSlip, savedPickSlips } from './transfer-pick-slips.js';
import { transferRowToRecord } from './transfer-record-mapper.js';

test('pick slips and progress commit together, concurrent saves conflict, and retries return the winner', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const companyId = `pick-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const tenant: TenantContext = { companyId, tenantId: 'tenant-invexa', userId: randomUUID(), role: 'WAREHOUSE_PICKER' };
  await prisma.user.create({ data: {
    id: tenant.userId, name: 'Picker', email: `${tenant.userId}@test.invexa.local`, passwordHash: 'x',
    role: tenant.role, assignedLocations: '[]', companyId,
  } });
  const source = await prisma.location.create({ data: { id: randomUUID(), code: `src-${companyId}`, name: 'Warehouse', type: 'warehouse', companyId } });
  const destination = await prisma.location.create({ data: { id: randomUUID(), code: `dst-${companyId}`, name: 'Store', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: companyId, name: 'Test Item', unit: 'PCS', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: companyId } });
  const row = await prisma.transfer.create({ data: {
    companyId, sourceLocationId: source.id, destinationLocationId: destination.id,
    requestedById: tenant.userId, assignedPickerId: tenant.userId, status: 'REQUESTED',
    lines: { create: { itemId: item.id, lotId: lot.id, requestedQty: 2 } },
  }, include: { lines: true } });
  const revision = pickRevision(transferRowToRecord(row), new Map((await listItemsForCompany(tenant)).map((record) => [record.id, record])),
    await listStockForLocation(tenant, source.id), []);
  const attempts = ['first', 'second'].map((id) => ({ id, requestId: id, pickerId: tenant.userId }));
  await assert.rejects(savePickSlip({ ...tenant, companyId: 'foreign-company' }, row.id, revision, 'PARTIAL', attempts[0]), { code: 'TRANSFER_PICK_CHANGED' });
  assert.equal((await savedPickSlips(row.id)).length, 0);

  const results = await Promise.allSettled(attempts.map((slip) => savePickSlip(tenant, row.id, revision, 'PARTIAL', slip)));
  const winner = results.find((result) => result.status === 'fulfilled');
  const loser = results.find((result) => result.status === 'rejected');
  assert.equal(winner?.value.transfer.status, 'PARTIAL');
  assert.equal(loser?.reason.code, 'TRANSFER_PICK_CHANGED');
  assert.equal((await savedPickSlips(row.id)).length, 1);
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: row.id } })).status, 'PARTIAL');
  const original = attempts.find((slip) => slip.id === (winner?.value.metadata as { id: string }).id)!;
  const retry = await savePickSlip(tenant, row.id, revision, 'PARTIAL', original);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.metadata, original);
  assert.equal((await savedPickSlips(row.id)).length, 1);
});
