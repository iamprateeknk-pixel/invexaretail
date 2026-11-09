// [ULTRA] P3 (#186): the DB-backed half of the envelope coverage — one
// test per touched route proving the error envelope on bad input, for the
// routes memory mode cannot reach (respondWhenMemoryUnavailable gates
// them to 501 without a database). Skipped unless TEST_DATABASE_URL is
// set, like the other *.postgres.test.ts files.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import operationsExtensionRouter from './operations-extension.js';
import catalogProcurementRouter from './catalog-procurement.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withRouter(router: any, run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  // Both routers apply their own extractToken/requireAuth internally.
  app.use('/api/v1', router);
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
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
  const companyId = `p3-env-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `p3-env-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'P3 Envelope Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'P3 Envelope Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `p3-env-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const supplier = await prisma.supplier.create({ data: { id: `p3-env-supplier-${randomUUID()}`, name: 'Test Supplier', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, supplierId: supplier.id, token };
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/** The single ADR-006 envelope: error + code + traceId, never `message`. */
function assertEnvelope(response: { status: number; body: any }, status: number, code: string): void {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(typeof response.body.error, 'string', JSON.stringify(response.body));
  assert.ok(response.body.error.length > 0, JSON.stringify(response.body));
  assert.equal(response.body.code, code, JSON.stringify(response.body));
  assert.equal(typeof response.body.traceId, 'string', JSON.stringify(response.body));
  assert.ok(response.body.traceId.length > 0, JSON.stringify(response.body));
  assert.equal(response.body.message, undefined, JSON.stringify(response.body));
}

async function makeItem(companyId: string) {
  return prisma.item.create({ data: { code: `P3E-${randomUUID().slice(0, 8)}`, name: 'P3 envelope item', companyId } });
}

async function makeOrder(a: Fixture) {
  return prisma.order.create({
    data: { channel: 'web', fulfillmentLocationId: a.locationId, createdById: a.userId, companyId: a.companyId, status: 'RESERVED' },
  });
}

// A received return whose line sits in quarantine awaiting a disposition.
async function makeHeldLine(a: Fixture, quantity: number) {
  const item = await makeItem(a.companyId);
  const order = await makeOrder(a);
  const orderLine = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, requestedQty: quantity, fulfilledQty: quantity },
  });
  const ret = await prisma.returnRequest.create({
    data: {
      orderId: order.id, createdById: a.userId, companyId: a.companyId, status: 'RECEIVED',
      lines: { create: [{ itemId: item.id, quantity, orderLineId: orderLine.id, disposition: 'PENDING_INSPECTION' }] },
    } as never,
    include: { lines: true },
  }) as unknown as { id: string; lines: Array<{ id: string }> };
  return { item, order, orderLine, ret, lineId: ret.lines[0].id };
}

integration('returns: a bad create body returns the 400 envelope, and an over-cap return keeps its errors array', async () => {
  const a = await makeFixture();
  const item = await makeItem(a.companyId);
  const order = await makeOrder(a);
  const orderLine = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, requestedQty: 5, fulfilledQty: 5 },
  });
  await withRouter(operationsExtensionRouter, async (call) => {
    assertEnvelope(
      await call('POST', `/orders/${order.id}/returns`, a.token, { lines: [{ orderLineId: orderLine.id, quantity: 0 }] }),
      400, 'VALIDATION_FAILED',
    );
    const over = await call('POST', `/orders/${order.id}/returns`, a.token, { lines: [{ orderLineId: orderLine.id, quantity: 6 }] });
    assertEnvelope(over, 400, 'VALIDATION_FAILED');
    assert.ok(Array.isArray(over.body.errors), JSON.stringify(over.body));
    assertEnvelope(
      await call('GET', `/orders/nope/returns`, a.token),
      404, 'NOT_FOUND',
    );
  });
});

integration('returns: bad status action, bad disposition and bad refund decision use the envelope', async () => {
  const a = await makeFixture();
  const { ret, lineId } = await makeHeldLine(a, 2);
  await withRouter(operationsExtensionRouter, async (call) => {
    assertEnvelope(
      await call('PATCH', `/returns/${ret.id}/status`, a.token, { action: 'BOGUS' }),
      409, 'INVALID_TRANSITION',
    );
    assertEnvelope(
      await call('POST', `/returns/${ret.id}/lines/${lineId}/disposition`, a.token, { disposition: 123 }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PATCH', '/returns/nope/refund', a.token, { status: 'MAYBE' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/orders/nope/retry-backorder', a.token, {}),
      404, 'NOT_FOUND',
    );
  });
});

integration('orders: bad pack-scan body and missing-order pack/ship routes use the envelope', async () => {
  const a = await makeFixture();
  await withRouter(operationsExtensionRouter, async (call) => {
    assertEnvelope(
      await call('POST', '/orders/nope/pack/scan', a.token, { quantity: 1 }),
      400, 'VALIDATION_FAILED',
    );
    for (const [method, path] of [
      ['POST', '/orders/nope/fulfill'],
      ['POST', '/orders/nope/cancel'],
      ['POST', '/orders/nope/pack/start'],
      ['POST', '/orders/nope/pack/seal'],
      ['POST', '/orders/nope/ship'],
      ['POST', '/shipments/nope/cancel'],
    ] as const) {
      assertEnvelope(await call(method, path, a.token, {}), 404, 'NOT_FOUND');
    }
  });
});

integration('procurement: bad tag / custom-field / reorder-suggestion bodies use the 400 envelope', async () => {
  const a = await makeFixture();
  await withRouter(catalogProcurementRouter, async (call) => {
    assertEnvelope(
      await call('POST', '/catalog/tags', a.token, { name: 'x' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PUT', '/catalog/items/nope/tags', a.token, { tagIds: [] }),
      404, 'NOT_FOUND',
    );
    assertEnvelope(
      await call('POST', '/catalog/custom-fields', a.token, { name: 'x' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PUT', '/catalog/items/nope/custom-fields/nope', a.token, { value: 'v' }),
      404, 'NOT_FOUND',
    );
    assertEnvelope(
      await call('POST', '/reorder-rules/suggestions/nope/accept', a.token, {}),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('GET', '/reorder-rules', a.token),
      400, 'VALIDATION_FAILED',
    );
  });
});

integration('procurement: bad supplier / price-break bodies use the 400 envelope', async () => {
  const a = await makeFixture();
  await withRouter(catalogProcurementRouter, async (call) => {
    assertEnvelope(
      await call('POST', '/suppliers', a.token, { name: 'x' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PUT', '/suppliers/nope', a.token, { email: 'not-an-email' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PUT', '/suppliers/nope/price-breaks/nope', a.token, { breaks: [{ minQty: 0, unitCost: 10 }] }),
      400, 'VALIDATION_FAILED',
    );
  });
});

integration('procurement: bad purchase-order create/receive/status/draft/invoice bodies use the 400 envelope', async () => {
  const a = await makeFixture();
  await withRouter(catalogProcurementRouter, async (call) => {
    assertEnvelope(
      await call('POST', '/purchase-orders', a.token, { supplierId: a.supplierId, locationId: a.locationId, lines: [] }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/purchase-orders/nope/receive', a.token, { requestId: '' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('PATCH', '/purchase-orders/nope/status', a.token, { status: 'BOGUS' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/purchase-orders/plan/draft', a.token, { locationId: a.locationId, groups: [] }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/purchase-orders/nope/invoices', a.token, { invoiceNumber: 'INV-1', lines: [] }),
      400, 'VALIDATION_FAILED',
    );
  });
});

integration('procurement: bad price / saved-report / saved-view bodies and a missing price use the envelope', async () => {
  const a = await makeFixture();
  await withRouter(catalogProcurementRouter, async (call) => {
    assertEnvelope(
      await call('POST', '/items/nope/prices', a.token, { priceType: 'RETAIL', price: 0 }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('GET', '/items/nope/price', a.token),
      404, 'NOT_FOUND',
    );
    assertEnvelope(
      await call('POST', '/saved-reports', a.token, { name: 'Weekly', reportType: 'bogus' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('POST', '/saved-views', a.token, { name: 'x' }),
      400, 'VALIDATION_FAILED',
    );
    assertEnvelope(
      await call('GET', '/saved-views/nope/items', a.token),
      404, 'NOT_FOUND',
    );
  });
});
