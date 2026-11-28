import test from 'node:test';
import assert from 'node:assert/strict';
import { API_VERSION, buildPlatformMeta, runtimeReleaseId } from './platform.js';

test('platform metadata is stable and contains the supported operational workflows', () => {
  assert.deepEqual(buildPlatformMeta('abc123'), {
    ok: true,
    service: 'retail-inventory-api',
    apiVersion: API_VERSION,
    release: 'abc123',
    capabilities: ['lot-stock', 'daily-import', 'stock-counts', 'transfers', 'offline-sync', 'saas-control-plane', 'platform-studio', 'generic-sync', 'company-isolation', 'billing-invoices', 'encrypted-sync', 'operational-kill-switches', 'tenant-suspension', 'tenant-onboarding', 'usage-metering', 'billing-checkout', 'plan-entitlements', 'api-key-auth', 'runtime-workspace', 'webhook-bridge', 'stripe-live', 'stripe-local', 'tenant-id', 'tenant-id-operational', 'drift-native'],
  });
});

test('staging API and worker use the Git release even when an app version is set', () => {
  const git = '1'.repeat(40);
  assert.equal(runtimeReleaseId({ INVEXA_ENV: 'staging', GITHUB_SHA: git, APP_VERSION: 'old' }), '1'.repeat(12));
  assert.equal(runtimeReleaseId({ APP_VERSION: 'local', GITHUB_SHA: git }), 'local');
  assert.equal(runtimeReleaseId({}), 'unknown');
});
