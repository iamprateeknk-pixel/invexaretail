"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bare-id call-site migration, slice 3 (see docs/tenant-scope-coverage.md):
// HTTP-level cross-tenant coverage for the ReturnRequest and ExceptionCase
// routes in routes/operations-extension.ts fixed to filter by companyId
// instead of looking a row up by bare id alone. DB-only - skipped unless
// TEST_DATABASE_URL is set. Reuses the withServer/makeFixture pattern from
// operations-extension-orders.postgres.test.ts (slice 1) and
// catalog-procurement-purchase-orders.postgres.test.ts (slice 2).
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', operations_extension_js_1.default);
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
async function makeFixture() {
    const companyId = `ops-ret-exc-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `ops-ret-exc-user-${(0, node_crypto_1.randomUUID)()}`;
    // Order.createdById / ReturnRequest.createdById / ExceptionCase.reportedById
    // are all real FKs to User.
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Ops Return/Exception Test Admin', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'Ops Return/Exception Test Admin',
        role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active',
    });
    const locationId = `ops-ret-exc-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
    const token = (0, otp_auth_js_1.generateJWT)(userId, companyId);
    return { companyId, userId, locationId, token };
}
async function makeOrder(companyId, locationId, createdById) {
    return db_js_1.prisma.order.create({
        data: { channel: 'web', fulfillmentLocationId: locationId, createdById, companyId, status: 'RESERVED' },
    });
}
async function makeReturnRequest(companyId, orderId, createdById) {
    return db_js_1.prisma.returnRequest.create({
        data: { orderId, createdById, companyId, status: 'REQUESTED' },
    });
}
async function makeExceptionCase(companyId, reportedById) {
    return db_js_1.prisma.exceptionCase.create({
        data: { type: 'DAMAGE', title: 'Test damage case', reportedById, companyId },
    });
}
integration('PATCH /returns/:id/status: another company\'s return request id resolves 404, not a status change', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    const returnA = await makeReturnRequest(a.companyId, orderA.id, a.userId);
    await withServer(async (call) => {
        const cross = await call('PATCH', `/returns/${returnA.id}/status`, b.token, { action: 'APPROVE' });
        strict_1.default.equal(cross.status, 404, 'a real return request belonging to another company must look identical to a missing one');
        const unchanged = await db_js_1.prisma.returnRequest.findUniqueOrThrow({ where: { id: returnA.id } });
        strict_1.default.equal(unchanged.status, 'REQUESTED', 'the cross-tenant attempt must not have changed anything');
    });
});
integration('PATCH /returns/:id/status: the owning company can still act on its own return request', async () => {
    const a = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    const returnA = await makeReturnRequest(a.companyId, orderA.id, a.userId);
    await withServer(async (call) => {
        const own = await call('PATCH', `/returns/${returnA.id}/status`, a.token, { action: 'APPROVE' });
        strict_1.default.equal(own.status, 200);
        strict_1.default.equal(own.body.returnRequest.status, 'APPROVED');
    });
});
integration('PATCH /returns/:id/refund: another company\'s return request id resolves 404', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const orderA = await makeOrder(a.companyId, a.locationId, a.userId);
    const returnA = await makeReturnRequest(a.companyId, orderA.id, a.userId);
    await withServer(async (call) => {
        const cross = await call('PATCH', `/returns/${returnA.id}/refund`, b.token, { status: 'REFUNDED' });
        strict_1.default.equal(cross.status, 404);
    });
});
integration('GET /exceptions: the list endpoint only ever returns the caller\'s own company\'s exception cases', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const caseA = await makeExceptionCase(a.companyId, a.userId);
    const caseB = await makeExceptionCase(b.companyId, b.userId);
    await withServer(async (call) => {
        const listA = await call('GET', '/exceptions', a.token);
        strict_1.default.equal(listA.status, 200);
        const idsA = listA.body.cases.map((c) => c.id);
        strict_1.default.ok(idsA.includes(caseA.id), 'company A must see its own exception case');
        strict_1.default.ok(!idsA.includes(caseB.id), 'company A must not see company B\'s exception case');
    });
});
integration('PATCH /exceptions/:id: another company\'s exception case id resolves 404, not a field change', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const caseA = await makeExceptionCase(a.companyId, a.userId);
    await withServer(async (call) => {
        const cross = await call('PATCH', `/exceptions/${caseA.id}`, b.token, { status: 'IN_PROGRESS' });
        strict_1.default.equal(cross.status, 404, 'a real exception case belonging to another company must look identical to a missing one');
        const unchanged = await db_js_1.prisma.exceptionCase.findUniqueOrThrow({ where: { id: caseA.id } });
        strict_1.default.equal(unchanged.status, 'OPEN', 'the cross-tenant attempt must not have changed anything');
    });
});
integration('POST /exceptions/:id/resolve: another company\'s exception case id resolves 404, not a resolution', async () => {
    const a = await makeFixture();
    const b = await makeFixture();
    const caseA = await makeExceptionCase(a.companyId, a.userId);
    await withServer(async (call) => {
        const cross = await call('POST', `/exceptions/${caseA.id}/resolve`, b.token, { disposition: 'WRITE_OFF' });
        strict_1.default.equal(cross.status, 404);
        const unchanged = await db_js_1.prisma.exceptionCase.findUniqueOrThrow({ where: { id: caseA.id } });
        strict_1.default.equal(unchanged.status, 'OPEN', 'the cross-tenant attempt must not have changed anything');
    });
});
integration('POST /exceptions: a newly opened case is stamped with the caller\'s own companyId, not the schema default', async () => {
    const a = await makeFixture();
    await withServer(async (call) => {
        const created = await call('POST', '/exceptions', a.token, { type: 'DAMAGE', title: 'New damage case' });
        strict_1.default.equal(created.status, 201);
        strict_1.default.equal(created.body.case.companyId, a.companyId, 'createExceptionCase must stamp the caller\'s real companyId, not fall back to the schema default');
    });
});
