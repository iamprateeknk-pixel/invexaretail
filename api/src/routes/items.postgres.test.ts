// Week 10: HTTP-level coverage for routes/items.ts (item search, stock
// detail, adjustment, reversal). DB-only (searchItems/getStockDetail/
// postInventoryMovement all require real Postgres) - see AGENTS.md
// "Required tests". Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { decideApprovalRequest } from '../lib/approval-rules.js';
import { extractToken } from './enterprise-auth.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { generateJWT } from '../lib/otp-auth.js';
import { createEnhancedUser } from '../lib/enterprise-repository.js';
import { registerLocationCompany, registerItemCompany } from '../lib/saas/tenant-scope.js';
import itemsRouter from './items.js';
import coreRouter from './core.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', itemsRouter);
  app.use('/api/v1', coreRouter);
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
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function makeFixture(registerItem = true) {
  const companyId = `items-route-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `items-route-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Items Route Test User', role: 'ADMIN', passwordHash: 'x', assignedLocations: '[]' } });
  createEnhancedUser({
    id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Items Route Test User',
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
  });
  const locationId = `items-route-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  registerLocationCompany(locationId, companyId);
  const itemId = `items-route-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Route Test Item', unit: 'ea', companyId } });
  if (registerItem) registerItemCompany(itemId, companyId);
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  const token = generateJWT(userId, companyId);
  return { companyId, userId, locationId, itemId, lotId: lot.id, token };
}

integration('GET /items/search paginates and is scoped to the caller\'s tenant', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  await withServer(async (call) => {
    const page = await call('GET', '/items/search?limit=50', fixtureA.token);
    assert.equal(page.status, 200);
    assert.ok(page.body.items.some((item: { id: string }) => item.id === fixtureA.itemId));
    assert.ok(!page.body.items.some((item: { id: string }) => item.id === fixtureB.itemId), 'tenant B\'s item must not appear in tenant A\'s search results');
  });
});

integration('published Studio item fields enforce role, type, required value and version in the catalogue', async () => {
  const owner = await makeFixture(false);
  const foreign = await makeFixture();
  const managerId = randomUUID();
  createEnhancedUser({ id: managerId, companyId: owner.companyId, email: `${managerId}@test.invexa.local`, name: 'Manager',
    role: 'BRANCH_MANAGER', branchIds: [], locationIds: [owner.locationId], passwordHash: 'x', status: 'active' });
  const manager = generateJWT(managerId, owner.companyId);
  const versionId = randomUUID();
  const field = { id: randomUUID(), companyId: owner.companyId, entityType: 'item', fieldKey: 'case_size', label: 'Case size',
    dataType: 'number', required: true, defaultValue: null, visibleRoles: ['ADMIN', 'BRANCH_MANAGER'], editableRoles: ['ADMIN'], status: 'active' };
  const privateField = { ...field, id: randomUUID(), fieldKey: 'internal', visibleRoles: ['ADMIN'] };
  const malformedField = { ...field, id: randomUUID(), fieldKey: 'malformed', visibleRoles: 'ADMIN,BRANCH_MANAGER' };
  const path = `/items/${owner.itemId}/studio-fields`;
  await prisma.controlPlaneConfig.create({ data: { companyId: owner.companyId, versionId, version: 2,
    kind: 'draft', status: 'draft', payload: { fields: [field, privateField] } } });
  await withServer(async (call) => {
    const draft = await call('GET', path, owner.token);
    assert.equal(draft.status, 200);
    assert.deepEqual(draft.body.fields, []);
    await prisma.controlPlaneConfig.create({ data: { companyId: owner.companyId, versionId, version: 2,
      kind: 'published', status: 'published', payload: { fields: [field, privateField, malformedField] } } });
    const admin = await call('GET', path, owner.token);
    assert.equal(admin.body.versionId, versionId);
    assert.equal(admin.body.fields.length, 2);
    assert.equal((await call('GET', path, foreign.token)).status, 404);
    const visibleToManager = await call('GET', path, manager);
    assert.deepEqual(visibleToManager.body.fields.map((entry: { key: string; editable: boolean }) => [entry.key, entry.editable]), [['case_size', false]]);

    const write = (token: string, value: unknown, version: string = versionId) => call('PUT', `${path}/case_size`, token, { value, versionId: version });
    assert.equal((await write(foreign.token, 12)).status, 404);
    assert.equal((await write(manager, 12)).status, 403);
    assert.equal((await write(owner.token, '12')).status, 422);
    assert.equal((await write(owner.token, null)).status, 422);
    assert.equal((await write(owner.token, 12, 'obsolete')).status, 409);
    assert.equal((await write(owner.token, 12)).status, 200);
    const after = await call('GET', path, manager);
    assert.equal(after.body.fields[0].value, 12);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'STUDIO_ITEM_FIELD_UPDATED', entityId: owner.itemId } });
    assert.equal(audit?.actorId, owner.userId);
    assert.deepEqual(audit?.metadata, { companyId: owner.companyId, fieldKey: field.fieldKey, configVersion: 2, versionId });

    const nextVersion = randomUUID();
    await prisma.controlPlaneConfig.create({ data: { companyId: owner.companyId, versionId: nextVersion, version: 3,
      kind: 'published', status: 'published', payload: { fields: [{ ...field, label: 'Pack size', visibleRoles: ['ADMIN'] }] } } });
    assert.equal((await write(owner.token, 20)).status, 409);
    assert.deepEqual((await call('GET', path, manager)).body.fields, []);
    const republished = await call('GET', path, owner.token);
    assert.equal(republished.body.versionId, nextVersion);
    assert.deepEqual(republished.body.fields.map((entry: { label: string; value: unknown }) => [entry.label, entry.value]), [['Pack size', 12]]);
  });
});

