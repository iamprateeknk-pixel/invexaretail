// Bare-id call-site migration, slice 2 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the PurchaseOrder routes in
// routes/catalog-procurement.ts fixed to filter by companyId instead of
// looking a row up by bare id alone. DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts (Order routes, slice 1).
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { drainStudioAutomationRuns } from '../lib/saas/studio-automation-worker.js';
import catalogProcurementRouter from './catalog-procurement.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  // catalogProcurementRouter applies its own extractToken/requireAuth
  // internally - no external auth middleware needed.
  app.use('/api/v1', catalogProcurementRouter);
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
  const companyId = `catalog-po-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `catalog-po-user-${randomUUID()}`;
  // PurchaseOrder.createdById is a real FK to User.
  await prisma.user.create({
    data: { id: userId, name: 'Catalog PO Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Catalog PO Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `catalog-po-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  const supplier = await prisma.supplier.create({ data: { id: `catalog-po-supplier-${randomUUID()}`, name: 'Test Supplier', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, supplierId: supplier.id, token };
}

async function makePo(companyId: string, locationId: string, supplierId: string, createdById: string) {
  return prisma.purchaseOrder.create({
    data: { number: `PO-${randomUUID().slice(0, 8)}`, supplierId, locationId, createdById, companyId, status: 'DRAFT' },
  });
}

integration('GET /purchase-orders only ever returns the caller\'s own company\'s purchase orders', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);
  const poB = await makePo(b.companyId, b.locationId, b.supplierId, b.userId);

  await withServer(async (call) => {
    const listA = await call('GET', '/purchase-orders', a.token);
    assert.equal(listA.status, 200);
    const idsA = listA.body.purchaseOrders.map((po: { id: string }) => po.id);
    assert.ok(idsA.includes(poA.id), 'company A must see its own purchase order');
    assert.ok(!idsA.includes(poB.id), 'company A must not see company B\'s purchase order');
    const locationList = await call('GET', `/purchase-orders?locationId=${a.locationId}`, a.token);
    assert.equal(locationList.status, 200, JSON.stringify(locationList.body));
    assert.deepEqual(locationList.body.purchaseOrders.map((po: { id: string }) => po.id), [poA.id]);
    const foreignLocation = await call('GET', `/purchase-orders?locationId=${b.locationId}`, a.token);
    assert.equal(foreignLocation.status, 404, JSON.stringify(foreignLocation.body));
  });
});

integration('PATCH /purchase-orders/:id/status: another company\'s purchase order id resolves 404, not a status change', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);

  await withServer(async (call) => {
    const cross = await call('PATCH', `/purchase-orders/${poA.id}/status`, b.token, { status: 'CANCELLED' });
    assert.equal(cross.status, 404, 'a real purchase order belonging to another company must look identical to a missing one');

    const unchanged = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poA.id } });
    assert.equal(unchanged.status, 'DRAFT', 'the cross-tenant attempt must not have changed anything');

    const own = await call('PATCH', `/purchase-orders/${poA.id}/status`, a.token, { status: 'CANCELLED' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poA.id } })).status, 'CANCELLED');
  });
});

integration('GET /purchase-orders/:id/invoices: another company\'s purchase order id returns no invoices, not a leak through the join', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);
  await prisma.supplierInvoice.create({
    data: { purchaseOrderId: poA.id, invoiceNumber: `INV-${randomUUID().slice(0, 8)}`, createdById: a.userId },
  });

  await withServer(async (call) => {
    const cross = await call('GET', `/purchase-orders/${poA.id}/invoices`, b.token);
    assert.equal(cross.status, 200);
    assert.deepEqual(cross.body.invoices, [], 'another company must not see invoices for a purchase order it does not own');

    const own = await call('GET', `/purchase-orders/${poA.id}/invoices`, a.token);
    assert.equal(own.status, 200);
    assert.equal(own.body.invoices.length, 1);
  });
});

integration('POST /purchase-orders/:id/receive: another company\'s purchase order id resolves 404', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const poA = await makePo(a.companyId, a.locationId, a.supplierId, a.userId);

  await withServer(async (call) => {
    const cross = await call('POST', `/purchase-orders/${poA.id}/receive`, b.token, { requestId: randomUUID(), lines: [] });
    assert.equal(cross.status, 404);
  });
});

// Week 6 / guide Week 14: PO receipt posts its sellable quantity through the
// canonical posting service *inside the receipt transaction*. Before, the
// StockMovement journal row was written after commit and its failure was
// swallowed, so the journal could silently disagree with the ledger.
integration('POST /purchase-orders/:id/receive posts a journal row atomically with the ledger, once per requestId', async () => {
  const a = await makeFixture();
  const item = await prisma.item.create({ data: { code: `CANON-${randomUUID().slice(0, 8)}`, name: 'Canonical Rice', companyId: a.companyId } });
  const po = await prisma.purchaseOrder.create({
    data: { number: `PO-${randomUUID().slice(0, 8)}`, supplierId: a.supplierId, locationId: a.locationId, createdById: a.userId, companyId: a.companyId, status: 'APPROVED',
      lines: { create: [{ itemId: item.id, quantity: 20, unitCost: 5 }] } },
    include: { lines: true },
  });
  const requestId = randomUUID();
  await withServer(async (call) => {
    const body = { requestId, lines: [{ lineId: po.lines[0].id, receivedQty: 8, damagedQty: 2, excessQty: 0, lotNo: 'CANON-LOT' }] };
    const first = await call('POST', `/purchase-orders/${po.id}/receive`, a.token, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.duplicate, false);
    const retry = await call('POST', `/purchase-orders/${po.id}/receive`, a.token, body);
    assert.equal(retry.body.duplicate, true);
  });
  const ledger = await prisma.stockLedger.findMany({ where: { itemId: item.id, locationId: a.locationId } });
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0].onHand), 8, 'sellable quantity only');
  assert.equal(Number(ledger[0].quarantine), 2, 'damaged quantity is quarantined, not sellable');
  assert.equal(ledger[0].companyId, a.companyId);
  const movements = await prisma.stockMovement.findMany({ where: { itemId: item.id, locationId: a.locationId } });
  assert.equal(movements.length, 1, 'exactly one journal row despite the retried request');
  assert.equal(Number(movements[0].qtyDelta), 8);
  assert.equal(Number(movements[0].afterBalance), 8);
  assert.equal(movements[0].companyId, a.companyId);
  assert.equal(movements.reduce((sum, m) => sum + Number(m.qtyDelta), 0), Number(ledger[0].onHand), 'journal sum equals the projection');
});

