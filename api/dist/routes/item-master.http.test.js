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
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const item_master_js_1 = __importDefault(require("./item-master.js"));
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
    if (!(0, enterprise_repository_js_1.findUserByEmail)('adminuser@retail.local')) {
        (0, enterprise_repository_js_1.createEnhancedUser)({
            id: 'user-adminuser-1', companyId: 'default-company', email: 'adminuser@retail.local', name: 'Admin User', role: 'ADMIN_USER',
            branchIds: [], locationIds: ['loc-1'], passwordHash: (0, otp_auth_js_1.hashPassword)('x'), status: 'active',
        });
    }
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', item_master_js_1.default);
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
(0, node_test_1.default)('an item can be created and edited with the full master, with versioning and identity checks', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const tag = unique();
        const created = await call('POST', '/items', admin, {
            code: `M-${tag}`, name: 'Master item', barcode: `89${tag}`, hsn: '1006', gstRate: 5, mrp: 99.5, leadTimeDays: 4, shelfLifeDays: 180,
            aliases: [`ERP-${tag}`, 'Master Item Alt'],
        });
        strict_1.default.equal(created.status, 201);
        const item = created.body.item;
        strict_1.default.deepEqual([item.status, item.version, item.hsn, item.gstRate, item.mrp, item.barcode], ['ACTIVE', 1, '1006', 5, 99.5, `89${tag}`]);
        strict_1.default.deepEqual(item.aliases, [`ERP-${tag}`, 'Master Item Alt']);
        strict_1.default.equal(item.createdById, 'user-admin-1');
        // Codes, barcodes and aliases live in one namespace.
        strict_1.default.equal((await call('POST', '/items', admin, { code: `ERP-${tag}`, name: 'Clash by code' })).status, 409);
        strict_1.default.equal((await call('POST', '/items', admin, { code: `N-${tag}`, name: 'Clash', barcode: `89${tag}` })).status, 409);
        strict_1.default.equal((await call('POST', '/items', admin, { code: `N2-${tag}`, name: 'Clash', aliases: [`m-${tag}`] })).status, 409);
        // Bad values are rejected, not stored.
        strict_1.default.equal((await call('POST', '/items', admin, { code: `B-${tag}`, name: 'Bad', gstRate: 150 })).status, 400);
        const edited = await call('PUT', `/items/${item.id}`, admin, { mrp: 105, hsn: null, aliases: [] });
        strict_1.default.equal(edited.status, 200);
        strict_1.default.equal(edited.body.item.version, 2);
        strict_1.default.equal(edited.body.item.mrp, 105);
        strict_1.default.equal(edited.body.item.hsn, undefined);
        strict_1.default.equal(edited.body.item.gstRate, 5, 'fields not in the request are left alone');
        strict_1.default.equal(edited.body.item.aliases, undefined);
        // The edit is stored, not just echoed back: later reads see it.
        const listed = (await call('GET', '/items', admin)).body.items.find((row) => row.id === item.id);
        strict_1.default.deepEqual([listed.version, listed.mrp, listed.gstRate, listed.barcode], [2, 105, 5, `89${tag}`]);
        strict_1.default.equal(listed.hsn, undefined);
        strict_1.default.equal(listed.aliases, undefined);
        // ... including the name, and archiving builds on the saved version.
        await call('PUT', `/items/${item.id}`, admin, { name: 'Renamed master item', countMethod: 'ITEM_WEIGHT' });
        const renamed = (await call('GET', '/items', admin)).body.items.find((row) => row.id === item.id);
        strict_1.default.deepEqual([renamed.name, renamed.countMethod, renamed.version], ['Renamed master item', 'ITEM_WEIGHT', 3]);
        const archived = await call('PATCH', `/items/${item.id}/status`, admin, { status: 'ARCHIVED', reason: 'test cleanup' });
        strict_1.default.equal(archived.body.item.version, 4);
    });
});
(0, node_test_1.default)('archiving hides an item from operations, blocks new transactions, and is fully reversible', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const store = tokenFor('store@retail.local');
        const picker = tokenFor('picker@retail.local');
        const target = 'item-1002';
        strict_1.default.equal((await call('PATCH', `/items/${target}/status`, admin, { status: 'ARCHIVED' })).status, 400);
        strict_1.default.equal((await call('PATCH', `/items/${target}/status`, store, { status: 'ARCHIVED', reason: 'no longer sold' })).status, 403);
        const archived = await call('PATCH', `/items/${target}/status`, admin, { status: 'ARCHIVED', reason: 'no longer sold' });
        strict_1.default.equal(archived.status, 200);
        strict_1.default.equal(archived.body.item.archiveReason, 'no longer sold');
        strict_1.default.equal(archived.body.item.archivedById, 'user-admin-1');
        strict_1.default.equal(archived.body.item.version, 2);
        const ids = async (token, query = '') => (await call('GET', `/items${query}`, token)).body.items.map((row) => row.id);
        // Operational roles never see it, whatever they ask for; admins find it on request.
        strict_1.default.equal((await ids(store)).includes(target), false);
        strict_1.default.equal((await ids(picker, '?status=all')).includes(target), false);
        strict_1.default.equal((await ids(admin)).includes(target), false);
        strict_1.default.equal((await ids(admin, '?status=ARCHIVED')).includes(target), true);
        strict_1.default.equal((await ids(admin, '?status=all')).includes(target), true);
        strict_1.default.equal((await call('GET', '/items?status=bogus', admin)).status, 400);
        // Its stock disappears for the store user but not for the admin.
        const storeStock = (await call('GET', '/stock/loc-1', store)).body.items;
        strict_1.default.equal(storeStock.some((row) => row.itemId === target), false);
        const adminStock = (await call('GET', '/stock/loc-1', admin)).body.items;
        strict_1.default.equal(adminStock.some((row) => row.itemId === target), true);
        // No new transactions against it.
        const assign = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-store-1', itemIds: [target] });
        strict_1.default.equal(assign.status, 400);
        strict_1.default.match(assign.body.message, /archived/);
        const count = await call('POST', '/stock-counts', admin, { itemId: target, locationId: 'loc-1', physicalQuantity: 1, mode: 'manual' });
        strict_1.default.equal(count.status, 400);
        strict_1.default.match(count.body.message, /archived/);
        const transfer = await call('POST', '/transfers', admin, {
            sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', lines: [{ itemId: target, lotId: 'lot-1002', quantity: 1 }],
        });
        strict_1.default.equal(transfer.status, 400);
        strict_1.default.match(transfer.body.message, /archived/);
        const restored = await call('PATCH', `/items/${target}/status`, admin, { status: 'ACTIVE' });
        strict_1.default.equal(restored.status, 200);
        strict_1.default.equal(restored.body.item.archiveReason, undefined);
        strict_1.default.equal((await ids(store)).includes(target), true);
        const assignAgain = await call('POST', '/count-assignments', admin, { locationId: 'loc-1', storeUserId: 'user-store-1', itemIds: [target] });
        strict_1.default.equal(assignAgain.status, 201);
    });
});
(0, node_test_1.default)('permanent delete is only for an item with no history, and only for the Main Admin', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const adminUser = tokenFor('adminuser@retail.local');
        const tag = unique();
        const fresh = (await call('POST', '/items', admin, { code: `D-${tag}`, name: 'Never used' })).body.item;
        const refs = await call('GET', `/items/${fresh.id}/references`, admin);
        strict_1.default.equal(refs.status, 200);
        strict_1.default.equal(refs.body.canDelete, true);
        strict_1.default.equal((await call('DELETE', `/items/${fresh.id}`, adminUser)).status, 403);
        strict_1.default.equal((await call('DELETE', `/items/${fresh.id}`, tokenFor('store@retail.local'))).status, 403);
        strict_1.default.equal((await call('DELETE', `/items/${fresh.id}`, admin)).status, 204);
        const after = (await call('GET', '/items?status=all', admin)).body.items;
        strict_1.default.equal(after.some((row) => row.id === fresh.id), false);
        strict_1.default.equal((await call('DELETE', `/items/${fresh.id}`, admin)).status, 404);
        // An item with stock, counts and movements must be archived instead.
        const used = await call('DELETE', '/items/item-1001', admin);
        strict_1.default.equal(used.status, 409);
        strict_1.default.match(used.body.message, /Archive it instead/);
        strict_1.default.ok(used.body.blockers.some((row) => row.key === 'stock'));
        const usedRefs = await call('GET', '/items/item-1001/references', admin);
        strict_1.default.equal(usedRefs.body.canDelete, false);
        // ... and it is still there.
        strict_1.default.ok((await call('GET', '/items', admin)).body.items.some((row) => row.id === 'item-1001'));
    });
});
