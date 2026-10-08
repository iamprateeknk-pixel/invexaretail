// GET /pick-waves lists waves. A pick wave has no company column; it belongs to the company that owns its location.
// For an Admin with no locationId the scope was `{}` and the query had no company filter, so every company's waves
// came back. Only the caller's own company's waves may be listed. DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { enforceOperationalCompanyScope, registerLocationCompany } from '../lib/saas/tenant-scope.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function withServer(run: (list: (token: string) => Promise<{ status: number; body: any }>) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const list = async (token: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/pick-waves`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    await run(list);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeCompany() {
  const companyId = `waves-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `waves-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Waves Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Waves Admin', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  const locationId = `waves-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Wave Loc', type: 'warehouse', companyId } });
  registerLocationCompany(locationId, companyId);
  const wave = await prisma.pickWave.create({ data: { locationId, transferIds: [`t-${randomUUID()}`, `t-${randomUUID()}`], createdById: userId } });
  return { companyId, userId, locationId, waveId: wave.id, token: generateJWT(userId, companyId) };
}

integration("GET /pick-waves without a location returns only the caller's own company's waves", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  await withServer(async (list) => {
    const forA = await list(a.token);
    assert.equal(forA.status, 200);
    const idsForA = forA.body.waves.map((wave: { id: string }) => wave.id);
    assert.ok(idsForA.includes(a.waveId), 'the owning company sees its own wave');
    assert.ok(!idsForA.includes(b.waveId), "another company's wave is not listed");

    const idsForB = (await list(b.token)).body.waves.map((wave: { id: string }) => wave.id);
    assert.ok(idsForB.includes(b.waveId) && !idsForB.includes(a.waveId));
  });
});
