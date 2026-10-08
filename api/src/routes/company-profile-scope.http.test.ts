// The company profile (name, industry, contact, address) was ONE process-wide record: GET /company and
// GET /workspace/profile returned the platform company's profile to the Admin of every company, and PUT /company
// by any Admin overwrote it for everybody (the industry also decides which pages every company's menu hides).
// Each company now has its own profile. Memory mode: the seed has a default-company admin and a separate
// company-jaipur admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { findCompanyProfile } from '../lib/repository.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Call = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Call, tokens: { owner: string; other: string }) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const owner = findUserByEmail('admin@retail.local')!;
  const other = findUserByEmail('admin@jaipur.local')!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const call: Call = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call, { owner: generateJWT(owner.id, owner.companyId), other: generateJWT(other.id, other.companyId) });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("one company's admin cannot read or overwrite another company's profile", async () => {
  await withServer(async (call, { owner, other }) => {
    const before = (await call('GET', '/company', owner)).body.company;
    assert.ok(before.name, 'the default company has a profile');

    // The other company starts with a neutral profile of its own, not the default company's.
    const otherBefore = (await call('GET', '/company', other)).body.company;
    assert.notEqual(otherBefore.name, before.name, "the other company is not shown the default company's profile");
    const workspaceBefore = (await call('GET', '/workspace/profile', other)).body;
    assert.notEqual(workspaceBefore.name, before.name, "the other company's workspace is not named after the default company");

    const rename = await call('PUT', '/company', other, { name: 'Jaipur Mart Renamed', industry: 'Pharmacy', industryKey: 'pharmacy' });
    assert.equal(rename.status, 200, JSON.stringify(rename.body));
    assert.equal(rename.body.company.name, 'Jaipur Mart Renamed');

    // The default company is untouched ...
    const ownerAfter = (await call('GET', '/company', owner)).body.company;
    assert.equal(ownerAfter.name, before.name);
    assert.equal(ownerAfter.industryKey, before.industryKey);
    assert.equal((await call('GET', '/workspace/profile', owner)).body.name, before.name);
    // ... and the other company sees its own change.
    assert.equal((await call('GET', '/company', other)).body.company.name, 'Jaipur Mart Renamed');
    assert.equal((await call('GET', '/workspace/profile', other)).body.name, 'Jaipur Mart Renamed');
    assert.equal(findCompanyProfile('company-jaipur')?.name, 'Jaipur Mart Renamed');
  });
});

test("the default company's admin still edits the default company's profile", async () => {
  await withServer(async (call, { owner }) => {
    const current = (await call('GET', '/company', owner)).body.company;
    const edited = await call('PUT', '/company', owner, { name: current.name, address: 'Updated Street 1' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await call('GET', '/company', owner)).body.company.address, 'Updated Street 1');
  });
});