integration('published Studio purchase-receipt automation runs once per committed receipt and stays in its company', async () => {
  const company = await makeFixture();
  const other = await makeFixture();
  const item = await prisma.item.create({ data: { code: randomUUID(), name: 'Receipt stock', companyId: company.companyId } });
  const order = await prisma.purchaseOrder.create({
    data: {
      number: `PO-${randomUUID().slice(0, 8)}`, supplierId: company.supplierId, locationId: company.locationId,
      createdById: company.userId, companyId: company.companyId, status: 'APPROVED',
      lines: { create: [{ itemId: item.id, quantity: 20, unitCost: 5 }] },
    },
    include: { lines: true },
  });
  const configuration = {
    companyId: company.companyId, version: 2, versionId: randomUUID(),
    payload: { automations: [{
      key: 'received', name: 'Receipt recorded', enforce: true, trigger: 'event',
      expression: 'purchase-order.received', actionKey: 'SEND_NOTIFICATION',
    }] },
  };
  await prisma.controlPlaneConfig.create({ data: { ...configuration, kind: 'draft', status: 'draft' } });
  const automationRuns = () => prisma.studioAutomationRun.findMany({ where: { companyId: company.companyId } });
  const path = `/purchase-orders/${order.id}/receive`;
  const makeBody = () => ({ requestId: randomUUID(), lines: [{ lineId: order.lines[0].id, receivedQty: 4, lotNo: 'RECEIPT-LOT' }] });
  await withServer(async (call) => {
    const first = await call('POST', path, company.token, makeBody());
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((await automationRuns()).length, 0, 'a draft cannot schedule a run');
    await prisma.controlPlaneConfig.create({ data: { ...configuration, kind: 'published', status: 'published' } });

    const rolledBack = makeBody();
    await prisma.lot.update({
      where: { itemId_lotNo: { itemId: item.id, lotNo: 'RECEIPT-LOT' } },
      data: { expiryDate: new Date('2028-01-01') },
    });
    const failure = await call('POST', path, company.token, { ...rolledBack,
      lines: rolledBack.lines.map((line) => ({ ...line, expiryDate: '2029-01-01' })) });
    assert.equal(failure.status, 400);
    assert.equal((await automationRuns()).length, 0, 'a rejected receipt cannot schedule a run');

    for (let index = 0; index < 2; index += 1) {
      const body = makeBody();
      const received = await call('POST', path, company.token, body);
      assert.equal(received.status, 200, JSON.stringify(received.body));
      assert.equal(received.body.duplicate, false);
      const retry = await call('POST', path, company.token, body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.duplicate, true);
      const foreign = await call('POST', path, other.token, body);
      assert.equal(foreign.status, 404, 'a known request ID cannot expose another company’s receipt');
      const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { requestId: body.requestId } });
      const runs = await automationRuns();
      assert.equal(runs.length, index + 1);
      assert.ok(runs.some((run) => run.occurrence === `purchase-order.received:${receipt.id}` && run.versionId === configuration.versionId));
    }
  });
  await drainStudioAutomationRuns(new Date());
  const allRuns = await automationRuns();
  assert.ok(allRuns.every((run) => run.status === 'DELIVERED'));
  assert.equal(await prisma.userNotification.count({ where: { userId: company.userId, title: 'Receipt recorded' } }), 2);
  assert.equal(await prisma.userNotification.count({ where: { userId: other.userId, title: 'Receipt recorded' } }), 0);
});

integration('a failing receipt leaves neither a journal row nor a ledger change (atomic)', async () => {
  const a = await makeFixture();
  const item = await prisma.item.create({ data: { code: `CANON-${randomUUID().slice(0, 8)}`, name: 'Atomic Rice', companyId: a.companyId } });
  const po = await prisma.purchaseOrder.create({
    data: { number: `PO-${randomUUID().slice(0, 8)}`, supplierId: a.supplierId, locationId: a.locationId, createdById: a.userId, companyId: a.companyId, status: 'APPROVED',
      lines: { create: [{ itemId: item.id, quantity: 10, unitCost: 5 }] } },
    include: { lines: true },
  });
  // Pre-existing lot with a different expiry makes the transaction throw *after* the line update.
  await prisma.lot.create({ data: { itemId: item.id, lotNo: 'CLASH', expiryDate: new Date('2027-01-01') } });
  await withServer(async (call) => {
    const res = await call('POST', `/purchase-orders/${po.id}/receive`, a.token, {
      requestId: randomUUID(), lines: [{ lineId: po.lines[0].id, receivedQty: 5, damagedQty: 0, excessQty: 0, lotNo: 'CLASH', expiryDate: '2028-02-02' }],
    });
    assert.equal(res.status, 400);
  });
  assert.equal(await prisma.stockMovement.count({ where: { itemId: item.id } }), 0);
  assert.equal(await prisma.stockLedger.count({ where: { itemId: item.id } }), 0);
  assert.equal(Number((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).receivedQty), 0);
});
