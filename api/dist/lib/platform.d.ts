export declare const API_VERSION = "2026-09";
export declare const PLATFORM_CAPABILITIES: readonly ["lot-stock", "daily-import", "stock-counts", "transfers", "offline-sync", "saas-control-plane", "platform-studio", "generic-sync", "company-isolation", "billing-invoices", "encrypted-sync", "operational-kill-switches", "tenant-suspension", "tenant-onboarding", "usage-metering", "billing-checkout", "plan-entitlements", "api-key-auth", "runtime-workspace", "webhook-bridge", "stripe-live", "stripe-local", "tenant-id", "tenant-id-operational", "drift-native"];
export declare function buildPlatformMeta(release: string): {
    ok: boolean;
    service: string;
    apiVersion: string;
    release: string;
    capabilities: ("transfers" | "lot-stock" | "daily-import" | "stock-counts" | "offline-sync" | "saas-control-plane" | "platform-studio" | "generic-sync" | "company-isolation" | "billing-invoices" | "encrypted-sync" | "operational-kill-switches" | "tenant-suspension" | "tenant-onboarding" | "usage-metering" | "billing-checkout" | "plan-entitlements" | "api-key-auth" | "runtime-workspace" | "webhook-bridge" | "stripe-live" | "stripe-local" | "tenant-id" | "tenant-id-operational" | "drift-native")[];
};
