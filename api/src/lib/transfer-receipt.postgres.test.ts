// Week 6 / guide Week 13: the destination on-hand leg of a transfer receipt
// posts through InventoryPostingService inside the receipt transaction, so the
// StockMovement journal and the StockLedger projection cannot disagree (the
// old raw upsert wrote no journal row at all). Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from './db.js';
import { findReceiptByRequestId, persistTransferReceipt } from './transfer-receipt.js';
import { persistConfirmedPickAllocations } from './persistence.js';
import type { TenantContext } from './tenant-context.js';
import { createEnhancedUser } from './enterprise-repository.js';
import { generateJWT, issueOfflinePermit, verifyJWT } from './otp-auth.js';
import { controlPlane } from './saas/control-plane.js';
import { enforceOperationalCompanyScope, registerLocationCompany } from './saas/tenant-scope.js';
import transfersRouter from '../routes/transfers.js';
import transferLogisticsRouter from '../routes/transfer-logistics.js';
import { extractToken } from '../routes/enterprise-auth.js';
import { mutationIdempotency } from './mutation-idempotency.js';
import offlineCommandsRouter from '../routes/offline-commands.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeTransfer(requested = 10) {
  const companyId = `xfer-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `xfer-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Xfer', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const src = await prisma.location.create({ data: { id: `src-${randomUUID()}`, code: `src-${randomUUID()}`, name: 'Src', type: 'warehouse', companyId } });
  const dst = await prisma.location.create({ data: { id: `dst-${randomUUID()}`, code: `dst-${randomUUID()}`, name: 'Dst', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `XF-${randomUUID().slice(0, 8)}`, name: 'Xfer item', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  const transfer = await prisma.transfer.create({
    data: { sourceLocationId: src.id, destinationLocationId: dst.id, status: 'DISPATCHED', requestedById: userId, companyId,
      lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: requested }] } },
    include: { lines: true },
  });
  const tenant: TenantContext = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
  return { transfer, item, lot, dst, userId, tenant };
}

const journal = async (itemId: string, locationId: string) => (await prisma.stockMovement.findMany({ where: { itemId, locationId } }));

integration('transfer receipt posts a TRANSFER_IN journal row that matches the ledger, and a retry posts nothing more', async () => {
  const f = await makeTransfer(10);
  const requestId = randomUUID();
  const input = {
    requestId, transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
    lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 7, damagedQty: 1, shortageQty: 2, excessQty: 0 }],
  };
  const first = await persistTransferReceipt(input);
  assert.equal(first?.duplicate, false);
  assert.equal(first?.status, 'PARTIAL_RECEIVED');
  const retry = await persistTransferReceipt(input);
  assert.equal(retry?.duplicate, true);
  await assert.rejects(persistTransferReceipt({
    ...input, lines: [{ ...input.lines[0], receivedQty: 6 }],
  }), { code: 'DUPLICATE_REQUEST' });

  const ledger = await prisma.stockLedger.findMany({ where: { itemId: f.item.id, locationId: f.dst.id } });
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0].onHand), 7);
  assert.equal(Number(ledger[0].quarantine), 1, 'damaged quantity is quarantined, never sellable');
  const rows = await journal(f.item.id, f.dst.id);
  assert.equal(rows.length, 1, 'one journal row despite the retry');
  assert.equal(rows[0].movementType, 'TRANSFER_IN');
  assert.equal(Number(rows[0].qtyDelta), 7);
  assert.equal(rows[0].companyId, f.tenant.companyId);
  assert.equal(rows.reduce((sum, r) => sum + Number(r.qtyDelta), 0), Number(ledger[0].onHand), 'journal sum equals projection');
});

integration('a second partial receipt adds a second journal row and the journal still sums to on-hand', async () => {
  const f = await makeTransfer(10);
  const line = (qty: number, short: number) => [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: qty, damagedQty: 0, shortageQty: short, excessQty: 0 }];
  const base = { transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant };
  await persistTransferReceipt({ ...base, requestId: randomUUID(), lines: line(4, 0) });
  await persistTransferReceipt({ ...base, requestId: randomUUID(), lines: line(6, 0) });
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.dst.id } });
  assert.equal(Number(ledger.onHand), 10);
  const rows = await journal(f.item.id, f.dst.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, r) => sum + Number(r.qtyDelta), 0), 10);
});

