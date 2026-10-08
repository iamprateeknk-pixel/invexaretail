// GET /saas/tenants and POST /saas/onboard only required "an Admin", so the Admin of ANY company could list every
// tenant and provision new companies with their first Admin account. They are platform-operator actions: only the
// Admin of the platform's own (default) company may use them. Memory mode: the seed has a default-company admin
// and a separate company-jaipur admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import operationsExtensionRouter from './operations-extension.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

async function withServer(run: (call: (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>, tokens: { operator: string; tenantAdmin: string }) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const operator = findUserByEmail('admin@retail.local')!;
  const tenantAdmin = findUserByEmail('admin@jaipur.local')!;
  assert.notEqual(operator.companyId, tenantAdmin.companyId);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', operationsExtensionRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call, { operator: generateJWT(operator.id, operator.companyId), tenantAdmin: generateJWT(tenantAdmin.id, tenantAdmin.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("another company's admin cannot list tenants or provision a new one", async () => {
  await withServer(async (call, { tenantAdmin }) => {
    const list = await call('GET', '/saas/tenants', tenantAdmin);
    assert.equal(list.status, 403);
    assert.equal(list.body.tenants, undefined, 'no tenant data is returned');

    const email = `minted-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const onboard = await call('POST', '/saas/onboard', tenantAdmin, { companyName: 'Minted Co', adminName: 'Minted Admin', adminEmail: email, planCode: 'starter', password: 'Str0ng-Passw0rd' });
    assert.equal(onboard.status, 403);
    assert.equal(findUserByEmail(email), undefined, 'no account was created');
  });
});

test('the platform operator (Admin of the default company) can still list tenants', async () => {
  await withServer(async (call, { operator }) => {
    const list = await call('GET', '/saas/tenants', operator);
    assert.equal(list.status, 200, 'the 403 above was the operator check, not a broken route');
    assert.ok(Array.isArray(list.body.tenants));
  });
});
