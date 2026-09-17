export const API_VERSION = '2026-09';

export const PLATFORM_CAPABILITIES = [
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
] as const;

export function buildPlatformMeta(release: string) {
  return {
    ok: true,
    service: 'retail-inventory-api',
    apiVersion: API_VERSION,
    release,
    capabilities: [...PLATFORM_CAPABILITIES],
  };
}
