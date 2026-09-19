import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { createTransferRecord, findStockLedgerEntry, listTransfers } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
import logisticsRouter from './transfer-logistics.js';
import coreRouter from './core.js';
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
  app.use('/api/v1', logisticsRouter);
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

const unique = () => Math.random().toString(36).slice(2, 8);

// wh-1 -> loc-1, 10 x item-1003 and 5 x item-1001, already confirmed (stock left the source).
function confirmedTransfer(id = `tr-${unique()}`) {
  createTransferRecord({
    id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'CONFIRMED',
    lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 10 }, { itemId: 'item-1001', lotId: 'lot-1001', quantity: 5 }],
    createdAt: new Date().toISOString(),
  });
  return id;
}

const carton = (lines: Array<[string, string, number]>, extra: object = {}) => ({
  lines: lines.map(([itemId, lotId, quantity]) => ({ itemId, lotId, quantity })), ...extra,
});

test('packing re-verifies cartons, refuses a mismatch, and only completes when every line is packed', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const id = confirmedTransfer();

    const state = await call('GET', `/transfers/${id}/pack`, picker);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body.expected.map((row: { requestedQty: number }) => row.requestedQty).sort((a: number, b: number) => a - b), [5, 10]);
    assert.equal(state.body.canComplete, false);

    // A carton with more than was picked, or an item that is not on the transfer, is not sealed.
    const over = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 11]]));
    assert.equal(over.status, 409);
    assert.equal(over.body.mismatches[0].kind, 'OVER');
    const stranger = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1002', 'lot-1002', 1]]));
    assert.equal(stranger.status, 409);
    assert.equal(stranger.body.mismatches[0].kind, 'UNEXPECTED');
    assert.equal((await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 0]]))).status, 400);

    // Completing early is refused.
    const early = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 6]], { weightKg: 4.2, requestId: 'c1' }));
    assert.equal(early.status, 201);
    assert.match(early.body.carton.packageId, /^PKG-.{6}-01$/);
    assert.equal((await call('POST', `/transfers/${id}/pack/complete`, picker)).status, 409);

    // The same request again does not seal a second carton.
    const retry = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 6]], { requestId: 'c1' }));
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.cartons.filter((row: { status: string }) => row.status === 'SEALED').length, 1);

    // A second carton finishes the job; a voided carton no longer counts.
    const second = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 4], ['item-1001', 'lot-1001', 5]]));
    assert.equal(second.status, 201);
    assert.equal(second.body.verification.readyToSeal, true);
    const voided = await call('POST', `/transfers/${id}/cartons/${second.body.carton.id}/void`, picker);
    assert.equal(voided.body.verification.readyToSeal, false);
    const third = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 4], ['item-1001', 'lot-1001', 5]]));
    assert.equal(third.body.carton.packageId.endsWith('-03'), true);

    const done = await call('POST', `/transfers/${id}/pack/complete`, picker);
    assert.equal(done.status, 200);
    assert.equal(done.body.packing.cartonCount, 2);
    assert.equal(listTransfers().find((row) => row.id === id)?.cartonCount, 2);
    // Sealed packing is final.
    assert.equal((await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 1]]))).status, 409);
  });
});

test('dispatch needs finished packing and a carrier, records the details, and flags a late arrival', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const admin = tokenFor('admin@retail.local');
    const id = confirmedTransfer();

    // Not packed yet.
    assert.equal((await call('POST', `/transfers/${id}/dispatch`, admin, { vehicleNo: 'MH12AB1234' })).status, 409);
    for (const lines of [[['item-1003', 'lot-1003', 10]], [['item-1001', 'lot-1001', 5]]] as Array<Array<[string, string, number]>>) {
      assert.equal((await call('POST', `/transfers/${id}/cartons`, picker, carton(lines))).status, 201);
    }
    // The legacy status route also refuses to skip a started-but-unfinished packing.
    assert.equal((await call('PATCH', `/transfers/${id}/status`, admin, { status: 'DISPATCHED' })).status, 409);
    assert.equal((await call('POST', `/transfers/${id}/pack/complete`, picker)).status, 200);

    // A picker cannot dispatch; a carrier/vehicle/AWB is required.
    assert.equal((await call('POST', `/transfers/${id}/dispatch`, picker, { vehicleNo: 'X' })).status, 403);
    const bare = await call('POST', `/transfers/${id}/dispatch`, admin, {});
    assert.equal(bare.status, 400);
    assert.match(bare.body.message, /vehicle number, courier or AWB/);

    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const sent = await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'BlueDart', awb: 'AWB-77', expectedArrivalAt: soon });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.transfer.status, 'DISPATCHED');
    assert.equal(sent.body.transfer.dispatch.awb, 'AWB-77');
    const again = await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'BlueDart', awb: 'AWB-77' });
    assert.equal(again.body.duplicate, true);

    const tracking = await call('GET', `/transfers/${id}/tracking`, admin);
    assert.equal(tracking.body.delayed, false);
    assert.equal(tracking.body.cartons.length, 2);

    // Past its promised arrival and not received: delayed.
    const late = confirmedTransfer();
    for (const lines of [[['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]] as Array<Array<[string, string, number]>>) {
      await call('POST', `/transfers/${late}/cartons`, picker, carton(lines));
    }
    await call('POST', `/transfers/${late}/pack/complete`, picker);
    await call('POST', `/transfers/${late}/dispatch`, admin, { vehicleNo: 'KA01', expectedArrivalAt: new Date(Date.now() - 3_600_000).toISOString() });
    assert.equal((await call('GET', `/transfers/${late}/tracking`, admin)).body.delayed, true);
    const listed = (await call('GET', '/transfers/list', admin)).body.transfers.find((row: { id: string }) => row.id === late);
    assert.equal(listed.delayed, true);
    assert.equal(listed.cartons.length, 1);
  });
});