integration('concurrent receiving returns one receipt and foreign tenants cannot replay it', async () => {
  const own = await makeTransfer(5);
  const foreign = await makeTransfer(5);
  const requestId = randomUUID();
  const input = {
    requestId, transferId: own.transfer.id, destinationLocationId: own.dst.id, receivedById: own.userId, notes: '', tenant: own.tenant,
    lines: [{ lineId: own.transfer.lines[0].id, itemId: own.item.id, lotId: own.lot.id, receivedQty: 5, damagedQty: 0, shortageQty: 0 }],
  };
  await assert.rejects(persistTransferReceipt({ ...input, tenant: foreign.tenant, receivedById: foreign.userId }), /not found/i);
  const results = await Promise.all(Array.from({ length: 5 }, () => persistTransferReceipt(input)));
  assert.equal(results.filter((result) => result && !result.duplicate).length, 1);
  assert.ok(results.every((result) => result && result.receiptId === results[0]?.receiptId));
  assert.equal((await findReceiptByRequestId(own.tenant, requestId))?.receiptId, results[0]?.receiptId);
  assert.equal(await findReceiptByRequestId(foreign.tenant, requestId), null);
  assert.equal(await findReceiptByRequestId({ ...own.tenant, userId: foreign.userId }, requestId), null);
  assert.equal((await journal(own.item.id, own.dst.id)).length, 1);
  assert.equal((await journal(own.item.id, foreign.dst.id)).length, 0);
});

