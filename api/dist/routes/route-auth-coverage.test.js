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
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
const core_js_1 = __importDefault(require("./core.js"));
const transfers_js_1 = __importDefault(require("./transfers.js"));
const branches_js_1 = __importDefault(require("./branches.js"));
const items_js_1 = __importDefault(require("./items.js"));
const catalog_procurement_js_1 = __importDefault(require("./catalog-procurement.js"));
const operations_extension_js_1 = __importDefault(require("./operations-extension.js"));
const campaigns_js_1 = __importDefault(require("./campaigns.js"));
const item_master_js_1 = __importDefault(require("./item-master.js"));
const import_control_center_js_1 = __importDefault(require("./import-control-center.js"));
const transfer_logistics_js_1 = __importDefault(require("./transfer-logistics.js"));
const command_center_js_1 = __importDefault(require("./command-center.js"));
// Security review (blueprint §35 and Appendix C "API authorization tests pass"):
// every route these routers register must refuse a caller with no credentials.
// The routes below are the ones that are meant to be reachable without a
// session; anything else that answers a token-less request is a hole.
const PUBLIC = [];
function collect(router) {
    const found = [];
    for (const layer of router.stack) {
        if (!layer.route)
            continue;
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
            if (typeof path !== 'string')
                continue;
            for (const method of Object.keys(layer.route.methods))
                found.push({ method: method.toUpperCase(), path });
        }
    }
    return found;
}
const fill = (path) => path.replace(/:[A-Za-z]+\??/g, 'probe').replace(/\*/g, 'probe');
(0, node_test_1.default)('no route on the operational routers answers a request that carries no credentials', async () => {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)('x'));
    const routers = [
        ['core', core_js_1.default], ['transfers', transfers_js_1.default], ['branches', branches_js_1.default], ['items', items_js_1.default], ['catalog-procurement', catalog_procurement_js_1.default], ['operations-extension', operations_extension_js_1.default],
        ['campaigns', campaigns_js_1.default], ['item-master', item_master_js_1.default], ['import-control-center', import_control_center_js_1.default],
        ['transfer-logistics', transfer_logistics_js_1.default], ['command-center', command_center_js_1.default],
    ];
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    for (const [, router] of routers)
        app.use('/api/v1', router);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('failed to bind test server');
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const open = [];
    let probed = 0;
    try {
        for (const [name, router] of routers) {
            for (const probe of collect(router)) {
                if (PUBLIC.includes(`${probe.method} ${probe.path}`))
                    continue;
                probed += 1;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 4000);
                try {
                    const response = await fetch(`${base}${fill(probe.path)}`, {
                        method: probe.method, signal: controller.signal,
                        headers: probe.method === 'GET' || probe.method === 'DELETE' ? {} : { 'Content-Type': 'application/json' },
                        body: probe.method === 'GET' || probe.method === 'DELETE' ? undefined : '{}',
                    });
                    await response.arrayBuffer().catch(() => undefined);
                    if (response.status !== 401 && response.status !== 403)
                        open.push(`${name}: ${probe.method} ${probe.path} -> ${response.status}`);
                }
                catch (error) {
                    open.push(`${name}: ${probe.method} ${probe.path} -> ${error instanceof Error ? error.name : 'error'}`);
                }
                finally {
                    clearTimeout(timer);
                }
            }
        }
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
    strict_1.default.ok(probed > 200, `expected to probe the whole API surface, only reached ${probed} routes`);
    strict_1.default.deepEqual(open, [], `routes reachable without credentials:\n${open.join('\n')}`);
});
