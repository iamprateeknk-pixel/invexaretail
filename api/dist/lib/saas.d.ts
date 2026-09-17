export type SaasModule = 'counts' | 'transfers' | 'oms' | 'intelligence' | 'connectors' | 'qc' | 'bins';
export type SaasPlan = {
    code: string;
    name: string;
    description: string;
    maxUsers: number;
    maxLocations: number;
    modules: SaasModule[];
    active: boolean;
};
export type TenantRecord = {
    id: string;
    name: string;
    slug: string;
    status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
    planCode: string;
    adminEmail: string;
    createdAt: string;
};
export type TenantSubscription = {
    id: string;
    tenantId: string;
    planCode: string;
    status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
    startedAt: string;
    expiresAt: string | null;
};
export declare const SAAS_PLANS: SaasPlan[];
export declare function findPlan(code: string): SaasPlan | undefined;
export declare function planAllows(plan: SaasPlan | undefined, module: SaasModule): boolean;
export declare function slugifyTenantName(name: string): string;
export type OnboardInput = {
    companyName: string;
    adminName: string;
    adminEmail: string;
    planCode: string;
};
export declare function validateOnboardInput(input: OnboardInput): string | null;
export declare function resetSaasStore(): void;
export declare function listTenants(): TenantRecord[];
export declare function listSubscriptions(): TenantSubscription[];
export declare function getTenant(id: string): TenantRecord | undefined;
export declare function getTenantSubscription(tenantId: string): TenantSubscription | undefined;
export declare function tenantAllows(tenantId: string, module: SaasModule): boolean;
export declare function provisionTenant(input: OnboardInput): {
    tenant: TenantRecord;
    subscription: TenantSubscription;
};