test('a carton code leads the destination to its transfer', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const store = tokenFor('store@retail.local');
    const id = confirmedTransfer();
    const sealed = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
    const found = await call('GET', `/transfers/by-package/${sealed.body.carton.packageId.toLowerCase()}`, store);
    assert.equal(found.status, 200);
    assert.equal(found.body.transfer.id, id);
    assert.equal((await call('GET', '/transfers/by-package/PKG-NOPE-01', store)).status, 404);
  });
});

test('a receive retried after a timeout returns the first result and posts destination stock once', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const id = confirmedTransfer();
    await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
    await call('POST', `/transfers/${id}/pack/complete`, picker);
    assert.equal((await call('POST', `/transfers/${id}/dispatch`, admin, { vehicleNo: 'GJ05' })).status, 200);

    const before = findStockLedgerEntry('item-1003', 'lot-1003', 'loc-1')?.onHand ?? 0;
    const requestId = `rcv-${unique()}`;
    const body = {
      requestId,
      lines: [
        { itemId: 'item-1003', lotId: 'lot-1003', receivedQty: 10 },
        { itemId: 'item-1001', lotId: 'lot-1001', receivedQty: 5 },
      ],
    };
    const first = await call('POST', `/transfers/${id}/receive`, store, body);
    assert.equal(first.status, 200);
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.receipt.status, 'RECEIVED');
    assert.equal(findStockLedgerEntry('item-1003', 'lot-1003', 'loc-1')?.onHand, before + 10);

    // The transfer is now fully received, yet the retry still gets the recorded result.
    const retry = await call('POST', `/transfers/${id}/receive`, store, body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.receipt.receivedQty, 15);
    assert.equal(findStockLedgerEntry('item-1003', 'lot-1003', 'loc-1')?.onHand, before + 10, 'no second posting');

    // A different request against the finished transfer is an ordinary error, and the key cannot be reused elsewhere.
    assert.equal((await call('POST', `/transfers/${id}/receive`, store, { ...body, requestId: `rcv-${unique()}` })).status, 400);
    const other = confirmedTransfer();
    assert.equal((await call('POST', `/transfers/${other}/receive`, store, body)).status, 409);
  });
});

test('a partial receipt keeps the transfer open and a retry of it still posts once', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const id = confirmedTransfer();
    await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
    await call('POST', `/transfers/${id}/pack/complete`, picker);
    await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'Local van' });

    const before = findStockLedgerEntry('item-1001', 'lot-1001', 'loc-1')?.onHand ?? 0;
    const requestId = `rcv-${unique()}`;
    const partial = { requestId, lines: [{ itemId: 'item-1001', lotId: 'lot-1001', receivedQty: 3, shortageQty: 2 }] };
    const first = await call('POST', `/transfers/${id}/receive`, store, partial);
    assert.equal(first.status, 200);
    assert.equal(first.body.receipt.status, 'PARTIAL_RECEIVED');
    const retry = await call('POST', `/transfers/${id}/receive`, store, partial);
    assert.equal(retry.body.duplicate, true);
    assert.equal(findStockLedgerEntry('item-1001', 'lot-1001', 'loc-1')?.onHand, before + 3);
    assert.equal(listTransfers().find((row) => row.id === id)?.status, 'PARTIAL_RECEIVED');
  });
});
