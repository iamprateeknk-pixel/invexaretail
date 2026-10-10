// Real-Postgres proof for the transfer picker assignment column and the transfer notifications.
// Skipped unless TEST_DATABASE_URL is set (CI runs every *.postgres.test.ts against a real database).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { persistTransferAssignedPicker } from './persistence.js';
import { notifyPickerAssigned, notifyTransferDispatched } from './transfer-assignment.js';
import type { TransferRecord } from './repository.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function fixture() {
  const companyId = `assign-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const source = await prisma.location.create({ data: { code: `src-${randomUUID()}`, name: 'Basni Warehouse', type: 'WAREHOUSE', companyId } });
  const destination = await prisma.location.create({ data: { code: `dst-${randomUUID()}`, name: 'Sardarpura Store', type: 'STORE', companyId } });
  const user = (role: 'ADMIN' | 'WAREHOUSE_PICKER' | 'STORE_USER', locations: string[]) => prisma.user.create({
    data: {
      id: `assign-${role.toLowerCase()}-${randomUUID()}`, name: role, email: `${randomUUID()}@test.invexa.local`,
      passwordHash: 'not-a-real-hash', role, assignedLocations: JSON.stringify(locations), companyId,
    },
  });
  const admin = await user('ADMIN', []);
  const picker = await user('WAREHOUSE_PICKER', [source.id]);
  const storeUser = await user('STORE_USER', [destination.id]);
  const row = await prisma.transfer.create({
    data: { sourceLocationId: source.id, destinationLocationId: destination.id, requestedById: admin.id, companyId, status: 'REQUESTED' },
  });
  const record: TransferRecord = {
    id: row.id, sourceLocationId: source.id, destinationLocationId: destination.id, requestedBy: admin.id, role: 'ADMIN',
    status: 'REQUESTED', lines: [{ itemId: 'item-x', lotId: 'lot-x', quantity: 6 }], createdAt: row.createdAt.toISOString(),
  };
  return { companyId, source, destination, admin, picker, storeUser, record };
}

integration('the assigned picker is stored on the transfer, scoped to its company, and can be cleared', async () => {
  const owner = await fixture();
  const other = await fixture();

  await persistTransferAssignedPicker({ ...owner.record, assignedPickerId: owner.picker.id }, owner.companyId);
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: owner.record.id } })).assignedPickerId, owner.picker.id);

  // Another company's write to the same id finds nothing and changes nothing.
  await assert.rejects(() => persistTransferAssignedPicker({ ...owner.record, assignedPickerId: other.picker.id }, other.companyId));
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: owner.record.id } })).assignedPickerId, owner.picker.id);

  await persistTransferAssignedPicker({ ...owner.record, assignedPickerId: undefined }, owner.companyId);
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: owner.record.id } })).assignedPickerId, null);
});

integration('notifications land in the recipient inbox under the right company', async () => {
  const owner = await fixture();

  await notifyPickerAssigned({ ...owner.record, assignedPickerId: owner.picker.id }, owner.companyId, 'Basni Warehouse', 'Sardarpura Store');
  const pickerInbox = await prisma.userNotification.findMany({ where: { userId: owner.picker.id } });
  assert.equal(pickerInbox.length, 1);
  assert.equal(pickerInbox[0].companyId, owner.companyId);
  assert.equal(pickerInbox[0].type, 'transfer.pick_assigned');
  assert.match(pickerInbox[0].body, new RegExp(owner.record.id));

  const users = [owner.picker, owner.storeUser, owner.admin].map((user) => ({
    id: user.id, companyId: owner.companyId, role: user.role, locationIds: JSON.parse(user.assignedLocations) as string[], status: 'active' as const,
  }));
  await notifyTransferDispatched({ ...owner.record, status: 'DISPATCHED' }, owner.companyId, users, 'Basni Warehouse');
  const dispatched = await prisma.userNotification.findMany({ where: { companyId: owner.companyId, type: 'transfer.dispatched' } });
  assert.deepEqual(dispatched.map((notice) => notice.userId), [owner.storeUser.id]);
});
