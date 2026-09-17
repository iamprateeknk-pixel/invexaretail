"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRouter = exports.studioRouter = exports.controlRouter = void 0;
const express_1 = require("express");
const control_plane_js_1 = require("../lib/saas/control-plane.js");
const persistence_js_1 = require("../lib/saas/persistence.js");
const provision_tenant_js_1 = require("../lib/saas/provision-tenant.js");
const billing_provider_js_1 = require("../lib/saas/billing-provider.js");
const enterprise = __importStar(require("../lib/enterprise-repository.js"));
const persistence_js_2 = require("../lib/persistence.js");
const otp_auth_js_1 = require("../lib/otp-auth.js");
function sendError(res, error) {
    if (error instanceof control_plane_js_1.ControlPlaneError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
    }
    res.status(500).json({ error: 'Internal control-plane error', code: 'INTERNAL_ERROR' });
}
function bearer(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        throw new control_plane_js_1.ControlPlaneError('Authentication required', 'UNAUTHENTICATED', 401);
    }
    return header.slice(7);
}
function requirePlatform(req, _res, next) {
    try {
        const { scope, payload, session } = control_plane_js_1.controlPlane.requireControlSession(bearer(req));
        if (payload.sessionType !== 'platform' && payload.sessionType !== 'control') {
            throw new control_plane_js_1.ControlPlaneError('Platform credentials required', 'FORBIDDEN', 403);
        }
        req.controlScope = scope;
        req.controlSessionType = payload.sessionType;
        req.controlSession = session;
        next();
    }
    catch (error) {
        sendError(_res, error);
    }
}
function requireScope(req) {
    if (!req.controlScope) {
        throw new control_plane_js_1.ControlPlaneError('Authentication required', 'UNAUTHENTICATED', 401);
    }
    return req.controlScope;
}
function requireLockedCompany(req, res, next) {
    try {
        const { scope, payload, session } = control_plane_js_1.controlPlane.requireControlSession(bearer(req));
        if (payload.sessionType !== 'control' || !scope.companyId) {
            throw new control_plane_js_1.ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
        }
        req.controlScope = scope;
        req.controlSessionType = payload.sessionType;
        req.controlSession = session;
        next();
    }
    catch (error) {
        sendError(res, error);
    }
}
function param(req, key) {
    const value = req.params[key];
    return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}
