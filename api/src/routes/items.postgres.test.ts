// Week 10: HTTP-level coverage for routes/items.ts (item search, stock
// detail, adjustment, reversal). DB-only (searchItems/getStockDetail/
// postInventoryMovement all require real Postgres) - see AGENTS.md
// "Required tests". Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { extractToken } from './enterprise-auth.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { registerLocationCompany, registerItemCompany } from '../lib/saas/tenant-scope.js';
import itemsRouter from './items.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', itemsRouter);
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

async function makeFixture() {
  const companyId = `items-route-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `items-route-user-${randomUUID()}`;
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Items Route Test User',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `items-route-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  registerLocationCompany(locationId, companyId);
  const itemId = `items-route-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Route Test Item', unit: 'ea', companyId } });
  registerItemCompany(itemId, companyId);
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, lotId: lot.id, token };
}

integration('GET /items/search paginates and is scoped to the caller\'s tenant', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  await withServer(async (call) => {
    const page = await call('GET', '/items/search?limit=50', fixtureA.token);
    assert.equal(page.status, 200);
    assert.ok(page.body.items.some((item: { id: string }) => item.id === fixtureA.itemId));
    assert.ok(!page.body.items.some((item: { id: string }) => item.id === fixtureB.itemId), 'tenant B\'s item must not appear in tenant A\'s search results');
  });
});

integration('POST /items/:itemId/adjust posts once for two identical requests with the same idempotency key', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    const key = randomUUID();
    const body = { locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 10, reason: 'stock take correction', idempotencyKey: key };
    const first = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, body);
    assert.equal(first.status, 201);
    assert.equal(first.body.duplicate, false);

    const second = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, body);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.movement.id, first.body.movement.id);

    const ledger = await prisma.stockLedger.findFirst({ where: { itemId: fixture.itemId, lotId: fixture.lotId, locationId: fixture.locationId } });
    assert.equal(Number(ledger?.onHand), 10, 'a retried adjustment must not double-post');
  });
});

integration('POST /items/:itemId/adjust requires an idempotencyKey and a reason', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    const missingKey = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 5, reason: 'test',
    });
    assert.equal(missingKey.status, 400);

    const missingReason = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 5, idempotencyKey: randomUUID(),
    });
    assert.equal(missingReason.status, 400);
  });
});

integration('a reversal posts an equal-and-opposite movement and retrying the reversal is itself idempotent', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    const posted = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 20, reason: 'seed', idempotencyKey: randomUUID(),
    });
    assert.equal(posted.status, 201);

    const reversed = await call('POST', `/items/${fixture.itemId}/movements/${posted.body.movement.id}/reverse`, fixture.token, { reason: 'undo' });
    assert.equal(reversed.status, 201);
    assert.equal(Number(reversed.body.movement.qtyDelta), -20);

    const again = await call('POST', `/items/${fixture.itemId}/movements/${posted.body.movement.id}/reverse`, fixture.token, { reason: 'undo again' });
    assert.equal(again.status, 409, 'reversing an already-reversed movement must fail, not silently double-reverse');

    const ledger = await prisma.stockLedger.findFirst({ where: { itemId: fixture.itemId, lotId: fixture.lotId, locationId: fixture.locationId } });
    assert.equal(Number(ledger?.onHand), 0);
  });
});

integration('tenant isolation: adjusting an item that belongs to a different tenant fails closed, not silently succeeds against the wrong company', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  await withServer(async (call) => {
    const response = await call('POST', `/items/${fixtureA.itemId}/adjust`, fixtureB.token, {
      locationId: fixtureA.locationId, lotId: fixtureA.lotId, qtyDelta: 5, reason: 'cross-tenant attempt', idempotencyKey: randomUUID(),
    });
    // Caught by enforceOperationalCompanyScope (a middleware layer ahead of
    // this route entirely) before assertItemOwnedByTenant/companyOwnsLocation
    // inside the handler even runs - two independent layers agree the
    // request must fail closed, which is the point: 403 here, not 404, is
    // the correct and stronger outcome.
    assert.equal(response.status, 403);

    const ledger = await prisma.stockLedger.findFirst({ where: { itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId } });
    assert.equal(ledger, null, 'tenant B must not be able to create a StockLedger row against tenant A\'s item');
  });
});

integration('GET /items/:itemId/stock-detail returns branch balances, lots and movement history from the canonical journal', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 15, reason: 'opening', idempotencyKey: randomUUID(),
    });
    const detail = await call('GET', `/items/${fixture.itemId}/stock-detail`, fixture.token);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.branches.length, 1);
    assert.equal(Number(detail.body.branches[0].onHand), 15);
    assert.equal(detail.body.lots.length, 1);
    assert.equal(detail.body.movements.length, 1);
    assert.equal(detail.body.reconciliation.length, 1);
    assert.equal(detail.body.reconciliation[0].explained, true, 'onHand must equal the journal sum right after posting');
  });
});

integration('GET /items/:itemId/stock-detail for a different tenant\'s item is rejected, not another tenant\'s data', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  await withServer(async (call) => {
    const response = await call('GET', `/items/${fixtureA.itemId}/stock-detail`, fixtureB.token);
    // Same enforceOperationalCompanyScope layer as the adjust test above.
    assert.equal(response.status, 403);
  });
});
