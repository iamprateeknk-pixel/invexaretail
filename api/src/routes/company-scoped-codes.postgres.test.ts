// Audit P0-3: identity is per company. Two customers must be able to use the same
// SKU / location / branch code, and one company must never see or change another's
// branches. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import branchesRouter from './branches.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', branchesRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  const call: Api = async (method, path, token, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try { await run(call); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeCompany() {
  const companyId = `codes-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `codes-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  createEnhancedUser({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
  return { companyId, token: generateJWT(userId, companyId) };
}

integration('two companies can use the same SKU, location and branch code', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const code = `SHARED-${randomUUID().slice(0, 6)}`.toUpperCase();
  await prisma.item.create({ data: { code, name: 'A item', companyId: a.companyId } });
  await prisma.item.create({ data: { code, name: 'B item', companyId: b.companyId } });
  await prisma.location.create({ data: { code, name: 'A loc', type: 'store', companyId: a.companyId } });
  await prisma.location.create({ data: { code, name: 'B loc', type: 'store', companyId: b.companyId } });
  await withServer(async (call) => {
    assert.equal((await call('POST', '/branches', a.token, { code, name: 'A branch' })).status, 201);
    assert.equal((await call('POST', '/branches', b.token, { code, name: 'B branch' })).status, 201, 'same branch code in another company is allowed');
    assert.equal((await call('POST', '/branches', a.token, { code, name: 'A again' })).status, 409, 'but not twice within one company');
  });
  // Uniqueness still holds inside one company.
  await assert.rejects(prisma.item.create({ data: { code, name: 'A duplicate', companyId: a.companyId } }));
  await assert.rejects(prisma.location.create({ data: { code, name: 'A dup loc', type: 'store', companyId: a.companyId } }));
});

integration('branches are company scoped: listing, updating and archiving another company\'s branch is invisible (404)', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const code = `ISO-${randomUUID().slice(0, 6)}`.toUpperCase();
  await withServer(async (call) => {
    const created = await call('POST', '/branches', a.token, { code, name: 'A only' });
    assert.equal(created.status, 201);
    const id = created.body.branch.id;

    const listB = await call('GET', '/branches', b.token);
    assert.equal(listB.status, 200);
    assert.equal(listB.body.branches.some((row: { id: string }) => row.id === id), false, 'B must not see A\'s branch');
    const listA = await call('GET', '/branches', a.token);
    assert.equal(listA.body.branches.some((row: { id: string }) => row.id === id), true);

    assert.equal((await call('PATCH', `/branches/${id}`, b.token, { name: 'hijacked' })).status, 404);
    assert.equal((await call('POST', `/branches/${id}/archive`, b.token)).status, 404);
    const stillA = await prisma.branch.findUniqueOrThrow({ where: { id } });
    assert.equal(stillA.name, 'A only');
    assert.equal(stillA.status, 'ACTIVE');
    assert.equal(stillA.companyId, a.companyId, 'the branch is stamped with the creating company, not the schema default');
  });
});
