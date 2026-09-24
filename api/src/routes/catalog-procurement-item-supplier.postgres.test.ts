// Bare-id call-site migration, slice 6 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the Item and Supplier call sites in
// routes/catalog-procurement.ts fixed to filter by companyId instead of
// looking a row up by bare id alone (or, for Supplier, no filter of any
// kind). Supplier had no companyId column at all before this slice -
// migration 20261030090000_supplier_company_scope adds one. DB-only -
// skipped unless TEST_DATABASE_URL is set. Reuses the withServer/
// makeFixture pattern from operations-extension-orders.postgres.test.ts.
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
  const companyId = `catalog-item-supplier-test-${randomUUID()}`;
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

integration('GET /suppliers: only ever returns the caller\'s own company\'s suppliers', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const listA = await call('GET', '/suppliers', a.token);
    assert.equal(listA.status, 200);
    const idsA = listA.body.suppliers.map((s: { id: string }) => s.id);
    assert.ok(idsA.includes(a.supplierId), 'company A must see its own supplier');
    assert.ok(!idsA.includes(b.supplierId), 'company A must not see company B\'s supplier');
  });
});

integration('POST /suppliers: a newly created supplier is stamped with the caller\'s own companyId', async () => {
  const a = await makeFixture();

  await withServer(async (call) => {
    const created = await call('POST', '/suppliers', a.token, { name: 'Brand New Supplier' });
    assert.equal(created.status, 201);
    const row = await prisma.supplier.findUniqueOrThrow({ where: { id: created.body.supplier.id } });
    assert.equal(row.companyId, a.companyId, 'a newly created supplier must be stamped with the caller\'s real companyId, not the schema default');
  });
});

integration('PUT /suppliers/:id: another company\'s supplier id resolves 404, not an update', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const cross = await call('PUT', `/suppliers/${a.supplierId}`, b.token, { name: 'Hijacked Name' });
    assert.equal(cross.status, 404, 'a real supplier belonging to another company must look identical to a missing one');

    const unchanged = await prisma.supplier.findUniqueOrThrow({ where: { id: a.supplierId } });
    assert.equal(unchanged.name, 'Test Supplier', 'the cross-tenant attempt must not have changed anything');
  });
});

integration('GET /suppliers/:id/score: another company\'s supplier id resolves 404', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const cross = await call('GET', `/suppliers/${a.supplierId}/score`, b.token);
    assert.equal(cross.status, 404);

    const own = await call('GET', `/suppliers/${a.supplierId}/score`, a.token);
    assert.equal(own.status, 200);
  });
});

integration('POST /purchase-orders: referencing another company\'s supplier or item is rejected, not silently linked', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const crossSupplier = await call('POST', '/purchase-orders', a.token, {
      supplierId: b.supplierId, locationId: a.locationId, lines: [{ itemId: a.itemId, quantity: 5, unitCost: 10 }],
    });
    assert.equal(crossSupplier.status, 404, 'another company\'s supplier id must not be usable to create a purchase order');

    const crossItem = await call('POST', '/purchase-orders', a.token, {
      supplierId: a.supplierId, locationId: a.locationId, lines: [{ itemId: b.itemId, quantity: 5, unitCost: 10 }],
    });
    assert.equal(crossItem.status, 400, 'another company\'s item id must not be silently accepted into a purchase order line');

    const own = await call('POST', '/purchase-orders', a.token, {
      supplierId: a.supplierId, locationId: a.locationId, lines: [{ itemId: a.itemId, quantity: 5, unitCost: 10 }],
    });
    assert.equal(own.status, 201, 'the owning company\'s own supplier and item must still work');
  });
});

integration('POST /items/:itemId/prices: another company\'s item id resolves 404', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const cross = await call('POST', `/items/${a.itemId}/prices`, b.token, { priceType: 'RETAIL', price: 100 });
    assert.equal(cross.status, 404);
  });
});

integration('GET /saved-views/:id/items: another company\'s saved-view id resolves 404, and item results never leak across companies', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const savedView = await prisma.savedView.create({
    data: { ownerId: a.userId, name: 'A view', filter: {}, companyId: a.companyId },
  });

  await withServer(async (call) => {
    const cross = await call('GET', `/saved-views/${savedView.id}/items`, b.token);
    assert.equal(cross.status, 404, 'a saved view belonging to another company must not be readable, or even discoverable');

    const own = await call('GET', `/saved-views/${savedView.id}/items`, a.token);
    assert.equal(own.status, 200);
    const ids = own.body.items.map((item: { id: string }) => item.id);
    assert.ok(!ids.includes(b.itemId), 'the item list behind a saved view must never include another company\'s items');
  });
});
