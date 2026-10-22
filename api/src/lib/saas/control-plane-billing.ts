import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from '../otp-auth.js';
import { PLAN_PRICES } from './tenant-scope.js';
import { ControlPlaneError, nowIso } from './control-plane.js';
import type { CompanyStatus, ScopeContext, PlanTemplate, CompanyRecord, BillingInvoice, AuditEvent, ConfigStatus, ConfigurationVersion } from './control-plane.js';
import type { ControlPlaneStore } from './control-plane-store.js';

/** Cross-calls the billing/entitlements area needs from the facade (they stay on ControlPlane). */
export interface ControlPlaneBillingHost {
  requireCompany(companyId: string): CompanyRecord;
  assertCompanyScope(scope: ScopeContext, resourceCompanyId: string): void;
  auditEvent(input: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent;
  blankConfig(companyId: string, authorId: string, version: number, status: ConfigStatus): ConfigurationVersion;
}

/** Companies, plans, entitlements, billing and kill-switch (area S3 of the ControlPlane facade). */
export class ControlPlaneBilling {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly host: ControlPlaneBillingHost,
  ) {}

  listPlans(): PlanTemplate[] {
    return [...this.store.plans.values()].map((plan) => ({ ...plan, limits: { ...plan.limits }, modules: { ...plan.modules } }));
  }

