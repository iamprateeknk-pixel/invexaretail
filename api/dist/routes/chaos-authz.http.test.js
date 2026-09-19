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
const command_center_js_1 = __importDefault(require("./command-center.js"));
const transfer_logistics_js_1 = __importDefault(require("./transfer-logistics.js"));
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
    app.use('/api/v1', transfer_logistics_js_1.default);
    app.use('/api/v1', command_center_js_1.default);
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
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        let parsed = {};
        try {
            parsed = JSON.parse(text);
        }
        catch { /* not JSON, e.g. a CSV download */ }
        return { status: response.status, body: parsed, text, type: response.headers.get('content-type') ?? '' };
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
const burst = (size, make) => Promise.all(Array.from({ length: size }, make));
// ---- chaos: the same logical action arrives many times at once --------------------------------------
(0, node_test_1.default)('ten simultaneous submits of one count record it once', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const requestId = `chaos-${unique()}`;
        const results = await burst(10, () => call('POST', '/stock-counts', admin, { itemId: 'item-1001', locationId: 'loc-1', physicalQuantity: 3, mode: 'manual', requestId }));
        strict_1.default.equal((0, repository_js_1.listCounts)().filter((row) => row.requestId === requestId).length, 1);
        strict_1.default.ok(results.every((row) => [200, 201, 409].includes(row.status)), results.map((row) => row.status).join());
        strict_1.default.equal(results.filter((row) => row.status === 201).length, 1, 'exactly one request created it');
    });
});
(0, node_test_1.default)('ten simultaneous weight counts create each lot count once, never a partial set', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const item = (0, repository_js_1.createItemRecord)({ code: `CH-${unique()}`, name: 'Chaos rice', unit: 'KG', countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true });
        const lots = ['A', 'B', 'C'].map((suffix) => (0, repository_js_1.ensureLotRecord)(item.id, `L-${unique()}-${suffix}`, null));
        for (const lot of lots)
            (0, repository_js_1.adjustStockLedger)(item.id, lot.id, 'loc-1', 2);
        const requestId = `chaos-${unique()}`;
        const results = await burst(10, () => call('POST', '/stock-counts/weight', admin, { itemId: item.id, locationId: 'loc-1', totalQuantity: 5, requestId }));
        const stored = (0, repository_js_1.listCounts)().filter((row) => row.requestId === requestId);
        strict_1.default.equal(stored.length, 3, 'one count per lot, no duplicates');
        strict_1.default.deepEqual(stored.map((row) => row.physicalQuantity).sort(), [1, 2, 2]);
        strict_1.default.equal(results.filter((row) => row.status === 201).length, 1);
        strict_1.default.ok(results.every((row) => [200, 201, 409].includes(row.status)));
    });
});
(0, node_test_1.default)('ten simultaneous receipts of one transfer post the stock once', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const store = tokenFor('store@retail.local');
        const id = `tr-${unique()}`;
        (0, repository_js_1.createTransferRecord)({
            id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'DISPATCHED',
            lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 10 }], createdAt: new Date().toISOString(),
        });
        void admin;
        const before = (0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.onHand ?? 0;
        const requestId = `chaos-${unique()}`;
        const results = await burst(10, () => call('POST', `/transfers/${id}/receive`, store, { requestId, lines: [{ itemId: 'item-1003', lotId: 'lot-1003', receivedQty: 10 }] }));
        strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.onHand, before + 10, 'stock posted exactly once');
        strict_1.default.equal(results.filter((row) => row.status === 200 && row.body.duplicate === false).length, 1);
        strict_1.default.ok(results.every((row) => [200, 409].includes(row.status)), results.map((row) => row.status).join());
    });
});
(0, node_test_1.default)('a count for a lot that is already waiting for review is refused, however many times it is tried', async () => {
    await withServer(async (call) => {
        const store = tokenFor('store@retail.local');
        const item = (0, repository_js_1.createItemRecord)({ code: `PW-${unique()}`, name: 'Pending' });
        (0, repository_js_1.adjustStockLedger)(item.id, item.lots[0].id, 'loc-1', 4);
        (0, repository_js_1.createCountAssignment)({ id: `asg-${unique()}`, locationId: 'loc-1', itemId: item.id, assignedToId: 'user-store-1', assignedById: 'user-admin-1', countDate: '2026-09-19' });
        const results = await burst(6, () => call('POST', '/stock-counts', store, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 4, mode: 'manual', requestId: `k-${unique()}` }));
        strict_1.default.equal(results.filter((row) => row.status === 201).length, 1);
        strict_1.default.equal((0, repository_js_1.listCounts)().filter((row) => row.itemId === item.id).length, 1);
    });
});
// ---- authorization: who may see the command center and the reports ----------------------------------
(0, node_test_1.default)('the command center and reports are refused to anyone who is not management, and to strangers', async () => {
    await withServer(async (call) => {
        const paths = ['/command-center', '/reports/transfer-cycle', '/reports/count-accuracy', '/reports/audit-export', '/ops/metrics'];
        for (const path of paths)
            strict_1.default.equal((await call('GET', path, null)).status, 401, `${path} without a token`);
        for (const email of ['store@retail.local', 'picker@retail.local']) {
            for (const path of paths)
                strict_1.default.equal((await call('GET', path, tokenFor(email))).status, 403, `${path} for ${email}`);
        }
        for (const path of paths.slice(0, 3)) {
            strict_1.default.equal((await call('GET', path, tokenFor('manager@retail.local'))).status, 200, `${path} for a branch manager`);
            strict_1.default.equal((await call('GET', path, tokenFor('auditor@retail.local'))).status, 200, `${path} for an auditor`);
        }
        // The audit trail export is narrower: no branch manager.
        strict_1.default.equal((await call('GET', '/reports/audit-export', tokenFor('manager@retail.local'))).status, 403);
        strict_1.default.equal((await call('GET', '/reports/audit-export', tokenFor('auditor@retail.local'))).status, 200);
        // Operational metrics are admin-only.
        strict_1.default.equal((await call('GET', '/ops/metrics', tokenFor('manager@retail.local'))).status, 403);
        strict_1.default.equal((await call('GET', '/ops/metrics', tokenFor('auditor@retail.local'))).status, 403);
        const metrics = await call('GET', '/ops/metrics', tokenFor('admin@retail.local'));
        strict_1.default.equal(metrics.status, 200);
        strict_1.default.equal(typeof metrics.body.process.rssMb, 'number');
    });
});
(0, node_test_1.default)('a branch manager sees only their own branch in the command center', async () => {
    await withServer(async (call) => {
        const manager = await call('GET', '/command-center', tokenFor('manager@retail.local'));
        const ids = manager.body.commandCenter.branchHealth.map((row) => row.locationId);
        strict_1.default.deepEqual(ids, ['loc-1']);
        const admin = await call('GET', '/command-center', tokenFor('admin@retail.local'));
        strict_1.default.ok(admin.body.commandCenter.branchHealth.length > 1);
    });
});
(0, node_test_1.default)('the audit export is a CSV download that can be filtered', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const requestId = `csv-${unique()}`;
        const item = (0, repository_js_1.createItemRecord)({ code: `CSV-${unique()}`, name: 'Audit item' });
        (0, repository_js_1.adjustStockLedger)(item.id, item.lots[0].id, 'loc-1', 2);
        const made = await call('POST', '/stock-counts', admin, { itemId: item.id, locationId: 'loc-1', physicalQuantity: 2, mode: 'manual', requestId });
        strict_1.default.equal(made.status, 201);
        const csv = await call('GET', '/reports/audit-export?action=STOCK_COUNT_SUBMITTED', admin);
        strict_1.default.equal(csv.status, 200);
        strict_1.default.match(csv.type, /text\/csv/);
        const lines = csv.text.split('\r\n');
        strict_1.default.match(lines[0], /"When","Actor"/);
        strict_1.default.ok(lines.some((line) => line.includes('STOCK_COUNT_SUBMITTED') && line.includes(made.body.count.id)));
        const none = await call('GET', '/reports/audit-export?format=json&action=NO_SUCH_ACTION', admin);
        strict_1.default.equal(none.body.count, 0);
        const byEntity = await call('GET', `/reports/audit-export?format=json&entityId=${made.body.count.id}`, admin);
        strict_1.default.equal(byEntity.body.count, 1);
    });
});
