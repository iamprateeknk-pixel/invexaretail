// Returns hardening: HTTP-level coverage for the flow-correctness fixes in
// routes/opext-returns.ts - duplicate-line aggregation on create (P0-1),
// transactional create serialized per order (P0-2), the in-transaction
// disposition claim with a guarded quarantine decrement (P0-3), and
// per-line RECEIVE claims that make the HOLD leg idempotent (P1-1).
// DB-only - skipped unless TEST_DATABASE_URL is set. Reuses the
// withServer/makeFixture pattern from
// operations-extension-returns-exceptions.postgres.test.ts.
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
  const companyId = `ops-ret-hard-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-ret-hard-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Ops Returns Hardening Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Returns Hardening Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-ret-hard-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, token };
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function makeItem(companyId: string) {
  return prisma.item.create({ data: { code: `RTH-${randomUUID().slice(0, 8)}`, name: 'Returns hardening item', companyId } });
}

async function makeOrder(a: Fixture) {
  return prisma.order.create({
    data: { channel: 'web', fulfillmentLocationId: a.locationId, createdById: a.userId, companyId: a.companyId, status: 'RESERVED' },
  });
}

// A received return whose line sits in quarantine awaiting a disposition:
// the exact state the disposition endpoint (P0-3) operates on.
async function makeHeldLine(a: Fixture, quantity: number, quarantine: number) {
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
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `RMA-${ret.id}` } });
  await prisma.stockLedger.create({
    data: { companyId: a.companyId, itemId: item.id, lotId: lot.id, locationId: a.locationId, onHand: 0, quarantine, version: 1 },
  });
  return { item, ret, lineId: ret.lines[0].id };
}

integration('POST /orders/:id/returns: duplicate lines for one order line are aggregated before the over-return cap', async () => {
  const a = await makeFixture();
  const item = await makeItem(a.companyId);
  const order = await makeOrder(a);
  const orderLine = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, requestedQty: 5, fulfilledQty: 5 },
  });

  await withServer(async (call) => {
    // 3 + 3 = 6 against 5 fulfilled: checked entry-by-entry (the old
    // behaviour) each line passes and the return invents a unit.
    const over = await call('POST', `/orders/${order.id}/returns`, a.token, {
      lines: [
        { orderLineId: orderLine.id, quantity: 3 },
        { orderLineId: orderLine.id, quantity: 3 },
      ],
    });
    assert.equal(over.status, 400, JSON.stringify(over.body));
    assert.equal(await prisma.returnRequest.count({ where: { orderId: order.id } }), 0, 'an over-return must not be recorded');

    // 3 + 2 = 5 = the fulfilled quantity: accepted, stored as one merged line.
    const ok = await call('POST', `/orders/${order.id}/returns`, a.token, {
      lines: [
        { orderLineId: orderLine.id, quantity: 3 },
        { orderLineId: orderLine.id, quantity: 2 },
      ],
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.returnRequest.lines.length, 1, 'duplicate entries must merge into a single return line');
    assert.equal(Number(ok.body.returnRequest.lines[0].quantity), 5);
  });
});

integration('POST /orders/:id/returns: two concurrent creates cannot both pass the already-returned cap', async () => {
  const a = await makeFixture();
  const item = await makeItem(a.companyId);
  const order = await makeOrder(a);
  const orderLine = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, requestedQty: 5, fulfilledQty: 5 },
  });

  await withServer(async (call) => {
    const attempt = () => call('POST', `/orders/${order.id}/returns`, a.token, {
      lines: [{ orderLineId: orderLine.id, quantity: 4 }],
    });
    const [r1, r2] = await Promise.all([attempt(), attempt()]);
    const statuses = [r1.status, r2.status].sort((x, y) => x - y);
    assert.deepEqual(statuses, [201, 400], `exactly one create may succeed, got ${r1.status} and ${r2.status}`);
  });
  const lines = await prisma.returnLine.findMany({ where: { orderLine: { orderId: order.id } } });
  assert.equal(
    lines.reduce((sum, line) => sum + Number(line.quantity), 0),
    4,
    'the recorded returned quantity is one create worth, never both',
  );
});

integration('POST /returns/:id/lines/:lineId/disposition: concurrent dispositions move the quarantined stock exactly once', async () => {
  const a = await makeFixture();
  const { item, ret, lineId } = await makeHeldLine(a, 3, 3);

  await withServer(async (call) => {
    const attempt = () => call('POST', `/returns/${ret.id}/lines/${lineId}/disposition`, a.token, { disposition: 'RESTOCK' });
    const [r1, r2] = await Promise.all([attempt(), attempt()]);
    const statuses = [r1.status, r2.status].sort((x, y) => x - y);
    assert.deepEqual(statuses, [200, 409], `exactly one disposition may win, got ${r1.status} and ${r2.status}`);

    // A later sequential attempt is refused too (the line is no longer pending).
    const third = await call('POST', `/returns/${ret.id}/lines/${lineId}/disposition`, a.token, { disposition: 'SCRAP' });
    assert.equal(third.status, 409);
  });

  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: a.locationId } });
  assert.equal(Number(ledger.onHand), 3, 'the restock lands exactly once');
  assert.equal(Number(ledger.quarantine), 0, 'quarantine is decremented exactly once');
  assert.equal(Number(ledger.damaged), 0, 'the losing SCRAP disposition must not move stock');
  const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id, movementType: 'SALES_RETURN' } });
  assert.equal(movements.length, 1, 'exactly one SALES_RETURN journal row');
  const line = await prisma.returnLine.findUniqueOrThrow({ where: { id: lineId } });
  assert.equal(line.disposition, 'RESTOCK');
});

integration('POST /returns/:id/lines/:lineId/disposition: insufficient quarantine aborts without claiming the line', async () => {
  const a = await makeFixture();
  // The line says 3 units are held; the ledger only quarantines 1.
  const { item, ret, lineId } = await makeHeldLine(a, 3, 1);

  await withServer(async (call) => {
    const res = await call('POST', `/returns/${ret.id}/lines/${lineId}/disposition`, a.token, { disposition: 'RESTOCK' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
  });

  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: a.locationId } });
  assert.equal(Number(ledger.quarantine), 1, 'quarantine is untouched by the aborted disposition');
  assert.equal(Number(ledger.onHand), 0, 'the rolled-back restock posting must not land');
  const line = await prisma.returnLine.findUniqueOrThrow({ where: { id: lineId } });
  assert.equal(line.disposition, 'PENDING_INSPECTION', 'the claim rolls back with the transaction, leaving the line decidable');
  const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id } });
  assert.equal(movements.length, 0);
});

integration('PATCH /returns/:id/status RECEIVE (HOLD): a retry after a mid-flow crash does not re-increment quarantine or duplicate the case', async () => {
  const a = await makeFixture();
  const item = await makeItem(a.companyId);
  const order = await makeOrder(a);
  const orderLine = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, requestedQty: 2, fulfilledQty: 2 },
  });
  const ret = await prisma.returnRequest.create({
    data: {
      orderId: order.id, createdById: a.userId, companyId: a.companyId, status: 'APPROVED',
      lines: { create: [{ itemId: item.id, quantity: 2, orderLineId: orderLine.id }] },
    } as never,
    include: { lines: true },
  }) as unknown as { id: string; lines: Array<{ id: string }> };
  const lineId = ret.lines[0].id;

  await withServer(async (call) => {
    const first = await call('PATCH', `/returns/${ret.id}/status`, a.token, { action: 'RECEIVE' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // Model the crash window the per-line claim closes: the line's
    // receipt (claim + quarantine increment) committed, but the
    // request-level status transition did not, so a retry re-enters the
    // RECEIVE loop with the line already held.
    await prisma.returnRequest.update({ where: { id: ret.id }, data: { status: 'APPROVED' } });
    const retry = await call('PATCH', `/returns/${ret.id}/status`, a.token, { action: 'RECEIVE' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
  });

  const lot = await prisma.lot.findFirstOrThrow({ where: { itemId: item.id, lotNo: `RMA-${ret.id}` } });
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, lotId: lot.id, locationId: a.locationId } });
  assert.equal(Number(ledger.quarantine), 2, 'quarantine is incremented once, not once per attempt');

  // createExceptionCase is fire-and-forget; wait for the first case to
  // land, settle briefly, then require that no second case appeared.
  const countCases = () => prisma.exceptionCase.count({ where: { sourceDocument: ret.id, sourceLineId: lineId } });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (await countCases()) < 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await countCases(), 1, 'exactly one quarantine case is opened for the held line');
});
