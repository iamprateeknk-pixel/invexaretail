import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';
import operationsExtensionRouter from './operations-extension.js';
import { controlRouter } from './control-plane.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { enforcePlanEntitlements } from '../lib/saas/entitlements.js';
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
  app.use('/api/v1', extractToken, requireAuth, enforceOperationalCompanyScope, enforcePlanEntitlements);
  app.use('/api/v1', coreRouter);
  app.use('/api/v1', operationsExtensionRouter);
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

test('HTTP: starter Jaipur cannot read or create channel orders', async () => {
  await withServer(async (url) => {
    const jaipur = tokenFor('admin@jaipur.local');
    const grocery = tokenFor('admin@retail.local');

    const listed = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${jaipur}` } });
    assert.equal(listed.status, 403);
    assert.equal(listed.body.code, 'FEATURE_NOT_ENTITLED');
    assert.equal(listed.body.feature, 'OMS');

    const created = await json(url, '/api/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jaipur}` },
      body: JSON.stringify({ channel: 'webstore', fulfillmentLocationId: 'loc-jaipur-1', lines: [{ itemId: 'item-jaipur-1', quantity: 1 }] }),
    });
    assert.equal(created.status, 403);
    assert.equal(created.body.code, 'FEATURE_NOT_ENTITLED');

    const items = await json(url, '/api/v1/items', { headers: { Authorization: `Bearer ${jaipur}` } });
    assert.equal(items.status, 200);

    const groceryOrders = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${grocery}` } });
    assert.equal(groceryOrders.status, 200);
    assert.equal(Array.isArray(groceryOrders.body.orders), true);

    const intelligence = await json(url, '/api/v1/intelligence/loc-jaipur-1', { headers: { Authorization: `Bearer ${jaipur}` } });
    assert.equal(intelligence.status, 403);
    assert.equal(intelligence.body.feature, 'ANALYTICS');

    const profile = await json(url, '/api/v1/workspace/profile', { headers: { Authorization: `Bearer ${jaipur}` } });
    assert.equal(profile.status, 200);
    assert.equal((profile.body.pack?.hide ?? []).includes('orders'), true);
    assert.equal((profile.body.pack?.hide ?? []).includes('intelligence'), true);
  });
});

test('HTTP: assigning starter to grocery freezes OMS until Pro is restored', async () => {
  const platform = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  try {
    await withServer(async (url) => {
      const login = await json(url, '/control/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
      });
      assert.equal(login.status, 200);
      const grocery = tokenFor('admin@retail.local');

      const assigned = await json(url, '/control/v1/companies/default-company/plan', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${login.body.token}` },
        body: JSON.stringify({ planId: 'starter', reason: 'http-entitlement' }),
      });
      assert.equal(assigned.status, 200);
      assert.equal(assigned.body.company.planId, 'starter');
      assert.equal(assigned.body.company.entitlements.OMS, false);

      const frozen = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${grocery}` } });
      assert.equal(frozen.status, 403);
      assert.equal(frozen.body.code, 'FEATURE_NOT_ENTITLED');

      const restored = await json(url, '/control/v1/companies/default-company/plan', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${login.body.token}` },
        body: JSON.stringify({ planId: 'pro', reason: 'http-entitlement-restore' }),
      });
      assert.equal(restored.status, 200);
      assert.equal(restored.body.company.entitlements.OMS, true);

      const open = await json(url, '/api/v1/orders', { headers: { Authorization: `Bearer ${grocery}` } });
      assert.equal(open.status, 200);
    });
  } finally {
    controlPlane.assignPlan(platform, 'default-company', 'pro', 'http-entitlement-restore');
  }
});