integration('manual item creation uses the current published fields and commits their values with the item', async () => {
  const owner = await makeFixture();
  const other = await makeFixture();
  const versionId = randomUUID();
  const field = { id: randomUUID(), companyId: owner.companyId, entityType: 'item', fieldKey: 'case_size', label: 'Case size',
    dataType: 'number', required: true, defaultValue: null, visibleRoles: ['ADMIN'], editableRoles: ['ADMIN'], status: 'active' };
  const hidden = { ...field, id: randomUUID(), fieldKey: 'private', visibleRoles: ['ADMIN_USER'], defaultValue: 5 };
  const published = { companyId: owner.companyId, versionId, version: 2, payload: { fields: [field, hidden] } };
  const input = { code: randomUUID(), name: 'New Studio item' };
  const formPath = '/items/studio-create-fields';
  await prisma.controlPlaneConfig.create({ data: { ...published, kind: 'draft', status: 'draft' } });
  await withServer(async (call) => {
    const draft = await call('GET', formPath, owner.token);
    assert.equal(draft.status, 200);
    assert.deepEqual(draft.body.fields, []);
    await prisma.controlPlaneConfig.create({ data: { ...published, kind: 'published', status: 'published' } });
    const form = await call('GET', formPath, owner.token);
    assert.equal(form.body.versionId, versionId);
    assert.deepEqual(form.body.fields.map((entry: { key: string }) => entry.key), ['case_size']);
    assert.deepEqual((await call('GET', formPath, other.token)).body.fields, []);

    const submit = (values: Record<string, unknown>, version: string = versionId) => call('POST', '/items', owner.token,
      { ...input, studioFields: { versionId: version, values } });
    assert.equal((await call('POST', '/items', owner.token, input)).status, 422);
    assert.equal((await submit({})).status, 422);
    assert.equal((await submit({ case_size: '12' })).status, 422);
    assert.equal((await submit({ case_size: 12, private: 9 })).status, 403);
    assert.equal((await submit({ case_size: 12 }, 'stale')).status, 409);
    assert.equal(await prisma.item.count({ where: { companyId: owner.companyId, code: input.code } }), 0);
    assert.equal((await call('GET', '/items', owner.token)).body.items.some((item: { code: string }) => item.code === input.code), false);

    const existingCode = randomUUID();
    await prisma.item.create({ data: { companyId: owner.companyId, name: 'Existing item', code: existingCode } });
    const fieldRows = () => prisma.controlPlaneFieldValue.count({
      where: { key: { startsWith: JSON.stringify([owner.companyId, 'item']).slice(0, -1) } },
    });
    const before = await fieldRows();
    const duplicate = await call('POST', '/items', owner.token,
      { ...input, code: existingCode, studioFields: { versionId, values: { case_size: 20 } } });
    assert.equal(duplicate.status, 409);
    assert.equal(await fieldRows(), before, 'a failed item insert rolls back the proposed field values');

    const created = await submit({ case_size: 0 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const itemId = created.body.item.id;
    const details = await call('GET', `/items/${itemId}/studio-fields`, owner.token);
    assert.equal(details.body.fields[0].value, 0);
    const foreignDetail = await call('GET', `/items/${itemId}/studio-fields`, other.token);
    assert.equal(foreignDetail.status, 403);
    assert.equal(foreignDetail.body.fields, undefined);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: itemId, action: 'ITEM_CREATED' } });
    assert.deepEqual(audit?.metadata, { companyId: owner.companyId, configVersion: 2, versionId });
  });
});

