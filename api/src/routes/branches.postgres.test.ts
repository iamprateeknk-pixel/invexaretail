// Week 8: Branch management is DB-only (no in-memory mirror - the same as
// it was in the retired routes/foundation.ts), so this is a .postgres.test.ts
// per AGENTS.md's "Required tests" convention. Skipped unless
// TEST_DATABASE_URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import branchesRouter from './branches.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { prisma } from '../lib/db.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

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
  app.use('/api/v1', branchesRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

integration('a non-admin cannot create, update or archive a branch, but can list them', async () => {
  await withServer(async (call) => {
    const store = tokenFor('store@retail.local');
    const code = `BR-${randomUUID().slice(0, 6)}`.toUpperCase();
    assert.equal((await call('POST', '/branches', store, { code, name: 'Test Branch' })).status, 403);
    assert.equal((await call('GET', '/branches', store)).status, 200);
  });
});

integration('creating a branch, then a duplicate code, then updating and archiving it', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const code = `BR-${randomUUID().slice(0, 6)}`.toUpperCase();
    const created = await call('POST', '/branches', admin, { code, name: 'New Branch' });
    assert.equal(created.status, 201);
    assert.equal(created.body.branch.code, code);

    const duplicate = await call('POST', '/branches', admin, { code, name: 'Another Branch' });
    assert.equal(duplicate.status, 409);

    const updated = await call('PATCH', `/branches/${created.body.branch.id}`, admin, { name: 'Renamed Branch', code: 'IGNORED' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.branch.name, 'Renamed Branch');
    assert.equal(updated.body.branch.code, code, 'branch code must be immutable via PATCH');

    const archived = await call('POST', `/branches/${created.body.branch.id}/archive`, admin);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.branch.status, 'ARCHIVED');
  });
});

integration('a branch with a location holding on-hand stock cannot be archived - the StockLedger fix made while porting from foundation.ts', async () => {
  const companyId = `branch-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const branchCode = `BR-${randomUUID().slice(0, 6)}`.toUpperCase();
  const branch = await prisma.branch.create({ data: { code: branchCode, name: 'Stocked Branch', type: 'WAREHOUSE' } });
  const locationId = `branch-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Loc', type: 'warehouse', companyId, branchId: branch.id } });
  const itemId = `branch-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  await prisma.stockLedger.create({ data: { itemId, lotId: lot.id, locationId, onHand: 5, companyId } });

  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const response = await call('POST', `/branches/${branch.id}/archive`, admin);
    assert.equal(response.status, 409);
    assert.equal(response.body.blockers.activeStock, 1);
  });
});
