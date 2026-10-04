"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Staged imports post stock in bulk. Only admins may stage/commit/reverse;
// auditors may read status and failures; every other role is refused BEFORE any
// database work happens (so this runs without Postgres).
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const imports_js_1 = __importDefault(require("./imports.js"));
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
    app.use('/api/v1', imports_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const call = async (method, path, email, body) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
            method,
            headers: { Authorization: `Bearer ${tokenFor(email)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return response.status;
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
const mutations = [
    ['POST', '/imports/staged/batches', { type: 'PURCHASE', fileName: 'x.csv', rows: [{ itemCode: 'A', quantity: '1' }] }],
    ['POST', '/imports/staged/batches/b1/validate'],
    ['POST', '/imports/staged/batches/b1/commit'],
    ['POST', '/imports/staged/batches/b1/reverse', { reason: 'x' }],
];
(0, node_test_1.default)('store users, pickers and managers cannot stage, validate, commit or reverse imports', async () => {
    await withServer(async (call) => {
        for (const email of ['store@retail.local', 'picker@retail.local', 'manager@retail.local', 'auditor@retail.local']) {
            for (const [method, path, body] of mutations) {
                strict_1.default.equal(await call(method, path, email, body), 403, `${email} ${method} ${path}`);
            }
        }
    });
});
(0, node_test_1.default)('reading a batch or its failures is refused for a store user but not by the role gate for an auditor', async () => {
    await withServer(async (call) => {
        strict_1.default.equal(await call('GET', '/imports/staged/batches/b1', 'store@retail.local'), 403);
        strict_1.default.equal(await call('GET', '/imports/staged/batches/b1/failures', 'picker@retail.local'), 403);
        // Past the role gate an auditor reaches the handler (which needs a database), so it is anything but 403.
        strict_1.default.notEqual(await call('GET', '/imports/staged/batches/b1', 'auditor@retail.local'), 403);
    });
});
(0, node_test_1.default)('an admin passes the role gate (validation of the body still applies)', async () => {
    await withServer(async (call) => {
        strict_1.default.equal(await call('POST', '/imports/staged/batches', 'admin@retail.local', { type: 'NOPE', fileName: 'x.csv', rows: [{}] }), 400);
    });
});
