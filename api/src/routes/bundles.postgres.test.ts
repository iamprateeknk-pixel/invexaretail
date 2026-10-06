// Virtual bundles/kits: HTTP-level coverage for routes/bundles.ts against real
// Postgres - cross-tenant isolation, definition rules, and availability math.
// DB-only - skipped unless TEST_DATABASE_URL is set. Reuses the
// withServer/makeFixture pattern from catalog-procurement-reorder-rules.postgres.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import bundlesRouter from './bundles.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', bundlesRouter);
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
  const companyId = `bundle-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `bundle-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Bundle Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Bundle Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `bundle-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  const mkItem = async (name: string) => {
    const id = `bundle-item-${randomUUID()}`;
    await prisma.item.create({ data: { id, code: id, name, unit: 'ea', companyId } });
    return id;
  };
  const kitId = await mkItem('Kit');
  const riceId = await mkItem('Rice');
  const dalId = await mkItem('Dal');
  const token = generateJWT(userId, companyId);
  return { companyId, locationId, kitId, riceId, dalId, token };
}

async function stock(f: { companyId: string; locationId: string }, itemId: string, onHand: number, reserved = 0) {
  await prisma.stockLedger.create({ data: { itemId, locationId: f.locationId, onHand, reserved, companyId: f.companyId } as never });
}

integration('PUT then GET: availability is limited by the scarcest component, net of reservations', async () => {
  const a = await makeFixture();
  await stock(a, a.riceId, 10);
  await stock(a, a.dalId, 9, 3);
  await withServer(async (call) => {
    const put = await call('PUT', `/items/${a.kitId}/bundle`, a.token, { components: [{ itemId: a.riceId, quantity: 2 }, { itemId: a.dalId, quantity: 3 }] });
    assert.equal(put.status, 200);
    const get = await call('GET', `/items/${a.kitId}/bundle`, a.token);
    assert.equal(get.status, 200);
    assert.equal(get.body.isBundle, true);
    assert.equal(get.body.buildable, 2, 'rice 10/2=5, dal (9-3)/3=2');
    assert.equal(get.body.limitingItemId, a.dalId);
  });
});

integration('definition rules: self-reference, nesting and foreign components are rejected', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    const self = await call('PUT', `/items/${a.kitId}/bundle`, a.token, { components: [{ itemId: a.kitId, quantity: 1 }] });
    assert.equal(self.status, 400);

    await call('PUT', `/items/${a.kitId}/bundle`, a.token, { components: [{ itemId: a.riceId, quantity: 1 }] });
    const nestedAsComponent = await call('PUT', `/items/${a.dalId}/bundle`, a.token, { components: [{ itemId: a.kitId, quantity: 1 }] });
    assert.equal(nestedAsComponent.status, 400, 'a bundle cannot be a component of another bundle');
    const componentBecomesBundle = await call('PUT', `/items/${a.riceId}/bundle`, a.token, { components: [{ itemId: a.dalId, quantity: 1 }] });
    assert.equal(componentBecomesBundle.status, 409, 'an existing component cannot become a bundle');

    const foreign = await call('PUT', `/items/${a.kitId}/bundle`, a.token, { components: [{ itemId: b.riceId, quantity: 1 }] });
    assert.equal(foreign.status, 404, 'another company item is indistinguishable from a missing one');
  });
});

integration('cross-tenant: another company cannot read, write or delete a bundle (404, never 403)', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    await call('PUT', `/items/${a.kitId}/bundle`, a.token, { components: [{ itemId: a.riceId, quantity: 1 }] });
    assert.equal((await call('GET', `/items/${a.kitId}/bundle`, b.token)).status, 404);
    assert.equal((await call('PUT', `/items/${a.kitId}/bundle`, b.token, { components: [{ itemId: b.riceId, quantity: 1 }] })).status, 404);
    assert.equal((await call('DELETE', `/items/${a.kitId}/bundle`, b.token)).status, 404);
    const own = await call('GET', `/items/${a.kitId}/bundle`, a.token);
    assert.equal(own.status, 200);
    assert.equal(own.body.components.length, 1, 'the cross-tenant attempts left the owner bundle untouched');
  });
});

integration('DELETE removes the bundle definition', async () => {
  const a = await makeFixture();
  await withServer(async (call) => {
    await call('PUT', `/items/${a.kitId}/bundle`, a.token, { components: [{ itemId: a.riceId, quantity: 1 }] });
    assert.equal((await call('DELETE', `/items/${a.kitId}/bundle`, a.token)).status, 200);
    assert.equal((await call('GET', `/items/${a.kitId}/bundle`, a.token)).body.isBundle, false);
  });
});
