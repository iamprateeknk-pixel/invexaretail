import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { recordDailyMovement, dailyMovements } from '../lib/repository.js';
import { todayFor } from '../lib/import-control-center.js';
import { extractToken } from './enterprise-auth.js';
import controlCenterRouter from './import-control-center.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (path: string, token: string) => Promise<{ status: number; body: any }>;

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
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call: Api = async (path, token) => {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) as any };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function sale(locationId: string, transactionAt: string, sourceType: 'SALES' | 'PURCHASE' = 'SALES') {
  recordDailyMovement({
    id: `mv-${Math.random().toString(36).slice(2, 8)}`, dedupeKey: `k-${Math.random()}`, itemId: 'item-1001', lotId: 'lot-1001', locationId,
    movementType: sourceType === 'SALES' ? 'SALE_OUT' : 'PURCHASE_IN', qtyDelta: sourceType === 'SALES' ? -1 : 5, transactionAt,
    sourceType, sourceReference: 'INV-1', importBatchId: 'batch-x', createdById: 'user-admin-1',
  });
}

test('the control center reports each branch\'s day as uploaded, partial or missing', async () => {
  dailyMovements.splice(0, dailyMovements.length);
  const now = new Date();
  const today = todayFor('Asia/Kolkata', now);
  sale('loc-1', now.toISOString());
  sale('wh-1', now.toISOString(), 'PURCHASE');
  // Yesterday's file must not count toward today.
  sale('loc-2', new Date(now.getTime() - 36 * 3_600_000).toISOString());

  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const report = (await call('/imports/control-center', admin)).body;
    assert.equal(report.date, today);
    assert.equal(report.timezone, 'Asia/Kolkata');
    const status = (locationId: string) => report.sales.branches.find((row: { locationId: string }) => row.locationId === locationId)?.status;
    assert.equal(status('loc-1'), 'UPLOADED');
    assert.equal(status('loc-2'), 'MISSING');
    assert.equal(report.sales.status, 'PARTIAL');
    assert.equal(report.purchases.status, 'UPLOADED');
    assert.deepEqual(report.purchases.branches.map((row: { locationId: string }) => row.locationId), ['wh-1']);
    assert.ok(report.window.from < report.window.to);
    assert.ok(Array.isArray(report.checkpoints));

    // Looking at yesterday moves the window: now loc-2 is in and loc-1 is not.
    const yesterday = todayFor('Asia/Kolkata', new Date(now.getTime() - 36 * 3_600_000));
    const past = (await call(`/imports/control-center?date=${yesterday}`, admin)).body;
    assert.equal(past.sales.branches.find((row: { locationId: string }) => row.locationId === 'loc-2').status, 'UPLOADED');
    assert.equal(past.sales.branches.find((row: { locationId: string }) => row.locationId === 'loc-1').status, 'MISSING');

    assert.equal((await call('/imports/control-center?date=18-09-2026', admin)).status, 400);
    assert.equal((await call('/imports/control-center?timezone=Mars/Base', admin)).status, 400);
  });
});

test('access follows role and branch', async () => {
  dailyMovements.splice(0, dailyMovements.length);
  sale('loc-1', new Date().toISOString());
  await withServer(async (call) => {
    assert.equal((await call('/imports/control-center', tokenFor('store@retail.local'))).status, 403);
    assert.equal((await call('/imports/control-center', tokenFor('picker@retail.local'))).status, 403);
    assert.equal((await call('/imports/control-center', tokenFor('auditor@retail.local'))).status, 200);

    // A branch manager only sees the branches assigned to them.
    const manager = (await call('/imports/control-center', tokenFor('manager@retail.local'))).body;
    assert.deepEqual(manager.sales.branches.map((row: { locationId: string }) => row.locationId), ['loc-1']);
    assert.deepEqual(manager.checkpoints.map((row: { locationId: string }) => row.locationId), ['loc-1']);
  });
});
