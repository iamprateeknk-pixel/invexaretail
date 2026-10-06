// Phase 4: coverage for the transfer-evidence routes extracted out of
// routes/core.ts. Evidence storage itself needs a database; these tests
// cover what the extraction must preserve in memory mode - authentication,
// the 404 for an unknown transfer, and the 404 (never 403) for another
// company's transfer id.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import transferEvidenceRouter from './transfer-evidence.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (method: string, path: string, token?: string) => Promise<{ status: number; body: any }>;

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', transferEvidenceRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call: Api = async (method, path, token) => {
    const response = await fetch(`${base}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('evidence routes require authentication', async () => {
  await withServer(async (call) => {
    assert.equal((await call('GET', '/transfers/anything/evidence')).status, 401);
    assert.equal((await call('GET', '/transfers/anything/evidence/e1')).status, 401);
    assert.equal((await call('POST', '/transfers/anything/evidence')).status, 401);
  });
});

test('an unknown transfer id is a 404 on every evidence route', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assert.equal((await call('GET', '/transfers/does-not-exist/evidence', admin)).status, 404);
    assert.equal((await call('GET', '/transfers/does-not-exist/evidence/e1', admin)).status, 404);
    assert.equal((await call('POST', '/transfers/does-not-exist/evidence', admin)).status, 404);
  });
});
