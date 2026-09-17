import test from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, buildPlatformMeta } from './platform.js';

test('platform metadata is stable and contains the supported operational workflows', () => {
  assert.deepEqual(buildPlatformMeta('abc123'), {
    ok: true,
    service: 'retail-inventory-api',
    apiVersion: API_VERSION,
    release: 'abc123',
    capabilities: ['lot-stock', 'daily-import', 'stock-counts', 'transfers', 'offline-sync', 'saas-control-plane', 'platform-studio', 'generic-sync', 'company-isolation', 'billing-invoices', 'encrypted-sync', 'operational-kill-switches', 'tenant-suspension', 'tenant-onboarding', 'usage-metering', 'billing-checkout', 'plan-entitlements', 'api-key-auth', 'runtime-workspace', 'webhook-bridge', 'stripe-live', 'stripe-local', 'tenant-id', 'tenant-id-operational', 'drift-native'],
  });
});
