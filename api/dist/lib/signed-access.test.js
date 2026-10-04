"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const signed_access_js_1 = require("./signed-access.js");
const input = { kind: 'transfer-evidence', resource: 't1/e1', companyId: 'c1' };
(0, node_test_1.default)('a fresh link verifies and carries exactly its resource and company', () => {
    const { token } = (0, signed_access_js_1.createSignedAccessToken)(input);
    const claims = (0, signed_access_js_1.verifySignedAccessToken)(token);
    strict_1.default.equal(claims?.resource, 't1/e1');
    strict_1.default.equal(claims?.companyId, 'c1');
});
(0, node_test_1.default)('an expired link is rejected', () => {
    const past = Date.now() - 10 * 60_000;
    const { token } = (0, signed_access_js_1.createSignedAccessToken)({ ...input, ttlSeconds: 60 }, past);
    strict_1.default.equal((0, signed_access_js_1.verifySignedAccessToken)(token), null);
});
(0, node_test_1.default)('a tampered body or signature is rejected', () => {
    const { token } = (0, signed_access_js_1.createSignedAccessToken)(input);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ kind: 'transfer-evidence', resource: 't1/OTHER', companyId: 'c1', exp: 9999999999 })).toString('base64url');
    strict_1.default.equal((0, signed_access_js_1.verifySignedAccessToken)(`${forged}.${sig}`), null);
    strict_1.default.equal((0, signed_access_js_1.verifySignedAccessToken)(`${body}.${sig.slice(0, -2)}xx`), null);
    strict_1.default.equal((0, signed_access_js_1.verifySignedAccessToken)('garbage'), null);
    strict_1.default.equal((0, signed_access_js_1.verifySignedAccessToken)(`${token}.extra`), null);
});
(0, node_test_1.default)('ttl is capped so a link can never be made long-lived', () => {
    const { expiresAt } = (0, signed_access_js_1.createSignedAccessToken)({ ...input, ttlSeconds: 10 ** 9 });
    strict_1.default.ok(new Date(expiresAt).getTime() - Date.now() <= 3600 * 1000 + 1000);
});