integration('the receiving route replays a committed receipt without a transfer in the in-memory snapshot', async () => {
  const f = await makeTransfer(5);
  registerLocationCompany(f.dst.id, f.tenant.companyId);
  createEnhancedUser({ id: f.userId, companyId: f.tenant.companyId, email: `${f.userId}@test.invexa.local`, name: 'Receiver',
    passwordHash: 'x', role: 'ADMIN', branchIds: [], locationIds: [f.dst.id], status: 'active' });
  const requestId = randomUUID();
  const lines = [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 5, damagedQty: 0, shortageQty: 0 }];
  const prior = await persistTransferReceipt({ requestId, transferId: f.transfer.id, destinationLocationId: f.dst.id,
    receivedById: f.userId, notes: 'Five checked', tenant: f.tenant, lines });
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, mutationIdempotency(), transfersRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const submit = (body: object, mutationId?: string) => fetch(`http://127.0.0.1:${address.port}/api/v1/transfers/${f.transfer.id}/receive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${generateJWT(f.userId, f.tenant.companyId)}`, 'Content-Type': 'application/json',
      ...(mutationId ? { 'X-Mutation-Id': mutationId } : {}) },
    body: JSON.stringify(body),
  });
  try {
    const result = await submit({ requestId, lines, notes: 'Five checked' }, requestId);
    const body = await result.json();
    assert.equal(result.status, 200, JSON.stringify(body));
    assert.equal(body.duplicate, true);
    assert.equal(body.transfer.status, 'RECEIVED');
    assert.equal(body.receipt.receiptId, prior?.receiptId);
    assert.equal(body.receipt.receivedAt, prior?.receivedAt);
    assert.equal(body.receipt.notes, 'Five checked');
    const offlineRetry = await submit({ requestId, lines, notes: 'Five checked', offlinePermit: 'expired-permit' }, requestId);
    assert.equal(offlineRetry.status, 200);
    assert.equal((await offlineRetry.json()).receipt.receiptId, prior?.receiptId);
    const altered = await submit({ requestId, lines, notes: 'Different notes' });
    assert.equal(altered.status, 409);
    assert.equal((await altered.json()).code, 'DUPLICATE_REQUEST');
    await prisma.transferReceipt.update({ where: { requestId }, data: { requestFingerprint: null } });
    const historical = await submit({ requestId });
    assert.equal(historical.status, 200);
    assert.equal((await historical.json()).receipt.receiptId, prior?.receiptId);
    assert.equal((await journal(f.item.id, f.dst.id)).length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

integration('a carton scan gives the current receive revision and a stale offline receipt cannot change stock', async () => {
  const f = await makeTransfer(6);
  const foreign = await makeTransfer(6);
  for (const own of [f, foreign]) {
    registerLocationCompany(own.dst.id, own.tenant.companyId);
    createEnhancedUser({ id: own.userId, companyId: own.tenant.companyId, email: `${own.userId}@test.invexa.local`, name: 'Receiver',
      passwordHash: 'x', role: 'ADMIN', branchIds: [], locationIds: [own.dst.id], status: 'active' });
  }
  const qrCode = `PKG-${randomUUID()}`;
  await prisma.transferCarton.create({ data: { transferId: f.transfer.id, cartonNumber: '1', qrCode, quantity: 6, status: 'SEALED' } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1', offlineCommandsRouter);
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope, mutationIdempotency(), transfersRouter, transferLogisticsRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const call = (path: string, body?: Record<string, unknown>, actor = f) => fetch(`http://127.0.0.1:${address.port}/api/v1/transfers/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${generateJWT(actor.userId, actor.tenant.companyId)}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  const previousFlag = process.env.CONTROL_PLANE_PERSIST_IN_TESTS;
  try {
    process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
    controlPlane.companies.set(f.tenant.companyId, { ...controlPlane.requireCompany('default-company'), id: f.tenant.companyId });
    const defaults = controlPlane.runtimeConfig(f.tenant.companyId, f.tenant.role);
    const policy = { role: f.tenant.role, offlineMaxHours: 2, syncScope: ['receiving'], navigation: [], encryptedLocalStore: true };
    const versionId = randomUUID();
    const configuration = { page: defaults.page, mobilePolicies: [policy] };
    await prisma.controlPlaneConfig.create({ data: {
      companyId: f.tenant.companyId, kind: 'published', status: 'published', version: 2, versionId, payload: configuration,
    } });
    const scanPath = `by-package/${qrCode.toLowerCase()}`;
    const scan = await call(scanPath);
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    const initial = scan.body.transfer.receiveRevision;
    assert.match(initial, /^[a-f0-9]{64}$/);
    assert.equal((await call(scanPath, undefined, foreign)).status, 404);
    assert.equal((await call('list')).body.transfers.find((row: { id: string }) => row.id === f.transfer.id).receiveRevision, initial);
    const lines = [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 2 }];
    const receive = `${f.transfer.id}/receive`;
    const savedCommand = { requestId: randomUUID(), receiveRevision: initial, lines };
    const wrongScope = issueOfflinePermit(f.userId, f.tenant.companyId, f.tenant.role, 300, 'picks').token;
    const { token } = issueOfflinePermit(f.userId, f.tenant.companyId, f.tenant.role, 300, 'receiving');
    assert.equal(verifyJWT(token), null);
    const denied = await call(receive, { ...savedCommand, offlinePermit: wrongScope });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'OFFLINE_WAREHOUSE_POLICY_REJECTED');
    assert.equal((await journal(f.item.id, f.dst.id)).length, 0);
    const replayCommand = { contractVersion: 2, commandId: savedCommand.requestId, type: 'RECEIVE_CONFIRM',
      entityId: f.transfer.id, revision: initial, permit: token, payload: { lines } };
    const sync = (command: object, actor = f) => fetch(`http://127.0.0.1:${address.port}/api/v1/sync/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${generateJWT(actor.userId, actor.tenant.companyId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    assert.equal((await sync(replayCommand, foreign)).status, 404);
    assert.equal((await sync({ ...replayCommand, contractVersion: 1 })).status, 400);
    const savedResponse = await sync(replayCommand);
    const saved = { status: savedResponse.status, body: await savedResponse.json() };
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const current = (await call(scanPath)).body.transfer.receiveRevision;
    assert.notEqual(current, initial);
    const staleCommand = { ...savedCommand, requestId: randomUUID() };
    const stale = await call(receive, staleCommand);
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, 'TRANSFER_RECEIVE_CHANGED');
    assert.equal(await prisma.transferReceipt.count({ where: { transferId: f.transfer.id } }), 1);
    assert.equal(Number((await journal(f.item.id, f.dst.id))[0].qtyDelta), 2);
    await prisma.controlPlaneConfig.update({ where: { versionId_kind: { versionId, kind: 'published' } },
      data: { payload: { ...configuration, mobilePolicies: [{ ...policy, syncScope: ['stock'] }] } } });
    const revoked = await call(receive, { ...savedCommand, requestId: randomUUID(), receiveRevision: current, offlinePermit: token });
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body.code, 'OFFLINE_WAREHOUSE_POLICY_REJECTED');
    const replay = await call(receive, { ...savedCommand, offlinePermit: token });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.receipt.receiptId, saved.body.receipt.receiptId);
    const replayThroughSync = await sync(replayCommand);
    assert.equal(replayThroughSync.status, 200);
    assert.equal((await replayThroughSync.json()).receipt.receiptId, saved.body.receipt.receiptId);
    const modified = await call(receive, { ...savedCommand, lines: [{ ...lines[0], receivedQty: 3 }] });
    assert.equal(modified.status, 409);
    assert.equal(modified.body.code, 'DUPLICATE_REQUEST');
    assert.equal((await journal(f.item.id, f.dst.id)).length, 1);

    // Distinct commands may reach persistence after both read the same state.
    // Only the first can apply, even though both quantities fit the transfer.
    const competing = await Promise.allSettled(Array.from({ length: 2 }, () => persistTransferReceipt({
      requestId: randomUUID(), expectedRevision: current, transferId: f.transfer.id, destinationLocationId: f.dst.id,
      receivedById: f.userId, notes: '', tenant: f.tenant,
      lines: [{ ...lines[0], damagedQty: 0, shortageQty: 0 }],
    })));
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = competing.find((result) => result.status === 'rejected');
    assert.equal(rejected?.reason.code, 'TRANSFER_RECEIVE_CHANGED');
    assert.equal((await journal(f.item.id, f.dst.id)).reduce((total, row) => total + Number(row.qtyDelta), 0), 4);
  } finally {
    if (previousFlag === undefined) delete process.env.CONTROL_PLANE_PERSIST_IN_TESTS;
    else process.env.CONTROL_PLANE_PERSIST_IN_TESTS = previousFlag;
    controlPlane.companies.delete(f.tenant.companyId);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

integration('a receipt that fails validation leaves no journal row, ledger row or receipt behind', async () => {
  const f = await makeTransfer(5);
  await assert.rejects(persistTransferReceipt({
    requestId: randomUUID(), transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
    lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 50, damagedQty: 0, shortageQty: 0, excessQty: 0 }],
  }));
  assert.equal((await journal(f.item.id, f.dst.id)).length, 0);
  assert.equal(await prisma.stockLedger.count({ where: { itemId: f.item.id, locationId: f.dst.id } }), 0);
  assert.equal(await prisma.transferReceipt.count({ where: { transferId: f.transfer.id } }), 0);
});

integration('in-transit stock is tracked on the source lot from pick-confirm until the receipt settles it (audit O-7)', async () => {
  const f = await makeTransfer(10);
  const srcId = f.transfer.sourceLocationId;
  await prisma.stockLedger.create({ data: { itemId: f.item.id, lotId: f.lot.id, locationId: srcId, onHand: 10, companyId: f.tenant.companyId } });
  await prisma.transfer.update({ where: { id: f.transfer.id }, data: { status: 'PENDING_PICK' as never } });
  const alloc = [{ itemId: f.item.id, lotId: f.lot.id, locationId: srcId, quantity: 10 }];
  await persistConfirmedPickAllocations(f.transfer.id, alloc, f.tenant);
  const afterConfirm = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } });
  assert.equal(Number(afterConfirm.onHand), 0);
  assert.equal(Number(afterConfirm.inTransit), 10, 'the 10 units are in flight, not vanished');
  await assert.rejects(persistConfirmedPickAllocations(f.transfer.id, alloc, f.tenant), /already confirmed/);
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit), 10, 'a rejected replay does not double it');

  await prisma.transfer.update({ where: { id: f.transfer.id }, data: { status: 'DISPATCHED' as never } });
  const receive = (requestId: string, receivedQty: number, shortageQty: number) => persistTransferReceipt({
    requestId, transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
    lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty, damagedQty: 0, shortageQty, excessQty: 0 }],
  });
  await receive(randomUUID(), 6, 0);
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit), 4, 'partial receipt releases only what arrived');
  await receive(randomUUID(), 3, 1);
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit), 0, 'received + short settles the rest');
});

integration('a transfer confirmed before in-transit tracking existed does not disturb another transfer\'s in-transit', async () => {
  const f = await makeTransfer(5);
  const srcId = f.transfer.sourceLocationId;
  await prisma.stockLedger.create({ data: { itemId: f.item.id, lotId: f.lot.id, locationId: srcId, onHand: 0, inTransit: 8, companyId: f.tenant.companyId } });
  await persistTransferReceipt({
    requestId: randomUUID(), transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
    lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 5, damagedQty: 0, shortageQty: 0, excessQty: 0 }],
  });
  assert.equal(Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit), 8);
});
