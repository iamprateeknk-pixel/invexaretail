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
import { generateJWT } from './otp-auth.js';
import { registerLocationCompany } from './saas/tenant-scope.js';
import transfersRouter from '../routes/transfers.js';

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
  app.use('/api/v1', transfersRouter);
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const result = await fetch(`http://127.0.0.1:${address.port}/api/v1/transfers/${f.transfer.id}/receive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${generateJWT(f.userId, f.tenant.companyId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, lines, notes: 'Five checked' }),
    });
    const body = await result.json();
    assert.equal(result.status, 200, JSON.stringify(body));
    assert.equal(body.duplicate, true);
    assert.equal(body.transfer.status, 'RECEIVED');
    assert.equal(body.receipt.receiptId, prior?.receiptId);
    assert.equal(body.receipt.receivedAt, prior?.receivedAt);
    assert.equal(body.receipt.notes, 'Five checked');
    assert.equal((await journal(f.item.id, f.dst.id)).length, 1);
  } finally {
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
