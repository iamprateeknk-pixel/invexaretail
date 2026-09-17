import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';
import { controlRouter } from './control-plane.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { enforcePlanEntitlements } from '../lib/saas/entitlements.js';
import { apiKeyAllowsMethod } from '../lib/saas/control-plane.js';

const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

function seedJaipurAdmin(): void {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(seedPassword));
  if (!findUserByEmail('admin@jaipur.local')) {
    createEnhancedUser({
      id: 'user-jaipur-admin',
      companyId: 'company-jaipur',
      email: 'admin@jaipur.local',
      name: 'Jaipur Admin',
      role: 'ADMIN',
      branchIds: [],
      locationIds: ['loc-jaipur-1'],
      passwordHash: hashPassword(seedPassword),
      status: 'active',
    });
  }
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  seedJaipurAdmin();
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, requireAuth, enforceOperationalCompanyScope, enforcePlanEntitlements);
  app.use('/api/v1', coreRouter);
  app.use('/control/v1', controlRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function json(url: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

test('read scopes allow GET and write scopes are required to mutate', () => {
  assert.equal(apiKeyAllowsMethod(['inventory.read'], 'GET'), true);
  assert.equal(apiKeyAllowsMethod(['inventory.read'], 'POST'), false);
  assert.equal(apiKeyAllowsMethod(['inventory.write'], 'GET'), true);
  assert.equal(apiKeyAllowsMethod(['inventory.write'], 'POST'), true);
});

test('HTTP: Pro API keys authenticate /api/v1 and Starter cannot issue keys', async () => {
  await withServer(async (url) => {
    const login = await json(url, '/control/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
    });
    const groceryLock = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ companyId: 'default-company' }),
    });
    const groceryAuth = { Authorization: `Bearer ${groceryLock.body.token}` };

    const created = await json(url, '/control/v1/integrations/api-keys', {
      method: 'POST',
      headers: groceryAuth,
      body: JSON.stringify({ name: 'POS', scopes: ['inventory.read'] }),
    });
    assert.equal(created.status, 201);
    assert.match(created.body.token, /^invx_/);
    const token = created.body.token as string;

    const listed = await json(url, '/api/v1/items', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body.items), true);

    const writeDenied = await json(url, '/api/v1/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: `SKU-KEY-${Date.now()}`, name: 'Key snack', unit: 'pack' }),
    });
    assert.equal(writeDenied.status, 403);
    assert.equal(writeDenied.body.code, 'API_KEY_SCOPE');

    const invalid = await json(url, '/api/v1/items', { headers: { Authorization: 'Bearer invx_deadbeefdeadbeefdeadbeefdeadbeef' } });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.body.code, 'API_KEY_INVALID');

    const revoked = await json(url, `/control/v1/integrations/api-keys/${created.body.id}/revoke`, {
      method: 'POST',
      headers: groceryAuth,
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.apiKey.status, 'revoked');
    const afterRevoke = await json(url, '/api/v1/items', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(afterRevoke.status, 401);
    assert.equal(afterRevoke.body.code, 'API_KEY_REVOKED');

    const jaipurLock = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ companyId: 'company-jaipur' }),
    });
    const jaipurKey = await json(url, '/control/v1/integrations/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jaipurLock.body.token}` },
      body: JSON.stringify({ name: 'POS', scopes: ['inventory.read'] }),
    });
    assert.equal(jaipurKey.status, 403);
    assert.equal(jaipurKey.body.code, 'FEATURE_NOT_ENTITLED');
  });
});
