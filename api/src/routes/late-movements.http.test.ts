import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { counts, createCountRecord, type DailyMovementRecord } from '../lib/repository.js';
import { applyLateMovements } from '../lib/late-movement-service.js';
import { extractToken } from './enterprise-auth.js';
import controlCenterRouter from './import-control-center.js';
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
  app.use('/api/v1', controlCenterRouter);
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

const HOUR = 3_600_000;
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

function salesMovement(key: string, over: Partial<DailyMovementRecord> = {}): DailyMovementRecord {
  return {
    id: `mv-${key}`, dedupeKey: key, itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', movementType: 'SALE_OUT', qtyDelta: -4,
    transactionAt: iso(-3), sourceType: 'SALES', sourceReference: 'INV-9', createdById: 'user-admin-1', ...over,
  };
}

function seedCounts() {
  counts.splice(0, counts.length);
  const pending = createCountRecord({
    id: 'count-pending', itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', physicalQuantity: 24, bookQty: 28, mode: 'manual',
    submittedBy: 'user-store-1', role: 'STORE_USER', createdAt: iso(-1),
  });
  const approved = createCountRecord({
    id: 'count-approved', itemId: 'item-1002', lotId: 'lot-1002', locationId: 'loc-1', physicalQuantity: 26, bookQty: 26, mode: 'manual',
    submittedBy: 'user-store-1', role: 'STORE_USER', createdAt: iso(-1), status: 'APPROVED',
  });
  return { pending, approved };
}

test('a late import recomputes a pending count, flags an approved one, and is idempotent', async () => {
  seedCounts();
  const touched = await applyLateMovements([
    salesMovement('k-before'),
    // After the count was taken: irrelevant to it.
    salesMovement('k-after', { transactionAt: iso(0), qtyDelta: -9 }),
    // Another item's late movement flags that item's approved count without rewriting it.
    salesMovement('k-approved', { itemId: 'item-1002', lotId: 'lot-1002', qtyDelta: -2 }),
    // A different branch is unaffected.
    salesMovement('k-other-branch', { locationId: 'loc-2' }),
  ]);
  assert.equal(touched, 2);

  const pending = counts.find((row) => row.id === 'count-pending')!;
  assert.deepEqual([pending.bookQty, pending.bookQtyOriginal, pending.lateDelta, pending.reconciliationRequired], [24, 28, -4, true]);
  assert.match(pending.reconciliationNote!, /28 -> 24/);
  const approved = counts.find((row) => row.id === 'count-approved')!;
  assert.deepEqual([approved.bookQty, approved.bookQtyOriginal, approved.lateDelta, approved.reconciliationRequired], [26, undefined, -2, true]);

  // The same file uploaded again changes nothing.
  assert.equal(await applyLateMovements([salesMovement('k-before'), salesMovement('k-approved', { itemId: 'item-1002', lotId: 'lot-1002', qtyDelta: -2 })]), 0);
  assert.equal(counts.find((row) => row.id === 'count-pending')!.bookQty, 24);
  // Manual adjustments are not sales/purchase files and never trigger this.
  assert.equal(await applyLateMovements([salesMovement('k-adj', { sourceType: 'ADJUSTMENT' })]), 0);
});

test('approving a recomputed count posts the variance against the corrected book quantity', async () => {
  seedCounts();
  await applyLateMovements([salesMovement('k-1')]);
  await withServer(async (call) => {
    const manager = tokenFor('manager@retail.local');
    // Physical 24 against the corrected book 24 = no variance, not the stale -4... (24 vs 28).
    const list = (await call('GET', '/counts', manager)).body.counts;
    const row = list.find((entry: { id: string }) => entry.id === 'count-pending');
    assert.equal(row.reconciliationRequired, true);
    assert.equal(row.bookQty, 24);
    assert.equal(row.variance, 0);

    const review = await call('PATCH', '/stock-counts/count-pending/review', manager, { status: 'APPROVED', reviewReason: 'Matches corrected book' });
    assert.equal(review.status, 200);
    assert.equal(review.body.count.variance, 0);

    // The store user never sees book quantity or the reconciliation detail.
    const own = (await call('GET', '/counts', tokenFor('store@retail.local'))).body.counts.find((entry: { id: string }) => entry.id === 'count-pending');
    assert.equal('bookQty' in own, false);
    assert.equal('reconciliationRequired' in own, false);
    assert.equal('reconciliationNote' in own, false);
  });
});

test('a reviewer resolves a flag with a note; only count managers may, and only once', async () => {
  seedCounts();
  await applyLateMovements([salesMovement('k-2')]);
  await withServer(async (call) => {
    const manager = tokenFor('manager@retail.local');
    const path = '/stock-counts/count-pending/reconciliation/ack';
    assert.equal((await call('POST', path, tokenFor('store@retail.local'), { note: 'looks fine to me' })).status, 403);
    assert.equal((await call('POST', path, manager, { note: 'no' })).status, 400);
    assert.equal((await call('POST', '/stock-counts/nope/reconciliation/ack', manager, { note: 'looks fine to me' })).status, 404);
    // A count with no open flag has nothing to resolve.
    assert.equal((await call('POST', '/stock-counts/count-approved/reconciliation/ack', manager, { note: 'looks fine to me' })).status, 409);

    const resolved = await call('POST', path, manager, { note: 'Checked the sales file, counts agree' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.count.reconciliationRequired, false);
    assert.match(resolved.body.count.reconciliationNote, /Resolved by user-manager-1/);
    assert.equal(resolved.body.count.lateDelta, -4, 'the recomputed figures stay for the audit trail');
    assert.equal((await call('POST', path, manager, { note: 'Checked the sales file, counts agree' })).status, 409);
  });
});

test('the import control center surfaces counts that need reconciliation', async () => {
  seedCounts();
  await applyLateMovements([salesMovement('k-3'), salesMovement('k-4', { itemId: 'item-1002', lotId: 'lot-1002', qtyDelta: -1 })]);
  await withServer(async (call) => {
    const report = (await call('GET', '/imports/control-center', tokenFor('admin@retail.local'))).body;
    assert.equal(report.reconciliation.required, 2);
    assert.deepEqual(report.reconciliation.counts.map((row: { id: string }) => row.id).sort(), ['count-approved', 'count-pending']);
    const pending = report.reconciliation.counts.find((row: { id: string }) => row.id === 'count-pending');
    assert.deepEqual([pending.bookQtyOriginal, pending.bookQty, pending.lateDelta], [28, 24, -4]);
  });
});
