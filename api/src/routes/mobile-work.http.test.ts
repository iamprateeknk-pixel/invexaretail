import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { adjustStockLedger, createCountAssignment, createItemRecord, ensureLotRecord, listCounts } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
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

// A loose-weight item with three 2 kg lots at loc-1 (the blueprint §13.2 example).
function weightItem(tag: string) {
  const item = createItemRecord({ code: `KG-${tag}`, name: `Loose rice ${tag}`, unit: 'KG', countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true });
  const lots = ['A', 'B', 'C'].map((suffix) => ensureLotRecord(item.id, `KG-${tag}-${suffix}`, null));
  for (const lot of lots) adjustStockLedger(item.id, lot.id, 'loc-1', 2);
  return { item, lots };
}

test('a retried count with the same requestId is recorded once', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const key = `req-${unique()}`;
    const body = { itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: 7, mode: 'manual', requestId: key };
    const first = await call('POST', '/stock-counts', admin, body);
    assert.equal(first.status, 201);
    const again = await call('POST', '/stock-counts', admin, body);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.count.id, first.body.count.id);
    assert.equal(listCounts().filter((count) => count.requestId === key).length, 1);
  });
});

test('piece items only take whole-number counts', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const fraction = await call('POST', '/stock-counts', admin, { itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: 2.5, mode: 'manual' });
    assert.equal(fraction.status, 400);
    assert.match(fraction.body.message, /whole units/);
    const { item } = weightItem(unique());
    // A weight item may be counted lot by lot with decimals.
    const lot = item.lots[0];
    assert.equal((await call('POST', '/stock-counts', admin, { itemId: item.id, locationId: 'loc-1', lotNo: lot.lotNo, physicalQuantity: 1.5, mode: 'manual' })).status, 201);
  });
});

test('a store user cannot count a lot that has no stock, and never sees book quantity', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const tag = unique();
    const item = createItemRecord({ code: `ZS-${tag}`, name: `Zero stock ${tag}` });
    adjustStockLedger(item.id, item.lots[0].id, 'loc-1', 0);
    createCountAssignment({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });

    const rejected = await call('POST', '/stock-counts', store, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 1, mode: 'manual' });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.message, /no stock/);

    // The same lot is still countable by an admin (maintenance), and a store user's normal count is blind.
    assert.equal((await call('POST', '/stock-counts', admin, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 1, mode: 'manual' })).status, 201);
    createCountAssignment({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: 'item-1004', assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
    const ok = await call('POST', '/stock-counts', store, { itemId: 'item-1004', locationId: 'loc-1', physicalQuantity: 5, mode: 'manual' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.count.bookQty, undefined);
    assert.equal(ok.body.count.variance, undefined);
  });
});

test('a weight count is allocated over lots by the server and stays blind for a store user', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const tag = unique();
    const { item, lots } = weightItem(tag);

    // Lot items cannot be counted by weight.
    assert.equal((await call('POST', '/stock-counts/weight', admin, { itemId: 'item-1001', locationId: 'loc-1', totalQuantity: 3 })).status, 400);
    assert.equal((await call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1', totalQuantity: -1 })).status, 400);
    assert.equal((await call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1' })).status, 400);
    // A store user needs an assignment.
    assert.equal((await call('POST', '/stock-counts/weight', store, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5 })).status, 403);

    createCountAssignment({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
    const key = `w-${tag}`;
    const submitted = await call('POST', '/stock-counts/weight', store, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5, requestId: key });
    assert.equal(submitted.status, 201);
    assert.deepEqual(submitted.body, { success: true, lots: 3 }, 'no book quantity, variance or split reaches a store user');

    // The split is what an admin sees: 2 + 2 + 1, variance -1.
    const stored = listCounts().filter((count) => count.requestId === key);
    assert.deepEqual(lots.map((lot) => stored.find((count) => count.lotId === lot.id)?.physicalQuantity), [2, 2, 1]);
    assert.ok(stored.every((count) => count.mode === 'weight' && count.bookQty === 2));

    // The task is closed and a retry is a no-op.
    const mine = (await call('GET', '/count-assignments/mine', store)).body.assignments as Array<{ itemId: string }>;
    assert.equal(mine.some((row) => row.itemId === item.id), false);
    const retry = await call('POST', '/stock-counts/weight', store, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5, requestId: key });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.equal(listCounts().filter((count) => count.requestId === key).length, 3);
  });
});

test('a manager sees the allocation and total variance of a weight count', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { item } = weightItem(unique());
    const result = await call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5.5 });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body.allocation.map((row: { physicalQuantity: number }) => row.physicalQuantity), [2, 2, 1.5]);
    assert.equal(result.body.totalVariance, -0.5);
    assert.equal(result.body.counts[0].variance, 0);
    // An excess lands on the last lot.
    const { item: other } = weightItem(unique());
    const excess = await call('POST', '/stock-counts/weight', admin, { itemId: other.id, locationId: 'loc-1', totalQuantity: 7 });
    assert.deepEqual(excess.body.allocation.map((row: { physicalQuantity: number }) => row.physicalQuantity), [2, 2, 3]);
    assert.equal(excess.body.totalVariance, 1);
  });
});

