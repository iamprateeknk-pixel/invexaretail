"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// Routers that apply `router.use(requireAuth)` reject unauthenticated requests
// before route matching, so a signature-authenticated route mounted after them
// is unreachable (the marketplace webhook answered 401 to everyone until this
// ordering was fixed). Guard the ordering statically: index.ts cannot be
// imported in a test because it starts the server.
(0, node_test_1.default)('signature-authenticated routers are mounted before every bearer-authenticated router', () => {
    const source = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src/index.ts'), 'utf8');
    const mountedAt = (name) => {
        const at = source.indexOf(`app.use('/api/v1', ${name})`);
        strict_1.default.notEqual(at, -1, `${name} must be mounted`);
        return at;
    };
    const authenticated = ['transfersRouter', 'branchesRouter', 'itemsRouter', 'importsRouter', 'reportsRouter', 'coreRouter', 'catalogProcurementRouter', 'operationsExtensionRouter'];
    for (const publicRouter of ['marketplaceWebhookRouter', 'evidenceAccessRouter']) {
        for (const guarded of authenticated) {
            strict_1.default.ok(mountedAt(publicRouter) < mountedAt(guarded), `${publicRouter} must precede ${guarded}`);
        }
    }
});
