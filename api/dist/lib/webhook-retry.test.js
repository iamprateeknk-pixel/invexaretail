"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const webhook_retry_js_1 = require("./webhook-retry.js");
(0, node_test_1.default)('the backoff schedule increases with each attempt', () => {
    const delays = [0, 1, 2, 3, 4].map((count) => (0, webhook_retry_js_1.nextRetryDelayMs)(count));
    for (let index = 1; index < delays.length; index += 1) {
        strict_1.default.ok((delays[index] ?? 0) >= (delays[index - 1] ?? 0));
    }
});
(0, node_test_1.default)('the schedule is exhausted after 5 scheduled retries - dead-lettered, no further auto-retry', () => {
    strict_1.default.equal((0, webhook_retry_js_1.nextRetryDelayMs)(6), null);
    strict_1.default.equal((0, webhook_retry_js_1.nextRetryAt)(6), null);
    strict_1.default.equal((0, webhook_retry_js_1.isDeadLettered)(6), true);
    strict_1.default.equal((0, webhook_retry_js_1.isDeadLettered)(5), false);
});
(0, node_test_1.default)('nextRetryAt adds the backoff delay to the given time', () => {
    const from = new Date('2026-09-16T00:00:00.000Z');
    const result = (0, webhook_retry_js_1.nextRetryAt)(1, from);
    strict_1.default.equal(result, new Date(from.getTime() + ((0, webhook_retry_js_1.nextRetryDelayMs)(1) ?? 0)).toISOString());
});
(0, node_test_1.default)('hashPayload is deterministic and distinguishes different payloads', () => {
    strict_1.default.equal((0, webhook_retry_js_1.hashPayload)('{"a":1}'), (0, webhook_retry_js_1.hashPayload)('{"a":1}'));
    strict_1.default.notEqual((0, webhook_retry_js_1.hashPayload)('{"a":1}'), (0, webhook_retry_js_1.hashPayload)('{"a":2}'));
});
