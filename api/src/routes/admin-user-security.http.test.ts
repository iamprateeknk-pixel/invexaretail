// Plan Area D WP4: admin-set passwords follow the same policy as self-service ones,
// and a password change or a disable ends every session the person has.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import enterpriseManagementRouter from './enterprise-management.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Call = (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Call, adminToken: string) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const admin = findUserByEmail('admin@retail.local')!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1/admin', enterpriseManagementRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call: Call = async (method, path, body, token) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call, generateJWT(admin.id, admin.companyId));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const unique = () => Math.random().toString(36).slice(2, 8);
const GOOD = 'Str0ng-Passw0rd';

async function createUser(call: Call, adminToken: string, password = GOOD) {
  const email = `staff-${unique()}@example.com`;
  const created = await call('POST', '/users', { name: 'Staff Member', email, password, role: 'STORE_USER', assignedLocationIds: [] }, adminToken);
  return { email, created };
}

test('creating a user with a weak or publicly known password is rejected', async () => {
  await withServer(async (call, adminToken) => {
    for (const password of ['abc123', 'alllowercase1', 'NoDigitsHere', 'ChangeMe123!']) {
      const { created } = await createUser(call, adminToken, password);
      assert.equal(created.status, 400, password);
    }
    const { created } = await createUser(call, adminToken, GOOD);
    assert.equal(created.status, 201);
  });
});

test('an admin cannot set a weaker password than the policy allows on an existing user', async () => {
  await withServer(async (call, adminToken) => {
    const { created } = await createUser(call, adminToken);
    const id = created.body.user.id;
    assert.equal((await call('PUT', `/users/${id}`, { password: 'short1' }, adminToken)).status, 400);
    assert.equal((await call('PUT', `/users/${id}`, { password: 'ChangeMe123!' }, adminToken)).status, 400);
    assert.equal((await call('PUT', `/users/${id}`, { password: 'An0ther-Good-One' }, adminToken)).status, 200);
  });
});

test('after an admin resets a password, the person\'s existing refresh token stops working', async () => {
  await withServer(async (call, adminToken) => {
    const { email, created } = await createUser(call, adminToken);
    const login = await call('POST', '/auth/login', { email, password: GOOD });
    assert.equal(login.status, 200);
    const refreshToken: string = login.body.refreshToken;
    assert.ok(refreshToken, 'a native-style client receives the refresh token in the body');
    assert.equal((await call('POST', '/auth/refresh-token', { refreshToken })).status, 200, 'it works before the reset');

    // rotation gave a new token; use the latest to prove the whole family is revoked
    const latest = (await call('POST', '/auth/refresh-token', { refreshToken })).body.refreshToken ?? refreshToken;
    const reset = await call('PUT', `/users/${created.body.user.id}`, { password: 'Br@nd-New-Pass1' }, adminToken);
    assert.equal(reset.status, 200);
    const afterReset = await call('POST', '/auth/refresh-token', { refreshToken: latest });
    assert.equal(afterReset.status, 401, 'the old session ended with the password');
  });
});

test('disabling a user ends their sessions, and re-enabling does not bring them back', async () => {
  await withServer(async (call, adminToken) => {
    const { email, created } = await createUser(call, adminToken);
    const login = await call('POST', '/auth/login', { email, password: GOOD });
    const refreshToken: string = login.body.refreshToken;
    const disabled = await call('DELETE', `/admin/users/${created.body.user.id}`, undefined, adminToken);
    assert.equal(disabled.status, 200);
    assert.equal((await call('POST', '/auth/refresh-token', { refreshToken })).status, 401);
    const reenabled = await call('PUT', `/admin/users/${created.body.user.id}`, { status: 'active' }, adminToken);
    assert.equal(reenabled.status, 200);
    assert.equal((await call('POST', '/auth/refresh-token', { refreshToken })).status, 401, 'the old refresh token stays dead after re-enabling');
  });
});
