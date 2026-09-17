import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import enterpriseAuthRouter from './enterprise-auth.js';
import coreRouter from './core.js';
import { controlRouter } from './control-plane.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { controlPlane } from '../lib/saas/control-plane.js';

const seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(seedPassword));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
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

test('HTTP: Super Admin onboarding creates an isolated operational tenant', async () => {
  await withServer(async (url) => {
    const login = await json(url, '/control/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'superadmin@invexa.local', password: seedPassword }),
    });
    assert.equal(login.status, 200);
    const platformToken = login.body.token as string;

    const locked = await json(url, '/control/v1/sessions/select-company', {
      method: 'POST',
      headers: { Authorization: `Bearer ${platformToken}` },
      body: JSON.stringify({ companyId: 'default-company' }),
    });
    const forbidden = await json(url, '/control/v1/companies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${locked.body.token}` },
      body: JSON.stringify({ name: 'Should Fail', planId: 'starter', adminEmail: 'fail@x.local', adminName: 'Fail' }),
    });
    assert.equal(forbidden.status, 401);
    assert.equal(forbidden.body.code, 'SESSION_REQUIRED');

    const stamp = Date.now();
    const email = `admin@kota-${stamp}.local`;
    const created = await json(url, '/control/v1/companies', {
      method: 'POST',
      headers: { Authorization: `Bearer ${platformToken}` },
      body: JSON.stringify({
        name: 'Kota Fresh Mart',
        planId: 'starter',
        adminEmail: email,
        adminName: 'Kota Admin',
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.company.name, 'Kota Fresh Mart');
    assert.equal(created.body.company.status, 'active');
    assert.equal(created.body.admin.email, email);
    assert.match(String(created.body.admin.temporaryPassword), /^Invexa/);
    assert.equal(created.body.location.type, 'store');

    const tenantLogin = await json(url, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: created.body.admin.temporaryPassword }),
    });
    assert.equal(tenantLogin.status, 200);
    assert.equal(tenantLogin.body.user.companyId, created.body.company.id);
    const tenantToken = tenantLogin.body.token as string;

    const tenantLocations = await json(url, '/api/v1/locations', {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    assert.equal(tenantLocations.status, 200);
    assert.equal(tenantLocations.body.locations.length, 1);
    assert.equal(tenantLocations.body.locations[0].id, created.body.location.id);
    assert.equal(tenantLocations.body.locations.some((row: { id: string }) => row.id === 'loc-1'), false);

    const grocery = tokenFor('admin@retail.local');
    const groceryLocations = await json(url, '/api/v1/locations', {
      headers: { Authorization: `Bearer ${grocery}` },
    });
    assert.equal(groceryLocations.status, 200);
    assert.equal(groceryLocations.body.locations.some((row: { id: string }) => row.id === created.body.location.id), false);
  });
});
