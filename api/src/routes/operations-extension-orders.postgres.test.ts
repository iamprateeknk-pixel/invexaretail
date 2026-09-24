// Bare-id call-site migration, slice 1 (see docs/week23-order-bare-id-
// remediation.md): HTTP-level cross-tenant coverage for the Order routes
// in routes/operations-extension.ts that were fixed to filter by companyId
// instead of looking a row up by bare id alone. DB-only (Order.companyId
// is a real Postgres column, invisible in memory mode) - skipped unless
// TEST_DATABASE_URL is set. This harness (withServer/makeFixture) is meant
// to be reused, not rewritten, by the next slice of this same
// remediation - see AGENTS.md "Required tests".
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import operationsExtensionRouter from './operations-extension.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  // operationsExtensionRouter applies its own extractToken/requireAuth/
  // enforcePermissionOverrides internally - no external auth middleware
  // needed here, matching how the router is actually mounted in index.ts.
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
  const companyId = `ops-orders-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-orders-user-${randomUUID()}`;
  // Order.createdById is a real FK to User - a Postgres row is required
  // even though auth itself (requireAuth) checks the separate in-memory
  // enhanced-user store below, not this table.
  await prisma.user.create({
    data: { id: userId, name: 'Ops Orders Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Orders Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-orders-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, token };
}

async function makeOrder(companyId: string, locationId: string, createdById: string) {
  return prisma.order.create({
    data: { channel: 'web', fulfillmentLocationId: locationId, createdById, companyId, status: 'RESERVED' },
  });
}

integration('GET /orders/:id/pack: another company\'s order id resolves 404, not 403, and never leaks its existence', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);

  await withServer(async (call) => {
    const cross = await call('GET', `/orders/${orderA.id}/pack`, b.token);
    assert.equal(cross.status, 404, 'a real order belonging to another company must look identical to a missing one');

    const own = await call('GET', `/orders/${orderA.id}/pack`, a.token);
    assert.equal(own.status, 200, 'the owning company must still be able to read its own order');
    assert.equal(own.body.session, null);
  });
});

integration('GET /orders/:id/shipment: cross-tenant lookup is scoped by companyId, not by location', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);

  await withServer(async (call) => {
    const cross = await call('GET', `/orders/${orderA.id}/shipment`, b.token);
    assert.equal(cross.status, 404);

    const own = await call('GET', `/orders/${orderA.id}/shipment`, a.token);
    assert.equal(own.status, 200);
  });
});

integration('GET /orders/:id/returns: cross-tenant lookup is scoped by companyId', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);

  await withServer(async (call) => {
    const cross = await call('GET', `/orders/${orderA.id}/returns`, b.token);
    assert.equal(cross.status, 404);

    const own = await call('GET', `/orders/${orderA.id}/returns`, a.token);
    assert.equal(own.status, 200);
  });
});

integration('GET /orders: the list endpoint only ever returns the caller\'s own company\'s orders', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
  const orderB = await makeOrder(b.companyId, b.locationId, b.userId);

  await withServer(async (call) => {
    const listA = await call('GET', '/orders', a.token);
    assert.equal(listA.status, 200);
    const idsA = listA.body.orders.map((o: { id: string }) => o.id);
    assert.ok(idsA.includes(orderA.id), 'company A must see its own order');
    assert.ok(!idsA.includes(orderB.id), 'company A must not see company B\'s order');
  });
});

integration('POST /shipments/:awb/cancel: a shipment belonging to another company is not found', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
  const awbNumber = `AWB-${randomUUID().slice(0, 8)}`;
  await prisma.shipment.create({
    data: {
      orderId: orderA.id, awbNumber, carrierProvider: 'MANUAL', serviceCode: 'STD', status: 'BOOKED',
      createdById: a.userId, companyId: a.companyId,
    },
  });

  await withServer(async (call) => {
    const cross = await call('POST', `/shipments/${awbNumber}/cancel`, b.token);
    assert.equal(cross.status, 404, 'a shipment belonging to another company must not be cancellable, or even discoverable');
  });
});
