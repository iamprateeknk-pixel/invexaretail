import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { parseWebhookEndpoint, parseWebhookEvents, parseWebhookName } from '../webhook-events.js';
import { ControlPlaneError, nowIso } from './control-plane.js';
import type { PublicControlPlaneWebhook, PublicApiKey, ScopeContext, CompanyRecord, AuditEvent, BillingInvoice } from './control-plane.js';
import type { ControlPlaneStore } from './control-plane-store.js';

/** Cross-calls the integrations area needs from the facade (they stay on ControlPlane). */
export interface ControlPlaneIntegrationsHost {
  requireCompany(companyId: string): CompanyRecord;
  requireLockedCompany(scope: ScopeContext): string;
  auditEvent(input: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent;
  assertFeature(companyId: string, featureKey: string): void;
  effectiveLimits(companyId: string): Record<string, number>;
  isFeatureEnabled(companyId: string, featureKey: string): boolean;
  listInvoices(companyId: string): BillingInvoice[];
}

/** API keys, webhooks, connectors, usage, health and public snapshots (area S7 of the ControlPlane facade). */
export class ControlPlaneIntegrations {
  constructor(
    private readonly store: ControlPlaneStore,
    private readonly host: ControlPlaneIntegrationsHost,
  ) {}

  createApiKey(scope: ScopeContext, name: string, scopes: string[]): { id: string; token: string; prefix: string } {
    const companyId = this.host.requireLockedCompany(scope);
    this.host.assertFeature(companyId, 'INTEGRATIONS');
    this.host.assertFeature(companyId, 'api_access');
    const token = `invx_${randomBytes(16).toString('hex')}`;
    const id = randomUUID();
    const prefix = token.slice(0, 12);
    this.store.apiKeys.set(id, {
      id,
      companyId,
      name,
      prefix,
      hash: createHmac('sha256', jwtSecret()).update(token).digest('hex'),
      scopes,
      status: 'active',
    });
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'API_KEY_CREATED',
      entityType: 'api_key',
      entityId: id,
      before: null,
      after: { prefix, scopes },
    });
    return { id, token, prefix };
  }

  verifyApiKey(token: string): PublicApiKey | null {
    if (!token.startsWith('invx_')) return null;
    const expected = createHmac('sha256', jwtSecret()).update(token).digest('hex');
    let matched: { id: string; companyId: string; name: string; prefix: string; hash: string; scopes: string[]; status: 'active' | 'revoked' } | null = null;
    for (const key of this.store.apiKeys.values()) {
      if (key.hash.length !== expected.length || !timingSafeEqual(key.hash, expected)) continue;
      matched = key;
      break;
    }
    if (!matched) return null;
    if (matched.status !== 'active') {
      throw new ControlPlaneError('API key is revoked', 'API_KEY_REVOKED', 401);
    }
    if (!this.host.isFeatureEnabled(matched.companyId, 'INTEGRATIONS') || !this.host.isFeatureEnabled(matched.companyId, 'api_access')) {
      throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
    const { hash: _hash, ...publicKey } = matched;
    return publicKey;
  }

  revokeApiKey(scope: ScopeContext, keyId: string): PublicApiKey {
    const companyId = this.host.requireLockedCompany(scope);
    const key = this.store.apiKeys.get(keyId);
    if (!key || key.companyId !== companyId) {
      throw new ControlPlaneError('API key not found', 'API_KEY_NOT_FOUND', 404);
    }
    key.status = 'revoked';
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'API_KEY_REVOKED',
      entityType: 'api_key',
      entityId: key.id,
      before: { status: 'active' },
      after: { status: 'revoked' },
    });
    const { hash: _hash, ...publicKey } = key;
    return publicKey;
  }

  /**
   * Issues a replacement key with the same name and scopes and revokes the old
   * one in a single step, so a leaked or aging key can be replaced without a gap
   * in which two keys are valid. The new token is returned once and never again;
   * the audit record names both key ids, never a token.
   */

  rotateApiKey(scope: ScopeContext, keyId: string): { id: string; token: string; prefix: string; rotatedFrom: string } {
    const companyId = this.host.requireLockedCompany(scope);
    const old = this.store.apiKeys.get(keyId);
    if (!old || old.companyId !== companyId) {
      throw new ControlPlaneError('API key not found', 'API_KEY_NOT_FOUND', 404);
    }
    if (old.status !== 'active') {
      throw new ControlPlaneError('Only an active API key can be rotated', 'API_KEY_REVOKED', 409);
    }
    const created = this.createApiKey(scope, old.name, [...old.scopes]);
    old.status = 'revoked';
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'API_KEY_ROTATED',
      entityType: 'api_key',
      entityId: old.id,
      before: { status: 'active' },
      after: { status: 'revoked', replacedBy: created.id },
    });
    return { ...created, rotatedFrom: old.id };
  }

  createWebhook(scope: ScopeContext, url: string, events: string[], name = 'Ops webhook'): { id: string; signingSecret: string; name: string; url: string; events: string[] } {
    const companyId = this.host.requireLockedCompany(scope);
    this.host.assertFeature(companyId, 'INTEGRATIONS');
    const parsedEvents = parseWebhookEvents(events);
    const parsedUrl = parseWebhookEndpoint(url);
    const id = randomUUID();
    const signingSecret = randomBytes(32).toString('hex');
    this.store.webhooks.set(id, {
      id,
      companyId,
      name: parseWebhookName(name),
      url: parsedUrl.toString(),
      events: parsedEvents,
      status: 'active',
      signingSecret,
      createdAt: nowIso(),
    });
    this.host.auditEvent({
      actorUserId: scope.actorId,
      actorType: 'platform',
      tenantId: scope.tenantId,
      companyId,
      sessionId: scope.companySessionId,
      action: 'WEBHOOK_CREATED',
      entityType: 'webhook',
      entityId: id,
      before: null,
      after: { url: parsedUrl.toString(), events: parsedEvents },
    });
    return { id, signingSecret, name: parseWebhookName(name), url: parsedUrl.toString(), events: parsedEvents };
  }

  publicWebhooks(companyId: string): PublicControlPlaneWebhook[] {
    return [...this.store.webhooks.values()]
      .filter((hook) => hook.companyId === companyId)
      .map(({ signingSecret: _secret, ...hook }) => hook);
  }

  upsertConnector(scope: ScopeContext, type: string, status: 'healthy' | 'degraded' | 'down' = 'healthy'): { id: string } {
    const companyId = this.host.requireLockedCompany(scope);
    const id = randomUUID();
    this.store.connectors.set(id, { id, companyId, type, status });
    return { id };
  }

  recordUsage(companyId: string, meter: string, increment = 1): void {
    const usage = this.store.usage.get(companyId) ?? {};
    usage[meter] = (usage[meter] ?? 0) + increment;
    this.store.usage.set(companyId, usage);
  }

  health() {
    return {
      ok: true,
      service: 'invexa-control-plane',
      persistence: 'snapshot',
      companies: this.store.companies.size,
      sessions: [...this.store.sessions.values()].filter((session) => session.status === 'active').length,
      queueLag: this.store.outbox.length,
      syncPending: [...this.store.mutations.values()].filter((mutation) => mutation.status === 'pending_sync' || mutation.status === 'retry_scheduled').length,
      pastDueCompanies: [...this.store.billing.entries()].filter(([, billing]) => billing.subscription === 'past_due').map(([companyId]) => companyId),
      suspendedCompanies: [...this.store.companies.values()].filter((company) => company.status === 'suspended').map((company) => company.id),
      killSwitches: Object.fromEntries(this.store.safety.entries()),
    };
  }

  billingSnapshot(companyId: string) {
    return {
      companyId,
      planId: this.host.requireCompany(companyId).planId,
      billing: this.store.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 },
      usage: this.store.usage.get(companyId) ?? {},
      limits: this.host.effectiveLimits(companyId),
      invoices: this.host.listInvoices(companyId),
    };
  }

  publicCompany(company: CompanyRecord) {
    return {
      ...company,
      planId: company.planId,
      entitlements: this.store.entitlements.get(company.id) ?? {},
      limits: this.host.effectiveLimits(company.id),
      usage: this.store.usage.get(company.id) ?? {},
    };
  }
}

