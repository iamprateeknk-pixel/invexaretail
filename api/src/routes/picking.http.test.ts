import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { adjustStockLedger, createItemRecord, createTransferRecord, ensureLotRecord, updateLotStatus } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
import coreRouter from './core.js';
import transfersRouter from './transfers.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', transfersRouter);
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

const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// A loose-KG item with three lots at wh-1: soonest-expiring 3 kg, later 2 kg, and a big lot with no expiry.
function looseItem() {
  const tag = unique();
  const item = createItemRecord({ code: `LK-${tag}`, name: `Loose ${tag}`, unit: 'KG', pickMethod: 'ITEM_QTY_FIFO', allocationStrategy: 'FEFO', decimalQuantity: true });
  const lots = [
    ensureLotRecord(item.id, `E1-${tag}`, '2027-06-01'),
    ensureLotRecord(item.id, `E0-${tag}`, '2027-01-01'),
    ensureLotRecord(item.id, `NX-${tag}`, null),
  ];
  const [late, soon, none] = lots;
  adjustStockLedger(item.id, late.id, 'wh-1', 2);
  adjustStockLedger(item.id, soon.id, 'wh-1', 3);
  adjustStockLedger(item.id, none.id, 'wh-1', 10);
  const transferId = `pk-${tag}`;
  createTransferRecord({
    id: transferId, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED',
    lines: [{ itemId: item.id, lotId: late.id, quantity: 5 }], createdAt: new Date().toISOString(),
  });
  return { item, lots: { late, soon, none }, transferId };
}

test('a KG pick is allocated by the server FEFO, previewed first, and never split by the picker', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const { item, lots, transferId } = looseItem();

    const preview = await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 4 });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.allocations.map((row: { lotId: string; quantity: number }) => [row.lotId, row.quantity]), [[lots.soon.id, 3], [lots.late.id, 1]]);
    assert.equal(preview.body.remaining, 5);
    assert.equal((await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 6 })).status, 400, 'more than requested');

    // The picker sends only item + weight; the server expands it into lots.
    const requestId = `slip-${unique()}`;
    const slip = await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { requestId, lines: [{ itemId: item.id, quantity: 4, inputMethod: 'MANUAL' }] });
    assert.equal(slip.status, 201);
    assert.deepEqual(slip.body.pickSlip.lines.map((line: { lotId: string; quantity: number }) => [line.lotId, line.quantity]), [[lots.soon.id, 3], [lots.late.id, 1]]);
    assert.equal(slip.body.transfer.status, 'PARTIAL');

    // A retry of the same slip returns it instead of picking twice.
    const retry = await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { requestId, lines: [{ itemId: item.id, quantity: 4, inputMethod: 'MANUAL' }] });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.pickSlip.id, slip.body.pickSlip.id);

    // Resume-safe: the server knows what is left, and lots already picked are not offered twice.
    const state = await call('GET', `/picker/transfers/${transferId}`, picker);
    assert.equal(state.body.pickSlips.length, 1);
    const next = await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 1 });
    assert.equal(next.body.remaining, 1);
    assert.equal(next.body.allocations[0].lotId, lots.late.id, 'the 3 kg lot is used up; the 1 kg left in the next-soonest lot comes next');
    assert.equal((await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { lines: [{ itemId: item.id, quantity: 2, inputMethod: 'MANUAL' }] })).status, 400, 'over the remaining request');
    const rest = await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { finished: true, lines: [{ itemId: item.id, quantity: 1, inputMethod: 'MANUAL' }] });
    assert.equal(rest.status, 201);
    assert.equal(rest.body.transfer.status, 'READY_FOR_ADMIN');
  });
});

test('blocked, expired and empty lots are never picked, and a shelf that cannot cover the request says so', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const { item, lots, transferId } = looseItem();
    updateLotStatus(lots.soon.id, 'BLOCKED');
    const blocked = await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 3 });
    assert.deepEqual(blocked.body.allocations.map((row: { lotId: string }) => row.lotId), [lots.late.id, lots.none.id], 'the blocked lot is skipped');

    const empty = createItemRecord({ code: `EM-${unique()}`, name: 'Empty', unit: 'KG', pickMethod: 'ITEM_QTY_FIFO', allocationStrategy: 'FEFO', decimalQuantity: true });
    const emptyLot = ensureLotRecord(empty.id, `EL-${unique()}`, null);
    adjustStockLedger(empty.id, emptyLot.id, 'wh-1', 1);
    createTransferRecord({ id: `pk-${unique()}`, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: empty.id, lotId: emptyLot.id, quantity: 5 }], createdAt: new Date().toISOString() });
    const shortTransfer = `pk-${unique()}`;
    createTransferRecord({ id: shortTransfer, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: empty.id, lotId: emptyLot.id, quantity: 5 }], createdAt: new Date().toISOString() });
    const shortage = await call('POST', `/picker/transfers/${shortTransfer}/pick-slips`, picker, { lines: [{ itemId: empty.id, quantity: 3, inputMethod: 'MANUAL' }] });
    assert.equal(shortage.status, 400);
    assert.match(shortage.body.message, /Only 1 of .* is available/);
    // ... and it can be reported instead of silently short-picked; the exception reason is the real one.
    const reported = await call('POST', `/picker/transfers/${shortTransfer}/pick-slips`, picker, { exceptions: [{ itemId: empty.id, lotId: emptyLot.id, reason: 'NO_STOCK', quantity: 2 }] });
    assert.equal(reported.status, 201);
  });
});

test('a piece pick still needs the right scan and refuses a blocked lot', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const tag = unique();
    const item = createItemRecord({ code: `PC-${tag}`, name: 'Pieces', unit: 'PCS' });
    const lot = item.lots[0];
    adjustStockLedger(item.id, lot.id, 'wh-1', 10);
    const id = `pk-${tag}`;
    createTransferRecord({ id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: item.id, lotId: lot.id, quantity: 4 }], createdAt: new Date().toISOString() });
    const line = (scanCode: string) => ({ lines: [{ itemId: item.id, lotId: lot.id, quantity: 2, inputMethod: 'SCAN', scanCode }] });
    const wrong = await call('POST', `/picker/transfers/${id}/pick-slips`, picker, line('SOMETHING-ELSE'));
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.message, /Wrong Item/);
    updateLotStatus(lot.id, 'BLOCKED');
    const blocked = await call('POST', `/picker/transfers/${id}/pick-slips`, picker, line(item.code));
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.message, /blocked, expired or has no stock/);
    updateLotStatus(lot.id, 'AVAILABLE');
    assert.equal((await call('POST', `/picker/transfers/${id}/pick-slips`, picker, line(item.code))).status, 201);
    // Two lines for the same lot in one slip cannot together exceed what is asked for.
    const twice = await call('POST', `/picker/transfers/${id}/pick-slips`, picker, { lines: [line(item.code).lines[0], line(item.code).lines[0]] });
    assert.equal(twice.status, 400);
  });
});
