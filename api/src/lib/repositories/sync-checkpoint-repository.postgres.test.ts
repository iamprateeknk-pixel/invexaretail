// Database-first slice 4 (docs/db-first-reads-plan.md): sync checkpoints read from Postgres per company.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { syncCheckpoints } from '../repository.js';
import { listSyncCheckpointsForCompany } from './sync-checkpoint-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompanyWithLocation() {
  const id = `sync-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const location = await prisma.location.create({ data: { code: `L-${randomUUID().slice(0, 8)}`, name: id, type: 'store', companyId: id } });
  return { id, locationId: location.id };
}

const checkpoint = (locationId: string, sourceType: string, at: string) =>
  prisma.syncCheckpoint.create({ data: { locationId, sourceType, syncedThroughAt: new Date(at) } });

integration("returns only the caller's checkpoints, SALES and PURCHASE only", async () => {
  const a = await makeCompanyWithLocation();
  const b = await makeCompanyWithLocation();
  await checkpoint(a.locationId, 'SALES', '2026-10-01T00:00:00Z');
  await checkpoint(a.locationId, 'PURCHASE', '2026-10-02T00:00:00Z');
  await checkpoint(a.locationId, 'ADJUSTMENT', '2026-10-03T00:00:00Z');
  await checkpoint(b.locationId, 'SALES', '2026-10-04T00:00:00Z');

  const mine = await listSyncCheckpointsForCompany(ctxFor(a.id));
  assert.deepEqual(mine.map((row) => [row.locationId, row.sourceType, row.syncedThroughAt]), [
    [a.locationId, 'PURCHASE', '2026-10-02T00:00:00.000Z'],
    [a.locationId, 'SALES', '2026-10-01T00:00:00.000Z'],
  ]);
  assert.ok(!mine.some((row) => row.locationId === b.locationId));
});

integration('parity: the repository equals the hydrated snapshot for the same company', async () => {
  const c = await makeCompanyWithLocation();
  await checkpoint(c.locationId, 'SALES', '2026-09-01T00:00:00Z');
  await checkpoint(c.locationId, 'PURCHASE', '2026-09-02T00:00:00Z');
  await hydrateRepositoryFromDatabase();
  const fromDb = await listSyncCheckpointsForCompany(ctxFor(c.id));
  const key = (row: { sourceType: string }) => row.sourceType;
  const fromSnapshot = syncCheckpoints.filter((row) => row.locationId === c.locationId);
  assert.equal(fromDb.length, 2);
  assert.deepEqual([...fromDb].sort((x, y) => key(x).localeCompare(key(y))), [...fromSnapshot].sort((x, y) => key(x).localeCompare(key(y))));
});
