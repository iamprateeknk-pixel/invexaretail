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
const core_js_1 = __importDefault(require("./core.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const kill_switch_js_1 = require("../lib/saas/kill-switch.js");
const control_plane_js_1 = require("../lib/saas/control-plane.js");
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
    app.use('/api/v1', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, tenant_scope_js_1.enforceOperationalCompanyScope, kill_switch_js_1.enforceOperationalKillSwitches, core_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const url = `http://127.0.0.1:${address.port}`;
    try {
        await run(url);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
async function json(url, path, token, init = {}) {
    const response = await fetch(`${url}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
}
(0, node_test_1.default)('HTTP: INVENTORY kill switch blocks item creates but still lists catalog', async () => {
    const platform = control_plane_js_1.controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
    control_plane_js_1.controlPlane.setKillSwitch(platform, 'INVENTORY', false, 'http-test');
    try {
        await withServer(async (url) => {
            const grocery = tokenFor('admin@retail.local');
            const listed = await json(url, '/api/v1/items', grocery);
            strict_1.default.equal(listed.status, 200);
            strict_1.default.equal(Array.isArray(listed.body.items), true);
            const created = await json(url, '/api/v1/items', grocery, {
                method: 'POST',
                body: JSON.stringify({ code: 'SKU-KILL-1', name: 'Kill switch snack', unit: 'pack' }),
            });
            strict_1.default.equal(created.status, 403);
            strict_1.default.equal(created.body.code, 'KILL_SWITCH');
            strict_1.default.equal(created.body.feature, 'INVENTORY');
            control_plane_js_1.controlPlane.setKillSwitch(platform, 'INVENTORY', true, 'http-test-restore');
            const restored = await json(url, '/api/v1/items', grocery, {
                method: 'POST',
                body: JSON.stringify({ code: `SKU-KILL-${Date.now()}`, name: 'Restored snack', unit: 'pack' }),
            });
            strict_1.default.equal(restored.status, 201);
            strict_1.default.equal(restored.body.success, true);
        });
    }
    finally {
        control_plane_js_1.controlPlane.setKillSwitch(platform, 'INVENTORY', true, 'http-test-restore');
    }
});
