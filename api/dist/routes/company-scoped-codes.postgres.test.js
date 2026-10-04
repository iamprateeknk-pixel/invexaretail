"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Audit P0-3: identity is per company. Two customers must be able to use the same
// SKU / location / branch code, and one company must never see or change another's
// branches. Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../lib/db.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const branches_js_1 = __importDefault(require("./branches.js"));
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function withServer(run) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', branches_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const call = async (method, path, token, body) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
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
async function makeCompany() {
    const companyId = `codes-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `codes-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'A', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    (0, enterprise_repository_js_1.createEnhancedUser)({ id: userId, companyId, email: `${userId}@test.invexa.local`, name: 'A', role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: 'x', status: 'active' });
    return { companyId, token: (0, otp_auth_js_1.generateJWT)(userId, companyId) };
}
integration('two companies can use the same SKU, location and branch code', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const code = `SHARED-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`.toUpperCase();
    await db_js_1.prisma.item.create({ data: { code, name: 'A item', companyId: a.companyId } });
    await db_js_1.prisma.item.create({ data: { code, name: 'B item', companyId: b.companyId } });
    await db_js_1.prisma.location.create({ data: { code, name: 'A loc', type: 'store', companyId: a.companyId } });
    await db_js_1.prisma.location.create({ data: { code, name: 'B loc', type: 'store', companyId: b.companyId } });
    await withServer(async (call) => {
        strict_1.default.equal((await call('POST', '/branches', a.token, { code, name: 'A branch' })).status, 201);
        strict_1.default.equal((await call('POST', '/branches', b.token, { code, name: 'B branch' })).status, 201, 'same branch code in another company is allowed');
        strict_1.default.equal((await call('POST', '/branches', a.token, { code, name: 'A again' })).status, 409, 'but not twice within one company');
    });
    // Uniqueness still holds inside one company.
    await strict_1.default.rejects(db_js_1.prisma.item.create({ data: { code, name: 'A duplicate', companyId: a.companyId } }));
    await strict_1.default.rejects(db_js_1.prisma.location.create({ data: { code, name: 'A dup loc', type: 'store', companyId: a.companyId } }));
});
integration('branches are company scoped: listing, updating and archiving another company\'s branch is invisible (404)', async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const code = `ISO-${(0, node_crypto_1.randomUUID)().slice(0, 6)}`.toUpperCase();
    await withServer(async (call) => {
        const created = await call('POST', '/branches', a.token, { code, name: 'A only' });
        strict_1.default.equal(created.status, 201);
        const id = created.body.branch.id;
        const listB = await call('GET', '/branches', b.token);
        strict_1.default.equal(listB.status, 200);
        strict_1.default.equal(listB.body.branches.some((row) => row.id === id), false, 'B must not see A\'s branch');
        const listA = await call('GET', '/branches', a.token);
        strict_1.default.equal(listA.body.branches.some((row) => row.id === id), true);
        strict_1.default.equal((await call('PATCH', `/branches/${id}`, b.token, { name: 'hijacked' })).status, 404);
        strict_1.default.equal((await call('POST', `/branches/${id}/archive`, b.token)).status, 404);
        const stillA = await db_js_1.prisma.branch.findUniqueOrThrow({ where: { id } });
        strict_1.default.equal(stillA.name, 'A only');
        strict_1.default.equal(stillA.status, 'ACTIVE');
        strict_1.default.equal(stillA.companyId, a.companyId, 'the branch is stamped with the creating company, not the schema default');
    });
});
