// GET /imports/history returned the process-wide list of daily stock movements (up to 500) to any admin, so an
// admin of one company could read another company's imported sales and purchase movements. It must return only
// movements at locations the caller's own company owns. Memory mode: the seed has a default-company admin and a
// separate company-jaipur admin whose location is loc-jaipur-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { listLocations, recordDailyMovement } from '../lib/repository.js';
import { JAIPUR_LOCATION_ID, enforceOperationalCompanyScope, ownerOfLocation } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

async function withServer(run: (history: (token: string) => Promise<{ status: number; body: any }>, tokens: { owner: string; other: string }) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const owner = findUserByEmail('admin@retail.local')!;
  const other = findUserByEmail('admin@jaipur.local')!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const history = async (token: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/imports/history`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(history, { owner: generateJWT(owner.id, owner.companyId), other: generateJWT(other.id, other.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("an admin sees only their own company's import movements, never another company's", async () => {
  const ownerLocation = listLocations().find((location) => location.id !== JAIPUR_LOCATION_ID && ownerOfLocation(location.id) === 'default-company');
  assert.ok(ownerLocation, 'the seed has a default-company location');
  const tag = Math.random().toString(36).slice(2, 8);
  const base = { movementType: 'SALE_OUT', qtyDelta: -1, transactionAt: new Date().toISOString(), sourceType: 'SALES' as const, createdById: 'test' };
  recordDailyMovement({ ...base, id: `own-${tag}`, dedupeKey: `own-${tag}`, itemId: 'item-1', locationId: ownerLocation!.id, sourceReference: `own-${tag}` });
  recordDailyMovement({ ...base, id: `jpr-${tag}`, dedupeKey: `jpr-${tag}`, itemId: 'item-jaipur-1', locationId: JAIPUR_LOCATION_ID, sourceReference: `jpr-${tag}` });
  recordDailyMovement({ ...base, id: `ghost-${tag}`, dedupeKey: `ghost-${tag}`, itemId: 'item-1', locationId: `loc-nobody-${tag}`, sourceReference: `ghost-${tag}` });

  await withServer(async (history, { owner, other }) => {
    const ownerIds = (await history(owner)).body.movements.map((movement: { id: string }) => movement.id);
    assert.ok(ownerIds.includes(`own-${tag}`), 'the owning company sees its own movement');
    assert.ok(!ownerIds.includes(`jpr-${tag}`), "the other company's movement is not shown");
    assert.ok(!ownerIds.includes(`ghost-${tag}`), 'a movement at a location nobody owns is not shown to anyone');

    const otherIds = (await history(other)).body.movements.map((movement: { id: string }) => movement.id);
    assert.ok(otherIds.includes(`jpr-${tag}`), 'the other company sees its own movement');
    assert.ok(!otherIds.includes(`own-${tag}`), "the first company's movement is not shown");
    assert.ok(!otherIds.includes(`ghost-${tag}`));
  });
});