function scopedCompany(req) {
    const scope = requireScope(req);
    const companyId = scope.companyId;
    if (!companyId)
        throw new control_plane_js_1.ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
    const requested = param(req, 'companyId') || undefined;
    if (requested)
        control_plane_js_1.controlPlane.assertCompanyScope(scope, requested);
    return companyId;
}
exports.controlRouter = (0, express_1.Router)();
exports.studioRouter = (0, express_1.Router)();
exports.syncRouter = (0, express_1.Router)();
function persistOnSuccess(req, res, next) {
    res.on('finish', () => {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && res.statusCode < 400) {
            (0, persistence_js_1.scheduleControlPlanePersist)();
        }
    });
    next();
}
exports.controlRouter.use(persistOnSuccess);
exports.studioRouter.use(persistOnSuccess);
exports.syncRouter.use(persistOnSuccess);
exports.controlRouter.post('/auth/login', (req, res) => {
    try {
        const email = String(req.body?.email ?? '').trim().toLowerCase();
        const password = String(req.body?.password ?? '');
        res.json({ success: true, ...control_plane_js_1.controlPlane.platformLogin(email, password) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.get('/plans', requirePlatform, (_req, res) => {
    res.json({ success: true, plans: control_plane_js_1.controlPlane.listPlans() });
});
exports.controlRouter.get('/companies', requirePlatform, (_req, res) => {
    res.json({
        success: true,
        companies: [...control_plane_js_1.controlPlane.companies.values()].map((company) => control_plane_js_1.controlPlane.publicCompany(company)),
    });
});
exports.controlRouter.post('/companies', requirePlatform, async (req, res) => {
    try {
        const scope = requireScope(req);
        const adminEmail = String(req.body?.adminEmail ?? '').trim().toLowerCase();
        if (!(0, otp_auth_js_1.validateEmail)(adminEmail)) {
            throw new control_plane_js_1.ControlPlaneError('Admin email is required', 'INVALID_EMAIL', 400);
        }
        if (enterprise.findUserByEmail(adminEmail)) {
            throw new control_plane_js_1.ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
        }
        const { company, temporaryPassword } = control_plane_js_1.controlPlane.createCompany(scope, {
            name: String(req.body?.name ?? ''),
            planId: String(req.body?.planId ?? 'starter'),
            adminEmail,
            adminName: String(req.body?.adminName ?? 'Company Admin'),
        });
        const admin = control_plane_js_1.controlPlane.companyUsers.get(company.primaryAdminId);
        if (!admin)
            throw new control_plane_js_1.ControlPlaneError('Company admin was not created', 'INTERNAL_ERROR', 500);
        const provisioned = await (0, provision_tenant_js_1.provisionOperationalTenant)({
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
            company: control_plane_js_1.controlPlane.publicCompany(company),
            admin: { id: admin.id, email: admin.email, name: admin.name, temporaryPassword },
            location: provisioned.location,
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/sessions/select-company', requirePlatform, (req, res) => {
    try {
        const companyId = String(req.body?.companyId ?? '');
        const result = control_plane_js_1.controlPlane.selectCompany(requireScope(req).actorId, companyId);
        res.json({
            success: true,
            session: result.session,
            token: result.token,
            company: control_plane_js_1.controlPlane.publicCompany(control_plane_js_1.controlPlane.requireCompany(companyId)),
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/sessions/exit', requireLockedCompany, (req, res) => {
    try {
        const scope = requireScope(req);
        const sessionId = scope.companySessionId;
        control_plane_js_1.controlPlane.exitSession(sessionId, scope.actorId);
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.get('/session', requireLockedCompany, (req, res) => {
    res.json({
        success: true,
        session: req.controlSession,
        company: control_plane_js_1.controlPlane.publicCompany(control_plane_js_1.controlPlane.requireCompany(requireScope(req).companyId)),
        scope: requireScope(req),
    });
});
exports.controlRouter.post('/companies/:companyId/suspend', requirePlatform, (req, res) => {
    try {
        const company = control_plane_js_1.controlPlane.setCompanyStatus(requireScope(req), param(req, 'companyId'), 'suspended', String(req.body?.reason ?? 'suspended'));
        res.json({ success: true, company });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/companies/:companyId/activate', requirePlatform, (req, res) => {
    try {
        const company = control_plane_js_1.controlPlane.setCompanyStatus(requireScope(req), param(req, 'companyId'), 'active', String(req.body?.reason ?? 'activated'));
        res.json({ success: true, company });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.put('/companies/:companyId/plan', requirePlatform, (req, res) => {
    try {
        const result = control_plane_js_1.controlPlane.assignPlan(requireScope(req), param(req, 'companyId'), String(req.body?.planId ?? ''), String(req.body?.reason ?? 'plan change'));
        res.json({ success: true, ...result, company: control_plane_js_1.controlPlane.publicCompany(result.company) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/companies/:companyId/entitlement-overrides', requirePlatform, (req, res) => {
    try {
        control_plane_js_1.controlPlane.overrideEntitlement(requireScope(req), param(req, 'companyId'), String(req.body?.featureKey ?? ''), Boolean(req.body?.enabled), String(req.body?.reason ?? 'override'));
        res.json({ success: true, company: control_plane_js_1.controlPlane.publicCompany(control_plane_js_1.controlPlane.requireCompany(param(req, 'companyId'))) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.get('/users', requireLockedCompany, (req, res) => {
    res.json({ success: true, users: control_plane_js_1.controlPlane.listCompanyUsers(scopedCompany(req)) });
});
exports.controlRouter.post('/users', requireLockedCompany, async (req, res) => {
    try {
        const user = control_plane_js_1.controlPlane.createCompanyUser(requireScope(req), {
            email: String(req.body?.email ?? ''),
            name: String(req.body?.name ?? ''),
            role: String(req.body?.role ?? 'STORE_USER'),
        });
        const assignable = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
        if (assignable.includes(user.role) && !enterprise.findUserByEmail(user.email)) {
            const record = control_plane_js_1.controlPlane.companyUsers.get(user.id);
            enterprise.createEnhancedUser({
                id: user.id,
                companyId: user.companyId,
                email: user.email,
                name: user.name,
                role: user.role,
                branchIds: [],
                locationIds: [],
                passwordHash: record?.passwordHash,
                status: user.status === 'active' ? 'active' : 'inactive',
            });
            await (0, persistence_js_2.persistEnterpriseUser)({
                id: user.id,
                name: user.name,
                email: user.email,
                passwordHash: record?.passwordHash ?? '',
                role: user.role,
                locationIds: [],
                companyId: user.companyId,
            });
        }
        res.status(201).json({ success: true, user });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/users/:userId/reset-password', requireLockedCompany, (req, res) => {
    try {
        const result = control_plane_js_1.controlPlane.resetPassword(requireScope(req), param(req, 'userId'));
        res.json({ success: true, ...result });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.delete('/users/:userId', requireLockedCompany, (req, res) => {
    try {
        control_plane_js_1.controlPlane.deleteCompanyUser(requireScope(req), param(req, 'userId'));
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.get('/audit', requirePlatform, (req, res) => {
    const companyId = requireScope(req).companyId;
    const events = control_plane_js_1.controlPlane.audit.filter((event) => !companyId || event.companyId === companyId);
    res.json({ success: true, events: events.slice(-200) });
});
exports.controlRouter.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(control_plane_js_1.controlPlane.health());
});
exports.controlRouter.post('/safety/kill-switches', requirePlatform, (req, res) => {
    try {
        control_plane_js_1.controlPlane.setKillSwitch(requireScope(req), String(req.body?.featureKey ?? ''), Boolean(req.body?.enabled), String(req.body?.reason ?? 'safety'));
        res.json({ success: true, safety: Object.fromEntries(control_plane_js_1.controlPlane.safety.entries()) });
    }
    catch (error) {
        sendError(res, error);
    }
});
function billingPayload(companyId) {
    return { provider: (0, billing_provider_js_1.billingProviderName)(), adapter: (0, billing_provider_js_1.stripeAdapter)(), ...control_plane_js_1.controlPlane.billingSnapshot(companyId) };
}
exports.controlRouter.get('/billing', requireLockedCompany, (req, res) => {
    res.json({ success: true, ...billingPayload(scopedCompany(req)) });
});
exports.controlRouter.post('/billing/usage', requireLockedCompany, (req, res) => {
    control_plane_js_1.controlPlane.recordUsage(scopedCompany(req), String(req.body?.meter ?? 'api_requests'), Number(req.body?.increment ?? 1));
    res.json({ success: true, ...billingPayload(scopedCompany(req)) });
});
exports.controlRouter.post('/billing/invoices', requireLockedCompany, (req, res) => {
    try {
        const invoice = control_plane_js_1.controlPlane.issueInvoice(requireScope(req), scopedCompany(req));
        res.status(201).json({ success: true, invoice, ...billingPayload(scopedCompany(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/billing/invoices/:invoiceId/pay', requireLockedCompany, (req, res) => {
    try {
        const invoice = control_plane_js_1.controlPlane.payInvoice(requireScope(req), param(req, 'invoiceId'));
        res.json({ success: true, invoice, ...billingPayload(scopedCompany(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/billing/invoices/:invoiceId/past-due', requireLockedCompany, (req, res) => {
    try {
        const invoice = control_plane_js_1.controlPlane.markInvoicePastDue(requireScope(req), param(req, 'invoiceId'));
        res.json({ success: true, invoice, ...billingPayload(scopedCompany(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/billing/checkout', requireLockedCompany, async (req, res) => {
    try {
        const result = await (0, billing_provider_js_1.createBillingCheckout)(requireScope(req), scopedCompany(req), {
            successUrl: typeof req.body?.successUrl === 'string' ? req.body.successUrl : undefined,
            cancelUrl: typeof req.body?.cancelUrl === 'string' ? req.body.cancelUrl : undefined,
        });
        res.status(201).json({ success: true, ...result });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/billing/stripe/confirm', requireLockedCompany, (req, res) => {
    try {
        const sessionId = String(req.body?.sessionId ?? '');
        const result = (0, billing_provider_js_1.confirmLocalStripeCheckout)(requireScope(req), sessionId);
        res.json({ success: true, ...result, ...billingPayload(result.invoice.companyId) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/billing/webhooks/stripe', (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_SECRET_KEY;
    const payload = req.rawBody ?? JSON.stringify(req.body ?? {});
    const header = String(req.headers['stripe-signature'] ?? '');
    if (!secret || !(0, billing_provider_js_1.verifyStripeSignature)(secret, payload, header)) {
        res.status(400).json({ error: 'Invalid Stripe signature', code: 'STRIPE_SIGNATURE_INVALID' });
        return;
    }
    try {
        const result = (0, billing_provider_js_1.applyStripeCheckoutEvent)((req.body ?? {}));
        res.json({ success: true, ...result, ...billingPayload(result.invoice.companyId) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/integrations/api-keys', requireLockedCompany, (req, res) => {
    try {
        const key = control_plane_js_1.controlPlane.createApiKey(requireScope(req), String(req.body?.name ?? 'default'), Array.isArray(req.body?.scopes) ? req.body.scopes : ['read']);
        res.status(201).json({ success: true, ...key });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/integrations/api-keys/:keyId/revoke', requireLockedCompany, (req, res) => {
    try {
        const apiKey = control_plane_js_1.controlPlane.revokeApiKey(requireScope(req), param(req, 'keyId'));
        res.json({ success: true, apiKey });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.get('/integrations', requireLockedCompany, (req, res) => {
    const companyId = scopedCompany(req);
    res.json({
        success: true,
        apiKeys: [...control_plane_js_1.controlPlane.apiKeys.values()].filter((key) => key.companyId === companyId).map(({ hash: _hash, ...key }) => key),
        webhooks: [...control_plane_js_1.controlPlane.publicWebhooks(companyId)],
        connectors: [...control_plane_js_1.controlPlane.connectors.values()].filter((connector) => connector.companyId === companyId),
    });
});
exports.controlRouter.post('/integrations/webhooks', requireLockedCompany, (req, res) => {
    try {
        const webhook = control_plane_js_1.controlPlane.createWebhook(requireScope(req), String(req.body?.url ?? ''), Array.isArray(req.body?.events) ? req.body.events : [], String(req.body?.name ?? 'Ops webhook'));
        res.status(201).json({ success: true, webhook });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.controlRouter.post('/integrations/connectors', requireLockedCompany, (req, res) => {
    try {
        const connector = control_plane_js_1.controlPlane.upsertConnector(requireScope(req), String(req.body?.type ?? 'pos'));
        res.status(201).json({ success: true, connector });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.use(requireLockedCompany);
exports.studioRouter.get('/draft', (req, res) => {
    res.json({ success: true, draft: control_plane_js_1.controlPlane.ensureDraft(requireScope(req)), diff: control_plane_js_1.controlPlane.diff(scopedCompany(req)) });
});
exports.studioRouter.post('/draft/stock/columns', (req, res) => {
    try {
        const draft = control_plane_js_1.controlPlane.addStockColumn(requireScope(req), {
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
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/fields', (req, res) => {
    try {
        const draft = control_plane_js_1.controlPlane.addField(requireScope(req), {
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
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/draft/actions/:actionKey', (req, res) => {
    try {
        const draft = control_plane_js_1.controlPlane.setActionEnabled(requireScope(req), param(req, 'actionKey'), Boolean(req.body?.enabled));
        res.json({ success: true, draft });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/draft/tabs/:tabKey', (req, res) => {
    try {
        const draft = control_plane_js_1.controlPlane.moveTab(requireScope(req), param(req, 'tabKey'), Number(req.body?.order ?? 1));
        res.json({ success: true, draft });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/preview', (req, res) => {
    try {
        res.json({
            success: true,
            preview: control_plane_js_1.controlPlane.preview(requireScope(req), {
                role: String(req.body?.role ?? 'ADMIN'),
                device: req.body?.device === 'mobile' || req.body?.device === 'tablet' ? req.body.device : 'desktop',
            }),
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/publish', (req, res) => {
    try {
        const published = control_plane_js_1.controlPlane.publish(requireScope(req));
        res.json({ success: true, published, runtime: control_plane_js_1.controlPlane.runtimeConfig(scopedCompany(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/rollback', (req, res) => {
    try {
        const published = control_plane_js_1.controlPlane.rollback(requireScope(req), Number(req.body?.version));
        res.json({ success: true, published });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.get('/runtime', (req, res) => {
    res.json({ success: true, runtime: control_plane_js_1.controlPlane.runtimeConfig(scopedCompany(req), String(req.query.role ?? 'ADMIN')) });
});
exports.studioRouter.get('/modules', (_req, res) => {
    res.json({ success: true, ...control_plane_js_1.controlPlane.moduleRegistry() });
});
exports.studioRouter.post('/modules/:moduleKey', (req, res) => {
    try {
        control_plane_js_1.controlPlane.setCompanyModule(requireScope(req), param(req, 'moduleKey'), Boolean(req.body?.enabled));
        res.json({ success: true, runtime: control_plane_js_1.controlPlane.runtimeConfig(scopedCompany(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.get('/workflows', (req, res) => {
    res.json({ success: true, workflows: control_plane_js_1.controlPlane.ensureDraft(requireScope(req)).workflows });
});
exports.studioRouter.post('/workflows', (req, res) => {
    try {
        const draft = control_plane_js_1.controlPlane.upsertWorkflow(requireScope(req), req.body);
        res.json({ success: true, draft });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/workflows/simulate', (req, res) => {
    try {
        res.json({
            success: true,
            simulation: control_plane_js_1.controlPlane.simulateWorkflow(scopedCompany(req), String(req.body?.key ?? 'transfer.approval'), { value: Number(req.body?.value ?? 0) }),
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/rules', (req, res) => {
    try {
        res.json({ success: true, draft: control_plane_js_1.controlPlane.upsertRule(requireScope(req), req.body) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/rules/evaluate', (req, res) => {
    res.json({ success: true, outcomes: control_plane_js_1.controlPlane.evaluateRule(scopedCompany(req), req.body ?? {}) });
});
exports.studioRouter.post('/reports', (req, res) => {
    try {
        res.json({ success: true, draft: control_plane_js_1.controlPlane.upsertReport(requireScope(req), req.body) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.post('/automations', (req, res) => {
    try {
        res.json({ success: true, draft: control_plane_js_1.controlPlane.upsertAutomation(requireScope(req), req.body) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.studioRouter.get('/mobile-policy', (req, res) => {
    res.json({ success: true, policies: control_plane_js_1.controlPlane.ensureDraft(requireScope(req)).mobilePolicies });
});
exports.studioRouter.post('/mobile-policy', (req, res) => {
    try {
        const draft = control_plane_js_1.controlPlane.upsertMobilePolicy(requireScope(req), {
            role: String(req.body?.role ?? ''),
            offlineMaxHours: Number(req.body?.offlineMaxHours ?? 0),
            syncScope: Array.isArray(req.body?.syncScope) ? req.body.syncScope.map(String) : [],
            navigation: Array.isArray(req.body?.navigation) ? req.body.navigation.map(String) : [],
            encryptedLocalStore: true,
        });
        res.json({ success: true, draft });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.syncRouter.post('/mutations', (req, res) => {
    try {
        const auth = req.headers.authorization?.startsWith('Bearer ') ? control_plane_js_1.controlPlane.requireControlSession(req.headers.authorization.slice(7)) : null;
        const requestedCompanyId = String(req.body?.companyId ?? '');
        const companyId = auth?.scope.companyId || requestedCompanyId;
        if (auth?.scope.companyId && requestedCompanyId) {
            control_plane_js_1.controlPlane.assertCompanyScope(auth.scope, requestedCompanyId);
        }
        const mutation = control_plane_js_1.controlPlane.enqueueMutation({
            mutationId: String(req.body?.mutationId ?? ''),
            tenantId: control_plane_js_1.controlPlane.tenantId,
            companyId,
            userId: String(req.body?.userId ?? auth?.scope.actorId ?? ''),
            deviceId: String(req.body?.deviceId ?? ''),
            entityType: String(req.body?.entityType ?? 'inventory'),
            actionType: String(req.body?.actionType ?? 'STOCK_ADJUST'),
            payload: req.body?.payload ?? {},
        });
        res.json({ success: true, mutation });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.syncRouter.get('/mutations', (req, res) => {
    const companyId = String(req.query.companyId ?? '');
    const mutations = [...control_plane_js_1.controlPlane.mutations.values()].filter((mutation) => !companyId || mutation.companyId === companyId);
    res.json({ success: true, mutations });
});
exports.syncRouter.post('/devices/register', (req, res) => {
    const device = control_plane_js_1.controlPlane.registerDevice({
        companyId: String(req.body?.companyId ?? ''),
        userId: String(req.body?.userId ?? ''),
        appVersion: String(req.body?.appVersion ?? '2.0.0'),
    });
    res.status(201).json({ success: true, device });
});
exports.syncRouter.post('/devices/:deviceId/revoke', (req, res) => {
    control_plane_js_1.controlPlane.revokeDevice(param(req, 'deviceId'));
    res.json({ success: true });
});
exports.syncRouter.get('/status', (_req, res) => {
    res.json({
        success: true,
        health: control_plane_js_1.controlPlane.health(),
        pending: [...control_plane_js_1.controlPlane.mutations.values()].filter((mutation) => mutation.status !== 'synced'),
    });
});
