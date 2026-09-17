import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';
import { controlRouter, studioRouter } from './control-plane.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { controlPlane } from '../lib/saas/control-plane.js';

const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

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
  app.use('/api/v1', extractToken, requireAuth, enforceOperationalCompanyScope);
  app.use('/api/v1', coreRouter);
  app.use('/control/v1', controlRouter);
  app.use('/studio/v1', studioRouter);
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

test('HTTP: runtime config is authenticated, company-scoped, and follows Studio publish', async () => {
  await withServer(async (url) => {
    const anonymous = await json(url, '/api/v1/runtime/config');
    assert.equal(anonymous.status, 401);

    const grocery = tokenFor('admin@retail.local');
    const storeUser = findUserByEmail('store@retail.local');
    const storeToken = storeUser ? generateJWT(storeUser.id, storeUser.companyId) : grocery;
    const before = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${grocery}` } });
    assert.equal(before.status, 200);
    assert.equal(before.body.runtime.companyId, 'default-company');
    assert.equal(before.body.runtime.page.actions.some((action: { key: string; enabled?: boolean }) => action.key === 'export' && action.enabled !== false), true);

    const login = await json(url, '/control/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
    });
    const groceryLock = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ companyId: 'default-company' }),
    });
    const studioAuth = { Authorization: `Bearer ${groceryLock.body.token}` };
    const previousVersion = before.body.runtime.version;

    const columnKey = `runtime_min_${Date.now().toString(36)}`;
    const column = await json(url, '/studio/v1/draft/stock/columns', {
      method: 'POST',
      headers: studioAuth,
      body: JSON.stringify({ name: 'Minimum Stock', key: columnKey, type: 'number' }),
    });
    assert.equal(column.status, 200);
    const disabled = await json(url, '/studio/v1/draft/actions/export', {
      method: 'POST',
      headers: studioAuth,
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disabled.status, 200);
    const published = await json(url, '/studio/v1/publish', { method: 'POST', headers: studioAuth });
    assert.equal(published.status, 200);

    try {
      const after = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${grocery}` } });
      assert.equal(after.status, 200);
      assert.equal(after.body.runtime.page.columns.some((entry: { key: string }) => entry.key === columnKey), true);
      assert.equal(after.body.runtime.page.actions.some((action: { key: string }) => action.key === 'export'), false);

      if (storeUser) {
        const storeRuntime = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${storeToken}` } });
        assert.equal(storeRuntime.status, 200);
        assert.equal(storeRuntime.body.runtime.page.columns.some((entry: { key: string }) => entry.key === columnKey), false);
      }

      const jaipur = tokenFor('admin@jaipur.local');
      const jaipurRuntime = await json(url, '/api/v1/runtime/config', { headers: { Authorization: `Bearer ${jaipur}` } });
      assert.equal(jaipurRuntime.status, 200);
      assert.equal(jaipurRuntime.body.runtime.companyId, 'company-jaipur');
      assert.equal(jaipurRuntime.body.runtime.page.columns.some((entry: { key: string }) => entry.key === columnKey), false);
    } finally {
      const restored = await json(url, '/studio/v1/rollback', {
        method: 'POST',
        headers: studioAuth,
        body: JSON.stringify({ version: previousVersion }),
      });
      assert.equal(restored.status, 200);
    }
  });
});
