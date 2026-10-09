// Database-first slice 3 (docs/db-first-reads-plan.md): open count assignments read from Postgres per company.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { countAssignments } from '../repository.js';
import { listOpenAssignmentsForCompany } from './count-assignment-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany() {
  const id = `assign-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const user = await prisma.user.create({
    data: { id: `${id}-user`, name: 'Counter', email: `${id}@test.invexa.local`, passwordHash: 'x', role: 'STORE_USER', assignedLocations: '[]', companyId: id },
  });
  const location = await prisma.location.create({ data: { code: `L-${randomUUID().slice(0, 8)}`, name: id, type: 'store', companyId: id } });
  const item = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Counted item', companyId: id } });
  return { id, userId: user.id, locationId: location.id, itemId: item.id };
}

const assign = (c: Awaited<ReturnType<typeof makeCompany>>, status: 'ASSIGNED' | 'SUBMITTED' | 'CANCELLED' = 'ASSIGNED', extra: object = {}) =>
  prisma.countAssignment.create({ data: { locationId: c.locationId, itemId: c.itemId, assignedToId: c.userId, assignedById: c.userId, status, ...extra } });

integration("returns only the caller's open assignments, never another company's or a finished one", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const open1 = await assign(a);
  const open2 = await assign(a, 'ASSIGNED', { priority: 'HIGH', dueDate: new Date('2026-12-01T00:00:00Z'), instructions: 'Aisle 4' });
  await assign(a, 'SUBMITTED');
  await assign(a, 'CANCELLED');
  const foreign = await assign(b);

  const mine = await listOpenAssignmentsForCompany(ctxFor(a.id));
  assert.deepEqual(mine.map((row) => row.id), [open1.id, open2.id], 'open only, oldest first');
  assert.equal(mine[1].priority, 'HIGH');
  assert.equal(mine[1].instructions, 'Aisle 4');
  assert.ok(!mine.some((row) => row.id === foreign.id));
  assert.deepEqual((await listOpenAssignmentsForCompany(ctxFor(b.id))).map((row) => row.id), [foreign.id]);
});

integration('parity: the repository equals the hydrated snapshot for the same company', async () => {
  const c = await makeCompany();
  await assign(c);
  await assign(c, 'ASSIGNED', { priority: 'LOW', dueDate: new Date('2026-11-05T00:00:00Z') });
  await hydrateRepositoryFromDatabase();
  const fromDb = await listOpenAssignmentsForCompany(ctxFor(c.id));
  const fromSnapshot = countAssignments.filter((row) => row.locationId === c.locationId && row.status === 'ASSIGNED');
  assert.equal(fromDb.length, 2);
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  assert.deepEqual([...fromDb].sort(byId), [...fromSnapshot].sort(byId));
});
