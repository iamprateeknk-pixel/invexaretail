"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const platform_js_1 = require("./platform.js");
(0, node_test_1.default)('platform metadata is stable and contains the supported operational workflows', () => {
    strict_1.default.deepEqual((0, platform_js_1.buildPlatformMeta)('abc123'), {
        ok: true,
        service: 'retail-inventory-api',
        apiVersion: platform_js_1.API_VERSION,
        release: 'abc123',
        capabilities: ['lot-stock', 'daily-import', 'stock-counts', 'transfers', 'offline-sync', 'saas-control-plane', 'platform-studio', 'generic-sync', 'company-isolation', 'billing-invoices', 'encrypted-sync', 'operational-kill-switches', 'tenant-suspension', 'tenant-onboarding', 'usage-metering', 'billing-checkout', 'plan-entitlements', 'api-key-auth', 'runtime-workspace', 'webhook-bridge', 'stripe-live', 'stripe-local', 'tenant-id', 'tenant-id-operational', 'drift-native'],
    });
});
