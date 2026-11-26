// Week 6: count-variance approval and transfer pick-confirm post through the
// canonical service inside their own transactions (journal + ledger + audit +
// outbox together, idempotent). Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from './db.js';
import { persistConfirmedPickAllocations, persistCount, persistCountBatch, persistCountReview, persistTransfer } from './persistence.js';
import { createOrderWithReservation } from './orders.js';
import { drainStudioAutomationRuns, listStudioAutomationRuns } from './saas/studio-automation-worker.js';
import { queueStudioBusinessEvent } from './saas/studio-business-events.js';
import { createCountRecord, type CountRecord } from './repository.js';
import { createEnhancedUser } from './enterprise-repository.js';
import { generateJWT } from './otp-auth.js';
import { enforceOperationalCompanyScope, registerLocationCompany } from './saas/tenant-scope.js';
import { extractToken } from '../routes/enterprise-auth.js';
import coreRouter from '../routes/core.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function fixture(onHand: number | null) {
  const companyId = `pcp-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `pcp-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'P', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const loc = await prisma.location.create({ data: { id: `pcp-loc-${randomUUID()}`, code: `pcp-${randomUUID()}`, name: 'L', type: 'store', companyId } });
  const dst = await prisma.location.create({ data: { id: `pcp-dst-${randomUUID()}`, code: `pcp-${randomUUID()}`, name: 'D', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `PCP-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  if (onHand !== null) await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: loc.id, onHand, companyId } });
  return { companyId, userId, loc, dst, item, lot };
}

async function pendingCount(f: Awaited<ReturnType<typeof fixture>>, physical: number, book: number) {
  const id = `count-${randomUUID()}`;
  await prisma.stockCount.create({ data: { id, itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, physicalQty: physical, bookQty: book, submittedById: f.userId, companyId: f.companyId } as never });
  const record: CountRecord = {
    id, itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, physicalQuantity: physical, bookQty: book, mode: 'manual',
    submittedBy: f.userId, role: 'ADMIN', createdAt: new Date().toISOString(), status: 'APPROVED', reviewedBy: f.userId, reviewedAt: new Date().toISOString(), reviewReason: 'ok',
  };
  return record;
}

integration('an approved count variance posts one COUNT_VARIANCE journal row that matches the ledger; a second review cannot post again', async () => {
  const f = await fixture(10);
  const count = await pendingCount(f, 7, 10);
  const other = await fixture(1);
  await assert.rejects(persistCountReview(count, other.companyId));
  assert.equal((await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } })).reviewStatus, 'PENDING_REVIEW');
  await persistCountReview(count, f.companyId);
  await assert.rejects(persistCountReview(count, f.companyId), 'a second review of the same count must not post again');
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(Number(ledger.onHand), 7);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'COUNT_VARIANCE');
  assert.equal(Number(rows[0].qtyDelta), -3);
  assert.equal(rows[0].companyId, f.companyId);
  assert.equal(rows[0].idempotencyKey, `count-variance:${count.id}`);
});

integration('a count on a lot with no ledger row yet establishes stock at the physical quantity', async () => {
  const f = await fixture(null);
  await persistCountReview(await pendingCount(f, 6, 0), f.companyId);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(Number(ledger.onHand), 6);
  assert.equal((await prisma.stockMovement.count({ where: { itemId: f.item.id } })), 1);
});

integration('live business notifications are queued by committed submissions and delivered once per action', async () => {
  const f = await fixture(20);
  const other = await fixture(20);
  const events = ['count.submitted', 'transfer.created', 'order.created'];
  const policy = {
    companyId: f.companyId, versionId: randomUUID(), version: 2,
    payload: { automations: events.map((expression) => ({
      key: expression, name: expression, enforce: true, trigger: 'event', expression, actionKey: 'SEND_NOTIFICATION',
    })) },
  };
  const count = {
    id: randomUUID(), itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, physicalQuantity: 20,
    bookQty: 20, mode: 'manual', submittedBy: f.userId, role: 'ADMIN', createdAt: new Date().toISOString(),
  } satisfies CountRecord;
  await prisma.controlPlaneConfig.create({ data: { ...policy, kind: 'draft', status: 'draft' } });
  await persistCount(count, f.companyId);
  assert.deepEqual(await listStudioAutomationRuns(f.companyId), []);
  await prisma.controlPlaneConfig.create({ data: { ...policy, kind: 'published', status: 'published' } });
  await persistCount(count, f.companyId);
  assert.deepEqual(await listStudioAutomationRuns(f.companyId), [], 'updating a pre-publication submission does not create an event');
  await assert.rejects(persistCountBatch([{ ...count, id: randomUUID(), lotId: 'missing-lot' }], f.companyId));
  await assert.rejects(prisma.$transaction(async (tx) => {
    await queueStudioBusinessEvent(tx, { event: 'count.submitted', companyId: f.companyId, entityId: 'rolled-back' });
    throw new Error('rollback after queuing');
  }), /rollback after queuing/);
  assert.deepEqual(await listStudioAutomationRuns(f.companyId), []);
  const newCount = { ...count, id: randomUUID() };
  await persistCount(newCount, f.companyId);
  await persistCount(newCount, f.companyId);
  await persistCountBatch([{ ...count, id: randomUUID() }, { ...count, id: randomUUID() }], f.companyId);
  const transfer = {
    id: randomUUID(), sourceLocationId: f.loc.id, destinationLocationId: f.dst.id, requestedBy: f.userId,
    status: 'REQUESTED', role: 'ADMIN', createdAt: new Date().toISOString(),
    lines: [{ itemId: f.item.id, lotId: f.lot.id, quantity: 2 }],
  } as const;
  await persistTransfer({ ...transfer, lines: [...transfer.lines] }, f.companyId);
  await persistTransfer({ ...transfer, lines: [...transfer.lines] }, f.companyId);
  const order = {
    companyId: f.companyId, channel: 'AMAZON', externalReference: randomUUID(), createdById: f.userId,
    fulfillmentLocationId: f.loc.id, lines: [{ itemId: f.item.id, quantity: 2 }],
  };
  await createOrderWithReservation(order);
  assert.equal((await createOrderWithReservation(order)).duplicate, true);
  const queued = await listStudioAutomationRuns(f.companyId);
  assert.deepEqual(queued.map((entry) => entry.expression).sort(), ['count.submitted', 'count.submitted', 'order.created', 'transfer.created']);
  assert.ok(queued.every((entry) => entry.status === 'PENDING' && entry.configVersion === 2));
  await Promise.all([drainStudioAutomationRuns(new Date()), drainStudioAutomationRuns(new Date())]);
  assert.ok((await listStudioAutomationRuns(f.companyId)).every((entry) => entry.status === 'DELIVERED'));
  assert.equal(await prisma.userNotification.count({ where: { companyId: f.companyId, userId: f.userId } }), 4);
  assert.equal(await prisma.userNotification.count({ where: { companyId: other.companyId } }), 0);
});

integration('published count workflows require the configured reviewer before any stock is posted', async () => {
  const f = await fixture(10);
  registerLocationCompany(f.loc.id, f.companyId);
  const addReviewer = async (role: 'BRANCH_MANAGER' | 'ADMIN', id: string = randomUUID()) => {
    const email = `reviewer-${id}@test.invexa.local`;
    const user = { id, email, companyId: f.companyId, name: 'Count reviewer', passwordHash: 'x', role };
    if (id !== f.userId) await prisma.user.create({ data: { ...user, assignedLocations: JSON.stringify([f.loc.id]) } });
    createEnhancedUser({ ...user, branchIds: [], locationIds: [f.loc.id], status: 'active' });
    return generateJWT(id, f.companyId);
  };
  const [manager, admin, submitter] = await Promise.all([addReviewer('BRANCH_MANAGER'), addReviewer('ADMIN'), addReviewer('ADMIN', f.userId)]);
  const addCount = async (physical: number) => createCountRecord({ ...await pendingCount(f, physical, 10), companyId: f.companyId, status: 'PENDING_REVIEW' });
  const atLimit = await addCount(9);
  const above = await addCount(7);
  const draftOnly = await addCount(6);
  const unpriced = await addCount(9);
  const supplier = await prisma.supplier.create({ data: { name: 'Count cost supplier', companyId: f.companyId } });
  const order = await prisma.purchaseOrder.create({ data: {
    number: `cost-${randomUUID()}`, supplierId: supplier.id, companyId: f.companyId, locationId: f.loc.id, createdById: f.userId,
    lines: { create: { itemId: f.item.id, quantity: 1, unitCost: 100 } },
  } });
  const config = { versionId: randomUUID(), companyId: f.companyId, version: 2, payload: { workflows: [
    { key: 'count.approval', name: 'Count variance', enforce: true, graph: { nodes: [
      { type: 'trigger', config: { event: 'count.created' } },
      { type: 'condition', config: { field: 'value', op: 'lte', amount: 100 } },
      { type: 'approval', config: { role: 'ADMIN' } },
    ] } },
  ] } };
  await prisma.controlPlaneConfig.create({ data: { ...config, kind: 'draft', status: 'draft' } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope, coreRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const approve = async (id: string, token: string) => fetch(`http://127.0.0.1:${address.port}/api/v1/stock-counts/${id}/review`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED', reviewReason: 'Checked the count independently.' }),
  });
  try {
    const draftReview = await approve(draftOnly.id, manager);
    assert.equal(draftReview.status, 200, await draftReview.text());
    await prisma.controlPlaneConfig.create({ data: { ...config, kind: 'published', status: 'published' } });
    const denied = await approve(above.id, manager);
    assert.equal(denied.status, 403, await denied.text());
    const self = await approve(above.id, submitter);
    assert.equal(self.status, 403);
    assert.equal((await self.json()).code, 'SELF_REVIEW');
    assert.equal(await prisma.stockMovement.count({ where: { companyId: f.companyId, sourceDocument: above.id } }), 0);
    const cleared = await approve(atLimit.id, manager);
    assert.equal(cleared.status, 200, await cleared.text());
    await prisma.purchaseOrderLine.updateMany({ where: { purchaseOrderId: order.id }, data: { unitCost: 0 } });
    const unpricedReview = await approve(unpriced.id, manager);
    assert.equal(unpricedReview.status, 403, await unpricedReview.text());
    const approved = await approve(above.id, admin);
    assert.equal(approved.status, 200, await approved.text());
    assert.equal((await approve(above.id, admin)).status, 409);
    const movements = await prisma.stockMovement.findMany({ where: { companyId: f.companyId, sourceDocument: above.id } });
    assert.equal(movements.length, 1);
    const applied = { workflowKey: 'count.approval', configVersion: 2 };
    assert.deepEqual((movements[0].metadata as { workflowPolicy?: unknown }).workflowPolicy, applied);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'STOCK_COUNT_APPROVED', entityId: above.id } });
    assert.deepEqual((audit.metadata as { workflowPolicy?: unknown }).workflowPolicy, applied);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

