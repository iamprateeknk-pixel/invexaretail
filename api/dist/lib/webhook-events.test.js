"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const webhook_events_js_1 = require("./webhook-events.js");
(0, node_test_1.default)('webhook events and names reject empty payloads', () => {
    strict_1.default.throws(() => (0, webhook_events_js_1.parseWebhookName)('x'), webhook_events_js_1.WebhookValidationError);
    strict_1.default.equal((0, webhook_events_js_1.parseWebhookName)('Slack ops'), 'Slack ops');
    strict_1.default.throws(() => (0, webhook_events_js_1.parseWebhookEvents)(['nope']), webhook_events_js_1.WebhookValidationError);
    strict_1.default.deepEqual((0, webhook_events_js_1.parseWebhookEvents)(['count.reviewed', 'count.reviewed', 'bogus']), ['count.reviewed']);
});
(0, node_test_1.default)('production endpoints must be public HTTPS', () => {
    strict_1.default.equal((0, webhook_events_js_1.parseWebhookEndpoint)('https://hooks.example.com/invexa').hostname, 'hooks.example.com');
    strict_1.default.throws(() => (0, webhook_events_js_1.parseWebhookEndpoint)('http://hooks.example.com/invexa'), /HTTPS/);
    strict_1.default.throws(() => (0, webhook_events_js_1.parseWebhookEndpoint)('https://127.0.0.1/hooks'), /public HTTPS/);
    strict_1.default.throws(() => (0, webhook_events_js_1.parseWebhookEndpoint)('https://192.168.1.9/hooks'), /public HTTPS/);
});
(0, node_test_1.default)('memory mode allows loopback HTTP receivers', () => {
    const local = (0, webhook_events_js_1.parseWebhookEndpoint)('http://127.0.0.1:4010/hooks', { allowPrivate: true });
    strict_1.default.equal(local.origin, 'http://127.0.0.1:4010');
});
(0, node_test_1.default)('HMAC signatures round-trip and reject tampering', () => {
    const body = '{"event":"count.reviewed"}';
    const secret = 's'.repeat(32);
    const signature = (0, webhook_events_js_1.signWebhookBody)(secret, body);
    strict_1.default.equal((0, webhook_events_js_1.verifyWebhookSignature)(secret, body, `sha256=${signature}`), true);
    strict_1.default.equal((0, webhook_events_js_1.verifyWebhookSignature)(secret, '{"event":"nope"}', `sha256=${signature}`), false);
    strict_1.default.equal((0, webhook_events_js_1.hashWebhookSecret)(secret).length, 64);
});
(0, node_test_1.default)('webhook secrets encrypt and decrypt with JWT_SECRET', () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-secret';
    const sealed = (0, webhook_events_js_1.encryptWebhookSecret)('plain-signing-secret');
    strict_1.default.notEqual(sealed, 'plain-signing-secret');
    strict_1.default.equal((0, webhook_events_js_1.decryptWebhookSecret)(sealed), 'plain-signing-secret');
    strict_1.default.equal((0, webhook_events_js_1.decryptWebhookSecret)('not-valid'), null);
    if (previous === undefined)
        delete process.env.JWT_SECRET;
    else
        process.env.JWT_SECRET = previous;
});
