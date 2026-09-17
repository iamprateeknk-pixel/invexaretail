"use strict";
// Blueprint P11 Commercial SaaS: tenant onboarding, plan entitlements and
// subscription templates. The live inventory schema is still one physical
// database; isolation is by tenantId on the subscription + JWT companyId
// already issued at login. Feature gates are plan entitlements, not a
// second copy of every table.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAAS_PLANS = void 0;
exports.findPlan = findPlan;
exports.planAllows = planAllows;
exports.slugifyTenantName = slugifyTenantName;
exports.validateOnboardInput = validateOnboardInput;
exports.resetSaasStore = resetSaasStore;
exports.listTenants = listTenants;
exports.listSubscriptions = listSubscriptions;
exports.getTenant = getTenant;
exports.getTenantSubscription = getTenantSubscription;
exports.tenantAllows = tenantAllows;
exports.provisionTenant = provisionTenant;
exports.SAAS_PLANS = [
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
function findPlan(code) {
    return exports.SAAS_PLANS.find((plan) => plan.code === code && plan.active);
}
function planAllows(plan, module) {
    if (!plan)
        return false;
    return plan.modules.includes(module);
}
function slugifyTenantName(name) {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug || 'tenant';
}
function validateOnboardInput(input) {
    if (!input.companyName.trim())
        return 'Company name is required.';
    if (!input.adminName.trim())
        return 'Admin name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.adminEmail.trim()))
        return 'A valid admin email is required.';
    if (!findPlan(input.planCode))
        return 'Unknown or inactive plan.';
    return null;
}
const tenants = [{
        id: 'default-company',
        name: 'Invexa Retail',
        slug: 'invexa-retail',
        status: 'ACTIVE',
        planCode: 'enterprise',
        adminEmail: 'admin@retail.local',
        createdAt: new Date(0).toISOString(),
    }];
const subscriptions = [{
        id: 'sub-default',
        tenantId: 'default-company',
        planCode: 'enterprise',
        status: 'ACTIVE',
        startedAt: new Date(0).toISOString(),
        expiresAt: null,
    }];
function resetSaasStore() {
    tenants.splice(1);
    subscriptions.splice(1);
}
function listTenants() {
    return tenants.map((row) => ({ ...row }));
}
function listSubscriptions() {
    return subscriptions.map((row) => ({ ...row }));
}
function getTenant(id) {
    return tenants.find((row) => row.id === id);
}
function getTenantSubscription(tenantId) {
    return subscriptions.find((row) => row.tenantId === tenantId && row.status !== 'CANCELLED');
}
function tenantAllows(tenantId, module) {
    const sub = getTenantSubscription(tenantId);
    const plan = findPlan(sub?.planCode ?? getTenant(tenantId)?.planCode ?? '');
    return planAllows(plan, module);
}
function provisionTenant(input) {
    const error = validateOnboardInput(input);
    if (error)
        throw new Error(error);
    const plan = findPlan(input.planCode);
    const baseSlug = slugifyTenantName(input.companyName);
    let slug = baseSlug;
    let n = 2;
    while (tenants.some((row) => row.slug === slug)) {
        slug = `${baseSlug}-${n}`;
        n += 1;
    }
    const tenant = {
        id: `tenant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: input.companyName.trim(),
        slug,
        status: 'TRIAL',
        planCode: plan.code,
        adminEmail: input.adminEmail.trim().toLowerCase(),
        createdAt: new Date().toISOString(),
    };
    const subscription = {
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