integration('a failed multi-lot count batch leaves no partial StockCount rows', async () => {
  const f = await fixture(10);
  const valid: CountRecord = {
    id: `count-${randomUUID()}`,
    itemId: f.item.id,
    lotId: f.lot.id,
    locationId: f.loc.id,
    physicalQuantity: 6,
    bookQty: 10,
    mode: 'weight',
    submittedBy: f.userId,
    role: 'ADMIN',
    createdAt: new Date().toISOString(),
    status: 'PENDING_REVIEW',
  };
  const invalid = {
    ...valid,
    id: `count-${randomUUID()}`,
    lotId: `missing-lot-${randomUUID()}`,
    status: 'PENDING_REVIEW' as const,
    reviewedBy: undefined,
    reviewedAt: undefined,
  };

  await assert.rejects(persistCountBatch([valid, invalid], f.companyId));
  assert.equal(await prisma.stockCount.count({ where: { companyId: f.companyId, itemId: f.item.id } }), 0);
});

integration('transfer pick-confirm posts TRANSFER_OUT, blocks insufficient stock atomically, and cannot deduct twice', async () => {
  const f = await fixture(10);
  const transfer = await prisma.transfer.create({
    data: { sourceLocationId: f.loc.id, destinationLocationId: f.dst.id, status: 'REQUESTED', requestedById: f.userId, companyId: f.companyId },
  });
  const tenant = { companyId: f.companyId, tenantId: 'tenant-invexa', userId: f.userId, role: 'ADMIN' as const };
  const other = await fixture(1);
  const otherTenant = { companyId: other.companyId, tenantId: 'tenant-invexa', userId: other.userId, role: 'ADMIN' as const };
  const alloc = (quantity: number) => [{ itemId: f.item.id, lotId: f.lot.id, locationId: f.loc.id, quantity }];

  await assert.rejects(persistConfirmedPickAllocations(transfer.id, alloc(1), otherTenant), /not found/i);
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } })).onHand), 10);
  await assert.rejects(persistConfirmedPickAllocations(transfer.id, alloc(99), tenant), /Insufficient/);
  assert.equal((await prisma.stockMovement.count({ where: { itemId: f.item.id } })), 0, 'nothing posted on a rejected confirm');

  await persistConfirmedPickAllocations(transfer.id, alloc(4), tenant);
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } });
  assert.equal(Number(ledger.onHand), 6);
  const rows = await prisma.stockMovement.findMany({ where: { itemId: f.item.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].movementType, 'TRANSFER_OUT');
  assert.equal(Number(rows[0].qtyDelta), -4);

  await assert.rejects(persistConfirmedPickAllocations(transfer.id, alloc(4), tenant), /already confirmed/);
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.loc.id } })).onHand), 6);
});

integration('the review stores the root-cause reason code with the variance (audit C-3)', async () => {
  const f = await fixture(10);
  const count = { ...(await pendingCount(f, 8, 10)), reasonCode: 'DAMAGE' };
  await persistCountReview(count, f.companyId);
  const row = await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } });
  assert.equal((row as { reasonCode?: string | null }).reasonCode, 'DAMAGE');
});
