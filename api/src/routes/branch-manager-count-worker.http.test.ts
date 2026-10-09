import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { countAssignments } from '../lib/repository.js';
import { resetCampaignStateForTests } from '../lib/campaign-store.js';
import { extractToken } from './enterprise-auth.js';
import campaignsRouter from './campaigns.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

// Branch managers can be handed stock-take work like store users and pickers:
// assigned, listed as their own tasks (web + mobile feed), counted, and never
// approved by the same person who counted it.

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (call: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  resetCampaignStateForTests();
  countAssignments.splice(0, countAssignments.length);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', campaignsRouter);
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

test('an admin can assign a stock count to a branch manager, who sees and counts it but cannot approve it', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const manager = tokenFor('manager@retail.local');
    const stock = await call('GET', '/stock/loc-1', admin);
    const row = stock.body.items.find((entry: { physicalQuantity: number }) => entry.physicalQuantity > 0);
    assert.ok(row, 'seed data has an item with stock at loc-1');

    const assigned = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-manager-1', itemIds: [row.itemId] });
    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));

    const mine = await call('GET', '/count-assignments/mine', manager);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.assignments.some((assignment: { itemId: string }) => assignment.itemId === row.itemId));

    const work = await call('GET', '/mobile/work', manager);
    assert.equal(work.status, 200);
    assert.ok(work.body.countTasks.some((task: { item: { id: string } }) => task.item.id === row.itemId), JSON.stringify(work.body.countTasks));

    const submitted = await call('POST', '/stock-counts', manager, { itemId: row.itemId, locationId: 'loc-1', physicalQuantity: row.physicalQuantity, mode: 'manual' });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    const countId = submitted.body.count.id;

    const selfReview = await call('PATCH', `/stock-counts/${countId}/review`, manager, { status: 'APPROVED', reviewReason: 'Counted it myself' });
    assert.equal(selfReview.status, 403, JSON.stringify(selfReview.body));
    assert.equal(selfReview.body.code, 'SELF_REVIEW');

    const adminReview = await call('PATCH', `/stock-counts/${countId}/review`, admin, { status: 'APPROVED', reviewReason: 'Matches the shelf' });
    assert.equal(adminReview.status, 200, JSON.stringify(adminReview.body));
  });
});

test('roles outside store user, picker and branch manager still cannot be given count work', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const stock = await call('GET', '/stock/loc-1', admin);
    const row = stock.body.items.find((entry: { physicalQuantity: number }) => entry.physicalQuantity > 0);
    const refused = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-auditor-1', itemIds: [row.itemId] });
    assert.equal(refused.status, 400);
    assert.equal((await call('GET', '/count-assignments/mine', tokenFor('auditor@retail.local'))).status, 403);
  });
});

test('a branch manager can be a worker on an auto stock-take campaign', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const created = await call('POST', '/campaigns', admin, { name: 'Manager count', locationId: 'loc-1', dailyItemsPerUser: 2, userIds: ['user-manager-1'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  });
});

test('a branch manager can still count an unassigned item ad hoc', async () => {
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const manager = tokenFor('manager@retail.local');
    const stock = await call('GET', '/stock/loc-1', admin);
    const row = stock.body.items.find((entry: { physicalQuantity: number }) => entry.physicalQuantity > 0);
    const submitted = await call('POST', '/stock-counts', manager, { itemId: row.itemId, locationId: 'loc-1', physicalQuantity: row.physicalQuantity, mode: 'manual' });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  });
});
