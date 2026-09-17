"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookValidationError = exports.WEBHOOK_EVENTS = void 0;
exports.isWebhookEvent = isWebhookEvent;
exports.parseWebhookEvents = parseWebhookEvents;
exports.parseWebhookName = parseWebhookName;
exports.parseWebhookEndpoint = parseWebhookEndpoint;
exports.hashWebhookSecret = hashWebhookSecret;
exports.signWebhookBody = signWebhookBody;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.encryptWebhookSecret = encryptWebhookSecret;
exports.decryptWebhookSecret = decryptWebhookSecret;
const node_crypto_1 = require("node:crypto");
exports.WEBHOOK_EVENTS = ['stock.low', 'transfer.updated', 'purchase-order.received', 'count.reviewed'];
class WebhookValidationError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = 'WebhookValidationError';
    }
}
exports.WebhookValidationError = WebhookValidationError;
function isWebhookEvent(value) {
    return exports.WEBHOOK_EVENTS.includes(value);
}
function parseWebhookEvents(value) {
    const raw = Array.isArray(value) ? value : [];
    const events = [...new Set(raw.filter((event) => typeof event === 'string').map((event) => event.trim()).filter(isWebhookEvent))];
    if (events.length === 0) {
        throw new WebhookValidationError('Name and at least one event are required.');
    }
    return events;
}
function parseWebhookName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name.length < 2) {
        throw new WebhookValidationError('Name and at least one event are required.');
    }
    return name;
}
function isLoopbackHost(hostname) {
    const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function isPrivateHost(hostname) {
    if (isLoopbackHost(hostname))
        return true;
    const host = hostname.toLowerCase();
    if (host === '0.0.0.0' || host.endsWith('.local'))
        return true;
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!ipv4)
        return false;
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    return false;
}
function parseWebhookEndpoint(raw, options) {
    let endpoint;
    try {
        endpoint = new URL(String(raw || ''));
    }
    catch {
        throw new WebhookValidationError('A valid HTTPS webhook URL is required.');
    }
    if (options?.allowPrivate && isLoopbackHost(endpoint.hostname) && (endpoint.protocol === 'http:' || endpoint.protocol === 'https:')) {
        return endpoint;
    }
    if (endpoint.protocol !== 'https:') {
        throw new WebhookValidationError('A valid HTTPS webhook URL is required.');
    }
    if (isPrivateHost(endpoint.hostname)) {
        throw new WebhookValidationError('Webhook URL must be a public HTTPS endpoint.');
    }
    return endpoint;
}
function hashWebhookSecret(secret) {
    return (0, node_crypto_1.createHash)('sha256').update(secret).digest('hex');
}
function signWebhookBody(secret, body) {
    return (0, node_crypto_1.createHmac)('sha256', secret).update(body).digest('hex');
}
function verifyWebhookSignature(secret, body, signature) {
    const expected = signWebhookBody(secret, body);
    const actual = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(actual, 'hex');
    return expectedBuf.length === actualBuf.length && (0, node_crypto_1.timingSafeEqual)(expectedBuf, actualBuf);
}
function encryptionKey() {
    return (0, node_crypto_1.createHash)('sha256').update(process.env.JWT_SECRET || 'dev-secret-change-in-production').digest();
}
function encryptWebhookSecret(plain) {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}
function decryptWebhookSecret(payload) {
    if (!payload || !payload.includes('.'))
        return null;
    const [ivHex, tagHex, dataHex] = payload.split('.');
    if (!ivHex || !tagHex || !dataHex)
        return null;
    try {
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    }
    catch {
        return null;
    }
}
