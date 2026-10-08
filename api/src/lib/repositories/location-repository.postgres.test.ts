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
import { listLocationsForCompany } from './location-repository.js';
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
