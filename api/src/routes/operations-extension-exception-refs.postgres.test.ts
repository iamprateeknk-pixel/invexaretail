// An exception case is stored under the caller's company but GET /exceptions joins the item, lot and owner it
// points at. POST /exceptions and PATCH /exceptions/:id used to accept any itemId/lotId/ownerId from the body, so
// an admin of company B could attach company A's item, lot or user to a case of their own and then read A's item
// code/name and user name/email back through it. Every reference must now resolve inside the caller's company;
// another company's id looks exactly like a missing one (404). DB-only - skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import operationsExtensionRouter from './operations-extension.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', operationsExtensionRouter);
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
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeFixture() {
  const companyId = `exc-refs-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `exc-refs-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Exception Refs Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Exception Refs Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `exc-refs-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `exc-refs-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Secret Item Name', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { id: `exc-refs-lot-${randomUUID()}`, lotNo: 'LOT-SECRET', itemId } });
  return { companyId, userId, locationId, itemId, lotId: lot.id, token: generateJWT(userId, companyId) };
}

const caseBody = (extra: Record<string, unknown>) => ({ type: 'DAMAGE', title: 'Cross reference probe', ...extra });

integration("POST /exceptions: another company's item, lot or owner id resolves 404 and no case is created; the owner's own ids work", async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    for (const [field, value] of [['itemId', a.itemId], ['lotId', a.lotId], ['ownerId', a.userId]] as const) {
      const cross = await call('POST', '/exceptions', b.token, caseBody({ [field]: value }));
      assert.equal(cross.status, 404, `${field} of another company must look like a missing one`);
    }
    assert.equal(await prisma.exceptionCase.count({ where: { companyId: b.companyId } }), 0, 'no case was created for company B');

    // The identical call with company B's own ids succeeds, so the 404s above were the company check.
    const own = await call('POST', '/exceptions', b.token, caseBody({ itemId: b.itemId, lotId: b.lotId, ownerId: b.userId, locationId: b.locationId }));
    assert.equal(own.status, 201, JSON.stringify(own.body));

    // And nothing of company A leaks through B's case list.
    const list = await call('GET', '/exceptions', b.token);
    assert.ok(!JSON.stringify(list.body).includes(a.itemId));
  });
});

integration("PATCH /exceptions/:id: reassigning the owner to another company's user resolves 404 and leaves the case untouched", async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const existing = await prisma.exceptionCase.create({ data: { type: 'DAMAGE', title: 'B case', reportedById: b.userId, companyId: b.companyId, ownerId: b.userId } });

  await withServer(async (call) => {
    const cross = await call('PATCH', `/exceptions/${existing.id}`, b.token, { ownerId: a.userId });
    assert.equal(cross.status, 404);
    assert.equal((await prisma.exceptionCase.findUniqueOrThrow({ where: { id: existing.id } })).ownerId, b.userId, 'the owner did not change');

    const own = await call('PATCH', `/exceptions/${existing.id}`, b.token, { ownerId: b.userId, priority: 'HIGH' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
  });
});
