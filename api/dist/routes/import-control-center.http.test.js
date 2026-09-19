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
const import_control_center_js_1 = require("../lib/import-control-center.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const import_control_center_js_2 = __importDefault(require("./import-control-center.js"));
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
    app.use('/api/v1', import_control_center_js_2.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (path, token) => {
        const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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
function sale(locationId, transactionAt, sourceType = 'SALES') {
    (0, repository_js_1.recordDailyMovement)({
        id: `mv-${Math.random().toString(36).slice(2, 8)}`, dedupeKey: `k-${Math.random()}`, itemId: 'item-1001', lotId: 'lot-1001', locationId,
        movementType: sourceType === 'SALES' ? 'SALE_OUT' : 'PURCHASE_IN', qtyDelta: sourceType === 'SALES' ? -1 : 5, transactionAt,
        sourceType, sourceReference: 'INV-1', importBatchId: 'batch-x', createdById: 'user-admin-1',
    });
}
(0, node_test_1.default)('the control center reports each branch\'s day as uploaded, partial or missing', async () => {
    repository_js_1.dailyMovements.splice(0, repository_js_1.dailyMovements.length);
    const now = new Date();
    const today = (0, import_control_center_js_1.todayFor)('Asia/Kolkata', now);
    sale('loc-1', now.toISOString());
    sale('wh-1', now.toISOString(), 'PURCHASE');
    // Yesterday's file must not count toward today.
    sale('loc-2', new Date(now.getTime() - 36 * 3_600_000).toISOString());
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const report = (await call('/imports/control-center', admin)).body;
        strict_1.default.equal(report.date, today);
        strict_1.default.equal(report.timezone, 'Asia/Kolkata');
        const status = (locationId) => report.sales.branches.find((row) => row.locationId === locationId)?.status;
        strict_1.default.equal(status('loc-1'), 'UPLOADED');
        strict_1.default.equal(status('loc-2'), 'MISSING');
        strict_1.default.equal(report.sales.status, 'PARTIAL');
        strict_1.default.equal(report.purchases.status, 'UPLOADED');
        strict_1.default.deepEqual(report.purchases.branches.map((row) => row.locationId), ['wh-1']);
        strict_1.default.ok(report.window.from < report.window.to);
        strict_1.default.ok(Array.isArray(report.checkpoints));
        // Looking at yesterday moves the window: now loc-2 is in and loc-1 is not.
        const yesterday = (0, import_control_center_js_1.todayFor)('Asia/Kolkata', new Date(now.getTime() - 36 * 3_600_000));
        const past = (await call(`/imports/control-center?date=${yesterday}`, admin)).body;
        strict_1.default.equal(past.sales.branches.find((row) => row.locationId === 'loc-2').status, 'UPLOADED');
        strict_1.default.equal(past.sales.branches.find((row) => row.locationId === 'loc-1').status, 'MISSING');
        strict_1.default.equal((await call('/imports/control-center?date=18-09-2026', admin)).status, 400);
        strict_1.default.equal((await call('/imports/control-center?timezone=Mars/Base', admin)).status, 400);
    });
});
(0, node_test_1.default)('access follows role and branch', async () => {
    repository_js_1.dailyMovements.splice(0, repository_js_1.dailyMovements.length);
    sale('loc-1', new Date().toISOString());
    await withServer(async (call) => {
        strict_1.default.equal((await call('/imports/control-center', tokenFor('store@retail.local'))).status, 403);
        strict_1.default.equal((await call('/imports/control-center', tokenFor('picker@retail.local'))).status, 403);
        strict_1.default.equal((await call('/imports/control-center', tokenFor('auditor@retail.local'))).status, 200);
        // A branch manager only sees the branches assigned to them.
        const manager = (await call('/imports/control-center', tokenFor('manager@retail.local'))).body;
        strict_1.default.deepEqual(manager.sales.branches.map((row) => row.locationId), ['loc-1']);
        strict_1.default.deepEqual(manager.checkpoints.map((row) => row.locationId), ['loc-1']);
    });
});
