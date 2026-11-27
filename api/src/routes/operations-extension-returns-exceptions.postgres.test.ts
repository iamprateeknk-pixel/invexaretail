// Bare-id call-site migration, slice 3 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the ReturnRequest and ExceptionCase
// routes in routes/operations-extension.ts fixed to filter by companyId
// instead of looking a row up by bare id alone. DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts (slice 1) and
// catalog-procurement-purchase-orders.postgres.test.ts (slice 2).
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
  const companyId = `ops-ret-exc-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-ret-exc-user-${randomUUID()}`;
  // Order.createdById / ReturnRequest.createdById / ExceptionCase.reportedById
  // are all real FKs to User.
  await prisma.user.create({
    data: { id: userId, name: 'Ops Return/Exception Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Return/Exception Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-ret-exc-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, token };
}

async function makeOrder(companyId: string, locationId: string, createdById: string) {
  return prisma.order.create({
    data: { channel: 'web', fulfillmentLocationId: locationId, createdById, companyId, status: 'RESERVED' },
  });
}

async function makeReturnRequest(companyId: string, orderId: string, createdById: string) {
  return prisma.returnRequest.create({
    data: { orderId, createdById, companyId, status: 'REQUESTED' },
  });
}

async function makeExceptionCase(companyId: string, reportedById: string) {
  return prisma.exceptionCase.create({
    data: { type: 'DAMAGE', title: 'Test damage case', reportedById, companyId },
  });
}

integration('PATCH /returns/:id/status: another company\'s return request id resolves 404, not a status change', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
  const returnA = await makeReturnRequest(a.companyId, orderA.id, a.userId);

  await withServer(async (call) => {
    const cross = await call('PATCH', `/returns/${returnA.id}/status`, b.token, { action: 'APPROVE' });
    assert.equal(cross.status, 404, 'a real return request belonging to another company must look identical to a missing one');

    const unchanged = await prisma.returnRequest.findUniqueOrThrow({ where: { id: returnA.id } });
    assert.equal(unchanged.status, 'REQUESTED', 'the cross-tenant attempt must not have changed anything');
  });
});

integration('PATCH /returns/:id/status: the owning company can still act on its own return request', async () => {
  const a = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
  const returnA = await makeReturnRequest(a.companyId, orderA.id, a.userId);

  await withServer(async (call) => {
    const own = await call('PATCH', `/returns/${returnA.id}/status`, a.token, { action: 'APPROVE' });
    assert.equal(own.status, 200);
    assert.equal(own.body.returnRequest.status, 'APPROVED');
  });
});

integration('PATCH /returns/:id/refund: another company\'s return request id resolves 404', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
  const returnA = await makeReturnRequest(a.companyId, orderA.id, a.userId);

  await withServer(async (call) => {
    const cross = await call('PATCH', `/returns/${returnA.id}/refund`, b.token, { status: 'REFUNDED' });
    assert.equal(cross.status, 404);
  });
});

integration('GET /exceptions: the list endpoint only ever returns the caller\'s own company\'s exception cases', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const caseA = await makeExceptionCase(a.companyId, a.userId);
  const caseB = await makeExceptionCase(b.companyId, b.userId);

  await withServer(async (call) => {
    const listA = await call('GET', '/exceptions', a.token);
    assert.equal(listA.status, 200);
    const idsA = listA.body.cases.map((c: { id: string }) => c.id);
    assert.ok(idsA.includes(caseA.id), 'company A must see its own exception case');
    assert.ok(!idsA.includes(caseB.id), 'company A must not see company B\'s exception case');
  });
});

