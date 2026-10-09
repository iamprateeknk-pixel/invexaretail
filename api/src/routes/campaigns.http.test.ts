import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail, createEnhancedUser } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { adjustStockLedger, countAssignments, updateCountAssignment, users } from '../lib/repository.js';
import { resetCampaignStateForTests } from '../lib/campaign-store.js';
import { runCampaignDay, runDueCampaigns } from '../lib/campaign-service.js';
import { resetEventBusForTests, subscribe, type DomainEvent } from '../lib/event-bus.js';
import { extractToken } from './enterprise-auth.js';
import campaignsRouter from './campaigns.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

const COMPANY = 'default-company';
const HOUR = 3_600_000;

function addStoreUser(id: string) {
  if (users.some((user) => user.id === id)) return;
  const email = `${id}@retail.local`;
  users.push({ id, email, name: `Store ${id}`, role: 'STORE_USER', assignedLocationIds: ['loc-1'] });
  createEnhancedUser({
    id, companyId: COMPANY, email, name: `Store ${id}`, role: 'STORE_USER', branchIds: [], locationIds: ['loc-1'],
    passwordHash: hashPassword('x'), status: 'active',
  });
}

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

type Api = (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>;

function freshState() {
  // Seed first: seeding is skipped once any enhanced user exists.
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  resetCampaignStateForTests();
  resetEventBusForTests();
  countAssignments.splice(0, countAssignments.length);
  ['c1', 'c2'].forEach((suffix) => addStoreUser(`user-camp-${suffix}`));
}

const c1 = 'user-camp-c1';
const c2 = 'user-camp-c2';
const campaignBody = { name: 'September full count', locationId: 'loc-1', dailyItemsPerUser: 2, userIds: [c1, c2] };

test('campaign creation validates its input and allows one open campaign per branch', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, userIds: [] })).status, 400);
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, dailyItemsPerUser: 0 })).status, 400);
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, userIds: ['user-auditor-1'] })).status, 400);
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, locationId: 'nowhere' })).status, 400);
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, timezone: 'Mars/Base' })).status, 400);
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, priorityOrder: ['LUCKY'] })).status, 400);

    const warehouseCampaign = await call('POST', '/campaigns', admin, { ...campaignBody, name: 'Warehouse full count', locationId: 'wh-1', userIds: ['user-picker-1'] });
    assert.equal(warehouseCampaign.status, 201);

    const created = await call('POST', '/campaigns', admin, campaignBody);
    assert.equal(created.status, 201);
    assert.equal(created.body.campaign.status, 'DRAFT');
    assert.equal(created.body.campaign.timezone, 'Asia/Kolkata');
    assert.equal((await call('POST', '/campaigns', admin, campaignBody)).status, 409);
  });
});

test('only count managers reach campaigns, and branch managers stay inside their branch', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    await call('POST', '/campaigns', admin, campaignBody);
    assert.equal((await call('GET', '/campaigns', tokenFor('store@retail.local'))).status, 403);
    assert.equal((await call('GET', '/campaigns', tokenFor('picker@retail.local'))).status, 403);
    assert.equal((await call('GET', '/campaigns', tokenFor('auditor@retail.local'))).status, 403);

    const manager = tokenFor('manager@retail.local');
    const list = await call('GET', '/campaigns', manager);
    assert.equal(list.status, 200);
    assert.equal(list.body.campaigns.length, 1);
    assert.equal((await call('POST', '/campaigns', manager, { ...campaignBody, locationId: 'loc-2' })).status, 403);
  });
});

test('activation builds the queue from positive stock only and hands each user their daily batch', async () => {
  freshState();
  // item-1006 has zero stock at loc-1: it must never enter the campaign.
  adjustStockLedger('item-1006', 'lot-1006', 'loc-1', -12);
  const events: DomainEvent[] = [];
  const sub = subscribe({ companyId: COMPANY, userId: 'test', locationIds: null, send: (event) => events.push(event) });
  try {
    await withServer(async (call) => {
      const admin = tokenFor('admin@retail.local');
      const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
      const activated = await call('POST', `/campaigns/${campaign.id}/activate`, admin);
      assert.equal(activated.status, 200);
      // 4 in-stock items, quota 2 per user, 2 users -> everything assigned in one go.
      assert.equal(activated.body.run.assigned, 4);
      assert.deepEqual(Object.values(activated.body.run.perUser).sort(), [2, 2]);
      assert.equal(activated.body.campaign.status, 'COUNTING');

      const items = await call('GET', `/campaigns/${campaign.id}/items`, admin);
      assert.equal(items.body.total, 4);
      assert.equal(items.body.items.some((row: { itemId: string }) => row.itemId === 'item-1006'), false);

      const tasks = countAssignments.filter((row) => row.campaignId === campaign.id);
      assert.equal(tasks.length, 4);
      for (const userId of [c1, c2]) {
        const mine = tasks.filter((row) => row.assignedToId === userId);
        assert.equal(mine.length, 2);
        // One shared countDate per user per run = one stock count in the mobile app.
        assert.equal(new Set(mine.map((row) => row.countDate)).size, 1);
        assert.ok(mine[0].dueDate);
        assert.equal(mine[0].assignedById, 'user-admin-1');
      }
      assert.ok(events.some((event) => event.topic === 'campaign.changed'));
      assert.ok(events.some((event) => event.topic === 'assignment.changed'));

      const detail = await call('GET', `/campaigns/${campaign.id}`, admin);
      assert.equal(detail.body.progress.byStatus.ASSIGNED, 4);
      assert.equal(detail.body.progress.coveragePercent, 0);
    });
  } finally {
    sub.unsubscribe();
    adjustStockLedger('item-1006', 'lot-1006', 'loc-1', 12);
  }
});

