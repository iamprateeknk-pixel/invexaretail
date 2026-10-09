// Database-first slice 2 (docs/db-first-reads-plan.md): the movement history reads Postgres per company.
// Proves tenant isolation, newest-first ordering with the limit applied, and parity with the hydrated snapshot.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { dailyMovements } from '../repository.js';
import { listRecentMovementsForCompany } from './movement-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany() {
  const id = `mov-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const user = await prisma.user.create({
    data: { id: `${id}-user`, name: 'Mover', email: `${id}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId: id },
  });
  const location = await prisma.location.create({ data: { code: `L-${randomUUID().slice(0, 8)}`, name: id, type: 'store', companyId: id } });
  const item = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Mover item', companyId: id } });
  return { id, userId: user.id, locationId: location.id, itemId: item.id };
}

async function addMovements(c: Awaited<ReturnType<typeof makeCompany>>, count: number, startMs: number) {
  const tag = randomUUID().slice(0, 8);
  await prisma.inventoryMovement.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      id: `${tag}-${index}`, dedupeKey: `${tag}-${index}`, itemId: c.itemId, locationId: c.locationId, movementType: 'SALE_OUT', qtyDelta: -1,
      transactionAt: new Date(startMs + index * 1000), sourceType: 'SALES', sourceReference: `ref-${index}`, createdById: c.userId,
    })),
  });
  return tag;
}

integration('returns only the caller\'s company, newest first, with the limit applied', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const tagA = await addMovements(a, 5, Date.UTC(2026, 0, 1));
  await addMovements(b, 3, Date.UTC(2026, 0, 2));

  const all = await listRecentMovementsForCompany(ctxFor(a.id));
  assert.equal(all.length, 5);
  assert.deepEqual(all.map((row) => row.id), [4, 3, 2, 1, 0].map((i) => `${tagA}-${i}`), 'newest first');
  assert.ok(all.every((row) => row.locationId === a.locationId), "another company's movements are never returned");
  assert.deepEqual((await listRecentMovementsForCompany(ctxFor(a.id), 2)).map((row) => row.id), [`${tagA}-4`, `${tagA}-3`]);
  assert.equal((await listRecentMovementsForCompany(ctxFor(b.id))).length, 3);
  assert.deepEqual(await listRecentMovementsForCompany(ctxFor(`mov-repo-${randomUUID()}`)), []);
});

integration('parity: the repository equals the hydrated snapshot for the same company', async () => {
  const c = await makeCompany();
  await addMovements(c, 4, Date.UTC(2026, 5, 1));
  await hydrateRepositoryFromDatabase();
  const fromDb = await listRecentMovementsForCompany(ctxFor(c.id));
  const fromSnapshot = dailyMovements.filter((row) => row.locationId === c.locationId).sort((x, y) => y.transactionAt.localeCompare(x.transactionAt) || y.id.localeCompare(x.id));
  assert.equal(fromDb.length, 4);
  assert.deepEqual(fromDb, fromSnapshot);
});
