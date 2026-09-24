"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration slice 9 (see docs/tenant-scope-coverage.md):
// core.ts's ~18 bare-id Transfer/StockCount lookups (listTransfers().find(),
// listCounts().find()) were already protected by lib/inventory.ts's
// company-aware canAccessLocation, but relied entirely on that location
// check - the record itself carried no companyId to check directly. This
// slice converted every entry-point lookup to findTransferForCompany/
// findCountForCompany (lib/repository.ts), an independent second layer.
// Memory-mode only (no TEST_DATABASE_URL needed): these are in-memory
// records, not a Prisma model.
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const repository_js_1 = require("../lib/repository.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const core_js_1 = __importDefault(require("./core.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
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
        return { status: response.status, body: (await response.json().catch(() => ({}))) };
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
function makeAdmin(companyId) {
    const id = `core-companyid-user-${(0, node_crypto_1.randomUUID)()}`;
    const user = (0, enterprise_repository_js_1.createEnhancedUser)({
        id, companyId, email: `${id}@test.invexa.local`, name: 'Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: (0, otp_auth_js_1.hashPassword)('x'), status: 'active',
    });
    return { id: user.id, token: (0, otp_auth_js_1.generateJWT)(user.id, companyId) };
}
(0, node_test_1.default)('GET /picker/transfers/:transferId: a transfer stamped with another company\'s companyId resolves 404, not just relying on the location check', async () => {
    // wh-1/loc-1 are seeded under DEFAULT_COMPANY_ID, so the owning admin's
    // location check (lib/inventory.ts's canAccessLocation - no ADMIN
    // bypass, unlike operations-extension.ts's own version) passes for real.
    const companyA = tenant_scope_js_1.DEFAULT_COMPANY_ID;
    const companyB = `core-companyid-b-${(0, node_crypto_1.randomUUID)()}`;
    const adminA = makeAdmin(companyA);
    const adminB = makeAdmin(companyB);
    const transferId = `core-companyid-transfer-${(0, node_crypto_1.randomUUID)()}`;
    (0, repository_js_1.createTransferRecord)({
        id: transferId, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
        requestedBy: adminA.id, role: 'ADMIN', status: 'CONFIRMED',
        lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
        createdAt: new Date().toISOString(), companyId: companyA,
    });
    await withServer(async (call) => {
        const cross = await call('GET', `/picker/transfers/${transferId}`, adminB.token);
        strict_1.default.equal(cross.status, 404, 'a transfer stamped with another company must look identical to a missing one, even though ADMIN bypasses the location check');
        const own = await call('GET', `/picker/transfers/${transferId}`, adminA.token);
        strict_1.default.equal(own.status, 200, 'the owning company\'s own admin must be unaffected');
    });
});
(0, node_test_1.default)('POST /stock-counts/:countId/reconciliation/ack: a count stamped with another company\'s companyId resolves 404', async () => {
    const companyA = `core-companyid-a-${(0, node_crypto_1.randomUUID)()}`;
    const companyB = `core-companyid-b-${(0, node_crypto_1.randomUUID)()}`;
    const adminA = makeAdmin(companyA);
    const adminB = makeAdmin(companyB);
    const countId = `core-companyid-count-${(0, node_crypto_1.randomUUID)()}`;
    (0, repository_js_1.createCountRecord)({
        id: countId, itemId: 'item-1003', lotId: 'lot-1003', locationId: 'wh-1',
        physicalQuantity: 5, bookQty: 5, mode: 'manual', submittedBy: adminA.id, role: 'ADMIN',
        createdAt: new Date().toISOString(), reconciliationRequired: true, companyId: companyA,
    });
    await withServer(async (call) => {
        const cross = await call('POST', `/stock-counts/${countId}/reconciliation/ack`, adminB.token, { note: 'cross tenant attempt' });
        strict_1.default.equal(cross.status, 404, 'a count stamped with another company must look identical to a missing one');
    });
});
(0, node_test_1.default)('a legacy transfer/count record with no companyId set (created before this field existed) still resolves for its owning company\'s admin - fail-safe-if-unknown', async () => {
    const adminA = makeAdmin(tenant_scope_js_1.DEFAULT_COMPANY_ID);
    const transferId = `core-companyid-legacy-transfer-${(0, node_crypto_1.randomUUID)()}`;
    (0, repository_js_1.createTransferRecord)({
        id: transferId, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1',
        requestedBy: adminA.id, role: 'ADMIN', status: 'CONFIRMED',
        lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
        createdAt: new Date().toISOString(),
        // companyId deliberately omitted, simulating a pre-existing record.
    });
    await withServer(async (call) => {
        const response = await call('GET', `/picker/transfers/${transferId}`, adminA.token);
        strict_1.default.equal(response.status, 200, 'a record with no companyId yet must not cause a false deny for a legitimate request');
    });
});
