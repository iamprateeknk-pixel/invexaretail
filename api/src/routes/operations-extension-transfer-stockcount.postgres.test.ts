// Bare-id call-site migration, slice 4 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the Transfer and StockCount call
// sites in routes/operations-extension.ts and routes/catalog-procurement.ts
// fixed to filter by companyId instead of relying on locationId alone (or,
// for the pick-wave lookup, no scoping at all). DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts (slice 1).
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

function withServer(router: express.Router) {
  return async (run: (call: Api) => Promise<void>): Promise<void> => {
    const app = express();
    app.use(express.json());
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
  };
}

const withOpsServer = withServer(operationsExtensionRouter);
const withCatalogServer = withServer(catalogProcurementRouter);

async function makeFixture() {
  const companyId = `ops-xfer-count-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-xfer-count-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Ops Transfer/Count Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Transfer/Count Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-xfer-count-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  const destLocationId = `ops-xfer-count-destloc-${randomUUID()}`;
  await prisma.location.create({ data: { id: destLocationId, code: destLocationId, name: 'Test Dest Loc', type: 'store', companyId } });
  const itemId = `ops-xfer-count-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, destLocationId, itemId, lotId: lot.id, token };
}

integration('GET /intelligence/:locationId: another company\'s admin sees neither the reorder rule nor the stock-count history behind it, even though the location check itself is bypassed for admins', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20, companyId: a.companyId } });
  await prisma.stockCount.create({
    data: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, physicalQty: 8, bookQty: 20, submittedById: a.userId, companyId: a.companyId },
  });

  await withOpsServer(async (call) => {
    const cross = await call('GET', `/intelligence/${a.locationId}`, b.token);
    assert.equal(cross.status, 200, 'the permissive location check still lets an admin of any company through');
    const crossRec = cross.body.intelligence.recommendations.find((r: { itemId: string }) => r.itemId === a.itemId);
    assert.equal(crossRec, undefined, 'ReorderRule is now company-scoped too - another company\'s admin must not see this reorder rule at all, not even with a degraded confidence');

    const own = await call('GET', `/intelligence/${a.locationId}`, a.token);
    assert.equal(own.status, 200);
    const ownRec = own.body.intelligence.recommendations.find((r: { itemId: string }) => r.itemId === a.itemId);
    assert.ok(ownRec, 'the owning company must still see its own reorder recommendation');
    assert.equal(ownRec.confidence, 'MEDIUM', 'the owning company must still see its own stock count variance history reflected in confidence');
  });
});

integration('GET /purchase-orders/plan: another company\'s locationId resolves 404, not a leak of its reorder plan', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20 } });

  await withCatalogServer(async (call) => {
    const cross = await call('GET', `/purchase-orders/plan?locationId=${a.locationId}`, b.token);
    assert.equal(cross.status, 404, 'a location belonging to another company must look identical to a missing one');

    const own = await call('GET', `/purchase-orders/plan?locationId=${a.locationId}`, a.token);
    assert.equal(own.status, 200, 'the owning company must still be able to plan for its own location');
  });
});

integration('POST /pick-waves/:id/scan: another company\'s pick wave id resolves 404', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const transfer = await prisma.transfer.create({
    data: {
      sourceLocationId: a.locationId, destinationLocationId: a.destLocationId, requestedById: a.userId,
      status: 'DISPATCHED', companyId: a.companyId,
      lines: { create: [{ itemId: a.itemId, lotId: a.lotId, requestedQty: 5 }] },
    },
  });
  const wave = await prisma.pickWave.create({
    data: { locationId: a.locationId, transferIds: [transfer.id], createdById: a.userId },
  });

  await withOpsServer(async (call) => {
    const cross = await call('POST', `/pick-waves/${wave.id}/scan`, b.token, { scannedBinCode: 'X', walkOrder: [], scannedIndex: 0 });
    assert.equal(cross.status, 404, 'a pick wave belonging to another company must not be usable, or even discoverable');
  });
});
