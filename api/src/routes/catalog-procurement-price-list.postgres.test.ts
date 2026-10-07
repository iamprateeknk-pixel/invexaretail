// PriceList slice on real Postgres: price is Decimal(14,2) in the database yet a JSON number on the wire,
// and price lists/resolution only ever see the caller's own company's rows (a foreign item id yields
// nothing, not another company's prices). Skipped unless TEST_DATABASE_URL is set.
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


integration('PriceList.price: 2dp Decimal in the database, JSON number on the wire, and company scoped', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    const created = await call('POST', `/items/${a.itemId}/prices`, a.token, { priceType: 'RETAIL', price: 12.345 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(typeof created.body.priceList.price, 'number', 'must not leak a Decimal string');
    assert.equal(created.body.priceList.price, 12.35, 'round-half-up to 2dp');
    assert.equal(Number((await prisma.priceList.findUniqueOrThrow({ where: { id: created.body.priceList.id } })).price), 12.35);

    const list = await call('GET', `/items/${a.itemId}/prices`, a.token);
    assert.equal(list.body.priceLists.length, 1);
    assert.equal(typeof list.body.priceLists[0].price, 'number');
    const resolved = await call('GET', `/items/${a.itemId}/price`, a.token);
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.price.price, 12.35);

    const foreignList = await call('GET', `/items/${a.itemId}/prices`, b.token);
    assert.equal(foreignList.body.priceLists.length, 0, 'another company must not read this items prices');
    const foreignResolve = await call('GET', `/items/${a.itemId}/price`, b.token);
    assert.equal(foreignResolve.status, 404, 'price resolution must not use another companys rows');
    const foreignCreate = await call('POST', `/items/${a.itemId}/prices`, b.token, { priceType: 'RETAIL', price: 1 });
    assert.equal(foreignCreate.status, 404);
  });
});
