"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_CAPABILITIES = exports.API_VERSION = void 0;
exports.buildPlatformMeta = buildPlatformMeta;
exports.API_VERSION = '2026-09';
exports.PLATFORM_CAPABILITIES = [
    'lot-stock',
    'daily-import',
    'stock-counts',
    'transfers',
    'offline-sync',
    'saas-control-plane',
    'platform-studio',
    'generic-sync',
    'company-isolation',
    'billing-invoices',
    'encrypted-sync',
    'operational-kill-switches',
    'tenant-suspension',
    'tenant-onboarding',
    'usage-metering',
    'billing-checkout',
    'plan-entitlements',
    'api-key-auth',
    'runtime-workspace',
    'webhook-bridge',
    'stripe-live',
    'stripe-local',
    'tenant-id',
    'tenant-id-operational',
    'drift-native',
];
function buildPlatformMeta(release) {
    return {
        ok: true,
        service: 'retail-inventory-api',
        apiVersion: exports.API_VERSION,
        release,
        capabilities: [...exports.PLATFORM_CAPABILITIES],
    };
}
