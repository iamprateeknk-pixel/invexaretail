// ULTRA P1 (issue #184): the operational user list reads Postgres per company instead of the snapshot.
// Proves tenant isolation, parity with the hydrated snapshot for the same company, JSON
// assigned-locations parsing, and post-boot visibility. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { users as snapshotUsers } from '../repository.js';
import { listUsersForCompany } from './user-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration: typeof test = process.env.TEST_DATABASE_URL ? test : (test as unknown as { skip: typeof test }).skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany() {
  const id = `user-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const location = await prisma.location.create({ data: { code: `L-${randomUUID().slice(0, 8)}`, name: id, type: 'store', companyId: id } });
  return { id, locationId: location.id };
}

const addUser = (companyId: string, locationId: string, role: 'ADMIN' | 'STORE_USER' = 'STORE_USER') =>
  prisma.user.create({
    data: {
      id: `${companyId}-user-${randomUUID().slice(0, 8)}`,
      name: 'Listed User',
      email: `${randomUUID()}@test.invexa.local`,
      passwordHash: 'x',
      role,
      assignedLocations: JSON.stringify([locationId]),
      companyId,
    },
  });

integration("returns only the caller's users, oldest first, with assigned locations parsed", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const first = await addUser(a.id, a.locationId, 'ADMIN');
  const second = await addUser(a.id, a.locationId);
  const foreign = await addUser(b.id, b.locationId);

  const mine = await listUsersForCompany(ctxFor(a.id));
  assert.deepEqual(mine.map((row) => row.id), [first.id, second.id]);
  assert.deepEqual(mine[0].assignedLocationIds, [a.locationId]);
  assert.equal(mine[0].role, 'ADMIN');
  assert.ok(!mine.some((row) => row.id === foreign.id));
  assert.deepEqual((await listUsersForCompany(ctxFor(b.id))).map((row) => row.id), [foreign.id]);
});

integration('parity: equals the hydrated snapshot for the same company; a user created after boot is visible without hydration', async () => {
  const c = await makeCompany();
  const before = await addUser(c.id, c.locationId);
  await hydrateRepositoryFromDatabase();
  const fromDb = await listUsersForCompany(ctxFor(c.id));
  const fromSnapshot = snapshotUsers.filter((row) => row.id === before.id);
  assert.deepEqual(fromDb, fromSnapshot);

  const after = await addUser(c.id, c.locationId);
  assert.ok(!snapshotUsers.some((row) => row.id === after.id));
  assert.deepEqual((await listUsersForCompany(ctxFor(c.id))).map((row) => row.id), [before.id, after.id]);
});
