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
const late_movement_service_js_1 = require("../lib/late-movement-service.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const import_control_center_js_1 = __importDefault(require("./import-control-center.js"));
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
    app.use('/api/v1', import_control_center_js_1.default);
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
const HOUR = 3_600_000;
const iso = (offsetHours) => new Date(Date.now() + offsetHours * HOUR).toISOString();
function salesMovement(key, over = {}) {
    return {
        id: `mv-${key}`, dedupeKey: key, itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', movementType: 'SALE_OUT', qtyDelta: -4,
        transactionAt: iso(-3), sourceType: 'SALES', sourceReference: 'INV-9', createdById: 'user-admin-1', ...over,
    };
}
function seedCounts() {
    repository_js_1.counts.splice(0, repository_js_1.counts.length);
    const pending = (0, repository_js_1.createCountRecord)({
        id: 'count-pending', itemId: 'item-1001', lotId: 'lot-1001', locationId: 'loc-1', physicalQuantity: 24, bookQty: 28, mode: 'manual',
        submittedBy: 'user-store-1', role: 'STORE_USER', createdAt: iso(-1),
    });
    const approved = (0, repository_js_1.createCountRecord)({
        id: 'count-approved', itemId: 'item-1002', lotId: 'lot-1002', locationId: 'loc-1', physicalQuantity: 26, bookQty: 26, mode: 'manual',
        submittedBy: 'user-store-1', role: 'STORE_USER', createdAt: iso(-1), status: 'APPROVED',
    });
    return { pending, approved };
}
(0, node_test_1.default)('a late import recomputes a pending count, flags an approved one, and is idempotent', async () => {
    seedCounts();
    const touched = await (0, late_movement_service_js_1.applyLateMovements)([
        salesMovement('k-before'),
        // After the count was taken: irrelevant to it.
        salesMovement('k-after', { transactionAt: iso(0), qtyDelta: -9 }),
        // Another item's late movement flags that item's approved count without rewriting it.
        salesMovement('k-approved', { itemId: 'item-1002', lotId: 'lot-1002', qtyDelta: -2 }),
        // A different branch is unaffected.
        salesMovement('k-other-branch', { locationId: 'loc-2' }),
    ]);
    strict_1.default.equal(touched, 2);
    const pending = repository_js_1.counts.find((row) => row.id === 'count-pending');
    strict_1.default.deepEqual([pending.bookQty, pending.bookQtyOriginal, pending.lateDelta, pending.reconciliationRequired], [24, 28, -4, true]);
    strict_1.default.match(pending.reconciliationNote, /28 -> 24/);
    const approved = repository_js_1.counts.find((row) => row.id === 'count-approved');
    strict_1.default.deepEqual([approved.bookQty, approved.bookQtyOriginal, approved.lateDelta, approved.reconciliationRequired], [26, undefined, -2, true]);
    // The same file uploaded again changes nothing.
    strict_1.default.equal(await (0, late_movement_service_js_1.applyLateMovements)([salesMovement('k-before'), salesMovement('k-approved', { itemId: 'item-1002', lotId: 'lot-1002', qtyDelta: -2 })]), 0);
    strict_1.default.equal(repository_js_1.counts.find((row) => row.id === 'count-pending').bookQty, 24);
    // Manual adjustments are not sales/purchase files and never trigger this.
    strict_1.default.equal(await (0, late_movement_service_js_1.applyLateMovements)([salesMovement('k-adj', { sourceType: 'ADJUSTMENT' })]), 0);
});
(0, node_test_1.default)('approving a recomputed count posts the variance against the corrected book quantity', async () => {
    seedCounts();
    await (0, late_movement_service_js_1.applyLateMovements)([salesMovement('k-1')]);
    await withServer(async (call) => {
        const manager = tokenFor('manager@retail.local');
        // Physical 24 against the corrected book 24 = no variance, not the stale -4... (24 vs 28).
        const list = (await call('GET', '/counts', manager)).body.counts;
        const row = list.find((entry) => entry.id === 'count-pending');
        strict_1.default.equal(row.reconciliationRequired, true);
        strict_1.default.equal(row.bookQty, 24);
        strict_1.default.equal(row.variance, 0);
        const review = await call('PATCH', '/stock-counts/count-pending/review', manager, { status: 'APPROVED', reviewReason: 'Matches corrected book' });
        strict_1.default.equal(review.status, 200);
        strict_1.default.equal(review.body.count.variance, 0);
        // The store user never sees book quantity or the reconciliation detail.
        const own = (await call('GET', '/counts', tokenFor('store@retail.local'))).body.counts.find((entry) => entry.id === 'count-pending');
        strict_1.default.equal('bookQty' in own, false);
        strict_1.default.equal('reconciliationRequired' in own, false);
        strict_1.default.equal('reconciliationNote' in own, false);
    });
});
(0, node_test_1.default)('a reviewer resolves a flag with a note; only count managers may, and only once', async () => {
    seedCounts();
    await (0, late_movement_service_js_1.applyLateMovements)([salesMovement('k-2')]);
    await withServer(async (call) => {
        const manager = tokenFor('manager@retail.local');
        const path = '/stock-counts/count-pending/reconciliation/ack';
        strict_1.default.equal((await call('POST', path, tokenFor('store@retail.local'), { note: 'looks fine to me' })).status, 403);
        strict_1.default.equal((await call('POST', path, manager, { note: 'no' })).status, 400);
        strict_1.default.equal((await call('POST', '/stock-counts/nope/reconciliation/ack', manager, { note: 'looks fine to me' })).status, 404);
        // A count with no open flag has nothing to resolve.
        strict_1.default.equal((await call('POST', '/stock-counts/count-approved/reconciliation/ack', manager, { note: 'looks fine to me' })).status, 409);
        const resolved = await call('POST', path, manager, { note: 'Checked the sales file, counts agree' });
        strict_1.default.equal(resolved.status, 200);
        strict_1.default.equal(resolved.body.count.reconciliationRequired, false);
        strict_1.default.match(resolved.body.count.reconciliationNote, /Resolved by user-manager-1/);
        strict_1.default.equal(resolved.body.count.lateDelta, -4, 'the recomputed figures stay for the audit trail');
        strict_1.default.equal((await call('POST', path, manager, { note: 'Checked the sales file, counts agree' })).status, 409);
    });
});
(0, node_test_1.default)('the import control center surfaces counts that need reconciliation', async () => {
    seedCounts();
    await (0, late_movement_service_js_1.applyLateMovements)([salesMovement('k-3'), salesMovement('k-4', { itemId: 'item-1002', lotId: 'lot-1002', qtyDelta: -1 })]);
    await withServer(async (call) => {
        const report = (await call('GET', '/imports/control-center', tokenFor('admin@retail.local'))).body;
        strict_1.default.equal(report.reconciliation.required, 2);
        strict_1.default.deepEqual(report.reconciliation.counts.map((row) => row.id).sort(), ['count-approved', 'count-pending']);
        const pending = report.reconciliation.counts.find((row) => row.id === 'count-pending');
        strict_1.default.deepEqual([pending.bookQtyOriginal, pending.bookQty, pending.lateDelta], [28, 24, -4]);
    });
});
