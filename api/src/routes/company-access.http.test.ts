import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import enterpriseAuthRouter from './enterprise-auth.js';
import coreRouter from './core.js';
import { controlRouter } from './control-plane.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { enforceApiUsage, enforcePlanLimits, enforceSuspendedCompany } from '../lib/saas/company-access.js';
import { controlPlane } from '../lib/saas/control-plane.js';
import { itemsForCompany } from '../lib/saas/tenant-scope.js';
import { listItems } from '../lib/repository.js';

const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
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
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope, enforceSuspendedCompany, enforcePlanLimits, enforceApiUsage);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
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

test('HTTP: suspending a company freezes tenant reads, writes and password login', async () => {
  const platform = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  try {
    await withServer(async (url) => {
      const login = await json(url, '/control/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
      });
      assert.equal(login.status, 200);
      const platformToken = login.body.token as string;

      const groceryToken = tokenFor('admin@retail.local');
      const before = await json(url, '/api/v1/locations', {
        headers: { Authorization: `Bearer ${groceryToken}` },
      });
      assert.equal(before.status, 200);

      const suspended = await json(url, '/control/v1/companies/default-company/suspend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${platformToken}` },
        body: JSON.stringify({ reason: 'http-test' }),
      });
      assert.equal(suspended.status, 200);
      assert.equal(suspended.body.company.status, 'suspended');

      const frozen = await json(url, '/api/v1/locations', {
        headers: { Authorization: `Bearer ${groceryToken}` },
      });
      assert.equal(frozen.status, 403);
      assert.equal(frozen.body.code, 'COMPANY_SUSPENDED');

      const tenantLogin = await json(url, '/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@retail.local', password: seedPassword }),
      });
      assert.equal(tenantLogin.status, 403);
      assert.equal(tenantLogin.body.code, 'COMPANY_SUSPENDED');

      const jaipur = tokenFor('admin@jaipur.local');
      const otherTenant = await json(url, '/api/v1/locations', {
        headers: { Authorization: `Bearer ${jaipur}` },
      });
      assert.equal(otherTenant.status, 200);

      const activated = await json(url, '/control/v1/companies/default-company/activate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${platformToken}` },
        body: JSON.stringify({ reason: 'http-test-restore' }),
      });
      assert.equal(activated.status, 200);
      assert.equal(activated.body.company.status, 'active');

      const restored = await json(url, '/api/v1/locations', {
        headers: { Authorization: `Bearer ${groceryToken}` },
      });
      assert.equal(restored.status, 200);

      const restoredLogin = await json(url, '/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@retail.local', password: seedPassword }),
      });
      assert.equal(restoredLogin.status, 200);
      assert.equal(restoredLogin.body.success, true);
    });
  } finally {
    controlPlane.setCompanyStatus(platform, 'default-company', 'active', 'http-test-restore');
  }
});

test('HTTP: plan limits block new grocery items at the current catalog size', async () => {
  const previous = controlPlane.limitOverrides.get('default-company');
  const current = itemsForCompany('default-company', listItems()).length;
  controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), max_items: current });
  try {
    await withServer(async (url) => {
      const grocery = tokenFor('admin@retail.local');
      const created = await json(url, '/api/v1/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${grocery}` },
        body: JSON.stringify({ code: `SKU-LIMIT-${Date.now()}`, name: 'Limit snack', unit: 'pack' }),
      });
      assert.equal(created.status, 403);
      assert.equal(created.body.code, 'PLAN_LIMIT_REACHED');

      const listed = await json(url, '/api/v1/items', {
        headers: { Authorization: `Bearer ${grocery}` },
      });
      assert.equal(listed.status, 200);
      assert.equal(Array.isArray(listed.body.items), true);
    });
  } finally {
    if (previous) controlPlane.limitOverrides.set('default-company', previous);
    else controlPlane.limitOverrides.delete('default-company');
  }
});

test('HTTP: daily API usage cap returns 429 USAGE_LIMIT_REACHED', async () => {
  const previous = controlPlane.limitOverrides.get('default-company');
  const previousUsage = controlPlane.usage.get('default-company');
  controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), api_requests_per_day: 0 });
  try {
    await withServer(async (url) => {
      const grocery = tokenFor('admin@retail.local');
      const listed = await json(url, '/api/v1/locations', {
        headers: { Authorization: `Bearer ${grocery}` },
      });
      assert.equal(listed.status, 429);
      assert.equal(listed.body.code, 'USAGE_LIMIT_REACHED');

      const tenantLogin = await json(url, '/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@retail.local', password: seedPassword }),
      });
      assert.equal(tenantLogin.status, 200);
      assert.equal(tenantLogin.body.success, true);
    });
  } finally {
    if (previous) controlPlane.limitOverrides.set('default-company', previous);
    else controlPlane.limitOverrides.delete('default-company');
    if (previousUsage) controlPlane.usage.set('default-company', previousUsage);
    else controlPlane.usage.delete('default-company');
  }
});