  createCompany(scope: ScopeContext, input: { name: string; planId: string; adminEmail: string; adminName: string }): { company: CompanyRecord; temporaryPassword: string } {
    if (scope.sessionType !== 'platform' || scope.companyId) {
      throw new ControlPlaneError('Unlocked platform session required to create companies', 'SESSION_REQUIRED', 401);
    }
    const name = input.name.trim();
    const adminEmail = input.adminEmail.trim().toLowerCase();
    const adminName = input.adminName.trim() || 'Company Admin';
    if (name.length < 2) throw new ControlPlaneError('Company name is required', 'INVALID_COMPANY_NAME', 400);
    if (!adminEmail.includes('@')) throw new ControlPlaneError('Admin email is required', 'INVALID_EMAIL', 400);
    if ([...this.store.companyUsers.values()].some((user) => user.email === adminEmail)) {
      throw new ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
    }
    const plan = this.store.plans.get(input.planId);
    if (!plan) throw new ControlPlaneError('Unknown plan', 'PLAN_NOT_FOUND', 404);
    const id = `company-${randomBytes(4).toString('hex')}`;
    const adminId = `user-${randomBytes(4).toString('hex')}`;
    const temporaryPassword = `Invexa${randomBytes(3).toString('hex')}9A`;
    const company: CompanyRecord = {
      id,
      tenantId: this.store.tenantId,
      name,
      status: 'active',
      planId: input.planId,
      primaryAdminId: adminId,
      createdAt: nowIso(),
    };
    this.store.companies.set(id, company);
    this.store.companyUsers.set(adminId, {
      id: adminId,
      companyId: id,
      email: adminEmail,
      name: adminName,
      role: 'ADMIN',
      status: 'active',
      passwordHash: hashPassword(temporaryPassword),
      isPrimaryAdmin: true,
      createdAt: nowIso(),
    });
    this.store.entitlements.set(id, { ...plan.modules });
    this.store.usage.set(id, { users: 1, company_admins: 1, api_requests: 0 });
    const published = this.host.blankConfig(id, scope.actorId, 1, 'published');
    this.store.published.set(id, published);
    this.store.versions.set(id, [published]);
    this.store.billing.set(id, {
      subscription: PLAN_PRICES[input.planId] > 0 ? 'active' : 'trial',
      cycle: 'monthly',
      amount: PLAN_PRICES[input.planId] ?? 0,
    });
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: this.store.tenantId,
      companyId: id,
      sessionId: scope.companySessionId,
      action: 'COMPANY_CREATED',
      entityType: 'company',
      entityId: id,
      before: null,
      after: company,
    });
    return { company, temporaryPassword };
  }

  setCompanyStatus(scope: ScopeContext, companyId: string, status: CompanyStatus, reason: string): CompanyRecord {
    if (scope.sessionType !== 'platform' || scope.companyId) {
      this.host.assertCompanyScope(scope, companyId);
    }
    const company = this.host.requireCompany(companyId);
    const before = company.status;
    company.status = status;
    if (status === 'suspended') {
      for (const session of this.store.sessions.values()) {
        if (session.companyId === companyId && session.status === 'active') {
          session.status = 'closed';
        }
      }
    }
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: company.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: status === 'suspended' ? 'COMPANY_SUSPENDED' : 'COMPANY_ACTIVATED',
      entityType: 'company',
      entityId: companyId,
      before: { status: before },
      after: { status },
      reason,
    });
    return company;
  }

  assignPlan(scope: ScopeContext, companyId: string, planId: string, reason: string): { company: CompanyRecord; downgradePolicy?: string } {
    if (scope.sessionType !== 'platform' || scope.companyId) this.host.assertCompanyScope(scope, companyId);
    const company = this.host.requireCompany(companyId);
    const plan = this.store.plans.get(planId);
    if (!plan) throw new ControlPlaneError('Unknown plan', 'PLAN_NOT_FOUND', 404);
    const previous = company.planId;
    company.planId = planId;
    const current = this.store.entitlements.get(companyId) ?? {};
    this.store.entitlements.set(companyId, { ...plan.modules });
    const billing = this.store.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 };
    billing.amount = PLAN_PRICES[planId] ?? billing.amount;
    if (billing.amount > 0 && billing.subscription === 'trial') billing.subscription = 'active';
    this.store.billing.set(companyId, billing);
    const usage = this.store.usage.get(companyId) ?? {};
    let downgradePolicy: string | undefined;
    if ((usage.users ?? 0) > plan.limits.max_users) {
      downgradePolicy = 'block_new_creation';
    }
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: company.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'PLAN_ASSIGNED',
      entityType: 'company',
      entityId: companyId,
      before: { planId: previous, entitlements: current },
      after: { planId, entitlements: this.store.entitlements.get(companyId), downgradePolicy },
      reason,
    });
    return { company, downgradePolicy };
  }

  overrideEntitlement(scope: ScopeContext, companyId: string, featureKey: string, enabled: boolean, reason: string): void {
    const overrides = this.entitlementOverrides(companyId);
    overrides[featureKey] = enabled;
    this.store.limitOverrides.set(companyId, { ...this.store.limitOverrides.get(companyId) });
    this.store.entitlements.set(companyId, { ...(this.store.entitlements.get(companyId) ?? {}), [featureKey]: enabled });
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: this.store.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'ENTITLEMENT_OVERRIDE',
      entityType: 'entitlement',
      entityId: featureKey,
      before: null,
      after: { enabled },
      reason,
    });
  }

  entitlementOverrides(companyId: string): Record<string, boolean> {
    const record = this.store.entitlements.get(companyId) ?? {};
    return { ...record };
  }

  effectiveLimits(companyId: string): Record<string, number> {
    const company = this.host.requireCompany(companyId);
    const plan = this.store.plans.get(company.planId)!;
    return { ...plan.limits, ...(this.store.limitOverrides.get(companyId) ?? {}) };
  }

  isFeatureEnabled(companyId: string, featureKey: string): boolean {
    if (this.store.safety.get(featureKey) === false) return false;
    const company = this.host.requireCompany(companyId);
    const plan = this.store.plans.get(company.planId)!;
    const fromPlan = plan.modules[featureKey] ?? plan.capabilities[featureKey] ?? false;
    const companyValue = this.store.entitlements.get(companyId)?.[featureKey];
    if (this.store.safety.get(featureKey) === false) return false;
    return companyValue ?? fromPlan;
  }

  assertFeature(companyId: string, featureKey: string): void {
    if (this.store.safety.get(featureKey) === false) {
      throw new ControlPlaneError(`${featureKey} is disabled by a platform kill switch`, 'KILL_SWITCH', 403);
    }
    if (!this.isFeatureEnabled(companyId, featureKey)) {
      throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
  }

  assertLimit(companyId: string, limitKey: string, nextCount: number): void {
    const limits = this.effectiveLimits(companyId);
    const max = limits[limitKey];
    if (typeof max === 'number' && nextCount > max) {
      throw new ControlPlaneError(`Plan limit reached for ${limitKey}`, 'PLAN_LIMIT_REACHED', 403);
    }
  }

  assertBillingWritable(companyId: string): void {
    const company = this.host.requireCompany(companyId);
    if (company.status === 'suspended') {
      throw new ControlPlaneError('Company is suspended', 'COMPANY_SUSPENDED', 403);
    }
    if (this.store.billing.get(companyId)?.subscription === 'past_due') {
      throw new ControlPlaneError('Billing is past due; mutating control-plane actions are on hold', 'BILLING_HOLD', 402);
    }
  }

  issueInvoice(scope: ScopeContext, companyId: string): BillingInvoice {
    if (scope.sessionType !== 'platform' || scope.companyId) this.host.assertCompanyScope(scope, companyId);
    const billing = this.store.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 };
    const invoice: BillingInvoice = {
      id: randomUUID(),
      companyId,
      amount: billing.amount,
      cycle: billing.cycle,
      status: 'open',
      issuedAt: nowIso(),
      paidAt: null,
    };
    this.store.invoices.set(invoice.id, invoice);
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: scope.actorType,
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'INVOICE_ISSUED',
      entityType: 'invoice',
      entityId: invoice.id,
      before: null,
      after: { amount: invoice.amount, status: invoice.status },
    });
    return invoice;
  }

  payInvoice(scope: ScopeContext, invoiceId: string): BillingInvoice {
    const invoice = this.store.invoices.get(invoiceId);
    if (!invoice) throw new ControlPlaneError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    if (scope.sessionType !== 'platform' || scope.companyId) this.host.assertCompanyScope(scope, invoice.companyId);
    if (invoice.status === 'paid') return invoice;
    invoice.status = 'paid';
    invoice.paidAt = nowIso();
    const remainingPastDue = [...this.store.invoices.values()].some(
      (entry) =>
        entry.companyId === invoice.companyId
        && entry.id !== invoice.id
        && entry.status === 'past_due',
    );
    const billing = this.store.billing.get(invoice.companyId);
    if (billing && !remainingPastDue) {
      billing.subscription = billing.amount > 0 ? 'active' : 'trial';
    }
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: scope.actorType,
      tenantId: scope.tenantId,
      companyId: invoice.companyId,
      sessionId: scope.companySessionId,
      action: 'INVOICE_PAID',
      entityType: 'invoice',
      entityId: invoice.id,
      before: { status: 'open' },
      after: { status: 'paid' },
    });
    return invoice;
  }

  markInvoicePastDue(scope: ScopeContext, invoiceId: string): BillingInvoice {
    const invoice = this.store.invoices.get(invoiceId);
    if (!invoice) throw new ControlPlaneError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    if (scope.sessionType !== 'platform' || scope.companyId) this.host.assertCompanyScope(scope, invoice.companyId);
    invoice.status = 'past_due';
    const billing = this.store.billing.get(invoice.companyId) ?? { subscription: 'past_due', cycle: invoice.cycle, amount: invoice.amount };
    billing.subscription = 'past_due';
    this.store.billing.set(invoice.companyId, billing);
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: scope.actorType,
      tenantId: scope.tenantId,
      companyId: invoice.companyId,
      sessionId: scope.companySessionId,
      action: 'INVOICE_PAST_DUE',
      entityType: 'invoice',
      entityId: invoice.id,
      before: null,
      after: { status: 'past_due' },
    });
    return invoice;
  }

  listInvoices(companyId: string): BillingInvoice[] {
    return [...this.store.invoices.values()].filter((invoice) => invoice.companyId === companyId);
  }

  setKillSwitch(scope: ScopeContext, featureKey: string, enabled: boolean, reason: string): void {
    this.store.safety.set(featureKey, enabled);
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: this.store.tenantId,
      companyId: null,
      sessionId: scope.companySessionId,
      action: 'KILL_SWITCH',
      entityType: 'safety',
      entityId: featureKey,
      before: null,
      after: { enabled },
      reason,
    });
  }

}
