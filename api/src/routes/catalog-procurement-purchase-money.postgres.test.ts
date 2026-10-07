// Decimal slice 7 on real Postgres: purchase-order and supplier-invoice money columns are NUMERIC in the
// database (totals/charges 2dp, unit costs 4dp, round-half-up) yet every API response - including nested
// lines, the included Item (mrp) and the status-change result - carries plain JSON numbers. Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import catalogProcurementRouter from './catalog-procurement.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
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
  const companyId = `catalog-price-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `catalog-item-supplier-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Catalog Item/Supplier Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Catalog Item/Supplier Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `catalog-item-supplier-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  const itemId = `catalog-item-supplier-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const supplier = await prisma.supplier.create({ data: { id: `catalog-item-supplier-supplier-${randomUUID()}`, name: 'Test Supplier', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, supplierId: supplier.id, token };
}



function assertNoDecimalStrings(value: unknown, path = 'response'): void {
  if (typeof value === 'string') {
    assert.equal(/^-?\d+\.\d+$/.test(value) && /(Cost|Amount|mrp|price)/i.test(path), false, `${path} looks like a Decimal string: ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((entry, index) => assertNoDecimalStrings(entry, `${path}[${index}]`));
  else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) assertNoDecimalStrings(entry, `${path}.${key}`);
}

integration('purchase money: rounded in the database, plain numbers in every response', async () => {
  const a = await makeFixture();
  await prisma.item.update({ where: { id: a.itemId }, data: { mrp: 50 } });
  await withServer(async (call) => {
    const created = await call('POST', '/purchase-orders', a.token, {
      supplierId: a.supplierId, locationId: a.locationId, freightCost: 100.555,
      lines: [{ itemId: a.itemId, quantity: 10, unitCost: 12.3456 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const po = created.body.purchaseOrder;
    assert.equal(po.totalAmount, 123.46, 'total rounded half-up to 2dp (10 x 12.3456 = 123.456)');
    assert.equal(po.freightCost, 100.56);
    assert.equal(po.lines[0].unitCost, 12.3456, 'unit cost keeps 4dp');
    assert.equal(po.lines[0].item.mrp, 50, 'the included item carries a number too');
    assertNoDecimalStrings(created.body);

    const stored = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
    assert.equal(Number(stored.totalAmount), 123.46);
    assert.equal(Number(stored.lines[0].unitCost), 12.3456);

    const list = await call('GET', '/purchase-orders', a.token);
    assertNoDecimalStrings(list.body);
    assert.equal(list.body.purchaseOrders.find((row: { id: string }) => row.id === po.id).totalAmount, 123.46);

    assert.equal((await call('PATCH', `/purchase-orders/${po.id}/status`, a.token, { status: 'SUBMITTED' })).status, 200);
    const approved = await call('PATCH', `/purchase-orders/${po.id}/status`, a.token, { status: 'APPROVED' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(typeof approved.body.purchaseOrder.totalAmount, 'number', 'the status-change result is a number too');
    assertNoDecimalStrings(approved.body);

    const invoice = await call('POST', `/purchase-orders/${po.id}/invoices`, a.token, {
      invoiceNumber: `INV-${Date.now()}`, lines: [{ itemId: a.itemId, invoicedQty: 5, unitCost: 12.3456 }],
    });
    assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
    assert.equal(invoice.body.invoice.totalAmount, 61.73, '5 x 12.3456 = 61.728 -> 61.73');
    assert.equal(invoice.body.invoice.lines[0].unitCost, 12.3456);
    assertNoDecimalStrings(invoice.body);
    const invoices = await call('GET', `/purchase-orders/${po.id}/invoices`, a.token);
    assertNoDecimalStrings(invoices.body);
    assert.equal(invoices.body.invoices[0].totalAmount, 61.73);
  });
});
