// Database-first slice 5 (docs/db-first-reads-plan.md): stock counts read from Postgres per company, with the
// submitter's real role. Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { counts as snapshot } from '../repository.js';
import { listCountsForCompany } from './count-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany(role: 'WAREHOUSE_PICKER' | 'BRANCH_MANAGER' = 'WAREHOUSE_PICKER') {
  const id = `count-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const user = await prisma.user.create({
    data: { id: `${id}-user`, name: 'Counter', email: `${id}@test.invexa.local`, passwordHash: 'x', role, assignedLocations: '[]', companyId: id },
  });
  const location = await prisma.location.create({ data: { code: `L-${randomUUID().slice(0, 8)}`, name: id, type: 'store', companyId: id } });
  const item = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Counted item', companyId: id } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `LOT-${randomUUID().slice(0, 6)}` } });
  return { id, userId: user.id, locationId: location.id, itemId: item.id, lotId: lot.id };
}

const addCount = (c: Awaited<ReturnType<typeof makeCompany>>, extra: object = {}) =>
  prisma.stockCount.create({
    data: { itemId: c.itemId, lotId: c.lotId, locationId: c.locationId, physicalQty: 7, bookQty: 10, submittedById: c.userId, companyId: c.id, ...extra },
  });

integration("returns only the caller's counts, oldest first, with the submitter's real role", async () => {
  const a = await makeCompany('WAREHOUSE_PICKER');
  const b = await makeCompany();
  const first = await addCount(a);
  const second = await addCount(a, { reviewStatus: 'APPROVED', reasonCode: 'DAMAGE', reviewReason: 'Checked' });
  const foreign = await addCount(b);

  const mine = await listCountsForCompany(ctxFor(a.id));
  assert.deepEqual(mine.map((row) => row.id), [first.id, second.id]);
  assert.ok(mine.every((row) => row.role === 'WAREHOUSE_PICKER'), 'role comes from the submitting user, not a placeholder');
  assert.equal(mine[1].status, 'APPROVED');
  assert.equal(mine[1].reasonCode, 'DAMAGE');
  assert.equal(mine[0].physicalQuantity, 7);
  assert.ok(!mine.some((row) => row.id === foreign.id));
  assert.deepEqual((await listCountsForCompany(ctxFor(b.id))).map((row) => row.id), [foreign.id]);
});

integration('parity: equals the hydrated snapshot for the same company, apart from the role placeholder', async () => {
  const c = await makeCompany('BRANCH_MANAGER');
  await addCount(c);
  await addCount(c, { mode: 'scan', reconciliationRequired: true, reconciliationNote: 'late file' });
  await hydrateRepositoryFromDatabase();
  const fromDb = await listCountsForCompany(ctxFor(c.id));
  const fromSnapshot = snapshot.filter((row) => row.locationId === c.locationId);
  assert.equal(fromDb.length, 2);
  assert.ok(fromDb.every((row) => row.role === 'BRANCH_MANAGER'));
  assert.ok(fromSnapshot.every((row) => row.role === 'STORE_USER'), 'the snapshot still carries its historical placeholder');
  const withoutRole = (row: object) => ({ ...row, role: undefined });
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  assert.deepEqual([...fromDb].sort(byId).map(withoutRole), [...fromSnapshot].sort(byId).map(withoutRole));
});
