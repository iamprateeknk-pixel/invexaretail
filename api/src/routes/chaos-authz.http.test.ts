import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { adjustStockLedger, createCountAssignment, createItemRecord, createTransferRecord, ensureLotRecord, findStockLedgerEntry, listCounts } from '../lib/repository.js';
import { extractToken } from './enterprise-auth.js';
import coreRouter from './core.js';
import commandCenterRouter from './command-center.js';
import transferLogisticsRouter from './transfer-logistics.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (method: string, path: string, token: string | null, body?: unknown) => Promise<{ status: number; body: any; text: string; type: string }>;

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
  app.use('/api/v1', transferLogisticsRouter);
  app.use('/api/v1', commandCenterRouter);
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
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON, e.g. a CSV download */ }
    return { status: response.status, body: parsed, text, type: response.headers.get('content-type') ?? '' };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const burst = <T,>(size: number, make: () => Promise<T>) => Promise.all(Array.from({ length: size }, make));

// ---- chaos: the same logical action arrives many times at once --------------------------------------

test('ten simultaneous submits of one count record it once', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const requestId = `chaos-${unique()}`;
    const results = await burst(10, () => call('POST', '/stock-counts', admin, { itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: 3, mode: 'manual', requestId }));
    assert.equal(listCounts().filter((row) => row.requestId === requestId).length, 1);
    assert.ok(results.every((row) => [200, 201, 409].includes(row.status)), results.map((row) => row.status).join());
    assert.equal(results.filter((row) => row.status === 201).length, 1, 'exactly one request created it');
  });
});

test('ten simultaneous weight counts create each lot count once, never a partial set', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const item = createItemRecord({ code: `CH-${unique()}`, name: 'Chaos rice', unit: 'KG', countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true });
    const lots = ['A', 'B', 'C'].map((suffix) => ensureLotRecord(item.id, `L-${unique()}-${suffix}`, null));
    for (const lot of lots) adjustStockLedger(item.id, lot.id, 'loc-1', 2);
    const requestId = `chaos-${unique()}`;
    const results = await burst(10, () => call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5, requestId }));
    const stored = listCounts().filter((row) => row.requestId === requestId);
    assert.equal(stored.length, 3, 'one count per lot, no duplicates');
    assert.deepEqual(stored.map((row) => row.physicalQuantity).sort(), [1, 2, 2]);
    assert.equal(results.filter((row) => row.status === 201).length, 1);
    assert.ok(results.every((row) => [200, 201, 409].includes(row.status)));
  });
});

test('ten simultaneous receipts of one transfer post the stock once', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const store = tokenFor('store@retail.local');
    const id = `tr-${unique()}`;
    createTransferRecord({
      id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'DISPATCHED',
      lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 10 }], createdAt: new Date().toISOString(),
    });
    void admin;
    const before = findStockLedgerEntry('item-1003', 'lot-1003', 'loc-1')?.onHand ?? 0;
    const requestId = `chaos-${unique()}`;
    const results = await burst(10, () => call('POST', `/transfers/${id}/receive`, store, { requestId, lines: [{ itemId: 'item-1003', lotId: 'lot-1003', receivedQty: 10 }] }));
    assert.equal(findStockLedgerEntry('item-1003', 'lot-1003', 'loc-1')?.onHand, before + 10, 'stock posted exactly once');
    assert.equal(results.filter((row) => row.status === 200 && row.body.duplicate === false).length, 1);
    assert.ok(results.every((row) => [200, 409].includes(row.status)), results.map((row) => row.status).join());
  });
});

test('a count for a lot that is already waiting for review is refused, however many times it is tried', async () => {
  await withServer(async (call) => {
    const store = tokenFor('store@retail.local');
    const item = createItemRecord({ code: `PW-${unique()}`, name: 'Pending' });
    adjustStockLedger(item.id, item.lots[0].id, 'loc-1', 4);
    createCountAssignment({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
    const results = await burst(6, () => call('POST', '/stock-counts', store, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 4, mode: 'manual', requestId: `k-${unique()}` }));
    assert.equal(results.filter((row) => row.status === 201).length, 1);
    assert.equal(listCounts().filter((row) => row.itemId === item.id).length, 1);
  });
});

// ---- authorization: who may see the command center and the reports ----------------------------------

test('the command center and reports are refused to anyone who is not management, and to strangers', async () => {
  await withServer(async (call) => {
    const paths = ['/command-center', '/reports/transfer-cycle', '/reports/count-accuracy', '/reports/audit-export', '/ops/metrics'];
    for (const path of paths) assert.equal((await call('GET', path, null)).status, 401, `${path} without a token`);
    for (const email of ['store@retail.local', 'picker@retail.local']) {
      for (const path of paths) assert.equal((await call('GET', path, tokenFor(email))).status, 403, `${path} for ${email}`);
    }
    for (const path of paths.slice(0, 3)) {
      assert.equal((await call('GET', path, tokenFor('manager@retail.local'))).status, 200, `${path} for a branch manager`);
      assert.equal((await call('GET', path, tokenFor('auditor@retail.local'))).status, 200, `${path} for an auditor`);
    }
    // The audit trail export is narrower: no branch manager.
    assert.equal((await call('GET', '/reports/audit-export', tokenFor('manager@retail.local'))).status, 403);
    assert.equal((await call('GET', '/reports/audit-export', tokenFor('auditor@retail.local'))).status, 200);
    // Operational metrics are admin-only.
    assert.equal((await call('GET', '/ops/metrics', tokenFor('manager@retail.local'))).status, 403);
    assert.equal((await call('GET', '/ops/metrics', tokenFor('auditor@retail.local'))).status, 403);
    const metrics = await call('GET', '/ops/metrics', tokenFor('admin@retail.local'));
    assert.equal(metrics.status, 200);
    assert.equal(typeof metrics.body.process.rssMb, 'number');
  });
});

test('a branch manager sees only their own branch in the command center', async () => {
  await withServer(async (call) => {
    const manager = await call('GET', '/command-center', tokenFor('manager@retail.local'));
    const ids = manager.body.commandCenter.branchHealth.map((row: { locationId: string }) => row.locationId);
    assert.deepEqual(ids, ['loc-1']);
    const admin = await call('GET', '/command-center', tokenFor('admin@retail.local'));
    assert.ok(admin.body.commandCenter.branchHealth.length > 1);
  });
});

test('the audit export is a CSV download that can be filtered', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const requestId = `csv-${unique()}`;
    const item = createItemRecord({ code: `CSV-${unique()}`, name: 'Audit item' });
    adjustStockLedger(item.id, item.lots[0].id, 'loc-1', 2);
    const made = await call('POST', '/stock-counts', admin, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 2, mode: 'manual', requestId });
    assert.equal(made.status, 201);
    const csv = await call('GET', '/reports/audit-export?action=STOCK_COUNT_SUBMITTED', admin);
    assert.equal(csv.status, 200);
    assert.match(csv.type, /text\/csv/);
    const lines = csv.text.split('\r\n');
    assert.match(lines[0], /"When","Actor"/);
    assert.ok(lines.some((line) => line.includes('STOCK_COUNT_SUBMITTED') && line.includes(made.body.count.id)));
    const none = await call('GET', '/reports/audit-export?format=json&action=NO_SUCH_ACTION', admin);
    assert.equal(none.body.count, 0);
    const byEntity = await call('GET', `/reports/audit-export?format=json&entityId=${made.body.count.id}`, admin);
    assert.equal(byEntity.body.count, 1);
  });
});