// Decimal migration slice 2: valueAtRisk is NUMERIC(14,2); the API must still emit a JSON number
// (a raw Prisma Decimal would serialize as a string) rounded to 2dp, on every response that carries a case.
integration('exception cases expose valueAtRisk as a 2dp number on list, patch and resolve', async () => {
  const a = await makeFixture();
  const row = await prisma.exceptionCase.create({ data: { type: 'DAMAGE', title: 'Valued case', reportedById: a.userId, companyId: a.companyId, valueAtRisk: 123.456 } });

  await withServer(async (call) => {
    const list = await call('GET', '/exceptions', a.token);
    const listed = list.body.cases.find((c: { id: string }) => c.id === row.id);
    assert.equal(typeof listed.valueAtRisk, 'number');
    assert.equal(listed.valueAtRisk, 123.46);

    const patched = await call('PATCH', `/exceptions/${row.id}`, a.token, { status: 'IN_PROGRESS' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.case.valueAtRisk, 123.46);

    const resolved = await call('POST', `/exceptions/${row.id}/resolve`, a.token, { disposition: 'NONE' });
    assert.equal(resolved.status, 200);
    assert.equal(typeof resolved.body.case.valueAtRisk, 'number');
  });
});

integration('PATCH /exceptions/:id: another company\'s exception case id resolves 404, not a field change', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const caseA = await makeExceptionCase(a.companyId, a.userId);

  await withServer(async (call) => {
    const cross = await call('PATCH', `/exceptions/${caseA.id}`, b.token, { status: 'IN_PROGRESS' });
    assert.equal(cross.status, 404, 'a real exception case belonging to another company must look identical to a missing one');

    const unchanged = await prisma.exceptionCase.findUniqueOrThrow({ where: { id: caseA.id } });
    assert.equal(unchanged.status, 'OPEN', 'the cross-tenant attempt must not have changed anything');
  });
});

integration('POST /exceptions/:id/resolve: another company\'s exception case id resolves 404, not a resolution', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const caseA = await makeExceptionCase(a.companyId, a.userId);

  await withServer(async (call) => {
    const cross = await call('POST', `/exceptions/${caseA.id}/resolve`, b.token, { disposition: 'WRITE_OFF' });
    assert.equal(cross.status, 404);

    const unchanged = await prisma.exceptionCase.findUniqueOrThrow({ where: { id: caseA.id } });
    assert.equal(unchanged.status, 'OPEN', 'the cross-tenant attempt must not have changed anything');
  });
});

integration('POST /exceptions: a newly opened case is stamped with the caller\'s own companyId, not the schema default', async () => {
  const a = await makeFixture();

  await withServer(async (call) => {
    const created = await call('POST', '/exceptions', a.token, { type: 'DAMAGE', title: 'New damage case' });
    assert.equal(created.status, 201);
    assert.equal(created.body.case.companyId, a.companyId, 'createExceptionCase must stamp the caller\'s real companyId, not fall back to the schema default');
  });
});

// Week 6: receiving a return with a RESTOCK disposition posts SALES_RETURN through
// the canonical service in its own transaction; a repeated RECEIVE cannot restock again.
integration('PATCH /returns/:id/status RECEIVE+RESTOCK posts one canonical SALES_RETURN row matching the ledger', async () => {
  const a = await makeFixture();
  const item = await prisma.item.create({ data: { code: `RET-${randomUUID().slice(0, 8)}`, name: 'Returned item', companyId: a.companyId } });
  const order = await makeOrder(a.companyId, a.locationId, a.userId);
  const orderLine = await prisma.orderLine.create({ data: { orderId: order.id, itemId: item.id, requestedQty: 3 } });
  const ret = await prisma.returnRequest.create({
    data: { orderId: order.id, createdById: a.userId, companyId: a.companyId, status: 'APPROVED',
      lines: { create: [{ itemId: item.id, quantity: 3, orderLineId: orderLine.id }] } } as never,
    include: { lines: true },
  }) as unknown as { id: string; lines: Array<{ id: string }> };

  await withServer(async (call) => {
    const res = await call('PATCH', `/returns/${ret.id}/status`, a.token, { action: 'RECEIVE', dispositions: { [ret.lines[0].id]: 'RESTOCK' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const again = await call('PATCH', `/returns/${ret.id}/status`, a.token, { action: 'RECEIVE', dispositions: { [ret.lines[0].id]: 'RESTOCK' } });
    assert.equal(again.status, 409, 'a received return cannot be received (and restocked) twice');
  });
  const ledger = await prisma.stockLedger.findMany({ where: { itemId: item.id, locationId: a.locationId } });
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0].onHand), 3);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: item.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'SALES_RETURN');
  assert.equal(Number(rows[0].qtyDelta), 3);
  assert.equal(rows[0].companyId, a.companyId);
});
