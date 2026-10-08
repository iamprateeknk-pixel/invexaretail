import { type NextFunction, type Request, type Response, Router } from 'express';
import { ControlPlaneError, controlPlane, type ScopeContext } from '../lib/saas/control-plane.js';
import { scheduleControlPlanePersist, syncOperationalCompanies } from '../lib/saas/persistence.js';
import { provisionOperationalTenant } from '../lib/saas/provision-tenant.js';
import { applyStripeCheckoutEvent, billingProviderName, confirmLocalStripeCheckout, createBillingCheckout, stripeAdapter, verifyStripeSignature } from '../lib/saas/billing-provider.js';
import * as enterprise from '../lib/enterprise-repository.js';
import { persistEnterpriseUser } from '../lib/persistence.js';
import { validateEmail } from '../lib/otp-auth.js';
import { defaultImportProfile, ImportProfileError, importTemplateCsv, normalizeImportProfile } from '../lib/import-profile.js';
import { createHandoff, redeemHandoff } from '../lib/saas/session-handoff.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof ControlPlaneError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: 'Internal control-plane error', code: 'INTERNAL_ERROR' });
}

function bearer(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new ControlPlaneError('Authentication required', 'UNAUTHENTICATED', 401);
  }
  return header.slice(7);
}

function requirePlatform(req: Request, _res: Response, next: NextFunction): void {
  try {
    const { scope, payload, session } = controlPlane.requireControlSession(bearer(req));
    if (payload.sessionType !== 'platform' && payload.sessionType !== 'control') {
      throw new ControlPlaneError('Platform credentials required', 'FORBIDDEN', 403);
    }
    req.controlScope = scope;
    req.controlSessionType = payload.sessionType;
    req.controlSession = session;
    next();
  } catch (error) {
    sendError(_res, error);
  }
}

function requireScope(req: Request): ScopeContext {
  if (!req.controlScope) {
    throw new ControlPlaneError('Authentication required', 'UNAUTHENTICATED', 401);
  }
  return req.controlScope;
}

function requireLockedCompany(req: Request, res: Response, next: NextFunction): void {
  try {
    const { scope, payload, session } = controlPlane.requireControlSession(bearer(req));
    if (payload.sessionType !== 'control' || !scope.companyId) {
      throw new ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
    }
    req.controlScope = scope;
    req.controlSessionType = payload.sessionType;
    req.controlSession = session;
    next();
  } catch (error) {
    sendError(res, error);
  }
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function scopedCompany(req: Request): string {
  const scope = requireScope(req);
  const companyId = scope.companyId;
  if (!companyId) throw new ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
  const requested = param(req, 'companyId') || undefined;
  if (requested) controlPlane.assertCompanyScope(scope, requested);
  return companyId;
}

export const controlRouter = Router();
export const studioRouter = Router();
export const syncRouter = Router();

function persistOnSuccess(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && res.statusCode < 400) {
      scheduleControlPlanePersist();
    }
  });
  next();
}

controlRouter.use(persistOnSuccess);
studioRouter.use(persistOnSuccess);
syncRouter.use(persistOnSuccess);

controlRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    await syncOperationalCompanies().catch(() => 0);
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    res.json({ success: true, ...controlPlane.platformLogin(email, password) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.get('/plans', requirePlatform, (_req: Request, res: Response) => {
  res.json({ success: true, plans: controlPlane.listPlans() });
});

controlRouter.get('/companies', requirePlatform, async (_req: Request, res: Response) => {
  await syncOperationalCompanies().catch(() => 0);
  res.json({
    success: true,
    companies: [...controlPlane.companies.values()].map((company) => controlPlane.publicCompany(company)),
  });
});

controlRouter.post('/companies', requirePlatform, async (req: Request, res: Response) => {
  try {
    const scope = requireScope(req);
    const adminEmail = String(req.body?.adminEmail ?? '').trim().toLowerCase();
    if (!validateEmail(adminEmail)) {
      throw new ControlPlaneError('Admin email is required', 'INVALID_EMAIL', 400);
    }
    if (enterprise.findUserByEmail(adminEmail)) {
      throw new ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
    }
    const { company, temporaryPassword } = controlPlane.createCompany(scope, {
      name: String(req.body?.name ?? ''),
      planId: String(req.body?.planId ?? 'starter'),
      adminEmail,
      adminName: String(req.body?.adminName ?? 'Company Admin'),
    });
    const admin = controlPlane.companyUsers.get(company.primaryAdminId);
    if (!admin) throw new ControlPlaneError('Company admin was not created', 'INTERNAL_ERROR', 500);
    const provisioned = await provisionOperationalTenant({
      companyId: company.id,
      companyName: company.name,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        passwordHash: admin.passwordHash,
      },
    });
    res.status(201).json({
      success: true,
      company: controlPlane.publicCompany(company),
      admin: { id: admin.id, email: admin.email, name: admin.name, temporaryPassword },
      location: provisioned.location,
    });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/sessions/select-company', requirePlatform, (req: Request, res: Response) => {
  try {
    const companyId = String(req.body?.companyId ?? '');
    const result = controlPlane.selectCompany(requireScope(req).actorId, companyId);
    res.json({
      success: true,
      session: result.session,
      token: result.token,
      company: controlPlane.publicCompany(controlPlane.requireCompany(companyId)),
    });
  } catch (error) {
    sendError(res, error);
  }
});

// One-time handoff of a locked-company session from the admin panel to the Control Plane UI
// (different origins). Only a short code travels in the URL; see lib/saas/session-handoff.ts.
controlRouter.post('/sessions/handoff', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const session = req.body?.session;
    // The caller can only hand off the session it is itself authenticated with.
    if (!session || typeof session !== 'object' || (session as { controlToken?: unknown }).controlToken !== bearer(req)) {
      throw new ControlPlaneError("Handoff must carry the caller's own control session", 'INVALID_HANDOFF', 400);
    }
    res.status(201).json({ success: true, ...createHandoff(session) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/sessions/handoff/exchange', (req: Request, res: Response) => {
  const session = redeemHandoff(String(req.body?.code ?? ''));
  if (!session) {
    res.status(401).json({ error: 'Handoff code is invalid or expired', code: 'HANDOFF_INVALID' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, session });
});

controlRouter.post('/sessions/exit', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const scope = requireScope(req);
    const sessionId = scope.companySessionId!;
    controlPlane.exitSession(sessionId, scope.actorId);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.get('/session', requireLockedCompany, (req: Request, res: Response) => {
  res.json({
    success: true,
    session: req.controlSession,
    company: controlPlane.publicCompany(controlPlane.requireCompany(requireScope(req).companyId!)),
    scope: requireScope(req),
  });
});

controlRouter.post('/companies/:companyId/suspend', requirePlatform, (req: Request, res: Response) => {
  try {
    const company = controlPlane.setCompanyStatus(requireScope(req), param(req, 'companyId'), 'suspended', String(req.body?.reason ?? 'suspended'));
    res.json({ success: true, company });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/companies/:companyId/activate', requirePlatform, (req: Request, res: Response) => {
  try {
    const company = controlPlane.setCompanyStatus(requireScope(req), param(req, 'companyId'), 'active', String(req.body?.reason ?? 'activated'));
    res.json({ success: true, company });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.put('/companies/:companyId/plan', requirePlatform, (req: Request, res: Response) => {
  try {
    const result = controlPlane.assignPlan(
      requireScope(req),
      param(req, 'companyId'),
      String(req.body?.planId ?? ''),
      String(req.body?.reason ?? 'plan change'),
    );
    res.json({ success: true, ...result, company: controlPlane.publicCompany(result.company) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/companies/:companyId/entitlement-overrides', requirePlatform, (req: Request, res: Response) => {
  try {
    controlPlane.overrideEntitlement(
      requireScope(req),
      param(req, 'companyId'),
      String(req.body?.featureKey ?? ''),
      Boolean(req.body?.enabled),
      String(req.body?.reason ?? 'override'),
    );
    res.json({ success: true, company: controlPlane.publicCompany(controlPlane.requireCompany(param(req, 'companyId'))) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.get('/users', requireLockedCompany, (req: Request, res: Response) => {
  res.json({ success: true, users: controlPlane.listCompanyUsers(scopedCompany(req)) });
});

controlRouter.post('/users', requireLockedCompany, async (req: Request, res: Response) => {
  try {
    const user = controlPlane.createCompanyUser(requireScope(req), {
      email: String(req.body?.email ?? ''),
      name: String(req.body?.name ?? ''),
      role: String(req.body?.role ?? 'STORE_USER'),
    });
    const assignable: enterprise.Role[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
    if (assignable.includes(user.role as enterprise.Role) && !enterprise.findUserByEmail(user.email)) {
      const record = controlPlane.companyUsers.get(user.id);
      enterprise.createEnhancedUser({
        id: user.id,
        companyId: user.companyId,
        email: user.email,
        name: user.name,
        role: user.role as enterprise.Role,
        branchIds: [],
        locationIds: [],
        passwordHash: record?.passwordHash,
        status: user.status === 'active' ? 'active' : 'inactive',
      });
      await persistEnterpriseUser({
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash: record?.passwordHash ?? '',
        role: user.role as enterprise.Role,
        locationIds: [],
        companyId: user.companyId,
      });
    }
    res.status(201).json({ success: true, user });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/users/:userId/reset-password', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const result = controlPlane.resetPassword(requireScope(req), param(req, 'userId'));
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.delete('/users/:userId', requireLockedCompany, (req: Request, res: Response) => {
  try {
    controlPlane.deleteCompanyUser(requireScope(req), param(req, 'userId'));
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.get('/audit', requirePlatform, (req: Request, res: Response) => {
  const companyId = requireScope(req).companyId;
  const events = controlPlane.audit.filter((event) => !companyId || event.companyId === companyId);
  res.json({ success: true, events: events.slice(-200) });
});

controlRouter.get('/health', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(controlPlane.health());
});

controlRouter.post('/safety/kill-switches', requirePlatform, (req: Request, res: Response) => {
  try {
    controlPlane.setKillSwitch(
      requireScope(req),
      String(req.body?.featureKey ?? ''),
      Boolean(req.body?.enabled),
      String(req.body?.reason ?? 'safety'),
    );
    res.json({ success: true, safety: Object.fromEntries(controlPlane.safety.entries()) });
  } catch (error) {
    sendError(res, error);
  }
});

function billingPayload(companyId: string) {
  return { provider: billingProviderName(), adapter: stripeAdapter(), ...controlPlane.billingSnapshot(companyId) };
}

controlRouter.get('/billing', requireLockedCompany, (req: Request, res: Response) => {
  res.json({ success: true, ...billingPayload(scopedCompany(req)) });
});

controlRouter.post('/billing/usage', requireLockedCompany, (req: Request, res: Response) => {
  controlPlane.recordUsage(scopedCompany(req), String(req.body?.meter ?? 'api_requests'), Number(req.body?.increment ?? 1));
  res.json({ success: true, ...billingPayload(scopedCompany(req)) });
});

controlRouter.post('/billing/invoices', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const invoice = controlPlane.issueInvoice(requireScope(req), scopedCompany(req));
    res.status(201).json({ success: true, invoice, ...billingPayload(scopedCompany(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/billing/invoices/:invoiceId/pay', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const invoice = controlPlane.payInvoice(requireScope(req), param(req, 'invoiceId'));
    res.json({ success: true, invoice, ...billingPayload(scopedCompany(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/billing/invoices/:invoiceId/past-due', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const invoice = controlPlane.markInvoicePastDue(requireScope(req), param(req, 'invoiceId'));
    res.json({ success: true, invoice, ...billingPayload(scopedCompany(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/billing/checkout', requireLockedCompany, async (req: Request, res: Response) => {
  try {
    const result = await createBillingCheckout(requireScope(req), scopedCompany(req), {
      successUrl: typeof req.body?.successUrl === 'string' ? req.body.successUrl : undefined,
      cancelUrl: typeof req.body?.cancelUrl === 'string' ? req.body.cancelUrl : undefined,
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/billing/stripe/confirm', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const sessionId = String(req.body?.sessionId ?? '');
    const result = confirmLocalStripeCheckout(requireScope(req), sessionId);
    res.json({ success: true, ...result, ...billingPayload(result.invoice.companyId) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/billing/webhooks/stripe', (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_SECRET_KEY;
  const payload = req.rawBody ?? JSON.stringify(req.body ?? {});
  const header = String(req.headers['stripe-signature'] ?? '');
  if (!secret || !verifyStripeSignature(secret, payload, header)) {
    res.status(400).json({ error: 'Invalid Stripe signature', code: 'STRIPE_SIGNATURE_INVALID' });
    return;
  }
  try {
    const result = applyStripeCheckoutEvent((req.body ?? {}) as Record<string, unknown>);
    res.json({ success: true, ...result, ...billingPayload(result.invoice.companyId) });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/integrations/api-keys', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const key = controlPlane.createApiKey(requireScope(req), String(req.body?.name ?? 'default'), Array.isArray(req.body?.scopes) ? req.body.scopes : ['read']);
    res.status(201).json({ success: true, ...key });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/integrations/api-keys/:keyId/revoke', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const apiKey = controlPlane.revokeApiKey(requireScope(req), param(req, 'keyId'));
    res.json({ success: true, apiKey });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/integrations/api-keys/:keyId/rotate', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const key = controlPlane.rotateApiKey(requireScope(req), param(req, 'keyId'));
    res.status(201).json({ success: true, ...key });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.get('/integrations', requireLockedCompany, (req: Request, res: Response) => {
  const companyId = scopedCompany(req);
  res.json({
    success: true,
    apiKeys: [...controlPlane.apiKeys.values()].filter((key) => key.companyId === companyId).map(({ hash: _hash, ...key }) => key),
    webhooks: [...controlPlane.publicWebhooks(companyId)],
    connectors: [...controlPlane.connectors.values()].filter((connector) => connector.companyId === companyId),
  });
});

controlRouter.post('/integrations/webhooks', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const webhook = controlPlane.createWebhook(
      requireScope(req),
      String(req.body?.url ?? ''),
      Array.isArray(req.body?.events) ? req.body.events : [],
      String(req.body?.name ?? 'Ops webhook'),
    );
    res.status(201).json({ success: true, webhook });
  } catch (error) {
    sendError(res, error);
  }
});

controlRouter.post('/integrations/connectors', requireLockedCompany, (req: Request, res: Response) => {
  try {
    const connector = controlPlane.upsertConnector(requireScope(req), String(req.body?.type ?? 'pos'));
    res.status(201).json({ success: true, connector });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.use(requireLockedCompany);

// Import columns: order, names, required flags, extra header aliases and custom columns.
studioRouter.get('/import-profile', (req: Request, res: Response) => {
  const companyId = scopedCompany(req);
  const saved = controlPlane.importProfiles.get(companyId);
  res.json({
    success: true,
    profile: saved ?? defaultImportProfile(),
    isDefault: !saved,
    templateCsv: importTemplateCsv(saved),
  });
});

studioRouter.put('/import-profile', (req: Request, res: Response) => {
  try {
    const companyId = scopedCompany(req);
    const profile = normalizeImportProfile(req.body);
    controlPlane.importProfiles.set(companyId, profile);
    controlPlane.auditEvent({
      actorUserId: requireScope(req).actorId,
      actorType: 'platform',
      tenantId: controlPlane.tenantId,
      companyId,
      sessionId: requireScope(req).companySessionId,
      action: 'IMPORT_PROFILE_UPDATED',
      entityType: 'import_profile',
      entityId: profile.importType,
      before: null,
      after: { columns: profile.fields.filter((field) => field.enabled).map((field) => field.label) },
    });
    res.json({ success: true, profile, isDefault: false, templateCsv: importTemplateCsv(profile) });
  } catch (error) {
    if (error instanceof ImportProfileError) {
      res.status(400).json({ success: false, error: error.message, code: 'INVALID_IMPORT_PROFILE' });
      return;
    }
    sendError(res, error);
  }
});

studioRouter.delete('/import-profile', (req: Request, res: Response) => {
  const companyId = scopedCompany(req);
  controlPlane.importProfiles.delete(companyId);
  res.json({ success: true, profile: defaultImportProfile(), isDefault: true, templateCsv: importTemplateCsv(undefined) });
});

studioRouter.get('/draft', (req: Request, res: Response) => {
  res.json({ success: true, draft: controlPlane.ensureDraft(requireScope(req)), diff: controlPlane.diff(scopedCompany(req)) });
});

studioRouter.post('/draft/stock/columns', (req: Request, res: Response) => {
  try {
    const draft = controlPlane.addStockColumn(requireScope(req), {
      name: String(req.body?.name ?? ''),
      key: String(req.body?.key ?? ''),
      type: String(req.body?.type ?? 'number'),
      required: Boolean(req.body?.required),
      defaultValue: req.body?.defaultValue ?? 0,
      placement: req.body?.placement,
      visibleRoles: req.body?.visibleRoles,
      editableRoles: req.body?.editableRoles,
    });
    res.json({ success: true, draft });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/fields', (req: Request, res: Response) => {
  try {
    const draft = controlPlane.addField(requireScope(req), {
      entityType: String(req.body?.entityType ?? 'stock'),
      key: String(req.body?.key ?? ''),
      name: String(req.body?.name ?? ''),
      type: String(req.body?.type ?? 'text'),
      required: Boolean(req.body?.required),
      defaultValue: req.body?.defaultValue,
      visibleRoles: req.body?.visibleRoles,
      editableRoles: req.body?.editableRoles,
    });
    res.json({ success: true, draft });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/draft/actions/:actionKey', (req: Request, res: Response) => {
  try {
    const draft = controlPlane.setActionEnabled(requireScope(req), param(req, 'actionKey'), Boolean(req.body?.enabled));
    res.json({ success: true, draft });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/draft/tabs/:tabKey', (req: Request, res: Response) => {
  try {
    const draft = controlPlane.moveTab(requireScope(req), param(req, 'tabKey'), Number(req.body?.order ?? 1));
    res.json({ success: true, draft });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/preview', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      preview: controlPlane.preview(requireScope(req), {
        role: String(req.body?.role ?? 'ADMIN'),
        device: req.body?.device === 'mobile' || req.body?.device === 'tablet' ? req.body.device : 'desktop',
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/publish', (req: Request, res: Response) => {
  try {
    const published = controlPlane.publish(requireScope(req));
    res.json({ success: true, published, runtime: controlPlane.runtimeConfig(scopedCompany(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/rollback', (req: Request, res: Response) => {
  try {
    const published = controlPlane.rollback(requireScope(req), Number(req.body?.version));
    res.json({ success: true, published });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.get('/runtime', (req: Request, res: Response) => {
  res.json({ success: true, runtime: controlPlane.runtimeConfig(scopedCompany(req), String(req.query.role ?? 'ADMIN')) });
});

studioRouter.get('/modules', (_req: Request, res: Response) => {
  res.json({ success: true, ...controlPlane.moduleRegistry() });
});

studioRouter.post('/modules/:moduleKey', (req: Request, res: Response) => {
  try {
    controlPlane.setCompanyModule(requireScope(req), param(req, 'moduleKey'), Boolean(req.body?.enabled));
    res.json({ success: true, runtime: controlPlane.runtimeConfig(scopedCompany(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.get('/workflows', (req: Request, res: Response) => {
  res.json({ success: true, workflows: controlPlane.ensureDraft(requireScope(req)).workflows });
});

studioRouter.post('/workflows', (req: Request, res: Response) => {
  try {
    const draft = controlPlane.upsertWorkflow(requireScope(req), req.body);
    res.json({ success: true, draft });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/workflows/simulate', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      simulation: controlPlane.simulateWorkflow(scopedCompany(req), String(req.body?.key ?? 'transfer.approval'), { value: Number(req.body?.value ?? 0) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/rules', (req: Request, res: Response) => {
  try {
    res.json({ success: true, draft: controlPlane.upsertRule(requireScope(req), req.body) });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/rules/evaluate', (req: Request, res: Response) => {
  res.json({ success: true, outcomes: controlPlane.evaluateRule(scopedCompany(req), req.body ?? {}) });
});

studioRouter.post('/reports', (req: Request, res: Response) => {
  try {
    res.json({ success: true, draft: controlPlane.upsertReport(requireScope(req), req.body) });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.post('/automations', (req: Request, res: Response) => {
  try {
    res.json({ success: true, draft: controlPlane.upsertAutomation(requireScope(req), req.body) });
  } catch (error) {
    sendError(res, error);
  }
});

studioRouter.get('/mobile-policy', (req: Request, res: Response) => {
  res.json({ success: true, policies: controlPlane.ensureDraft(requireScope(req)).mobilePolicies });
});

studioRouter.post('/mobile-policy', (req: Request, res: Response) => {
  try {
    const draft = controlPlane.upsertMobilePolicy(requireScope(req), {
      role: String(req.body?.role ?? ''),
      offlineMaxHours: Number(req.body?.offlineMaxHours ?? 0),
      syncScope: Array.isArray(req.body?.syncScope) ? req.body.syncScope.map(String) : [],
      navigation: Array.isArray(req.body?.navigation) ? req.body.navigation.map(String) : [],
      encryptedLocalStore: true,
    });
    res.json({ success: true, draft });
  } catch (error) {
    sendError(res, error);
  }
});

syncRouter.post('/mutations', (req: Request, res: Response) => {
  try {
    const auth = req.headers.authorization?.startsWith('Bearer ') ? controlPlane.requireControlSession(req.headers.authorization.slice(7)) : null;
    const requestedCompanyId = String(req.body?.companyId ?? '');
    const companyId = auth?.scope.companyId || requestedCompanyId;
    if (auth?.scope.companyId && requestedCompanyId) {
      controlPlane.assertCompanyScope(auth.scope, requestedCompanyId);
    }
    const mutation = controlPlane.enqueueMutation({
      mutationId: String(req.body?.mutationId ?? ''),
      tenantId: controlPlane.tenantId,
      companyId,
      userId: String(req.body?.userId ?? auth?.scope.actorId ?? ''),
      deviceId: String(req.body?.deviceId ?? ''),
      entityType: String(req.body?.entityType ?? 'inventory'),
      actionType: String(req.body?.actionType ?? 'STOCK_ADJUST'),
      payload: req.body?.payload ?? {},
    });
    res.json({ success: true, mutation });
  } catch (error) {
    sendError(res, error);
  }
});

syncRouter.get('/mutations', (req: Request, res: Response) => {
  const companyId = String(req.query.companyId ?? '');
  const mutations = [...controlPlane.mutations.values()].filter((mutation) => !companyId || mutation.companyId === companyId);
  res.json({ success: true, mutations });
});

syncRouter.post('/devices/register', (req: Request, res: Response) => {
  const device = controlPlane.registerDevice({
    companyId: String(req.body?.companyId ?? ''),
    userId: String(req.body?.userId ?? ''),
    appVersion: String(req.body?.appVersion ?? '2.0.0'),
  });
  res.status(201).json({ success: true, device });
});

syncRouter.post('/devices/:deviceId/revoke', (req: Request, res: Response) => {
  controlPlane.revokeDevice(param(req, 'deviceId'));
  res.json({ success: true });
});

syncRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    health: controlPlane.health(),
    pending: [...controlPlane.mutations.values()].filter((mutation) => mutation.status !== 'synced'),
  });
});