integration('POST /items/:itemId/adjust posts once for two identical requests with the same idempotency key', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    const key = randomUUID();
    const body = { locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 10, reason: 'stock take correction', idempotencyKey: key };
    const first = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, body);
    assert.equal(first.status, 201);
    assert.equal(first.body.duplicate, false);

    const second = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, body);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.movement.id, first.body.movement.id);

    const ledger = await prisma.stockLedger.findFirst({ where: { itemId: fixture.itemId, lotId: fixture.lotId, locationId: fixture.locationId } });
    assert.equal(Number(ledger?.onHand), 10, 'a retried adjustment must not double-post');
  });
});

integration('item adjustments wait for a published review and replay a completed post after policy changes', async () => {
  const { companyId, itemId, locationId, lotId, token } = await makeFixture();
  const reviewer = `items-reviewer-${randomUUID()}`;
  await prisma.user.create({ data: { id: reviewer, companyId, email: `${reviewer}@test.invexa.local`, name: reviewer, role: 'ADMIN', passwordHash: 'x', assignedLocations: '[]' } });
  const publish = (version: number, outcome: { requireApproval: string } | { action: string }) => prisma.controlPlaneConfig.create({
    data: { versionId: randomUUID(), companyId, version, kind: 'published', status: 'published', payload: { rules: [
      { key: 'adjustments', name: 'Adjustments', liveFor: 'STOCK_ADJUSTMENT', condition: { adjustmentValueGte: 0 }, outcome },
    ] } },
  });
  await publish(2, { requireApproval: 'ADMIN' });
  await withServer(async (call) => {
    const path = `/items/${itemId}/adjust`;
    const command = { locationId, lotId, qtyDelta: 5, reason: 'stock take correction', idempotencyKey: randomUUID() };
    const pending = await call('POST', path, token, command);
    assert.equal(pending.status, 409);
    assert.equal(pending.body.requiredApproverRole, 'ADMIN');
    assert.ok(pending.body.approvalRequestId);
    assert.equal((await call('POST', path, token, command)).body.approvalRequestId, pending.body.approvalRequestId);
    assert.equal(await prisma.stockMovement.count({ where: { companyId, itemId } }), 0);

    await decideApprovalRequest(pending.body.approvalRequestId, reviewer, 'ADMIN', 'APPROVED', null, companyId);
    const posted = await call('POST', path, token, command);
    assert.equal(posted.status, 201);
    await publish(3, { action: 'BLOCK' });
    const replay = await call('POST', path, token, command);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.movement.id, posted.body.movement.id);
    const rejected = await call('POST', path, token, { ...command, idempotencyKey: randomUUID() });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'STUDIO_RULE_BLOCKED');
    assert.equal(await prisma.stockMovement.count({ where: { companyId, itemId } }), 1);
  });
});