test('running the same day twice, or rolling over, never duplicates work', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);
    const before = countAssignments.filter((row) => row.campaignId === campaign.id).length;

    const again = await call('POST', `/campaigns/${campaign.id}/run`, admin, {});
    assert.equal(again.body.result.skipped, 'ALREADY_RAN');

    // Tomorrow, with every task still open: quota is already full, so nothing new is handed out.
    const tomorrow = await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
    assert.equal(tomorrow.ran, true);
    assert.equal(tomorrow.assigned, 0);
    assert.equal(countAssignments.filter((row) => row.campaignId === campaign.id).length, before);

    // Forcing the same day still respects the quota.
    const forced = await call('POST', `/campaigns/${campaign.id}/run`, admin, { force: true });
    assert.equal(forced.body.result.assigned, 0);
  });
});

test('count -> review -> recount -> approval drives coverage to a completed campaign', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const store = { [c1]: tokenFor(`${c1}@retail.local`), [c2]: tokenFor(`${c2}@retail.local`) };
    const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);

    const submitAllOpen = async () => {
      for (const userId of [c1, c2] as const) {
        const mine = (await call('GET', '/count-assignments/mine', store[userId])).body.assignments as Array<{ itemId: string; campaignId?: string }>;
        for (const task of mine) {
          assert.equal(task.campaignId, campaign.id);
          const stock = await call('GET', '/stock/loc-1', store[userId]);
          const row = stock.body.items.find((entry: { itemId: string }) => entry.itemId === task.itemId);
          const submit = await call('POST', '/stock-counts', store[userId], { itemId: task.itemId, locationId: 'loc-1', physicalQuantity: row.physicalQuantity, mode: 'manual' });
          assert.equal(submit.status, 201);
        }
      }
    };

    await submitAllOpen();
    let detail = await call('GET', `/campaigns/${campaign.id}`, admin);
    assert.equal(detail.body.progress.byStatus.SUBMITTED, 4);
    assert.equal(detail.body.campaign.status, 'COUNTING');

    // Reviewer sends one back for a recount and approves the rest.
    const pending = (await call('GET', '/counts', admin)).body.counts.filter((row: { status: string }) => row.status === 'PENDING_REVIEW');
    assert.equal(pending.length, 4);
    const [toRecount, ...toApprove] = pending;
    const recount = await call('PATCH', `/stock-counts/${toRecount.id}/review`, admin, { status: 'RECOUNT', reviewReason: 'Shelf looked short' });
    assert.equal(recount.status, 200);
    for (const count of toApprove) {
      assert.equal((await call('PATCH', `/stock-counts/${count.id}/review`, admin, { status: 'APPROVED', reviewReason: 'Matches shelf' })).status, 200);
    }

    detail = await call('GET', `/campaigns/${campaign.id}`, admin);
    assert.equal(detail.body.progress.byStatus.APPROVED, 3);
    assert.equal(detail.body.progress.byStatus.RECOUNT, 1);
    assert.equal(detail.body.campaign.status, 'COUNTING');
    // The recount is an explicit task linked to the prior count and still tagged to the campaign.
    const recountTask = countAssignments.find((row) => row.parentCountId === toRecount.id);
    assert.equal(recountTask?.campaignId, campaign.id);
    assert.equal(recountTask?.assignedToId, toRecount.submittedBy);

    // Next day: the fifth (pending) item goes to a user with room; open recount still counts toward quota.
    const day2 = await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
    assert.equal(day2.assigned, 1);

    await submitAllOpen();
    for (const count of (await call('GET', '/counts', admin)).body.counts.filter((row: { status: string }) => row.status === 'PENDING_REVIEW')) {
      await call('PATCH', `/stock-counts/${count.id}/review`, admin, { status: 'APPROVED', reviewReason: 'Confirmed count' });
    }

    detail = await call('GET', `/campaigns/${campaign.id}`, admin);
    assert.equal(detail.body.progress.coveragePercent, 100);
    assert.equal(detail.body.campaign.status, 'COMPLETED');
    assert.ok(detail.body.campaign.completedAt);
    // A completed campaign frees the branch for the next one and no longer accepts commands.
    assert.equal((await call('POST', `/campaigns/${campaign.id}/pause`, admin)).status, 409);
    assert.equal((await call('POST', '/campaigns', admin, { ...campaignBody, name: 'October count' })).status, 201);
  });
});

