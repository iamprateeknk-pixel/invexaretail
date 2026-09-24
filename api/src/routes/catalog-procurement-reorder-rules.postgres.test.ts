// Bare-id call-site migration, slice 7 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the ReorderRule routes in
// routes/catalog-procurement.ts. ReorderRule had no companyId column at
// all before this slice - migration 20261102090000_reorder_rule_company_scope
// adds one, backfilled through the rule's own Location. DB-only - skipped
// unless TEST_DATABASE_URL is set. Reuses the withServer/makeFixture
// pattern from operations-extension-orders.postgres.test.ts.
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
  const companyId = `catalog-reorder-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `catalog-reorder-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Catalog Reorder Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Catalog Reorder Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `catalog-reorder-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  const itemId = `catalog-reorder-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, token };
}

integration('GET /reorder-rules: only ever returns the caller\'s own company\'s rules for a location it does not own', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const ruleA = await prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20, companyId: a.companyId } });

  await withServer(async (call) => {
    const cross = await call('GET', `/reorder-rules?locationId=${a.locationId}`, b.token);
    assert.equal(cross.status, 200, 'the permissive role-only check still lets an admin of any company through');
    assert.deepEqual(cross.body.rules, [], 'another company\'s admin must not see a rule for a location it does not own');

    const own = await call('GET', `/reorder-rules?locationId=${a.locationId}`, a.token);
    assert.equal(own.status, 200);
    assert.ok(own.body.rules.some((r: { id: string }) => r.id === ruleA.id));
  });
});

integration('PUT /reorder-rules/:itemId: another company\'s locationId is rejected, not silently written to', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await withServer(async (call) => {
    const cross = await call('PUT', `/reorder-rules/${a.itemId}`, b.token, { locationId: a.locationId, minQty: 1, targetQty: 10 });
    assert.equal(cross.status, 404, 'a location belonging to another company must not be usable to create or update a reorder rule');

    const rule = await prisma.reorderRule.findUnique({ where: { itemId_locationId: { itemId: a.itemId, locationId: a.locationId } } });
    assert.equal(rule, null, 'the cross-tenant attempt must not have created a rule at all');

    const own = await call('PUT', `/reorder-rules/${a.itemId}`, a.token, { locationId: a.locationId, minQty: 1, targetQty: 10 });
    assert.equal(own.status, 200, 'the owning company\'s own write must still succeed');
    assert.equal(own.body.rule.companyId, a.companyId, 'a newly created rule must be stamped with the caller\'s real companyId');
  });
});

integration('GET /purchase-orders/plan: reorder rules from another company at the same item never leak into the plan', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await prisma.reorderRule.create({ data: { itemId: a.itemId, locationId: a.locationId, minQty: 5, targetQty: 20, companyId: a.companyId } });

  await withServer(async (call) => {
    const cross = await call('GET', `/purchase-orders/plan?locationId=${a.locationId}`, b.token);
    assert.equal(cross.status, 404);
  });
});
