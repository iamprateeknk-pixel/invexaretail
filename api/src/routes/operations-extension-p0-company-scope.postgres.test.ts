// Plan P0-SEC-001..004: Lot status/expiry, AssetCheckout, ContextComment and
// UserNotification are company scoped. Every test uses a REAL foreign id (a row
// that exists under company A, attacked as company B) and expects a 404-equivalent,
// then proves the identical call succeeds for the owner (so the rejection is the
// tenant check, not an unrelated bug). DB-only - skipped unless TEST_DATABASE_URL is set.
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
  const companyId = `p0-scope-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `p0-scope-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'P0 Scope Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'P0 Scope Admin',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `p0-scope-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Loc', type: 'warehouse', companyId } });
  const itemId = `p0-scope-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}`, status: 'AVAILABLE' } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, lotId: lot.id, token };
}

// ---- P0-SEC-001 -----------------------------------------------------------

integration('P0-SEC-001 PATCH /lots/:id/status: another company\'s lot id is a 404 and the lot is untouched', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    const cross = await call('PATCH', `/lots/${a.lotId}/status`, b.token, { status: 'BLOCKED' });
    assert.equal(cross.status, 404);
    assert.equal((await prisma.lot.findUniqueOrThrow({ where: { id: a.lotId } })).status, 'AVAILABLE', 'a foreign admin must not be able to block another company\'s lot');
    const own = await call('PATCH', `/lots/${a.lotId}/status`, a.token, { status: 'BLOCKED' });
    assert.equal(own.status, 200);
    assert.equal((await prisma.lot.findUniqueOrThrow({ where: { id: a.lotId } })).status, 'BLOCKED');
  });
});

integration('P0-SEC-001 PATCH /lots/:id/expiry: another company\'s lot id is a 404 and the expiry date is untouched', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    const cross = await call('PATCH', `/lots/${a.lotId}/expiry`, b.token, { expiryDate: '2030-01-01' });
    assert.equal(cross.status, 404);
    assert.equal((await prisma.lot.findUniqueOrThrow({ where: { id: a.lotId } })).expiryDate, null);
    const own = await call('PATCH', `/lots/${a.lotId}/expiry`, a.token, { expiryDate: '2030-01-01' });
    assert.equal(own.status, 200);
    assert.ok((await prisma.lot.findUniqueOrThrow({ where: { id: a.lotId } })).expiryDate);
  });
});

// ---- P0-SEC-002 -----------------------------------------------------------

integration('P0-SEC-002 GET /asset-checkouts: an admin with no locationId only sees their own company\'s checkouts', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const rowA = await prisma.assetCheckout.create({ data: { itemId: a.itemId, locationId: a.locationId, assigneeName: 'Alice', createdById: a.userId, companyId: a.companyId } });
  const rowB = await prisma.assetCheckout.create({ data: { itemId: b.itemId, locationId: b.locationId, assigneeName: 'Bob', createdById: b.userId, companyId: b.companyId } });
  await withServer(async (call) => {
    const listA = (await call('GET', '/asset-checkouts', a.token)).body.checkouts.map((c: { id: string }) => c.id);
    assert.ok(listA.includes(rowA.id));
    assert.ok(!listA.includes(rowB.id), 'company A must not see company B\'s checkout');
    const listB = (await call('GET', '/asset-checkouts', b.token)).body.checkouts.map((c: { id: string }) => c.id);
    assert.ok(listB.includes(rowB.id) && !listB.includes(rowA.id));
  });
});

integration('P0-SEC-002 POST /asset-checkouts: a foreign item or foreign location is rejected and stamps the caller\'s company', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    const foreignItem = await call('POST', '/asset-checkouts', b.token, { itemId: a.itemId, locationId: b.locationId, assigneeName: 'X', quantity: 1 });
    assert.equal(foreignItem.status, 404);
    const foreignLocation = await call('POST', '/asset-checkouts', b.token, { itemId: b.itemId, locationId: a.locationId, assigneeName: 'X', quantity: 1 });
    assert.equal(foreignLocation.status, 404);
    assert.equal(await prisma.assetCheckout.count({ where: { OR: [{ itemId: a.itemId }, { locationId: a.locationId }] } }), 0, 'nothing may be created against another company\'s ids');
    const own = await call('POST', '/asset-checkouts', a.token, { itemId: a.itemId, locationId: a.locationId, assigneeName: 'Alice', quantity: 1 });
    assert.equal(own.status, 201);
    assert.equal(own.body.checkout.companyId, a.companyId);
  });
});

