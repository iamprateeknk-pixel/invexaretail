"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSignedAccessToken = createSignedAccessToken;
exports.verifySignedAccessToken = verifySignedAccessToken;
const node_crypto_1 = require("node:crypto");
// Guide Week 18: evidence files are served behind short-lived, tenant-bound,
// signed links. A link names exactly one resource and one company and expires;
// nothing about the resource is guessable or reusable across tenants.
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;
function secret() {
    const configured = process.env.JWT_SECRET?.trim();
    if (configured)
        return `signed-access:${configured}`;
    if (process.env.NODE_ENV === 'production')
        throw new Error('JWT_SECRET must be configured in production.');
    return 'signed-access:dev-secret-key-change-in-production';
}
function sign(payload) {
    return (0, node_crypto_1.createHmac)('sha256', secret()).update(payload).digest('base64url');
}
function createSignedAccessToken(input, now = Date.now()) {
    const ttl = Math.min(Math.max(1, Math.floor(input.ttlSeconds ?? DEFAULT_TTL_SECONDS)), MAX_TTL_SECONDS);
    const claims = { kind: input.kind, resource: input.resource, companyId: input.companyId, exp: Math.floor(now / 1000) + ttl };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return { token: `${body}.${sign(body)}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}
/** Returns the claims only if the signature is genuine and the link has not expired; otherwise null. */
function verifySignedAccessToken(token, now = Date.now()) {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined)
        return null;
    const expected = sign(body);
    if (signature.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(Buffer.from(signature), Buffer.from(expected)))
        return null;
    try {
        const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now)
            return null;
        if (!claims.kind || !claims.resource || !claims.companyId)
            return null;
        return claims;
    }
    catch {
        return null;
    }
}
