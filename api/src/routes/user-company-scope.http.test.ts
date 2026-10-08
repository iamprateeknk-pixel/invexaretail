// A user belongs to one company. PUT /users/:userId and DELETE /users/:userId used to find the user in the
// process-wide list by id alone, so an admin of company B could change the role or password of (or delete) a
// user of company A whose id they knew. The other company's user must now look exactly like a missing one:
// 404, never 403 (a 403 would confirm the account exists), and the user must be left untouched.
// Memory mode: the seed has a default-company admin and a separate company-jaipur admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, findUserById, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
const GOOD = 'Str0ng-Passw0rd';

type Call = (method: string, path: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Call, tokens: { ownerAdmin: string; otherAdmin: string }) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const owner = findUserByEmail('admin@retail.local')!;
  const other = findUserByEmail('admin@jaipur.local')!;
  assert.notEqual(owner.companyId, other.companyId, 'the seed must give the two admins different companies');
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
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
    await run(call, { ownerAdmin: generateJWT(owner.id, owner.companyId), otherAdmin: generateJWT(other.id, other.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createStaff(call: Call, token: string) {
  const email = `scope-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await call('POST', '/users', { name: 'Scope Test', email, password: GOOD, role: 'STORE_USER', assignedLocationIds: [] }, token);
  assert.equal(created.status, 201);
  return created.body.user.id as string;
}

test("another company's admin cannot change a user: 404, and the user is untouched", async () => {
  await withServer(async (call, { ownerAdmin, otherAdmin }) => {
    const victimId = await createStaff(call, ownerAdmin);
    const hashBefore = findUserById(victimId)!.passwordHash;

    const rename = await call('PUT', `/users/${victimId}`, { name: 'Hijacked', role: 'WAREHOUSE_PICKER', password: 'An0ther-Strong-Pass' }, otherAdmin);
    assert.equal(rename.status, 404, 'a user of another company looks like a missing one');
    const after = findUserById(victimId)!;
    assert.equal(after.name, 'Scope Test');
    assert.equal(after.role, 'STORE_USER');
    assert.equal(after.passwordHash, hashBefore, 'the password was not replaced');

    // The identical call from the owning company works: the 404 above was the company check, not a bug.
    const own = await call('PUT', `/users/${victimId}`, { name: 'Renamed By Owner' }, ownerAdmin);
    assert.equal(own.status, 200);
    assert.equal(findUserById(victimId)!.name, 'Renamed By Owner');
  });
});

test("another company's admin cannot delete a user: 404, and the owner still can", async () => {
  await withServer(async (call, { ownerAdmin, otherAdmin }) => {
    const victimId = await createStaff(call, ownerAdmin);
    const attempt = await call('DELETE', `/users/${victimId}`, undefined, otherAdmin);
    assert.equal(attempt.status, 404);
    assert.ok(findUserById(victimId), 'the user still exists');

    const own = await call('DELETE', `/users/${victimId}`, undefined, ownerAdmin);
    assert.equal(own.status, 200);
    assert.equal(findUserById(victimId), undefined);
  });
});