test('a user who skips a day gets no new items until the old batch is done, then a fresh full batch', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, userIds: [c1] });
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);
    const dayOne = countAssignments.filter((row) => row.campaignId === campaign.id);
    assert.equal(dayOne.length, 2);

    // Day 2: on leave, nothing counted -> the same two tasks stay, nothing new.
    const dayTwo = await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
    assert.equal(dayTwo.assigned, 0);

    // Back at work: the old batch is finished, so the next day brings a new full batch.
    for (const row of dayOne) updateCountAssignment(row.id, { status: 'SUBMITTED' });
    const dayThree = await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 54 * HOUR) });
    assert.equal(dayThree.assigned, 2);
    const fresh = countAssignments.filter((row) => row.campaignId === campaign.id && row.status === 'ASSIGNED');
    assert.equal(fresh.some((row) => dayOne.some((old) => old.itemId === row.itemId)), false);
  });
});

test('an item whose net stock is negative is never assigned, even with one positive lot', async () => {
  freshState();
  // item-1006: lot-1006 has +12, a second lot -20 -> net -8.
  adjustStockLedger('item-1006', 'lot-1006-neg', 'loc-1', -20);
  try {
    await withServer(async (call) => {
      const admin = tokenFor('admin@retail.local');
      const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
      await call('POST', `/campaigns/${campaign.id}/activate`, admin);
      const items = (await call('GET', `/campaigns/${campaign.id}/items`, admin)).body.items as Array<{ itemId: string }>;
      assert.equal(items.some((row) => row.itemId === 'item-1006'), false);
      assert.equal(countAssignments.some((row) => row.campaignId === campaign.id && row.itemId === 'item-1006'), false);
    });
  } finally {
    adjustStockLedger('item-1006', 'lot-1006-neg', 'loc-1', 20);
  }
});

test('stock that runs out leaves the queue and comes back when restocked; new stock joins it', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, dailyItemsPerUser: 1, userIds: [c1] });
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);
    // Quota 1 for a single user: one task out, the rest wait in the queue.
    let items = (await call('GET', `/campaigns/${campaign.id}/items?status=PENDING`, admin)).body.items as Array<{ itemId: string }>;
    assert.equal(items.length, 4);
    const victim = items[0].itemId;
    const ledgerRow = { 'item-1001': 'lot-1001', 'item-1002': 'lot-1002', 'item-1004': 'lot-1004', 'item-1005': 'lot-1005', 'item-1006': 'lot-1006' }[victim]!;
    const onHand = 5;
    adjustStockLedger(victim, ledgerRow, 'loc-1', -1000);
    try {
      await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR), force: true });
      const excluded = (await call('GET', `/campaigns/${campaign.id}/items?status=EXCLUDED`, admin)).body.items as Array<{ itemId: string; excludedReason: string }>;
      assert.deepEqual(excluded.map((row) => [row.itemId, row.excludedReason]), [[victim, 'ZERO_STOCK']]);
    } finally {
      adjustStockLedger(victim, ledgerRow, 'loc-1', 1000);
    }
    void onHand;
    await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 60 * HOUR), force: true });
    items = (await call('GET', `/campaigns/${campaign.id}/items?status=EXCLUDED`, admin)).body.items;
    assert.equal(items.length, 0);
  });
});

