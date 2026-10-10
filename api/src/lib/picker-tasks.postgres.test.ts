// Database-first slice 9 (docs/db-first-reads-plan.md): GET /picker-tasks from Postgres. Proves tenant isolation, the
// pickable-status filter, the "assigned to someone else leaves my queue" rule, and parity with the hydrated snapshot.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { hydrateRepositoryFromDatabase } from './persistence.js';
import { buildPickerTasks, listPickableTransfers } from './picker-tasks.js';
import { listTransfers } from './repository.js';
import type { AccessContext } from './inventory.js';
import type { TenantContext } from './tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function makeCompany() {
  const id = `picker-tasks-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const mk = (suffix: string, role: 'WAREHOUSE_PICKER') => prisma.user.create({
    data: { id: `${id}-${suffix}`, name: suffix, email: `${id}-${suffix}@test.invexa.local`, passwordHash: 'x', role, assignedLocations: '[]', companyId: id },
  });
  const [picker, otherPicker] = await Promise.all([mk('picker', 'WAREHOUSE_PICKER'), mk('picker2', 'WAREHOUSE_PICKER')]);
  const warehouse = await prisma.location.create({ data: { code: `W-${randomUUID().slice(0, 8)}`, name: `${id} wh`, type: 'warehouse', companyId: id } });
  const store = await prisma.location.create({ data: { code: `S-${randomUUID().slice(0, 8)}`, name: `${id} st`, type: 'store', companyId: id } });
  const item = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Picked', companyId: id } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'L1' } });
  return { id, picker: picker.id, otherPicker: otherPicker.id, warehouseId: warehouse.id, storeId: store.id, itemId: item.id, lotId: lot.id };
}

const addTransfer = (c: Awaited<ReturnType<typeof makeCompany>>, status: string, extra: object = {}) =>
  prisma.transfer.create({
    data: {
      sourceLocationId: c.warehouseId, destinationLocationId: c.storeId, requestedById: c.picker, status: status as never, companyId: c.id,
      lines: { create: [{ itemId: c.itemId, lotId: c.lotId, requestedQty: 6 }] }, ...extra,
    },
  });

const tenantOf = (c: Awaited<ReturnType<typeof makeCompany>>): TenantContext => ({ companyId: c.id, tenantId: 'tenant-invexa', userId: c.picker, role: 'WAREHOUSE_PICKER' });
const accessOf = (c: Awaited<ReturnType<typeof makeCompany>>): AccessContext => ({ role: 'WAREHOUSE_PICKER', assignedLocationIds: [c.warehouseId], companyId: c.id });

integration("lists only this company's transfers that still need picking, oldest first", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const first = await addTransfer(a, 'REQUESTED');
  const second = await addTransfer(a, 'PICKING');
  await addTransfer(a, 'DISPATCHED');
  await addTransfer(a, 'RECEIVED');
  const foreign = await addTransfer(b, 'REQUESTED');

  const rows = await listPickableTransfers(tenantOf(a));
  assert.deepEqual(rows.map((row) => row.id), [first.id, second.id]);
  assert.ok(!rows.some((row) => row.id === foreign.id));
  assert.deepEqual(rows[0].lines, [{ itemId: a.itemId, lotId: a.lotId, quantity: 6, receivedQty: 0, damagedQty: 0, shortageQty: 0 }]);
});

integration('a transfer assigned to another picker leaves my queue; an admin still sees it', async () => {
  const a = await makeCompany();
  const open = await addTransfer(a, 'PENDING_PICK');
  const mine = await addTransfer(a, 'PENDING_PICK', { assignedPickerId: a.picker });
  const theirs = await addTransfer(a, 'PENDING_PICK', { assignedPickerId: a.otherPicker });
  await hydrateRepositoryFromDatabase();

  const rows = await listPickableTransfers(tenantOf(a));
  const asPicker = buildPickerTasks(accessOf(a), a.picker, rows);
  assert.deepEqual(asPicker.map((task) => task.transferId).sort(), [open.id, mine.id].sort());
  assert.equal(asPicker.find((task) => task.transferId === mine.id)?.assignedToMe, true);
  assert.ok(!asPicker.some((task) => task.transferId === theirs.id));

  const asAdmin = buildPickerTasks({ role: 'ADMIN', assignedLocationIds: [], companyId: a.id }, 'admin-x', rows);
  assert.ok(asAdmin.some((task) => task.transferId === theirs.id), 'an admin sees every pickable transfer in the company');
});

integration('parity: the database list equals the hydrated snapshot for the same transfers', async () => {
  const c = await makeCompany();
  const created = [await addTransfer(c, 'REQUESTED'), await addTransfer(c, 'PARTIAL', { assignedPickerId: c.otherPicker })];
  await hydrateRepositoryFromDatabase();
  const fromDb = await listPickableTransfers(tenantOf(c));
  const ids = new Set(created.map((row) => row.id));
  const fromSnapshot = listTransfers()
    .filter((row) => ids.has(row.id))
    .map((row) => ({ id: row.id, sourceLocationId: row.sourceLocationId, lines: row.lines, assignedPickerId: row.assignedPickerId }));
  assert.equal(fromDb.length, 2);
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  // an unassigned transfer carries assignedPickerId undefined in the snapshot and omits the key from the database rows
  const norm = (rows: Array<{ assignedPickerId?: string | null }>) => rows.map((row) => ({ ...row, assignedPickerId: row.assignedPickerId ?? undefined }));
  assert.deepEqual(norm([...fromDb].sort(byId)), norm([...fromSnapshot].sort(byId)));
});
