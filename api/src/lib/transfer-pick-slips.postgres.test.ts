import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
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
  const attempts = Array.from({ length: 6 }, (_, index) => {
    const id = `slip-${index}`;
    return { id, requestId: id, pickerId: tenant.userId, requestFingerprint: `fingerprint-${index}` };
  });
  await assert.rejects(savePickSlip({ ...tenant, companyId: 'foreign-company' }, row.id, revision, 'PARTIAL', attempts[0]), { code: 'TRANSFER_PICK_CHANGED' });
  assert.equal((await savedPickSlips(row.id)).length, 0);

  const results = await Promise.allSettled(attempts.map((slip) => savePickSlip(tenant, row.id, revision, 'PARTIAL', slip)));
  const [winner, ...others] = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');
  assert.equal(winner?.value.transfer.status, 'PARTIAL');
  assert.equal(others.length, 0);
  assert.deepEqual(losers.map((loser) => loser.reason.code), Array(attempts.length - 1).fill('TRANSFER_PICK_CHANGED'));
  assert.equal((await savedPickSlips(row.id)).length, 1);
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: row.id } })).status, 'PARTIAL');
  const original = attempts.find((slip) => slip.id === (winner?.value.metadata as { id: string }).id)!;
  const retry = await savePickSlip(tenant, row.id, revision, 'PARTIAL', original);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.metadata, original);
  await assert.rejects(savePickSlip(tenant, row.id, revision, 'PARTIAL', {
    ...original, requestFingerprint: 'changed-command',
  }), { code: 'DUPLICATE_REQUEST' });
  assert.equal((await savedPickSlips(row.id)).length, 1);

  // Force the raw FOR UPDATE query to acquire its snapshot while another
  // transaction holds the row. PostgreSQL reports SQLSTATE 40001 when that
  // transaction commits, and Prisma's adapter wraps it as a raw-query error.
  let signalLocked!: () => void;
  let releaseLock!: () => void;
  const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
  const released = new Promise<void>((resolve) => { releaseLock = resolve; });
  const manager = prisma.$transaction(async (tx) => {
    await tx.transfer.update({ where: { id: row.id }, data: { status: 'READY_FOR_ADMIN' } });
    signalLocked();
    await released;
  });
  await Promise.race([locked, manager]);
  const changed = assert.rejects(savePickSlip(tenant, row.id, revision, 'PARTIAL', {
    id: 'late', requestId: 'late', pickerId: tenant.userId,
  }), { code: 'TRANSFER_PICK_CHANGED' });
  // Await both operations after releasing the lock, even if the poll fails.
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
      const [result] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE 'SELECT id FROM "Transfer" WHERE id = % FOR UPDATE') AS waiting`;
      waiting = result.waiting;
      if (!waiting) await delay(20);
    }
    assert.equal(waiting, true, 'the picker must wait on the manager transaction');
  } finally {
    releaseLock();
    await Promise.all([manager, changed]);
  }
  assert.equal((await savedPickSlips(row.id)).length, 1);
});
