"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const evidence_access_js_1 = __importDefault(require("./evidence-access.js"));
const signed_access_js_1 = require("../lib/signed-access.js");
async function get(path) {
    const app = (0, express_1.default)();
    app.use('/api/v1', evidence_access_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('bind failed');
    try {
        return (await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`)).status;
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
(0, node_test_1.default)('a garbage, expired or wrong-kind link never serves a file (404, not 401/500)', async () => {
    strict_1.default.equal(await get('/evidence-files/garbage'), 404);
    const expired = (0, signed_access_js_1.createSignedAccessToken)({ kind: 'transfer-evidence', resource: 't/e', companyId: 'c1', ttlSeconds: 1 }, Date.now() - 60_000).token;
    strict_1.default.equal(await get(`/evidence-files/${expired}`), 404);
    const wrongKind = (0, signed_access_js_1.createSignedAccessToken)({ kind: 'something-else', resource: 't/e', companyId: 'c1' }).token;
    strict_1.default.equal(await get(`/evidence-files/${wrongKind}`), 404);
});
(0, node_test_1.default)('a genuine link for a transfer that does not exist is still a 404 (no existence oracle)', async () => {
    const ok = (0, signed_access_js_1.createSignedAccessToken)({ kind: 'transfer-evidence', resource: 'no-such-transfer/e1', companyId: 'c1' }).token;
    strict_1.default.equal(await get(`/evidence-files/${ok}`), 404);
});