integration('P0-SEC-002 PATCH /asset-checkouts/:id/return: another company\'s checkout is a 404 and stays checked out', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const row = await prisma.assetCheckout.create({ data: { itemId: a.itemId, locationId: a.locationId, assigneeName: 'Alice', createdById: a.userId, companyId: a.companyId } });
  await withServer(async (call) => {
    assert.equal((await call('PATCH', `/asset-checkouts/${row.id}/return`, b.token, {})).status, 404);
    assert.equal((await prisma.assetCheckout.findUniqueOrThrow({ where: { id: row.id } })).status, 'CHECKED_OUT');
    assert.equal((await call('PATCH', `/asset-checkouts/${row.id}/return`, a.token, {})).status, 200);
  });
});

// ---- P0-SEC-003 -----------------------------------------------------------

integration('P0-SEC-003 comments: a foreign entity id is a 404 on read and write, and threads never cross companies', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  await withServer(async (call) => {
    const posted = await call('POST', `/comments/item/${a.itemId}`, a.token, { body: 'Check the shelf label' });
    assert.equal(posted.status, 201);
    assert.equal(posted.body.comment.companyId, a.companyId);

    assert.equal((await call('GET', `/comments/item/${a.itemId}`, b.token)).status, 404, 'B cannot read A\'s thread by guessing the item id');
    assert.equal((await call('POST', `/comments/item/${a.itemId}`, b.token, { body: 'injected' })).status, 404, 'B cannot write on A\'s item');
    assert.equal(await prisma.contextComment.count({ where: { entityId: a.itemId, companyId: b.companyId } }), 0);

    const own = await call('GET', `/comments/item/${a.itemId}`, a.token);
    assert.equal(own.status, 200);
    assert.equal(own.body.comments.length, 1);
  });
});

integration('P0-SEC-003 comments: unknown entity types are rejected, and a comment cannot be read through a different company\'s row', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const stray = await prisma.contextComment.create({ data: { entityType: 'item', entityId: a.itemId, authorId: b.userId, authorName: 'B', body: 'legacy row owned by B', companyId: b.companyId } });
  await withServer(async (call) => {
    assert.equal((await call('GET', `/comments/secrets/${a.itemId}`, a.token)).status, 400, 'only allowlisted entity types');
    const own = (await call('GET', `/comments/item/${a.itemId}`, a.token)).body.comments.map((c: { id: string }) => c.id);
    assert.ok(!own.includes(stray.id), 'a row owned by another company never appears, even on the same entity id');
  });
});

// ---- P0-SEC-004 -----------------------------------------------------------

integration('P0-SEC-004 notification inbox: global and role notices stay inside their own company', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const globalA = await prisma.userNotification.create({ data: { title: 'A global', body: 'for A only', companyId: a.companyId } });
  const roleB = await prisma.userNotification.create({ data: { role: 'ADMIN', title: 'B admins', body: 'for B admins', companyId: b.companyId } });
  const personalA = await prisma.userNotification.create({ data: { userId: a.userId, title: 'A personal', body: 'x', companyId: a.companyId } });
  await withServer(async (call) => {
    const inboxA = (await call('GET', '/notification-inbox', a.token)).body.notifications.map((n: { id: string }) => n.id);
    assert.ok(inboxA.includes(globalA.id) && inboxA.includes(personalA.id));
    assert.ok(!inboxA.includes(roleB.id), 'a role-wide notice of company B must not reach company A\'s admins');
    const inboxB = (await call('GET', '/notification-inbox', b.token)).body.notifications.map((n: { id: string }) => n.id);
    assert.ok(inboxB.includes(roleB.id));
    assert.ok(!inboxB.includes(globalA.id), 'a global notice of company A must not reach company B');
  });
});

integration('P0-SEC-004 PATCH /notification-inbox/:id/read: another company\'s notification is a 404 and stays unread', async () => {
  const a = await makeFixture();
  const b = await makeFixture();
  const notice = await prisma.userNotification.create({ data: { title: 'A global', body: 'x', companyId: a.companyId } });
  await withServer(async (call) => {
    assert.equal((await call('PATCH', `/notification-inbox/${notice.id}/read`, b.token)).status, 404);
    assert.equal((await prisma.userNotification.findUniqueOrThrow({ where: { id: notice.id } })).readAt, null);
    assert.equal((await call('PATCH', `/notification-inbox/${notice.id}/read`, a.token)).status, 200);
  });
});
