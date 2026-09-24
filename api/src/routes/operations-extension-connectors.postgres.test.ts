// Bare-id call-site migration, slice 6 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the MarketplaceConnector/Item call
// sites in routes/operations-extension.ts's POST /connectors/:id/ingest,
// found while fixing the Item bare-id call sites in this file. DB-only -
// skipped unless TEST_DATABASE_URL is set.
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
  const companyId = `ops-connector-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-connector-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Ops Connector Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Connector Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-connector-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId, status: 'ACTIVE' } });
  const itemId = `ops-connector-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, token };
}

integration('POST /connectors/:id/ingest: another company\'s connector id resolves 404', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const connector = await prisma.marketplaceConnector.create({
    data: { name: 'Test Connector', platform: 'CUSTOM', channel: 'web', webhookSecret: 'whsec_test', tenantId: a.companyId },
  });

  await withServer(async (call) => {
    const cross = await call('POST', `/connectors/${connector.id}/ingest`, b.token, { externalReference: randomUUID(), lines: [{ sku: a.itemId, quantity: 1 }] });
    assert.equal(cross.status, 404, 'a connector belonging to another company must not be usable, or even discoverable');
  });
});

integration('POST /connectors/:id/ingest: a SKU that resolves to another company\'s item is rejected as unknown, not silently used', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const connector = await prisma.marketplaceConnector.create({
    data: { name: 'Test Connector', platform: 'CUSTOM', channel: 'web', webhookSecret: 'whsec_test', tenantId: a.companyId },
  });

  await withServer(async (call) => {
    const response = await call('POST', `/connectors/${connector.id}/ingest`, a.token, { externalReference: randomUUID(), lines: [{ sku: b.itemId, quantity: 1 }] });
    assert.equal(response.status, 409, 'no order can be created when every line references an unknown SKU');
    assert.equal(response.body.orders.length, 0);
    assert.ok(response.body.errors.some((e: { message: string }) => e.message.includes('Unknown SKU')), 'another company\'s item id must resolve as an unknown SKU, not a usable one');
  });
});
