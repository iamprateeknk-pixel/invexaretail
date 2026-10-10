// Database-first slice 1 (docs/db-first-reads-plan.md): the location repository reads Postgres directly.
// Proves (a) it returns only the caller's company, (b) it needs no hydration to see a location created after
// boot, and (c) parity: what it returns equals what the hydrated snapshot holds for the same company.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { locations as snapshot } from '../repository.js';
import { LocationOrderError, listLocationsForCompany, saveLocationOrder } from './location-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany(): Promise<string> {
  const id = `loc-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  return id;
}

const makeLocation = (companyId: string, name: string, type = 'store') =>
  prisma.location.create({ data: { code: `C-${randomUUID().slice(0, 8)}`, name, type, companyId } });

integration('returns only the caller\'s company, oldest first, and sees a location created after boot without hydration', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const first = await makeLocation(a, 'A first', 'warehouse');
  const second = await makeLocation(a, 'A second');
  const foreign = await makeLocation(b, 'B only');

  const mine = await listLocationsForCompany(ctxFor(a));
  assert.deepEqual(mine.map((row) => row.id), [first.id, second.id], 'own locations, oldest first');
  assert.equal(mine[0].type, 'warehouse');
  assert.ok(!mine.some((row) => row.id === foreign.id), "another company's location is never returned");
  assert.deepEqual((await listLocationsForCompany(ctxFor(b))).map((row) => row.id), [foreign.id]);
  assert.deepEqual(await listLocationsForCompany(ctxFor(`loc-repo-${randomUUID()}`)), [], 'an unknown company has none');
});

integration('parity: the repository equals the hydrated snapshot for the same company', async () => {
  const company = await makeCompany();
  await makeLocation(company, 'Parity store');
  await makeLocation(company, 'Parity warehouse', 'warehouse');

  await hydrateRepositoryFromDatabase();
  const fromDb = await listLocationsForCompany(ctxFor(company));
  const fromSnapshot = snapshot.filter((row) => fromDb.some((d) => d.id === row.id));
  assert.equal(fromDb.length, 2);
  assert.deepEqual([...fromSnapshot].sort((x, y) => x.id.localeCompare(y.id)), [...fromDb].sort((x, y) => x.id.localeCompare(y.id)));
});

integration('an admin-chosen order is saved per company and read back in that order', async () => {
  const company = await makeCompany();
  const store = await makeLocation(company, 'Store');
  const warehouse = await makeLocation(company, 'Warehouse', 'warehouse');
  const branch = await makeLocation(company, 'Branch');

  const saved = await saveLocationOrder(ctxFor(company), [warehouse.id, branch.id, store.id]);
  assert.deepEqual(saved.map((row) => row.id), [warehouse.id, branch.id, store.id]);
  assert.deepEqual((await listLocationsForCompany(ctxFor(company))).map((row) => row.id), [warehouse.id, branch.id, store.id]);
  const rows = await prisma.location.findMany({ where: { companyId: company }, select: { id: true, sortOrder: true } });
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.sortOrder])), { [warehouse.id]: 1, [branch.id]: 2, [store.id]: 3 });

  // saving again is safe and the new order wins
  await saveLocationOrder(ctxFor(company), [store.id, warehouse.id, branch.id]);
  assert.deepEqual((await listLocationsForCompany(ctxFor(company))).map((row) => row.id), [store.id, warehouse.id, branch.id]);
});

integration("another company's location id is refused like an unknown one and its order never changes", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const a1 = await makeLocation(a, 'A one');
  const a2 = await makeLocation(a, 'A two');
  const b1 = await makeLocation(b, 'B one');
  const b2 = await makeLocation(b, 'B two');

  // B tries to reorder using A's real ids (alone, and mixed with its own): both fail closed
  await assert.rejects(saveLocationOrder(ctxFor(b), [a2.id, a1.id]), LocationOrderError);
  await assert.rejects(saveLocationOrder(ctxFor(b), [b2.id, a1.id]), LocationOrderError);
  await assert.rejects(saveLocationOrder(ctxFor(b), [b2.id, `loc-${randomUUID()}`]), LocationOrderError, 'an unknown id fails the same way');
  const untouched = await prisma.location.findMany({ where: { id: { in: [a1.id, a2.id] } }, select: { sortOrder: true } });
  assert.ok(untouched.every((row) => row.sortOrder === 0), "A's rows were never written");

  // the identical call shape succeeds for the owner, proving the refusal was the tenant check
  await saveLocationOrder(ctxFor(a), [a2.id, a1.id]);
  assert.deepEqual((await listLocationsForCompany(ctxFor(a))).map((row) => row.id), [a2.id, a1.id]);
  assert.deepEqual((await listLocationsForCompany(ctxFor(b))).map((row) => row.id), [b1.id, b2.id], "B's order is unaffected");
});
