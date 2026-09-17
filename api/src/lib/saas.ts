// Blueprint P11 Commercial SaaS: tenant onboarding, plan entitlements and
// subscription templates. The live inventory schema is still one physical
// database; isolation is by tenantId on the subscription + JWT companyId
// already issued at login. Feature gates are plan entitlements, not a
// second copy of every table.

export type SaasModule =
  | 'counts'
  | 'transfers'
  | 'oms'
  | 'intelligence'
  | 'connectors'
  | 'qc'
  | 'bins';

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

export const SAAS_PLANS: SaasPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Single-store counts, transfers and receiving.',
    maxUsers: 8,
    maxLocations: 2,
    modules: ['counts', 'transfers', 'qc'],
    active: true,
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'Multi-location OMS, intelligence and marketplace connectors.',
    maxUsers: 40,
    maxLocations: 15,
    modules: ['counts', 'transfers', 'oms', 'intelligence', 'connectors', 'qc', 'bins'],
    active: true,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited locations with every operational module.',
    maxUsers: 500,
    maxLocations: 250,
    modules: ['counts', 'transfers', 'oms', 'intelligence', 'connectors', 'qc', 'bins'],
    active: true,
  },
];

export function findPlan(code: string): SaasPlan | undefined {
  return SAAS_PLANS.find((plan) => plan.code === code && plan.active);
}

export function planAllows(plan: SaasPlan | undefined, module: SaasModule): boolean {
  if (!plan) return false;
  return plan.modules.includes(module);
}

export function slugifyTenantName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'tenant';
}

export type OnboardInput = {
  companyName: string;
  adminName: string;
  adminEmail: string;
  planCode: string;
};

export function validateOnboardInput(input: OnboardInput): string | null {
  if (!input.companyName.trim()) return 'Company name is required.';
  if (!input.adminName.trim()) return 'Admin name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.adminEmail.trim())) return 'A valid admin email is required.';
  if (!findPlan(input.planCode)) return 'Unknown or inactive plan.';
  return null;
}

const tenants: TenantRecord[] = [{
  id: 'default-company',
  name: 'Invexa Retail',
  slug: 'invexa-retail',
  status: 'ACTIVE',
  planCode: 'enterprise',
  adminEmail: 'admin@retail.local',
  createdAt: new Date(0).toISOString(),
}];

const subscriptions: TenantSubscription[] = [{
  id: 'sub-default',
  tenantId: 'default-company',
  planCode: 'enterprise',
  status: 'ACTIVE',
  startedAt: new Date(0).toISOString(),
  expiresAt: null,
}];

export function resetSaasStore(): void {
  tenants.splice(1);
  subscriptions.splice(1);
}

export function listTenants(): TenantRecord[] {
  return tenants.map((row) => ({ ...row }));
}

export function listSubscriptions(): TenantSubscription[] {
  return subscriptions.map((row) => ({ ...row }));
}

export function getTenant(id: string): TenantRecord | undefined {
  return tenants.find((row) => row.id === id);
}

export function getTenantSubscription(tenantId: string): TenantSubscription | undefined {
  return subscriptions.find((row) => row.tenantId === tenantId && row.status !== 'CANCELLED');
}

export function tenantAllows(tenantId: string, module: SaasModule): boolean {
  const sub = getTenantSubscription(tenantId);
  const plan = findPlan(sub?.planCode ?? getTenant(tenantId)?.planCode ?? '');
  return planAllows(plan, module);
}

export function provisionTenant(input: OnboardInput): { tenant: TenantRecord; subscription: TenantSubscription } {
  const error = validateOnboardInput(input);
  if (error) throw new Error(error);
  const plan = findPlan(input.planCode)!;
  const baseSlug = slugifyTenantName(input.companyName);
  let slug = baseSlug;
  let n = 2;
  while (tenants.some((row) => row.slug === slug)) {
    slug = `${baseSlug}-${n}`;
    n += 1;
  }
  const tenant: TenantRecord = {
    id: `tenant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.companyName.trim(),
    slug,
    status: 'TRIAL',
    planCode: plan.code,
    adminEmail: input.adminEmail.trim().toLowerCase(),
    createdAt: new Date().toISOString(),
  };
  const subscription: TenantSubscription = {
    id: `sub-${tenant.id}`,
    tenantId: tenant.id,
    planCode: plan.code,
    status: 'TRIAL',
    startedAt: tenant.createdAt,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  };
  tenants.push(tenant);
  subscriptions.push(subscription);
  return { tenant, subscription };
}
