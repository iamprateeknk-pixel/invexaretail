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
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const core_js_1 = __importDefault(require("./core.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
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
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();
// A loose-weight item with three 2 kg lots at loc-1 (the blueprint §13.2 example).
function weightItem(tag) {
    const item = (0, repository_js_1.createItemRecord)({ code: `KG-${tag}`, name: `Loose rice ${tag}`, unit: 'KG', countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true });
    const lots = ['A', 'B', 'C'].map((suffix) => (0, repository_js_1.ensureLotRecord)(item.id, `KG-${tag}-${suffix}`, null));
    for (const lot of lots)
        (0, repository_js_1.adjustStockLedger)(item.id, lot.id, 'loc-1', 2);
    return { item, lots };
}
(0, node_test_1.default)('a retried count with the same requestId is recorded once', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const key = `req-${unique()}`;
        const body = { itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: 7, mode: 'manual', requestId: key };
        const first = await call('POST', '/stock-counts', admin, body);
        strict_1.default.equal(first.status, 201);
        const again = await call('POST', '/stock-counts', admin, body);
        strict_1.default.equal(again.status, 200);
        strict_1.default.equal(again.body.duplicate, true);
        strict_1.default.equal(again.body.count.id, first.body.count.id);
        strict_1.default.equal((0, repository_js_1.listCounts)().filter((count) => count.requestId === key).length, 1);
    });
});
(0, node_test_1.default)('a store user cannot count a lot that has no stock, and never sees book quantity', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const store = tokenFor('store@retail.local');
        const tag = unique();
        const item = (0, repository_js_1.createItemRecord)({ code: `ZS-${tag}`, name: `Zero stock ${tag}` });
        (0, repository_js_1.adjustStockLedger)(item.id, item.lots[0].id, 'loc-1', 0);
        (0, repository_js_1.createCountAssignment)({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
        const rejected = await call('POST', '/stock-counts', store, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 1, mode: 'manual' });
        strict_1.default.equal(rejected.status, 400);
        strict_1.default.match(rejected.body.message, /no stock/);
        // The same lot is still countable by an admin (maintenance), and a store user's normal count is blind.
        strict_1.default.equal((await call('POST', '/stock-counts', admin, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 1, mode: 'manual' })).status, 201);
        (0, repository_js_1.createCountAssignment)({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: 'item-1004', assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
        const ok = await call('POST', '/stock-counts', store, { itemId: 'item-1004', locationId: 'loc-1', physicalQuantity: 5, mode: 'manual' });
        strict_1.default.equal(ok.status, 201);
        strict_1.default.equal(ok.body.count.bookQty, undefined);
        strict_1.default.equal(ok.body.count.variance, undefined);
    });
});
(0, node_test_1.default)('a weight count is allocated over lots by the server and stays blind for a store user', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const store = tokenFor('store@retail.local');
        const tag = unique();
        const { item, lots } = weightItem(tag);
        // Lot items cannot be counted by weight.
        strict_1.default.equal((await call('POST', '/stock-counts/weight', admin, { itemId: 'item-1001', locationId: 'loc-1', totalQuantity: 3 })).status, 400);
        strict_1.default.equal((await call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1', totalQuantity: -1 })).status, 400);
        strict_1.default.equal((await call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1' })).status, 400);
        // A store user needs an assignment.
        strict_1.default.equal((await call('POST', '/stock-counts/weight', store, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5 })).status, 403);
        (0, repository_js_1.createCountAssignment)({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
        const key = `w-${tag}`;
        const submitted = await call('POST', '/stock-counts/weight', store, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5, requestId: key });
        strict_1.default.equal(submitted.status, 201);
        strict_1.default.deepEqual(submitted.body, { success: true, lots: 3 }, 'no book quantity, variance or split reaches a store user');
        // The split is what an admin sees: 2 + 2 + 1, variance -1.
        const stored = (0, repository_js_1.listCounts)().filter((count) => count.requestId === key);
        strict_1.default.deepEqual(lots.map((lot) => stored.find((count) => count.lotId === lot.id)?.physicalQuantity), [2, 2, 1]);
        strict_1.default.ok(stored.every((count) => count.mode === 'weight' && count.bookQty === 2));
        // The task is closed and a retry is a no-op.
        const mine = (await call('GET', '/count-assignments/mine', store)).body.assignments;
        strict_1.default.equal(mine.some((row) => row.itemId === item.id), false);
        const retry = await call('POST', '/stock-counts/weight', store, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5, requestId: key });
        strict_1.default.equal(retry.status, 200);
        strict_1.default.equal(retry.body.duplicate, true);
        strict_1.default.equal((0, repository_js_1.listCounts)().filter((count) => count.requestId === key).length, 3);
    });
});
(0, node_test_1.default)('a manager sees the allocation and total variance of a weight count', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const { item } = weightItem(unique());
        const result = await call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5.5 });
        strict_1.default.equal(result.status, 201);
        strict_1.default.deepEqual(result.body.allocation.map((row) => row.physicalQuantity), [2, 2, 1.5]);
        strict_1.default.equal(result.body.totalVariance, -0.5);
        strict_1.default.equal(result.body.counts[0].variance, 0);
        // An excess lands on the last lot.
        const { item: other } = weightItem(unique());
        const excess = await call('POST', '/stock-counts/weight', admin, { itemId: other.id, locationId: 'loc-1', totalQuantity: 7 });
        strict_1.default.deepEqual(excess.body.allocation.map((row) => row.physicalQuantity), [2, 2, 3]);
        strict_1.default.equal(excess.body.totalVariance, 1);
    });
});
(0, node_test_1.default)('mobile work lists only actionable count tasks, with no quantities', async () => {
    await withServer(async (call) => {
        const store = tokenFor('store@retail.local');
        const tag = unique();
        const { item, lots } = weightItem(tag);
        // A second lot with no stock must not be offered.
        const empty = (0, repository_js_1.ensureLotRecord)('item-1005', `EMPTY-${tag}`, null);
        (0, repository_js_1.adjustStockLedger)('item-1005', empty.id, 'loc-1', 0);
        const zero = (0, repository_js_1.createItemRecord)({ code: `Z-${tag}`, name: `Zero ${tag}` });
        (0, repository_js_1.adjustStockLedger)(zero.id, zero.lots[0].id, 'loc-1', 0);
        for (const itemId of [item.id, zero.id, 'item-1005']) {
            (0, repository_js_1.createCountAssignment)({ id: `asg-${unique()}`, locationId: 'loc-1', itemId, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
        }
        const work = await call('GET', '/mobile/work', store);
        strict_1.default.equal(work.status, 200);
        const tasks = work.body.countTasks;
        strict_1.default.equal(tasks.some((task) => task.item.id === zero.id), false, 'zero-stock item is not a task');
        const weight = tasks.find((task) => task.item.id === item.id);
        strict_1.default.deepEqual([weight.item.countMethod, weight.item.decimalQuantity, weight.lots.length], ['ITEM_WEIGHT', true, lots.length]);
        const rice = tasks.find((task) => task.item.id === 'item-1005');
        strict_1.default.equal(rice.lots.some((lot) => lot.lotId === empty.id), false, 'zero-stock lot is not offered');
        strict_1.default.doesNotMatch(JSON.stringify(work.body), /bookQty|onHand|variance/);
        // Only store users have count tasks; receive tasks are branch scoped.
        strict_1.default.deepEqual((await call('GET', '/mobile/work', tokenFor('admin@retail.local'))).body.countTasks, []);
        strict_1.default.ok(Array.isArray(work.body.receiveTasks));
    });
});