test('mobile work lists only actionable count tasks, with no quantities', async () => {
  await withServer(async (call) => {
    const store = tokenFor('store@retail.local');
    const tag = unique();
    const { item, lots } = weightItem(tag);
    // A second lot with no stock must not be offered.
    const empty = ensureLotRecord('item-1005', `EMPTY-${tag}`, null);
    adjustStockLedger('item-1005', empty.id, 'loc-1', 0);
    const zero = createItemRecord({ code: `Z-${tag}`, name: `Zero ${tag}` });
    adjustStockLedger(zero.id, zero.lots[0].id, 'loc-1', 0);
    for (const itemId of [item.id, zero.id, 'item-1005']) {
      createCountAssignment({ id: `asg-${unique()}`, locationId: 'loc-1', itemId, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
    }

    const work = await call('GET', '/mobile/work', store);
    assert.equal(work.status, 200);
    const tasks = work.body.countTasks as Array<{ item: { id: string; countMethod: string; decimalQuantity: boolean }; lots: Array<{ lotId: string; lotNo: string }> }>;
    assert.equal(tasks.some((task) => task.item.id === zero.id), false, 'zero-stock item is not a task');
    const weight = tasks.find((task) => task.item.id === item.id)!;
    assert.deepEqual([weight.item.countMethod, weight.item.decimalQuantity, weight.lots.length], ['ITEM_WEIGHT', true, lots.length]);
    const rice = tasks.find((task) => task.item.id === 'item-1005')!;
    assert.equal(rice.lots.some((lot) => lot.lotId === empty.id), false, 'zero-stock lot is not offered');
    assert.doesNotMatch(JSON.stringify(work.body), /bookQty|onHand|variance/);

    // Only store users have count tasks; receive tasks are branch scoped.
    assert.deepEqual((await call('GET', '/mobile/work', tokenFor('admin@retail.local'))).body.countTasks, []);
    assert.ok(Array.isArray(work.body.receiveTasks));
  });
});

// audit: mobile app issue - "count completed on the phone, but still shows pending" - a multi-lot
// item's assignment only closes once every lot with stock has been counted (the mobile app used to
// assume the first lot submitted always closed it and hid the assignment locally, leaving it stuck
// ASSIGNED on the server with no way to reach the remaining lots from the app again).
test('a multi-lot item\'s assignment stays open until every lot is counted, then closes', async () => {
  await withServer(async (call) => {
    const store = tokenFor('store@retail.local');
    const tag = unique();
    const item = createItemRecord({ code: `ML-${tag}`, name: `Multi lot ${tag}` });
    const lotA = item.lots[0];
    const lotB = ensureLotRecord(item.id, `ML-${tag}-B`, null);
    adjustStockLedger(item.id, lotA.id, 'loc-1', 5);
    adjustStockLedger(item.id, lotB.id, 'loc-1', 3);
    createCountAssignment({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });

    const firstLot = await call('POST', '/stock-counts', store, { itemId: item.id, locationId: 'loc-1', lotNo: lotA.lotNo, physicalQuantity: 5, mode: 'manual' });
    assert.equal(firstLot.status, 201, JSON.stringify(firstLot.body));
    const afterFirst = (await call('GET', '/count-assignments/mine', store)).body.assignments as Array<{ itemId: string }>;
    assert.equal(afterFirst.some((row) => row.itemId === item.id), true, 'lot B still has stock and has not been counted - the assignment must stay open');
    const workAfterFirst = (await call('GET', '/mobile/work', store)).body.countTasks as Array<{ item: { id: string }; lots: Array<{ lotNo: string }> }>;
    const remainingTask = workAfterFirst.find((task) => task.item.id === item.id);
    assert.ok(remainingTask, 'the work feed must still offer this item so the app can guide the user to the next lot');
    assert.ok(remainingTask!.lots.some((lot) => lot.lotNo === lotB.lotNo), 'lot B, not yet counted, is still offered');

    const secondLot = await call('POST', '/stock-counts', store, { itemId: item.id, locationId: 'loc-1', lotNo: lotB.lotNo, physicalQuantity: 3, mode: 'manual' });
    assert.equal(secondLot.status, 201, JSON.stringify(secondLot.body));
    const afterSecond = (await call('GET', '/count-assignments/mine', store)).body.assignments as Array<{ itemId: string }>;
    assert.equal(afterSecond.some((row) => row.itemId === item.id), false, 'every lot with stock is now counted - the assignment must close');
  });
});

test('warehouse pickers are also assigned counts, and their own work feed offers them (audit: mobile app gap)', async () => {
  await withServer(async (call) => {
    const picker = tokenFor('picker@retail.local');
    const tag = unique();
    const item = createItemRecord({ code: `WP-${tag}`, name: `Warehouse count ${tag}` });
    adjustStockLedger(item.id, item.lots[0].id, 'wh-1', 4);
    createCountAssignment({ id: `asg-${unique()}`, locationId: 'wh-1', itemId: item.id, assignedToId: 'user-picker-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });

    const mine = (await call('GET', '/count-assignments/mine', picker)).body.assignments as Array<{ itemId: string }>;
    assert.equal(mine.some((row) => row.itemId === item.id), true);
    const work = (await call('GET', '/mobile/work', picker)).body.countTasks as Array<{ item: { id: string } }>;
    assert.equal(work.some((task) => task.item.id === item.id), true, 'the picker\'s own work feed must include their assigned counts');

    const submitted = await call('POST', '/stock-counts', picker, { itemId: item.id, locationId: 'wh-1', physicalQuantity: 4, mode: 'manual' });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.count.bookQty, undefined, 'a picker\'s count is blind, same as a store user\'s');
  });
});
