// Bare-id call-site migration, slice 7 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the ExpiryAlert routes in
// routes/operations-extension.ts fixed to filter by companyId instead of
// looking a row up by bare id alone. DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts.
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
  const companyId = `ops-expiry-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `ops-expiry-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Ops Expiry Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Expiry Test Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `ops-expiry-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'warehouse', companyId } });
  const itemId = `ops-expiry-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, lotId: lot.id, token };
}

async function makeAlert(a: Awaited<ReturnType<typeof makeFixture>>) {
  return prisma.expiryAlert.create({
    data: {
      itemId: a.itemId, lotId: a.lotId, locationId: a.locationId,
      quantity: 10, expiryDate: new Date(Date.now() + 30 * 86_400_000), daysUntilExpiry: 30,
      companyId: a.companyId,
    },
  });
}

integration('PATCH /expiry-alerts/:id/status: another company\'s expiry alert id resolves 404, not a status change', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const alert = await makeAlert(a);

  await withServer(async (call) => {
    const cross = await call('PATCH', `/expiry-alerts/${alert.id}/status`, b.token, { status: 'ACKNOWLEDGED' });
    assert.equal(cross.status, 404, 'a real expiry alert belonging to another company must look identical to a missing one');

    const unchanged = await prisma.expiryAlert.findUniqueOrThrow({ where: { id: alert.id } });
    assert.equal(unchanged.status, 'ACTIVE', 'the cross-tenant attempt must not have changed anything');

    const own = await call('PATCH', `/expiry-alerts/${alert.id}/status`, a.token, { status: 'ACKNOWLEDGED' });
    assert.equal(own.status, 200, 'the owning company must still be able to act on its own alert');
  });
});

integration('POST /expiry-alerts/:id/write-off: another company\'s expiry alert id resolves 404, not a write-off', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const alert = await makeAlert(a);
  await prisma.stockLedger.create({ data: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, onHand: 10, companyId: a.companyId } });

  await withServer(async (call) => {
    const cross = await call('POST', `/expiry-alerts/${alert.id}/write-off`, b.token, { reason: 'Cross tenant write off attempt' });
    assert.equal(cross.status, 404);

    const unchanged = await prisma.expiryAlert.findUniqueOrThrow({ where: { id: alert.id } });
    assert.equal(unchanged.status, 'ACTIVE', 'the cross-tenant attempt must not have changed anything');
  });
});

// Week 6: an expiry write-off posts EXPIRY_WRITE_OFF through the canonical
// service in the write-off transaction; a second write-off of the same alert
// is rejected, and a later legitimate one is its own movement.
integration('POST /expiry-alerts/:id/write-off posts one canonical journal row that matches the ledger', async () => {
  const a = await makeFixture();
  const alert = await makeAlert(a);
  await prisma.stockLedger.create({ data: { itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, onHand: 10, companyId: a.companyId } });

  await withServer(async (call) => {
    const res = await call('POST', `/expiry-alerts/${alert.id}/write-off`, a.token, { reason: 'Expired on shelf', quantity: 4 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const again = await call('POST', `/expiry-alerts/${alert.id}/write-off`, a.token, { reason: 'Expired on shelf', quantity: 4 });
    assert.equal(again.status, 409, 'a resolved alert cannot be written off twice');
  });
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: a.itemId, locationId: a.locationId } });
  assert.equal(Number(ledger.onHand), 6);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: a.itemId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'EXPIRY_WRITE_OFF');
  assert.equal(Number(rows[0].qtyDelta), -4);
  assert.equal(rows[0].companyId, a.companyId);
  assert.equal(Number(rows[0].afterBalance), 6);
});