integration('POST /items/:itemId/adjust requires an idempotencyKey and a reason', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    const missingKey = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 5, reason: 'test',
    });
    assert.equal(missingKey.status, 400);

    const missingReason = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 5, idempotencyKey: randomUUID(),
    });
    assert.equal(missingReason.status, 400);
  });
});

integration('a reversal posts an equal-and-opposite movement and retrying the reversal is itself idempotent', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    const posted = await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 20, reason: 'seed', idempotencyKey: randomUUID(),
    });
    assert.equal(posted.status, 201);

    const reversed = await call('POST', `/items/${fixture.itemId}/movements/${posted.body.movement.id}/reverse`, fixture.token, { reason: 'undo' });
    assert.equal(reversed.status, 201);
    assert.equal(Number(reversed.body.movement.qtyDelta), -20);

    const again = await call('POST', `/items/${fixture.itemId}/movements/${posted.body.movement.id}/reverse`, fixture.token, { reason: 'undo again' });
    assert.equal(again.status, 409, 'reversing an already-reversed movement must fail, not silently double-reverse');

    const ledger = await prisma.stockLedger.findFirst({ where: { itemId: fixture.itemId, lotId: fixture.lotId, locationId: fixture.locationId } });
    assert.equal(Number(ledger?.onHand), 0);
  });
});

integration('tenant isolation: adjusting an item that belongs to a different tenant fails closed, not silently succeeds against the wrong company', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  await withServer(async (call) => {
    const response = await call('POST', `/items/${fixtureA.itemId}/adjust`, fixtureB.token, {
      locationId: fixtureA.locationId, lotId: fixtureA.lotId, qtyDelta: 5, reason: 'cross-tenant attempt', idempotencyKey: randomUUID(),
    });
    // Caught by enforceOperationalCompanyScope (a middleware layer ahead of
    // this route entirely) before assertItemOwnedByTenant/companyOwnsLocation
    // inside the handler even runs - two independent layers agree the
    // request must fail closed, which is the point: 403 here, not 404, is
    // the correct and stronger outcome.
    assert.equal(response.status, 403);

    const ledger = await prisma.stockLedger.findFirst({ where: { itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId } });
    assert.equal(ledger, null, 'tenant B must not be able to create a StockLedger row against tenant A\'s item');
  });
});

integration('GET /items/:itemId/stock-detail returns branch balances, lots and movement history from the canonical journal', async () => {
  const fixture = await makeFixture();
  await withServer(async (call) => {
    await call('POST', `/items/${fixture.itemId}/adjust`, fixture.token, {
      locationId: fixture.locationId, lotId: fixture.lotId, qtyDelta: 15, reason: 'opening', idempotencyKey: randomUUID(),
    });
    const detail = await call('GET', `/items/${fixture.itemId}/stock-detail`, fixture.token);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.branches.length, 1);
    assert.equal(Number(detail.body.branches[0].onHand), 15);
    assert.equal(detail.body.lots.length, 1);
    assert.equal(detail.body.movements.length, 1);
    assert.equal(detail.body.reconciliation.length, 1);
    assert.equal(detail.body.reconciliation[0].explained, true, 'onHand must equal the journal sum right after posting');
  });
});

integration('GET /items/:itemId/stock-detail for a different tenant\'s item is rejected, not another tenant\'s data', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  await withServer(async (call) => {
    const response = await call('GET', `/items/${fixtureA.itemId}/stock-detail`, fixtureB.token);
    // Same enforceOperationalCompanyScope layer as the adjust test above.
    assert.equal(response.status, 403);
  });
});
