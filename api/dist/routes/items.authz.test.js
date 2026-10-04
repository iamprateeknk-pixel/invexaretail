"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Manual adjustments/reversals post stock; only admins may. The role gate runs
// before any database work, so this needs no Postgres.
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const items_js_1 = __importDefault(require("./items.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', items_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    const call = async (path, email, body) => {
        const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${(0, otp_auth_js_1.generateJWT)(user.id, user.companyId)}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
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
(0, node_test_1.default)('store users, pickers, managers and auditors cannot adjust or reverse stock', async () => {
    await withServer(async (call) => {
        for (const email of ['store@retail.local', 'picker@retail.local', 'manager@retail.local', 'auditor@retail.local']) {
            strict_1.default.equal(await call('/items/item-1001/adjust', email, { locationId: 'l', lotId: 'l', qtyDelta: 5, reason: 'x', idempotencyKey: 'k' }), 403, `${email} adjust`);
            strict_1.default.equal(await call('/items/item-1001/movements/m1/reverse', email, { reason: 'x' }), 403, `${email} reverse`);
        }
    });
});
(0, node_test_1.default)('an admin passes the role gate and reaches request validation', async () => {
    await withServer(async (call) => {
        strict_1.default.equal(await call('/items/item-1001/adjust', 'admin@retail.local', {}), 400);
    });
});
