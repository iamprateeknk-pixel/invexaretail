export const API_VERSION = '2026-09';

export function runtimeReleaseId(env = process.env): string {
  const gitRelease = env.GITHUB_SHA?.slice(0, 12);
  return (env.INVEXA_ENV === 'staging' ? gitRelease : env.APP_VERSION || gitRelease) || 'unknown';
}

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
