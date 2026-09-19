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
const inventory_js_1 = require("../lib/inventory.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
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
    app.use('/api/v1', enterprise_auth_js_1.extractToken, enterprise_auth_js_1.requireAuth, tenant_scope_js_1.enforceOperationalCompanyScope, core_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    try {
        await run(`http://127.0.0.1:${address.port}`);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}
async function getStock(url, locationId, token) {
    const response = await fetch(`${url}/api/v1/stock/${locationId}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
}
(0, node_test_1.default)('hidesZeroStockForRole only applies to operational roles', () => {
    strict_1.default.equal((0, inventory_js_1.hidesZeroStockForRole)('STORE_USER'), true);
    strict_1.default.equal((0, inventory_js_1.hidesZeroStockForRole)('WAREHOUSE_PICKER'), true);
    for (const role of ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR']) {
        strict_1.default.equal((0, inventory_js_1.hidesZeroStockForRole)(role), false);
    }
});
(0, node_test_1.default)('HTTP: store user and picker never see a zero-stock row, admin still does', async () => {
    // Drain item-1006 at loc-1 to exactly zero, keeping the row in the ledger.
    (0, repository_js_1.adjustStockLedger)('item-1006', 'lot-1006', 'loc-1', -12);
    try {
        await withServer(async (url) => {
            const store = await getStock(url, 'loc-1', tokenFor('store@retail.local'));
            strict_1.default.equal(store.status, 200);
            strict_1.default.equal(store.body.items.some((row) => row.itemId === 'item-1006'), false);
            strict_1.default.equal(store.body.items.some((row) => row.itemId === 'item-1001'), true);
            const admin = await getStock(url, 'loc-1', tokenFor('admin@retail.local'));
            strict_1.default.equal(admin.status, 200);
            strict_1.default.equal(admin.body.items.some((row) => row.itemId === 'item-1006'), true);
        });
    }
    finally {
        (0, repository_js_1.adjustStockLedger)('item-1006', 'lot-1006', 'loc-1', 12);
    }
});
(0, node_test_1.default)('parseItemOperationalMeta returns only provided keys and rejects bad enums', () => {
    strict_1.default.deepEqual((0, inventory_js_1.parseItemOperationalMeta)({}), {});
    strict_1.default.deepEqual((0, inventory_js_1.parseItemOperationalMeta)({ countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true }), { countMethod: 'ITEM_WEIGHT', allocationStrategy: 'FIFO', decimalQuantity: true });
    strict_1.default.throws(() => (0, inventory_js_1.parseItemOperationalMeta)({ countMethod: 'GUESS' }), /countMethod/);
    strict_1.default.throws(() => (0, inventory_js_1.parseItemOperationalMeta)({ pickMethod: 'RANDOM' }), /pickMethod/);
    strict_1.default.throws(() => (0, inventory_js_1.parseItemOperationalMeta)({ allocationStrategy: 'LIFO' }), /allocationStrategy/);
});
