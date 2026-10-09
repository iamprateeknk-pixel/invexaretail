// Database-first slice 8 (docs/db-first-reads-plan.md): GET /mobile/work built from Postgres equals the one built from
// the hydrated snapshot, and never leaks another company's tasks. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { hydrateRepositoryFromDatabase } from './persistence.js';
import { loadMobileWork, loadMobileWorkFromSnapshot } from './mobile-work.js';
import type { AccessContext } from './inventory.js';
import type { TenantContext } from './tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function makeCompany() {
  const id = `mobile-work-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const user = await prisma.user.create({
    data: { id: `${id}-user`, name: 'Store user', email: `${id}@test.invexa.local`, passwordHash: 'x', role: 'STORE_USER', assignedLocations: '[]', companyId: id },
  });
  const store = await prisma.location.create({ data: { code: `S-${randomUUID().slice(0, 8)}`, name: `${id} store`, type: 'store', companyId: id } });
  const warehouse = await prisma.location.create({ data: { code: `W-${randomUUID().slice(0, 8)}`, name: `${id} warehouse`, type: 'warehouse', companyId: id } });
  return { id, userId: user.id, storeId: store.id, warehouseId: warehouse.id };
}

async function addItem(c: Awaited<ReturnType<typeof makeCompany>>, tag: string) {
  const item = await prisma.item.create({ data: { code: `I-${tag}-${randomUUID().slice(0, 6)}`, name: `Counted ${tag}`, companyId: c.id, barcode: `890${randomUUID().slice(0, 8)}`, unit: 'PCS' } });
  const stocked = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'STOCKED', expiryDate: new Date('2027-05-01T00:00:00Z') } });
  const empty = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'EMPTY' } });
  const blocked = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'BLOCKED', status: 'BLOCKED' } });
  for (const [lot, onHand] of [[stocked, 12], [empty, 0], [blocked, 5]] as const) {
    await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: c.storeId, onHand, companyId: c.id } });
  }
  return { item, stockedLotId: stocked.id };
}

const tenantOf = (c: Awaited<ReturnType<typeof makeCompany>>): TenantContext => ({ companyId: c.id, tenantId: 'tenant-invexa', userId: c.userId, role: 'STORE_USER' });
const accessOf = (c: Awaited<ReturnType<typeof makeCompany>>): AccessContext => ({ role: 'STORE_USER', assignedLocationIds: [c.storeId], companyId: c.id });

integration('count tasks keep only stocked, available lots; receive tasks list only this company\'s inbound transfers; equals the snapshot', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const { item, stockedLotId } = await addItem(a, 'a');
  const second = await addItem(a, 'a2');
  await prisma.countAssignment.create({ data: { locationId: a.storeId, itemId: item.id, assignedToId: a.userId, assignedById: a.userId, priority: 'HIGH', instructions: 'Shelf 3' } });
  // an assignment whose item has nothing on the shelf is not an actionable task
  await prisma.stockLedger.updateMany({ where: { itemId: second.item.id }, data: { onHand: 0 } });
  await prisma.countAssignment.create({ data: { locationId: a.storeId, itemId: second.item.id, assignedToId: a.userId, assignedById: a.userId } });

  const inbound = await prisma.transfer.create({
    data: {
      sourceLocationId: a.warehouseId, destinationLocationId: a.storeId, requestedById: a.userId, status: 'DISPATCHED', cartonCount: 3, companyId: a.id,
      lines: { create: [{ itemId: item.id, lotId: stockedLotId, requestedQty: 4 }] },
    },
  });
  await prisma.transfer.create({ data: { sourceLocationId: a.warehouseId, destinationLocationId: a.storeId, requestedById: a.userId, status: 'REQUESTED', companyId: a.id } });
  // another company's inbound transfer must never show up
  await prisma.transfer.create({ data: { sourceLocationId: b.warehouseId, destinationLocationId: b.storeId, requestedById: b.userId, status: 'DISPATCHED', companyId: b.id } });

  await hydrateRepositoryFromDatabase();
  const fromDb = await loadMobileWork(tenantOf(a), accessOf(a));
  const fromSnapshot = loadMobileWorkFromSnapshot(tenantOf(a), accessOf(a));

  assert.equal(fromDb.countTasks.length, 1, 'the unstocked item is dropped');
  assert.deepEqual(fromDb.countTasks[0].lots.map((lot) => lot.lotNo), ['STOCKED'], 'empty and blocked lots are dropped');
  assert.equal(fromDb.countTasks[0].priority, 'HIGH');
  assert.deepEqual(fromDb.receiveTasks.map((task) => task.transferId), [inbound.id], "only this company's dispatched transfer");
  assert.equal(fromDb.receiveTasks[0].lineCount, 1);
  assert.equal(fromDb.receiveTasks[0].cartonCount, 3);

  const normalise = (work: typeof fromDb) => ({
    countTasks: work.countTasks,
    receiveTasks: work.receiveTasks.filter((task) => task.transferId === inbound.id),
  });
  assert.deepEqual(normalise(fromDb), normalise(fromSnapshot));
});

integration('a branch manager sees receive tasks but no count tasks, and a user of another company sees none of this company\'s', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  await prisma.transfer.create({ data: { sourceLocationId: a.warehouseId, destinationLocationId: a.storeId, requestedById: a.userId, status: 'IN_TRANSIT', companyId: a.id } });
  await hydrateRepositoryFromDatabase();

  const manager = await loadMobileWork({ ...tenantOf(a), role: 'BRANCH_MANAGER' }, { role: 'BRANCH_MANAGER', assignedLocationIds: [a.storeId], companyId: a.id });
  assert.equal(manager.countTasks.length, 0);
  assert.equal(manager.receiveTasks.length, 1);

  const stranger = await loadMobileWork(tenantOf(b), accessOf(b));
  assert.deepEqual(stranger, { countTasks: [], receiveTasks: [] });
});
