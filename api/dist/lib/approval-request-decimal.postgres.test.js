"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Decimal migration pilot (docs/decimal-migration-plan.md): ApprovalRequest.valueAtStake is the
// first Float field converted to Decimal. Proves the rounding policy (round-half-up to 2dp) at
// the database layer and that both API routes serving this field (GET /approval-requests,
// POST /approval-requests/:id/decide) still return it as a JSON number, not the string
// Prisma.Decimal's default toJSON would otherwise silently produce. Skipped unless
// TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const otp_auth_js_1 = require("./otp-auth.js");
const enterprise_repository_js_1 = require("./enterprise-repository.js");
const approval_rules_js_1 = require("./approval-rules.js");
const operations_extension_js_1 = __importDefault(require("../routes/operations-extension.js"));
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
            method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
integration('valueAtStake rounds to 2dp in the database and serializes as a JSON number, not a Decimal string', async () => {
    const companyId = `ard-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const requesterId = `ard-req-${(0, node_crypto_1.randomUUID)()}`;
    const approverId = `ard-app-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: requesterId, name: 'Requester', email: `${requesterId}@test.invexa.local`, passwordHash: 'x', role: 'STORE_USER', assignedLocations: '[]', companyId } });
    await db_js_1.prisma.user.create({ data: { id: approverId, name: 'Approver', email: `${approverId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    (0, enterprise_repository_js_1.createEnhancedUser)({ id: approverId, companyId, email: `${approverId}@test.invexa.local`, name: 'Approver', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
    const token = (0, otp_auth_js_1.generateJWT)(approverId, companyId);
    const triggerType = `ard-trigger-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.approvalRule.create({
        data: { label: 'Decimal pilot rule', triggerType, valueThreshold: 100, requiredApproverRole: 'ADMIN', createdById: approverId },
    });
    const entityId = `ard-entity-${(0, node_crypto_1.randomUUID)()}`;
    const gate = await (0, approval_rules_js_1.checkApprovalGate)({
        triggerType, entityType: 'TestEntity', entityId, branchId: null,
        value: 1234.567, requestedById: requesterId, // deliberately 3 decimal places to exercise the 2dp rounding policy
    });
    strict_1.default.equal(gate.blocked, true, JSON.stringify(gate));
    const stored = await db_js_1.prisma.approvalRequest.findUniqueOrThrow({ where: { id: gate.requestId } });
    strict_1.default.equal(Number(stored.valueAtStake), 1234.57, 'round-half-up to 2dp per the money rounding policy');
    await withServer(async (call) => {
        const list = await call('GET', '/approval-requests?status=PENDING', token);
        strict_1.default.equal(list.status, 200, JSON.stringify(list.body));
        const row = list.body.requests.find((r) => r.id === gate.requestId);
        strict_1.default.ok(row, 'the pending request must appear');
        strict_1.default.equal(typeof row.valueAtStake, 'number', 'must serialize as a JSON number, not a Decimal string');
        strict_1.default.equal(row.valueAtStake, 1234.57);
        const decided = await call('POST', `/approval-requests/${row.id}/decide`, token, { decision: 'APPROVED' });
        strict_1.default.equal(decided.status, 200, JSON.stringify(decided.body));
        strict_1.default.equal(typeof decided.body.request.valueAtStake, 'number');
        strict_1.default.equal(decided.body.request.valueAtStake, 1234.57);
    });
});
