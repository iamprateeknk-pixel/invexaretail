"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_WEB_ORIGINS = void 0;
exports.normalizeOrigin = normalizeOrigin;
exports.resolveAllowedOrigins = resolveAllowedOrigins;
exports.isAllowedOrigin = isAllowedOrigin;
exports.REQUIRED_WEB_ORIGINS = [
    'https://invexaretail.com',
    'https://www.invexaretail.com',
    'https://invexaretail-web.iamprateek-nk.workers.dev',
    'https://invexaretail.prateek160298.workers.dev',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
];
function normalizeOrigin(value) {
    const candidate = value.trim();
    if (!candidate)
        return null;
    try {
        return new URL(candidate).origin.toLowerCase();
    }
    catch {
        return candidate.replace(/\/+$/, '').toLowerCase();
    }
}
/**
 * Hostinger env can override ALLOWED_ORIGINS and accidentally drop the live
 * website. Always keep normalized production origins, then add extras.
 */
function resolveAllowedOrigins(envValue) {
    return [...new Set([...exports.REQUIRED_WEB_ORIGINS, ...String(envValue ?? '').split(',')]
            .map(normalizeOrigin)
            .filter((origin) => Boolean(origin)))];
}
function isAllowedOrigin(origin, allowedOrigins = resolveAllowedOrigins(process.env.ALLOWED_ORIGINS)) {
    if (!origin)
        return true;
    const normalized = normalizeOrigin(origin);
    return Boolean(normalized && allowedOrigins.includes(normalized));
}