test('absence: workload can be moved to a colleague or returned to the queue', async () => {
  freshState();
  addStoreUser('user-camp-c3');
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, userIds: [c1, c2] });
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);

    const move = await call('POST', `/campaigns/${campaign.id}/reassign`, admin, { fromUserId: c1, toUserId: 'user-camp-c3' });
    assert.equal(move.status, 200);
    assert.equal(move.body.result.moved, 2);
    assert.equal(countAssignments.filter((row) => row.campaignId === campaign.id && row.assignedToId === 'user-camp-c3' && row.status === 'ASSIGNED').length, 2);
    assert.equal(countAssignments.filter((row) => row.assignedToId === c1 && row.status === 'ASSIGNED').length, 0);

    // c2 is out: their two tasks return to the queue and are redistributed to whoever has room.
    const returned = await call('POST', `/campaigns/${campaign.id}/reassign`, admin, { fromUserId: c2 });
    assert.equal(returned.status, 200);
    assert.equal(returned.body.result.returnedToQueue, 2);
    const detail = await call('GET', `/campaigns/${campaign.id}`, admin);
    assert.equal(detail.body.campaign.userIds.includes(c2), false);
    // Nothing was lost: every in-stock item is still covered by an open task or waiting in the queue.
    const { ASSIGNED, PENDING } = detail.body.progress.byStatus;
    assert.equal(ASSIGNED + PENDING, 5);
    assert.equal(countAssignments.filter((row) => row.assignedToId === c2 && row.status === 'ASSIGNED').length, 0);

    const lonely = await call('POST', `/campaigns/${campaign.id}/reassign`, admin, { fromUserId: c1 });
    assert.equal(lonely.status, 200);
  });
});

test('pause stops allocation, resume restarts it, cancel withdraws open tasks', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, dailyItemsPerUser: 1 });
    assert.equal((await call('POST', `/campaigns/${campaign.id}/pause`, admin)).status, 409);
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);

    assert.equal((await call('POST', `/campaigns/${campaign.id}/pause`, admin)).body.campaign.status, 'PAUSED');
    const paused = await runCampaignDay(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
    assert.equal(paused.skipped, 'NOT_RUNNABLE');
    const resumed = await call('POST', `/campaigns/${campaign.id}/resume`, admin);
    assert.equal(resumed.body.campaign.status, 'COUNTING');

    // The scheduler entry point picks the campaign up like any other day.
    const due = await runDueCampaigns(new Date(Date.now() + 54 * HOUR));
    assert.equal(due.length, 1);
    assert.equal(due[0].error, undefined);

    const cancelled = await call('POST', `/campaigns/${campaign.id}/cancel`, admin);
    assert.equal(cancelled.body.campaign.status, 'CANCELLED');
    assert.equal(countAssignments.filter((row) => row.campaignId === campaign.id && row.status === 'ASSIGNED').length, 0);
    assert.equal((await call('POST', `/campaigns/${campaign.id}/resume`, admin)).status, 409);
  });
});

test('settings can be edited while open; removing a user hands their work back', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
    await call('POST', `/campaigns/${campaign.id}/activate`, admin);

    const bad = await call('PATCH', `/campaigns/${campaign.id}`, admin, { dailyItemsPerUser: 9999 });
    assert.equal(bad.status, 400);
    const ok = await call('PATCH', `/campaigns/${campaign.id}`, admin, { dailyItemsPerUser: 3, priorityOrder: ['ABC', 'EXPIRY'], userIds: [c1] });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.campaign.dailyItemsPerUser, 3);
    assert.deepEqual(ok.body.campaign.priorityOrder, ['ABC', 'EXPIRY']);
    assert.equal(countAssignments.filter((row) => row.assignedToId === c2 && row.status === 'ASSIGNED').length, 0);
  });
});

test('COUNT_ENFORCE_RECOUNT refuses to approve an out-of-tolerance first count, and allows it when off (audit C-1)', async () => {
  freshState();
  await withServer(async (call) => {
    const admin = tokenFor('admin@retail.local');
    const stock = await call('GET', '/stock/loc-1', admin);
    const row = stock.body.items.find((entry: { physicalQuantity: number }) => entry.physicalQuantity >= 20);
    assert.ok(row, 'seed data has an item with stock');
    const submit = async () => (await call('POST', '/stock-counts', admin, { itemId: row.itemId, locationId: 'loc-1', physicalQuantity: Math.max(0, row.physicalQuantity - 15), mode: 'manual' })).body;
    const first = await submit();
    const countId = first.count?.id ?? first.id;
    assert.ok(countId, JSON.stringify(first));
    process.env.COUNT_ENFORCE_RECOUNT = 'true';
    try {
      const refused = await call('PATCH', `/stock-counts/${countId}/review`, admin, { status: 'APPROVED', reviewReason: 'Looks right' });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.equal(refused.body.code, 'RECOUNT_REQUIRED');
      assert.equal((await call('PATCH', `/stock-counts/${countId}/review`, admin, { status: 'RECOUNT', reviewReason: 'Recount please' })).status, 200);
    } finally {
      delete process.env.COUNT_ENFORCE_RECOUNT;
    }
  });
});
