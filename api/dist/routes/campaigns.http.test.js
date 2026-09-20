"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const repository_js_1 = require("../lib/repository.js");
const campaign_store_js_1 = require("../lib/campaign-store.js");
const campaign_service_js_1 = require("../lib/campaign-service.js");
const event_bus_js_1 = require("../lib/event-bus.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const campaigns_js_1 = __importDefault(require("./campaigns.js"));
const core_js_1 = __importDefault(require("./core.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const COMPANY = 'default-company';
const HOUR = 3_600_000;
function addStoreUser(id) {
    if (repository_js_1.users.some((user) => user.id === id))
        return;
    const email = `${id}@retail.local`;
    repository_js_1.users.push({ id, email, name: `Store ${id}`, role: 'STORE_USER', assignedLocationIds: ['loc-1'] });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id, companyId: COMPANY, email, name: `Store ${id}`, role: 'STORE_USER', branchIds: [], locationIds: ['loc-1'],
        passwordHash: (0, otp_auth_js_1.hashPassword)('x'), status: 'active',
    });
}
function tokenFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return (0, otp_auth_js_1.generateJWT)(user.id, user.companyId);
}
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', campaigns_js_1.default);
    app.use('/api/v1', core_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (method, path, token, body) => {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
function freshState() {
    // Seed first: seeding is skipped once any enhanced user exists.
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    (0, campaign_store_js_1.resetCampaignStateForTests)();
    (0, event_bus_js_1.resetEventBusForTests)();
    repository_js_1.countAssignments.splice(0, repository_js_1.countAssignments.length);
    ['c1', 'c2'].forEach((suffix) => addStoreUser(`user-camp-${suffix}`));
}
const c1 = 'user-camp-c1';
const c2 = 'user-camp-c2';
const campaignBody = { name: 'September full count', locationId: 'loc-1', dailyItemsPerUser: 2, userIds: [c1, c2] };
(0, node_test_1.default)('campaign creation validates its input and allows one open campaign per branch', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, userIds: [] })).status, 400);
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, dailyItemsPerUser: 0 })).status, 400);
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, userIds: ['user-manager-1'] })).status, 400);
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, locationId: 'nowhere' })).status, 400);
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, timezone: 'Mars/Base' })).status, 400);
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, priorityOrder: ['LUCKY'] })).status, 400);
        const warehouseCampaign = await call('POST', '/campaigns', admin, { ...campaignBody, name: 'Warehouse full count', locationId: 'wh-1', userIds: ['user-picker-1'] });
        strict_1.default.equal(warehouseCampaign.status, 201);
        const created = await call('POST', '/campaigns', admin, campaignBody);
        strict_1.default.equal(created.status, 201);
        strict_1.default.equal(created.body.campaign.status, 'DRAFT');
        strict_1.default.equal(created.body.campaign.timezone, 'Asia/Kolkata');
        strict_1.default.equal((await call('POST', '/campaigns', admin, campaignBody)).status, 409);
    });
});
(0, node_test_1.default)('only count managers reach campaigns, and branch managers stay inside their branch', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        await call('POST', '/campaigns', admin, campaignBody);
        strict_1.default.equal((await call('GET', '/campaigns', tokenFor('store@retail.local'))).status, 403);
        strict_1.default.equal((await call('GET', '/campaigns', tokenFor('picker@retail.local'))).status, 403);
        strict_1.default.equal((await call('GET', '/campaigns', tokenFor('auditor@retail.local'))).status, 403);
        const manager = tokenFor('manager@retail.local');
        const list = await call('GET', '/campaigns', manager);
        strict_1.default.equal(list.status, 200);
        strict_1.default.equal(list.body.campaigns.length, 1);
        strict_1.default.equal((await call('POST', '/campaigns', manager, { ...campaignBody, locationId: 'loc-2' })).status, 403);
    });
});
(0, node_test_1.default)('activation builds the queue from positive stock only and hands each user their daily batch', async () => {
    freshState();
    // item-1006 has zero stock at loc-1: it must never enter the campaign.
    (0, repository_js_1.adjustStockLedger)('item-1006', 'lot-1006', 'loc-1', -12);
    const events = [];
    const sub = (0, event_bus_js_1.subscribe)({ companyId: COMPANY, userId: 'test', locationIds: null, send: (event) => events.push(event) });
    try {
        await withServer(async (call) => {
            const admin = tokenFor('admin@retail.local');
            const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
            const activated = await call('POST', `/campaigns/${campaign.id}/activate`, admin);
            strict_1.default.equal(activated.status, 200);
            // 4 in-stock items, quota 2 per user, 2 users -> everything assigned in one go.
            strict_1.default.equal(activated.body.run.assigned, 4);
            strict_1.default.deepEqual(Object.values(activated.body.run.perUser).sort(), [2, 2]);
            strict_1.default.equal(activated.body.campaign.status, 'COUNTING');
            const items = await call('GET', `/campaigns/${campaign.id}/items`, admin);
            strict_1.default.equal(items.body.total, 4);
            strict_1.default.equal(items.body.items.some((row) => row.itemId === 'item-1006'), false);
            const tasks = repository_js_1.countAssignments.filter((row) => row.campaignId === campaign.id);
            strict_1.default.equal(tasks.length, 4);
            for (const userId of [c1, c2]) {
                const mine = tasks.filter((row) => row.assignedToId === userId);
                strict_1.default.equal(mine.length, 2);
                // One shared countDate per user per run = one stock count in the mobile app.
                strict_1.default.equal(new Set(mine.map((row) => row.countDate)).size, 1);
                strict_1.default.ok(mine[0].dueDate);
                strict_1.default.equal(mine[0].assignedById, 'user-admin-1');
            }
            strict_1.default.ok(events.some((event) => event.topic === 'campaign.changed'));
            strict_1.default.ok(events.some((event) => event.topic === 'assignment.changed'));
            const detail = await call('GET', `/campaigns/${campaign.id}`, admin);
            strict_1.default.equal(detail.body.progress.byStatus.ASSIGNED, 4);
            strict_1.default.equal(detail.body.progress.coveragePercent, 0);
        });
    }
    finally {
        sub.unsubscribe();
        (0, repository_js_1.adjustStockLedger)('item-1006', 'lot-1006', 'loc-1', 12);
    }
});
(0, node_test_1.default)('running the same day twice, or rolling over, never duplicates work', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
        await call('POST', `/campaigns/${campaign.id}/activate`, admin);
        const before = repository_js_1.countAssignments.filter((row) => row.campaignId === campaign.id).length;
        const again = await call('POST', `/campaigns/${campaign.id}/run`, admin, {});
        strict_1.default.equal(again.body.result.skipped, 'ALREADY_RAN');
        // Tomorrow, with every task still open: quota is already full, so nothing new is handed out.
        const tomorrow = await (0, campaign_service_js_1.runCampaignDay)(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
        strict_1.default.equal(tomorrow.ran, true);
        strict_1.default.equal(tomorrow.assigned, 0);
        strict_1.default.equal(repository_js_1.countAssignments.filter((row) => row.campaignId === campaign.id).length, before);
        // Forcing the same day still respects the quota.
        const forced = await call('POST', `/campaigns/${campaign.id}/run`, admin, { force: true });
        strict_1.default.equal(forced.body.result.assigned, 0);
    });
});
(0, node_test_1.default)('count -> review -> recount -> approval drives coverage to a completed campaign', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const store = { [c1]: tokenFor(`${c1}@retail.local`), [c2]: tokenFor(`${c2}@retail.local`) };
        const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
        await call('POST', `/campaigns/${campaign.id}/activate`, admin);
        const submitAllOpen = async () => {
            for (const userId of [c1, c2]) {
                const mine = (await call('GET', '/count-assignments/mine', store[userId])).body.assignments;
                for (const task of mine) {
                    strict_1.default.equal(task.campaignId, campaign.id);
                    const stock = await call('GET', '/stock/loc-1', store[userId]);
                    const row = stock.body.items.find((entry) => entry.itemId === task.itemId);
                    const submit = await call('POST', '/stock-counts', store[userId], { itemId: task.itemId, locationId: 'loc-1', physicalQuantity: row.physicalQuantity, mode: 'manual' });
                    strict_1.default.equal(submit.status, 201);
                }
            }
        };
        await submitAllOpen();
        let detail = await call('GET', `/campaigns/${campaign.id}`, admin);
        strict_1.default.equal(detail.body.progress.byStatus.SUBMITTED, 4);
        strict_1.default.equal(detail.body.campaign.status, 'COUNTING');
        // Reviewer sends one back for a recount and approves the rest.
        const pending = (await call('GET', '/counts', admin)).body.counts.filter((row) => row.status === 'PENDING_REVIEW');
        strict_1.default.equal(pending.length, 4);
        const [toRecount, ...toApprove] = pending;
        const recount = await call('PATCH', `/stock-counts/${toRecount.id}/review`, admin, { status: 'RECOUNT', reviewReason: 'Shelf looked short' });
        strict_1.default.equal(recount.status, 200);
        for (const count of toApprove) {
            strict_1.default.equal((await call('PATCH', `/stock-counts/${count.id}/review`, admin, { status: 'APPROVED', reviewReason: 'Matches shelf' })).status, 200);
        }
        detail = await call('GET', `/campaigns/${campaign.id}`, admin);
        strict_1.default.equal(detail.body.progress.byStatus.APPROVED, 3);
        strict_1.default.equal(detail.body.progress.byStatus.RECOUNT, 1);
        strict_1.default.equal(detail.body.campaign.status, 'COUNTING');
        // The recount is an explicit task linked to the prior count and still tagged to the campaign.
        const recountTask = repository_js_1.countAssignments.find((row) => row.parentCountId === toRecount.id);
        strict_1.default.equal(recountTask?.campaignId, campaign.id);
        strict_1.default.equal(recountTask?.assignedToId, toRecount.submittedBy);
        // Next day: the fifth (pending) item goes to a user with room; open recount still counts toward quota.
        const day2 = await (0, campaign_service_js_1.runCampaignDay)(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
        strict_1.default.equal(day2.assigned, 1);
        await submitAllOpen();
        for (const count of (await call('GET', '/counts', admin)).body.counts.filter((row) => row.status === 'PENDING_REVIEW')) {
            await call('PATCH', `/stock-counts/${count.id}/review`, admin, { status: 'APPROVED', reviewReason: 'Confirmed count' });
        }
        detail = await call('GET', `/campaigns/${campaign.id}`, admin);
        strict_1.default.equal(detail.body.progress.coveragePercent, 100);
        strict_1.default.equal(detail.body.campaign.status, 'COMPLETED');
        strict_1.default.ok(detail.body.campaign.completedAt);
        // A completed campaign frees the branch for the next one and no longer accepts commands.
        strict_1.default.equal((await call('POST', `/campaigns/${campaign.id}/pause`, admin)).status, 409);
        strict_1.default.equal((await call('POST', '/campaigns', admin, { ...campaignBody, name: 'October count' })).status, 201);
    });
});
(0, node_test_1.default)('stock that runs out leaves the queue and comes back when restocked; new stock joins it', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, dailyItemsPerUser: 1, userIds: [c1] });
        await call('POST', `/campaigns/${campaign.id}/activate`, admin);
        // Quota 1 for a single user: one task out, the rest wait in the queue.
        let items = (await call('GET', `/campaigns/${campaign.id}/items?status=PENDING`, admin)).body.items;
        strict_1.default.equal(items.length, 4);
        const victim = items[0].itemId;
        const ledgerRow = { 'item-1001': 'lot-1001', 'item-1002': 'lot-1002', 'item-1004': 'lot-1004', 'item-1005': 'lot-1005', 'item-1006': 'lot-1006' }[victim];
        const onHand = 5;
        (0, repository_js_1.adjustStockLedger)(victim, ledgerRow, 'loc-1', -1000);
        try {
            await (0, campaign_service_js_1.runCampaignDay)(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR), force: true });
            const excluded = (await call('GET', `/campaigns/${campaign.id}/items?status=EXCLUDED`, admin)).body.items;
            strict_1.default.deepEqual(excluded.map((row) => [row.itemId, row.excludedReason]), [[victim, 'ZERO_STOCK']]);
        }
        finally {
            (0, repository_js_1.adjustStockLedger)(victim, ledgerRow, 'loc-1', 1000);
        }
        void onHand;
        await (0, campaign_service_js_1.runCampaignDay)(campaign.id, COMPANY, { now: new Date(Date.now() + 60 * HOUR), force: true });
        items = (await call('GET', `/campaigns/${campaign.id}/items?status=EXCLUDED`, admin)).body.items;
        strict_1.default.equal(items.length, 0);
    });
});
(0, node_test_1.default)('absence: workload can be moved to a colleague or returned to the queue', async () => {
    freshState();
    addStoreUser('user-camp-c3');
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, userIds: [c1, c2] });
        await call('POST', `/campaigns/${campaign.id}/activate`, admin);
        const move = await call('POST', `/campaigns/${campaign.id}/reassign`, admin, { fromUserId: c1, toUserId: 'user-camp-c3' });
        strict_1.default.equal(move.status, 200);
        strict_1.default.equal(move.body.result.moved, 2);
        strict_1.default.equal(repository_js_1.countAssignments.filter((row) => row.campaignId === campaign.id && row.assignedToId === 'user-camp-c3' && row.status === 'ASSIGNED').length, 2);
        strict_1.default.equal(repository_js_1.countAssignments.filter((row) => row.assignedToId === c1 && row.status === 'ASSIGNED').length, 0);
        // c2 is out: their two tasks return to the queue and are redistributed to whoever has room.
        const returned = await call('POST', `/campaigns/${campaign.id}/reassign`, admin, { fromUserId: c2 });
        strict_1.default.equal(returned.status, 200);
        strict_1.default.equal(returned.body.result.returnedToQueue, 2);
        const detail = await call('GET', `/campaigns/${campaign.id}`, admin);
        strict_1.default.equal(detail.body.campaign.userIds.includes(c2), false);
        // Nothing was lost: every in-stock item is still covered by an open task or waiting in the queue.
        const { ASSIGNED, PENDING } = detail.body.progress.byStatus;
        strict_1.default.equal(ASSIGNED + PENDING, 5);
        strict_1.default.equal(repository_js_1.countAssignments.filter((row) => row.assignedToId === c2 && row.status === 'ASSIGNED').length, 0);
        const lonely = await call('POST', `/campaigns/${campaign.id}/reassign`, admin, { fromUserId: c1 });
        strict_1.default.equal(lonely.status, 200);
    });
});
(0, node_test_1.default)('pause stops allocation, resume restarts it, cancel withdraws open tasks', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const { body: { campaign } } = await call('POST', '/campaigns', admin, { ...campaignBody, dailyItemsPerUser: 1 });
        strict_1.default.equal((await call('POST', `/campaigns/${campaign.id}/pause`, admin)).status, 409);
        await call('POST', `/campaigns/${campaign.id}/activate`, admin);
        strict_1.default.equal((await call('POST', `/campaigns/${campaign.id}/pause`, admin)).body.campaign.status, 'PAUSED');
        const paused = await (0, campaign_service_js_1.runCampaignDay)(campaign.id, COMPANY, { now: new Date(Date.now() + 30 * HOUR) });
        strict_1.default.equal(paused.skipped, 'NOT_RUNNABLE');
        const resumed = await call('POST', `/campaigns/${campaign.id}/resume`, admin);
        strict_1.default.equal(resumed.body.campaign.status, 'COUNTING');
        // The scheduler entry point picks the campaign up like any other day.
        const due = await (0, campaign_service_js_1.runDueCampaigns)(new Date(Date.now() + 54 * HOUR));
        strict_1.default.equal(due.length, 1);
        strict_1.default.equal(due[0].error, undefined);
        const cancelled = await call('POST', `/campaigns/${campaign.id}/cancel`, admin);
        strict_1.default.equal(cancelled.body.campaign.status, 'CANCELLED');
        strict_1.default.equal(repository_js_1.countAssignments.filter((row) => row.campaignId === campaign.id && row.status === 'ASSIGNED').length, 0);
        strict_1.default.equal((await call('POST', `/campaigns/${campaign.id}/resume`, admin)).status, 409);
    });
});
(0, node_test_1.default)('settings can be edited while open; removing a user hands their work back', async () => {
    freshState();
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const { body: { campaign } } = await call('POST', '/campaigns', admin, campaignBody);
        await call('POST', `/campaigns/${campaign.id}/activate`, admin);
        const bad = await call('PATCH', `/campaigns/${campaign.id}`, admin, { dailyItemsPerUser: 9999 });
        strict_1.default.equal(bad.status, 400);
        const ok = await call('PATCH', `/campaigns/${campaign.id}`, admin, { dailyItemsPerUser: 3, priorityOrder: ['ABC', 'EXPIRY'], userIds: [c1] });
        strict_1.default.equal(ok.status, 200);
        strict_1.default.equal(ok.body.campaign.dailyItemsPerUser, 3);
        strict_1.default.deepEqual(ok.body.campaign.priorityOrder, ['ABC', 'EXPIRY']);
        strict_1.default.equal(repository_js_1.countAssignments.filter((row) => row.assignedToId === c2 && row.status === 'ASSIGNED').length, 0);
    });
});
