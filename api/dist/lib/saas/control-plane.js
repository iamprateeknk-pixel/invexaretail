"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTION_REGISTRY = exports.MODULE_REGISTRY = exports.DEFAULT_STOCK_PAGE = exports.controlPlane = exports.ControlPlane = exports.ControlPlaneError = void 0;
exports.apiKeyAllowsMethod = apiKeyAllowsMethod;
exports.signControlToken = signControlToken;
exports.verifyControlToken = verifyControlToken;
const node_crypto_1 = require("node:crypto");
const otp_auth_js_1 = require("../otp-auth.js");
const tenant_scope_js_1 = require("./tenant-scope.js");
const webhook_events_js_1 = require("../webhook-events.js");
function apiKeyAllowsMethod(scopes, method) {
    const normalized = scopes.map((scope) => String(scope).toLowerCase());
    const wildcard = normalized.includes('*');
    const write = wildcard || normalized.some((scope) => scope === 'write' || scope.endsWith('.write'));
    const read = write || normalized.some((scope) => scope === 'read' || scope.endsWith('.read'));
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
        return read;
    return write;
}
class ControlPlaneError extends Error {
    code;
    status;
    constructor(message, code, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'ControlPlaneError';
    }
}
exports.ControlPlaneError = ControlPlaneError;
const DEFAULT_STOCK_PAGE = {
    pageKey: 'inventory.stock',
    title: 'Stock by item',
    route: '/inventory',
    columns: [
        { key: 'item_code', label: 'Item code & name', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
        { key: 'company', label: 'Company', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
        { key: 'category', label: 'Category', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
        { key: 'pack_size', label: 'Pack/Size', type: 'text', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
        { key: 'lot_coverage', label: 'Lot coverage', type: 'text', source: 'core', visible: true, exportEnabled: false, mobileEnabled: true },
        { key: 'physical', label: 'Total physical', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
        { key: 'book', label: 'Total book', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
        { key: 'variance', label: 'Variance', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
        { key: 'quarantine', label: 'Quarantine', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
        { key: 'reserved', label: 'Reserved', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
        { key: 'available', label: 'Available', type: 'number', source: 'core', visible: true, exportEnabled: true, mobileEnabled: true },
        { key: 'value', label: 'Value', type: 'currency', source: 'core', visible: true, exportEnabled: true, mobileEnabled: false },
    ],
    actions: [
        { key: 'export', label: 'Export', enabled: true, placement: 'header', visibleRoles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'] },
        { key: 'scan', label: 'Scan item', enabled: true, placement: 'header' },
        { key: 'daily_import', label: 'Daily sales / purchase', enabled: true, placement: 'header', visibleRoles: ['ADMIN', 'ADMIN_USER'] },
    ],
    widgets: [
        { key: 'stock_table', label: 'Stock table', order: 1 },
        { key: 'lots', label: 'Lots', order: 2 },
    ],
    tabs: [
        { key: 'stock', label: 'Stock', order: 1 },
        { key: 'lots', label: 'Lots', order: 2 },
        { key: 'movements', label: 'Movements', order: 3 },
    ],
};
exports.DEFAULT_STOCK_PAGE = DEFAULT_STOCK_PAGE;
const MODULE_REGISTRY = {
    CATALOG: { name: 'Catalog', dependencies: [], entitlementKey: 'module.catalog' },
    LOCATIONS: { name: 'Locations', dependencies: [], entitlementKey: 'module.locations' },
    INVENTORY: { name: 'Inventory', dependencies: ['CATALOG', 'LOCATIONS'], entitlementKey: 'module.inventory' },
    WMS: { name: 'Warehouse', dependencies: ['INVENTORY'], entitlementKey: 'module.wms' },
    OMS: { name: 'Orders', dependencies: ['INVENTORY'], entitlementKey: 'module.oms' },
    PURCHASING: { name: 'Purchasing', dependencies: ['INVENTORY'], entitlementKey: 'module.purchasing' },
    ANALYTICS: { name: 'Analytics', dependencies: ['INVENTORY'], entitlementKey: 'module.analytics' },
    ADVANCED_WORKFLOW: { name: 'Advanced workflow', dependencies: ['INVENTORY'], entitlementKey: 'module.advanced_workflow' },
    INTEGRATIONS: { name: 'Integrations', dependencies: [], entitlementKey: 'module.integrations' },
    MOBILE_OFFLINE: { name: 'Mobile offline', dependencies: ['INVENTORY'], entitlementKey: 'module.mobile_offline' },
};
exports.MODULE_REGISTRY = MODULE_REGISTRY;
const ACTION_REGISTRY = {
    CREATE_TRANSFER: { handlerKey: 'transfers.create', permission: 'inventory.create' },
    APPROVE_TRANSFER: { handlerKey: 'transfers.approve', permission: 'inventory.approve' },
    POST_STOCK_ADJUSTMENT: { handlerKey: 'inventory.adjust', permission: 'inventory.adjust' },
    CREATE_PO: { handlerKey: 'purchasing.create', permission: 'purchasing.create' },
    BLOCK_LOT: { handlerKey: 'inventory.block_lot', permission: 'inventory.edit' },
    CREATE_TASK: { handlerKey: 'tasks.create', permission: 'inventory.create' },
    SEND_NOTIFICATION: { handlerKey: 'notify.send', permission: 'inventory.view' },
    CALL_WEBHOOK: { handlerKey: 'integrations.webhook', permission: 'integrations.edit' },
};
exports.ACTION_REGISTRY = ACTION_REGISTRY;
function nowIso() {
    return new Date().toISOString();
}
function jwtSecret() {
    const configured = process.env.JWT_SECRET?.trim();
    if (configured)
        return configured;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be configured in production.');
    }
    return 'dev-secret-key-change-in-production';
}
function signControlToken(payload) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const tokenType = payload.tokenType ?? 'access';
    const ttlSeconds = payload.ttlSeconds ?? (tokenType === 'refresh' ? 60 * 60 * 24 * 7 : 60 * 60);
    const body = {
        ...payload,
        issuedAt,
        expiresAt: issuedAt + ttlSeconds,
        tokenType,
    };
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = (0, node_crypto_1.createHmac)('sha256', jwtSecret()).update(`${header}.${encoded}`).digest('base64url');
    return `${header}.${encoded}.${signature}`;
}
function verifyControlToken(token, expectedType = 'access') {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        throw new ControlPlaneError('Invalid control token', 'INVALID_TOKEN', 401);
    }
    const [header, encoded, signature] = parts;
    const expected = (0, node_crypto_1.createHmac)('sha256', jwtSecret()).update(`${header}.${encoded}`).digest('base64url');
    if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) {
        throw new ControlPlaneError('Invalid control token', 'INVALID_TOKEN', 401);
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
        throw new ControlPlaneError('Control token expired', 'TOKEN_EXPIRED', 401);
    }
    if ((payload.tokenType ?? 'access') !== expectedType) {
        throw new ControlPlaneError('Wrong token type', 'INVALID_TOKEN', 401);
    }
    return payload;
}
function timingSafeEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function clonePage(page) {
    return JSON.parse(JSON.stringify(page));
}
const COMPARATOR_SUFFIXES = ['Gte', 'Lte', 'Gt', 'Lt'];
function ruleConditionMatches(condition, context) {
    return Object.entries(condition).every(([key, expected]) => {
        const comparator = COMPARATOR_SUFFIXES.find((suffix) => key.endsWith(suffix));
        if (!comparator)
            return context[key] === expected;
        const field = key.slice(0, -comparator.length);
        const actual = Number(context[field]);
        const threshold = Number(expected);
        if (Number.isNaN(actual) || Number.isNaN(threshold))
            return false;
        if (comparator === 'Gt')
            return actual > threshold;
        if (comparator === 'Gte')
            return actual >= threshold;
        if (comparator === 'Lt')
            return actual < threshold;
        return actual <= threshold;
    });
}
function ruleOutcomeAction(outcome) {
    if (typeof outcome.action === 'string')
        return outcome.action;
    const [first] = Object.values(outcome);
    return String(first ?? '');
}
class ControlPlane {
    tenantId = tenant_scope_js_1.DEFAULT_TENANT_ID;
    plans = new Map();
    companies = new Map();
    platformUsers = new Map();
    companyUsers = new Map();
    sessions = new Map();
    entitlements = new Map();
    limitOverrides = new Map();
    usage = new Map();
    audit = [];
    safety = new Map();
    drafts = new Map();
    published = new Map();
    versions = new Map();
    fieldValues = new Map();
    ledger = new Map();
    mutations = new Map();
    devices = new Map();
    apiKeys = new Map();
    webhooks = new Map();
    connectors = new Map();
    billing = new Map();
    invoices = new Map();
    outbox = [];
    seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
    seedPasswordHash = (0, otp_auth_js_1.hashPassword)(this.seedPassword);
    constructor() {
        this.seed();
    }
    reset() {
        this.plans.clear();
        this.companies.clear();
        this.platformUsers.clear();
        this.companyUsers.clear();
        this.sessions.clear();
        this.entitlements.clear();
        this.limitOverrides.clear();
        this.usage.clear();
        this.audit = [];
        this.safety.clear();
        this.drafts.clear();
        this.published.clear();
        this.versions.clear();
        this.fieldValues.clear();
        this.ledger.clear();
        this.mutations.clear();
        this.devices.clear();
        this.apiKeys.clear();
        this.webhooks.clear();
        this.connectors.clear();
        this.billing.clear();
        this.invoices.clear();
        this.outbox = [];
        this.seedPasswordHash = (0, otp_auth_js_1.hashPassword)(this.seedPassword);
        this.seed();
    }
    seed() {
        this.plans.set('starter', {
            id: 'starter',
            name: 'Starter',
            limits: { max_users: 25, max_company_admins: 1, max_branches: 3, max_warehouses: 1, max_items: 2000, storage_gb: 5, api_requests_per_day: 1000 },
            modules: { INVENTORY: true, WMS: true, OMS: false, PURCHASING: true, ANALYTICS: false, ADVANCED_WORKFLOW: false, INTEGRATIONS: false, MOBILE_OFFLINE: true, CATALOG: true, LOCATIONS: true },
            capabilities: { csv_export: true, api_access: false, custom_roles: false, custom_fields: true, custom_modules: false, white_label: false, sso: false },
        });
        this.plans.set('pro', {
            id: 'pro',
            name: 'Pro',
            limits: { max_users: 50, max_company_admins: 3, max_branches: 10, max_warehouses: 4, max_items: 20000, storage_gb: 50, api_requests_per_day: 20000 },
            modules: { INVENTORY: true, WMS: true, OMS: true, PURCHASING: true, ANALYTICS: true, ADVANCED_WORKFLOW: true, INTEGRATIONS: true, MOBILE_OFFLINE: true, CATALOG: true, LOCATIONS: true },
            capabilities: { csv_export: true, api_access: true, custom_roles: true, custom_fields: true, custom_modules: false, white_label: false, sso: false },
        });
        this.plans.set('enterprise', {
            id: 'enterprise',
            name: 'Enterprise',
            limits: { max_users: 500, max_company_admins: 20, max_branches: 100, max_warehouses: 40, max_items: 200000, storage_gb: 500, api_requests_per_day: 200000 },
            modules: { INVENTORY: true, WMS: true, OMS: true, PURCHASING: true, ANALYTICS: true, ADVANCED_WORKFLOW: true, INTEGRATIONS: true, MOBILE_OFFLINE: true, CATALOG: true, LOCATIONS: true },
            capabilities: { csv_export: true, api_access: true, custom_roles: true, custom_fields: true, custom_modules: true, white_label: true, sso: true },
        });
        const passwordHash = this.seedPasswordHash;
        this.platformUsers.set('platform-super-1', {
            id: 'platform-super-1',
            email: 'superadmin@invexa.local',
            name: 'Platform Super Admin',
            passwordHash,
            status: 'active',
        });
        this.createSeedCompany({
            id: 'default-company',
            name: 'Invexa Demo Grocery',
            planId: 'pro',
            admin: { id: 'user-admin-1', email: 'admin@retail.local', name: 'Admin User', role: 'ADMIN' },
        });
        this.createSeedCompany({
            id: 'company-jaipur',
            name: 'Jaipur Mart',
            planId: 'starter',
            admin: { id: 'user-jaipur-admin', email: 'admin@jaipur.local', name: 'Jaipur Admin', role: 'ADMIN' },
        });
        this.ledger.set(this.ledgerKey('default-company', 'item-1'), 10);
        this.billing.set('default-company', { subscription: 'active', cycle: 'monthly', amount: 4999 });
        this.billing.set('company-jaipur', { subscription: 'trial', cycle: 'monthly', amount: 0 });
    }
    createSeedCompany(input) {
        const createdAt = nowIso();
        this.companies.set(input.id, {
            id: input.id,
            tenantId: this.tenantId,
            name: input.name,
            status: 'active',
            planId: input.planId,
            primaryAdminId: input.admin.id,
            createdAt,
        });
        this.companyUsers.set(input.admin.id, {
            id: input.admin.id,
            companyId: input.id,
            email: input.admin.email,
            name: input.admin.name,
            role: input.admin.role,
            status: 'active',
            passwordHash: this.seedPasswordHash,
            isPrimaryAdmin: true,
            createdAt,
        });
        const plan = this.plans.get(input.planId);
        this.entitlements.set(input.id, { ...plan.modules });
        this.usage.set(input.id, { users: 1, company_admins: 1, api_requests: 0 });
        const published = this.blankConfig(input.id, input.admin.id, 1, 'published');
        published.publishedAt = createdAt;
        this.published.set(input.id, published);
        this.versions.set(input.id, [published]);
    }
    blankConfig(companyId, authorId, version, status) {
        return {
            id: (0, node_crypto_1.randomUUID)(),
            companyId,
            version,
            status,
            authorId,
            parentVersion: version > 1 ? version - 1 : null,
            page: clonePage(DEFAULT_STOCK_PAGE),
            fields: [],
            modules: { ...this.entitlements.get(companyId) },
            workflows: [
                {
                    key: 'transfer.approval',
                    name: 'Transfer approval',
                    version: 1,
                    graph: {
                        nodes: [
                            { id: 'start', type: 'trigger', config: { event: 'transfer.created' } },
                            { id: 'check', type: 'condition', config: { field: 'value', op: 'lte', amount: 100000 } },
                            { id: 'auto', type: 'action', config: { action: 'APPROVE_TRANSFER' } },
                            { id: 'manager', type: 'approval', config: { role: 'BRANCH_MANAGER' } },
                        ],
                    },
                },
            ],
            rules: [
                {
                    key: 'high_value_adjustment',
                    name: 'High value adjustment approval',
                    condition: { branchCity: 'Jaipur', adjustmentValueGt: 10000 },
                    outcome: { requireApproval: 'BRANCH_MANAGER' },
                },
            ],
            reports: [{ key: 'low_stock', name: 'Low stock', entity: 'inventory', columns: ['item_code', 'available'], filters: {} }],
            automations: [{ key: 'low_stock_notify', name: 'Low stock notify', trigger: 'event', expression: 'inventory.low_stock', actionKey: 'SEND_NOTIFICATION' }],
            mobilePolicies: [
                { role: 'STORE_USER', offlineMaxHours: 12, syncScope: ['stock', 'counts'], navigation: ['dashboard', 'stock', 'counts'], encryptedLocalStore: true },
                { role: 'WAREHOUSE_PICKER', offlineMaxHours: 12, syncScope: ['stock', 'picks', 'putaway'], navigation: ['dashboard', 'picks', 'putaway'], encryptedLocalStore: true },
            ],
            publishedAt: status === 'published' ? nowIso() : null,
            createdAt: nowIso(),
        };
    }
    auditEvent(input) {
        const event = { ...input, id: (0, node_crypto_1.randomUUID)(), timestamp: nowIso() };
        this.audit.push(event);
        this.outbox.push({ id: event.id, event: `audit.${input.action.toLowerCase()}`, payload: event, createdAt: event.timestamp });
        return event;
    }
    createScope(input) {
        return {
            tenantId: input.tenantId ?? this.tenantId,
            companyId: input.companyId ?? null,
            actorId: input.actorId,
            actorType: input.actorType ?? (input.sessionType === 'platform' || input.sessionType === 'control' ? 'platform' : 'company'),
            sessionType: input.sessionType,
            companySessionId: input.companySessionId ?? null,
            role: input.role ?? 'ADMIN',
            requestId: input.requestId,
        };
    }
    assertCompanyScope(scope, resourceCompanyId) {
        if (!scope.companyId || scope.companyId !== resourceCompanyId) {
            this.auditEvent({
                actorUserId: scope.actorId,
                actorType: scope.actorType,
                tenantId: scope.tenantId,
                companyId: scope.companyId,
                sessionId: scope.companySessionId,
                action: 'COMPANY_SCOPE_DENIED',
                entityType: 'company',
                entityId: resourceCompanyId,
                before: { requested: resourceCompanyId },
                after: { locked: scope.companyId },
            });
            throw new ControlPlaneError('Company scope mismatch', 'COMPANY_SCOPE_MISMATCH', 403);
        }
    }
    platformLogin(email, password) {
        const user = [...this.platformUsers.values()].find((entry) => entry.email === email.toLowerCase());
        if (!user || user.status !== 'active' || !(0, otp_auth_js_1.verifyPassword)(password, user.passwordHash)) {
            throw new ControlPlaneError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
        }
        const token = signControlToken({
            platformUserId: user.id,
            userId: user.id,
            tenantId: this.tenantId,
            companyId: '',
            companySessionId: '',
            sessionType: 'platform',
            permissions: ['platform.super_admin'],
        });
        this.auditEvent({
            actorUserId: user.id,
            actorType: 'platform',
            tenantId: this.tenantId,
            companyId: null,
            sessionId: null,
            action: 'PLATFORM_LOGIN',
            entityType: 'platform_user',
            entityId: user.id,
            before: null,
            after: { email: user.email },
        });
        return {
            user: { id: user.id, email: user.email, name: user.name, status: user.status },
            token,
            companies: [...this.companies.values()].map((company) => ({ ...company })),
        };
    }
    selectCompany(platformUserId, companyId) {
        const company = this.requireCompany(companyId);
        if (company.status !== 'active') {
            throw new ControlPlaneError('Company is suspended', 'COMPANY_SUSPENDED', 403);
        }
        for (const session of this.sessions.values()) {
            if (session.platformUserId === platformUserId && session.status === 'active') {
                session.status = 'closed';
            }
        }
        const session = {
            id: (0, node_crypto_1.randomUUID)(),
            platformUserId,
            companyId,
            tenantId: company.tenantId,
            status: 'active',
            issuedAt: nowIso(),
            expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        };
        this.sessions.set(session.id, session);
        const token = signControlToken({
            platformUserId,
            userId: platformUserId,
            tenantId: company.tenantId,
            companyId,
            companySessionId: session.id,
            sessionType: 'control',
            permissions: ['platform.super_admin', 'studio.publish'],
        });
        this.auditEvent({
            actorUserId: platformUserId,
            actorType: 'platform',
            tenantId: company.tenantId,
            companyId,
            sessionId: session.id,
            action: 'COMPANY_SESSION_LOCKED',
            entityType: 'company_session',
            entityId: session.id,
            before: null,
            after: { companyId },
        });
        return { session, token };
    }
    exitSession(sessionId, actorId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new ControlPlaneError('Session not found', 'SESSION_NOT_FOUND', 404);
        session.status = 'closed';
        this.auditEvent({
            actorUserId: actorId,
            actorType: 'platform',
            tenantId: session.tenantId,
            companyId: session.companyId,
            sessionId,
            action: 'COMPANY_SESSION_EXIT',
            entityType: 'company_session',
            entityId: sessionId,
            before: { status: 'active' },
            after: { status: 'closed' },
        });
    }
    requireControlSession(token) {
        const payload = verifyControlToken(token);
        if (payload.sessionType === 'platform') {
            return {
                scope: this.createScope({
                    actorId: payload.userId,
                    sessionType: 'platform',
                    tenantId: payload.tenantId,
                    companyId: null,
                    role: 'PLATFORM_SUPER_ADMIN',
                }),
                payload,
            };
        }
        const session = this.sessions.get(payload.companySessionId);
        if (!session || session.status !== 'active') {
            throw new ControlPlaneError('Company control session is closed', 'SESSION_CLOSED', 401);
        }
        if (session.companyId !== payload.companyId) {
            throw new ControlPlaneError('Company scope mismatch', 'COMPANY_SCOPE_MISMATCH', 403);
        }
        return {
            scope: this.createScope({
                actorId: payload.userId,
                sessionType: payload.sessionType,
                tenantId: payload.tenantId,
                companyId: payload.companyId,
                companySessionId: session.id,
                role: 'PLATFORM_SUPER_ADMIN',
            }),
            payload,
            session,
        };
    }
    requireCompany(companyId) {
        const company = this.companies.get(companyId);
        if (!company)
            throw new ControlPlaneError('Company not found', 'COMPANY_NOT_FOUND', 404);
        return company;
    }
    listPlans() {
        return [...this.plans.values()].map((plan) => ({ ...plan, limits: { ...plan.limits }, modules: { ...plan.modules } }));
    }
    createCompany(scope, input) {
        if (scope.sessionType !== 'platform' || scope.companyId) {
            throw new ControlPlaneError('Unlocked platform session required to create companies', 'SESSION_REQUIRED', 401);
        }
        const name = input.name.trim();
        const adminEmail = input.adminEmail.trim().toLowerCase();
        const adminName = input.adminName.trim() || 'Company Admin';
        if (name.length < 2)
            throw new ControlPlaneError('Company name is required', 'INVALID_COMPANY_NAME', 400);
        if (!adminEmail.includes('@'))
            throw new ControlPlaneError('Admin email is required', 'INVALID_EMAIL', 400);
        if ([...this.companyUsers.values()].some((user) => user.email === adminEmail)) {
            throw new ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
        }
        const plan = this.plans.get(input.planId);
        if (!plan)
            throw new ControlPlaneError('Unknown plan', 'PLAN_NOT_FOUND', 404);
        const id = `company-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
        const adminId = `user-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
        const temporaryPassword = `Invexa${(0, node_crypto_1.randomBytes)(3).toString('hex')}9A`;
        const company = {
            id,
            tenantId: this.tenantId,
            name,
            status: 'active',
            planId: input.planId,
            primaryAdminId: adminId,
            createdAt: nowIso(),
        };
        this.companies.set(id, company);
        this.companyUsers.set(adminId, {
            id: adminId,
            companyId: id,
            email: adminEmail,
            name: adminName,
            role: 'ADMIN',
            status: 'active',
            passwordHash: (0, otp_auth_js_1.hashPassword)(temporaryPassword),
            isPrimaryAdmin: true,
            createdAt: nowIso(),
        });
        this.entitlements.set(id, { ...plan.modules });
        this.usage.set(id, { users: 1, company_admins: 1, api_requests: 0 });
        const published = this.blankConfig(id, scope.actorId, 1, 'published');
        this.published.set(id, published);
        this.versions.set(id, [published]);
        this.billing.set(id, {
            subscription: tenant_scope_js_1.PLAN_PRICES[input.planId] > 0 ? 'active' : 'trial',
            cycle: 'monthly',
            amount: tenant_scope_js_1.PLAN_PRICES[input.planId] ?? 0,
        });
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: 'platform',
            tenantId: this.tenantId,
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
    setCompanyStatus(scope, companyId, status, reason) {
        if (scope.sessionType !== 'platform' || scope.companyId) {
            this.assertCompanyScope(scope, companyId);
        }
        const company = this.requireCompany(companyId);
        const before = company.status;
        company.status = status;
        if (status === 'suspended') {
            for (const session of this.sessions.values()) {
                if (session.companyId === companyId && session.status === 'active') {
                    session.status = 'closed';
                }
            }
        }
        this.auditEvent({
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
    assignPlan(scope, companyId, planId, reason) {
        if (scope.sessionType !== 'platform' || scope.companyId)
            this.assertCompanyScope(scope, companyId);
        const company = this.requireCompany(companyId);
        const plan = this.plans.get(planId);
        if (!plan)
            throw new ControlPlaneError('Unknown plan', 'PLAN_NOT_FOUND', 404);
        const previous = company.planId;
        company.planId = planId;
        const current = this.entitlements.get(companyId) ?? {};
        this.entitlements.set(companyId, { ...plan.modules });
        const billing = this.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 };
        billing.amount = tenant_scope_js_1.PLAN_PRICES[planId] ?? billing.amount;
        if (billing.amount > 0 && billing.subscription === 'trial')
            billing.subscription = 'active';
        this.billing.set(companyId, billing);
        const usage = this.usage.get(companyId) ?? {};
        let downgradePolicy;
        if ((usage.users ?? 0) > plan.limits.max_users) {
            downgradePolicy = 'block_new_creation';
        }
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: 'platform',
            tenantId: company.tenantId,
            companyId,
            sessionId: scope.companySessionId,
            action: 'PLAN_ASSIGNED',
            entityType: 'company',
            entityId: companyId,
            before: { planId: previous, entitlements: current },
            after: { planId, entitlements: this.entitlements.get(companyId), downgradePolicy },
            reason,
        });
        return { company, downgradePolicy };
    }
    overrideEntitlement(scope, companyId, featureKey, enabled, reason) {
        const overrides = this.entitlementOverrides(companyId);
        overrides[featureKey] = enabled;
        this.limitOverrides.set(companyId, { ...this.limitOverrides.get(companyId) });
        this.entitlements.set(companyId, { ...(this.entitlements.get(companyId) ?? {}), [featureKey]: enabled });
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: 'platform',
            tenantId: this.tenantId,
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
    entitlementOverrides(companyId) {
        const record = this.entitlements.get(companyId) ?? {};
        return { ...record };
    }
    effectiveLimits(companyId) {
        const company = this.requireCompany(companyId);
        const plan = this.plans.get(company.planId);
        return { ...plan.limits, ...(this.limitOverrides.get(companyId) ?? {}) };
    }
    isFeatureEnabled(companyId, featureKey) {
        if (this.safety.get(featureKey) === false)
            return false;
        const company = this.requireCompany(companyId);
        const plan = this.plans.get(company.planId);
        const fromPlan = plan.modules[featureKey] ?? plan.capabilities[featureKey] ?? false;
        const companyValue = this.entitlements.get(companyId)?.[featureKey];
        if (this.safety.get(featureKey) === false)
            return false;
        return companyValue ?? fromPlan;
    }
    assertFeature(companyId, featureKey) {
        if (this.safety.get(featureKey) === false) {
            throw new ControlPlaneError(`${featureKey} is disabled by a platform kill switch`, 'KILL_SWITCH', 403);
        }
        if (!this.isFeatureEnabled(companyId, featureKey)) {
            throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
        }
    }
    assertLimit(companyId, limitKey, nextCount) {
        const limits = this.effectiveLimits(companyId);
        const max = limits[limitKey];
        if (typeof max === 'number' && nextCount > max) {
            throw new ControlPlaneError(`Plan limit reached for ${limitKey}`, 'PLAN_LIMIT_REACHED', 403);
        }
    }
    assertBillingWritable(companyId) {
        const company = this.requireCompany(companyId);
        if (company.status === 'suspended') {
            throw new ControlPlaneError('Company is suspended', 'COMPANY_SUSPENDED', 403);
        }
        if (this.billing.get(companyId)?.subscription === 'past_due') {
            throw new ControlPlaneError('Billing is past due; mutating control-plane actions are on hold', 'BILLING_HOLD', 402);
        }
    }
    issueInvoice(scope, companyId) {
        if (scope.sessionType !== 'platform' || scope.companyId)
            this.assertCompanyScope(scope, companyId);
        const billing = this.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 };
        const invoice = {
            id: (0, node_crypto_1.randomUUID)(),
            companyId,
            amount: billing.amount,
            cycle: billing.cycle,
            status: 'open',
            issuedAt: nowIso(),
            paidAt: null,
        };
        this.invoices.set(invoice.id, invoice);
        this.auditEvent({
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
    payInvoice(scope, invoiceId) {
        const invoice = this.invoices.get(invoiceId);
        if (!invoice)
            throw new ControlPlaneError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
        if (scope.sessionType !== 'platform' || scope.companyId)
            this.assertCompanyScope(scope, invoice.companyId);
        if (invoice.status === 'paid')
            return invoice;
        invoice.status = 'paid';
        invoice.paidAt = nowIso();
        const remainingPastDue = [...this.invoices.values()].some((entry) => entry.companyId === invoice.companyId
            && entry.id !== invoice.id
            && entry.status === 'past_due');
        const billing = this.billing.get(invoice.companyId);
        if (billing && !remainingPastDue) {
            billing.subscription = billing.amount > 0 ? 'active' : 'trial';
        }
        this.auditEvent({
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
    markInvoicePastDue(scope, invoiceId) {
        const invoice = this.invoices.get(invoiceId);
        if (!invoice)
            throw new ControlPlaneError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
        if (scope.sessionType !== 'platform' || scope.companyId)
            this.assertCompanyScope(scope, invoice.companyId);
        invoice.status = 'past_due';
        const billing = this.billing.get(invoice.companyId) ?? { subscription: 'past_due', cycle: invoice.cycle, amount: invoice.amount };
        billing.subscription = 'past_due';
        this.billing.set(invoice.companyId, billing);
        this.auditEvent({
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
    listInvoices(companyId) {
        return [...this.invoices.values()].filter((invoice) => invoice.companyId === companyId);
    }
    setKillSwitch(scope, featureKey, enabled, reason) {
        this.safety.set(featureKey, enabled);
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: 'platform',
            tenantId: this.tenantId,
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
    listCompanyUsers(companyId) {
        return [...this.companyUsers.values()]
            .filter((user) => user.companyId === companyId)
            .map(({ passwordHash: _passwordHash, ...user }) => user);
    }
    createCompanyUser(scope, input) {
        const companyId = scope.companyId;
        if (!companyId)
            throw new ControlPlaneError('Company session required', 'SESSION_REQUIRED', 401);
        this.assertCompanyScope(scope, companyId);
        const activeUsers = this.listCompanyUsers(companyId).filter((user) => user.status === 'active');
        this.assertLimit(companyId, 'max_users', activeUsers.length + 1);
        if (input.role === 'ADMIN' || input.role === 'PLATFORM_SUPER_ADMIN') {
            if (input.role === 'PLATFORM_SUPER_ADMIN') {
                throw new ControlPlaneError('Super Admin is not assignable inside a company', 'ROLE_NOT_ASSIGNABLE', 403);
            }
            const admins = activeUsers.filter((user) => user.role === 'ADMIN').length;
            this.assertLimit(companyId, 'max_company_admins', admins + 1);
        }
        const user = {
            id: `user-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`,
            companyId,
            email: input.email.toLowerCase(),
            name: input.name,
            role: input.role,
            status: 'active',
            passwordHash: this.seedPasswordHash,
            isPrimaryAdmin: false,
            createdAt: nowIso(),
        };
        this.companyUsers.set(user.id, user);
        const usage = this.usage.get(companyId) ?? { users: 0, company_admins: 0, api_requests: 0 };
        usage.users = (usage.users ?? 0) + 1;
        if (user.role === 'ADMIN')
            usage.company_admins = (usage.company_admins ?? 0) + 1;
        this.usage.set(companyId, usage);
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: scope.actorType,
            tenantId: scope.tenantId,
            companyId,
            sessionId: scope.companySessionId,
            action: 'USER_CREATED',
            entityType: 'company_user',
            entityId: user.id,
            before: null,
            after: { email: user.email, role: user.role },
        });
        const { passwordHash: _passwordHash, ...publicUser } = user;
        return publicUser;
    }
    resetPassword(scope, userId) {
        const user = this.companyUsers.get(userId);
        if (!user)
            throw new ControlPlaneError('User not found', 'USER_NOT_FOUND', 404);
        if (scope.companyId)
            this.assertCompanyScope(scope, user.companyId);
        const temporaryPassword = `Invexa${(0, node_crypto_1.randomBytes)(3).toString('hex')}9A`;
        user.passwordHash = (0, otp_auth_js_1.hashPassword)(temporaryPassword);
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: scope.actorType,
            tenantId: scope.tenantId,
            companyId: user.companyId,
            sessionId: scope.companySessionId,
            action: 'PASSWORD_RESET',
            entityType: 'company_user',
            entityId: userId,
            before: null,
            after: { reset: true },
        });
        return { temporaryPassword };
    }
    deleteCompanyUser(scope, userId) {
        const user = this.companyUsers.get(userId);
        if (!user)
            throw new ControlPlaneError('User not found', 'USER_NOT_FOUND', 404);
        if (scope.companyId)
            this.assertCompanyScope(scope, user.companyId);
        if (user.isPrimaryAdmin) {
            throw new ControlPlaneError('Primary Company Admin cannot be deleted', 'PRIMARY_ADMIN_PROTECTED', 403);
        }
        user.status = 'inactive';
    }
    ensureDraft(scope) {
        const companyId = this.requireLockedCompany(scope);
        const existing = this.drafts.get(companyId);
        if (existing)
            return existing;
        const published = this.published.get(companyId) ?? this.blankConfig(companyId, scope.actorId, 1, 'published');
        const draft = {
            ...JSON.parse(JSON.stringify(published)),
            id: (0, node_crypto_1.randomUUID)(),
            version: published.version + 1,
            status: 'draft',
            authorId: scope.actorId,
            parentVersion: published.version,
            publishedAt: null,
            createdAt: nowIso(),
        };
        this.drafts.set(companyId, draft);
        return draft;
    }
    requireLockedCompany(scope) {
        if (scope.sessionType !== 'control' || !scope.companyId || !scope.companySessionId) {
            throw new ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
        }
        const session = this.sessions.get(scope.companySessionId);
        if (!session || session.status !== 'active' || session.companyId !== scope.companyId) {
            throw new ControlPlaneError('Company control session is closed', 'SESSION_CLOSED', 401);
        }
        return scope.companyId;
    }
    addStockColumn(scope, input) {
        const companyId = this.requireLockedCompany(scope);
        this.assertBillingWritable(companyId);
        this.assertFeature(companyId, 'INVENTORY');
        if (!this.plans.get(this.requireCompany(companyId).planId)?.capabilities.custom_fields) {
            throw new ControlPlaneError('Custom fields are not entitled', 'FEATURE_NOT_ENTITLED', 403);
        }
        const draft = this.ensureDraft(scope);
        if (draft.page.columns.some((column) => column.key === input.key) || input.key === 'item_code') {
            throw new ControlPlaneError('Reserved or duplicate field key', 'RESERVED_FIELD', 400);
        }
        const field = {
            id: (0, node_crypto_1.randomUUID)(),
            companyId,
            entityType: 'stock',
            fieldKey: input.key,
            label: input.name,
            dataType: input.type,
            required: Boolean(input.required),
            defaultValue: input.defaultValue ?? 0,
            placement: input.placement ?? 'after:available',
            visibleRoles: input.visibleRoles ?? ['ADMIN', 'BRANCH_MANAGER'],
            editableRoles: input.editableRoles ?? ['ADMIN'],
            sortFilter: true,
            exportEnabled: true,
            mobileEnabled: true,
            status: 'active',
        };
        draft.fields.push(field);
        const column = {
            key: input.key,
            label: input.name,
            type: input.type,
            source: 'custom',
            visible: true,
            exportEnabled: true,
            mobileEnabled: true,
            visibleRoles: field.visibleRoles,
        };
        const afterIndex = draft.page.columns.findIndex((entry) => entry.key === 'available');
        if (afterIndex >= 0)
            draft.page.columns.splice(afterIndex + 1, 0, column);
        else
            draft.page.columns.push(column);
        return draft;
    }
    // Generic Field Builder (blueprint §16 "Field builder"): works across any
    // entity type, not only the stock page. addStockColumn() above is kept
    // as-is for backward compatibility (it also mirrors into page.columns,
    // which only the stock page renders today) - this is the path for
    // fields on entities that don't have a page-rendering surface yet.
    addField(scope, input) {
        const companyId = this.requireLockedCompany(scope);
        this.assertBillingWritable(companyId);
        if (!this.plans.get(this.requireCompany(companyId).planId)?.capabilities.custom_fields) {
            throw new ControlPlaneError('Custom fields are not entitled', 'FEATURE_NOT_ENTITLED', 403);
        }
        const draft = this.ensureDraft(scope);
        if (draft.fields.some((entry) => entry.entityType === input.entityType && entry.fieldKey === input.key)) {
            throw new ControlPlaneError('Duplicate field key for this entity', 'RESERVED_FIELD', 400);
        }
        const field = {
            id: (0, node_crypto_1.randomUUID)(),
            companyId,
            entityType: input.entityType,
            fieldKey: input.key,
            label: input.name,
            dataType: input.type,
            required: Boolean(input.required),
            defaultValue: input.defaultValue ?? null,
            visibleRoles: input.visibleRoles ?? ['ADMIN', 'BRANCH_MANAGER'],
            editableRoles: input.editableRoles ?? ['ADMIN'],
            sortFilter: true,
            exportEnabled: true,
            mobileEnabled: true,
            status: 'active',
        };
        draft.fields.push(field);
        return draft;
    }
    setActionEnabled(scope, actionKey, enabled) {
        const draft = this.ensureDraft(scope);
        const action = draft.page.actions.find((entry) => entry.key === actionKey);
        if (!action)
            throw new ControlPlaneError('Unknown action', 'ACTION_NOT_FOUND', 404);
        action.enabled = enabled;
        return draft;
    }
    moveTab(scope, tabKey, order) {
        const draft = this.ensureDraft(scope);
        const tab = draft.page.tabs.find((entry) => entry.key === tabKey);
        if (!tab)
            throw new ControlPlaneError('Unknown tab', 'TAB_NOT_FOUND', 404);
        tab.order = order;
        draft.page.tabs.sort((left, right) => left.order - right.order);
        return draft;
    }
    preview(scope, input) {
        const draft = this.ensureDraft(scope);
        const page = clonePage(draft.page);
        page.columns = page.columns.filter((column) => !column.visibleRoles || column.visibleRoles.includes(input.role));
        page.actions = page.actions.filter((action) => action.enabled && (!action.visibleRoles || action.visibleRoles.includes(input.role)));
        if (input.device === 'mobile') {
            page.columns = page.columns.filter((column) => column.mobileEnabled);
        }
        return { role: input.role, device: input.device, page, version: draft.version };
    }
    diff(companyId) {
        const published = this.published.get(companyId);
        const draft = this.drafts.get(companyId);
        if (!published || !draft)
            return [];
        const changes = [];
        const publishedKeys = new Set(published.page.columns.map((column) => column.key));
        for (const column of draft.page.columns) {
            if (!publishedKeys.has(column.key))
                changes.push({ op: '+', path: `columns.${column.key}`, to: column.label });
        }
        for (const action of draft.page.actions) {
            const previous = published.page.actions.find((entry) => entry.key === action.key);
            if (previous && previous.enabled !== action.enabled) {
                changes.push({ op: action.enabled ? '+' : '-', path: `actions.${action.key}`, from: previous.enabled, to: action.enabled });
            }
        }
        return changes;
    }
    publish(scope) {
        const companyId = this.requireLockedCompany(scope);
        this.assertBillingWritable(companyId);
        const draft = this.ensureDraft(scope);
        draft.status = 'published';
        draft.publishedAt = nowIso();
        this.published.set(companyId, JSON.parse(JSON.stringify(draft)));
        const history = this.versions.get(companyId) ?? [];
        history.push(JSON.parse(JSON.stringify(draft)));
        this.versions.set(companyId, history);
        this.drafts.delete(companyId);
        this.outbox.push({ id: (0, node_crypto_1.randomUUID)(), event: 'config.published', payload: { companyId, version: draft.version }, createdAt: nowIso() });
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: 'platform',
            tenantId: scope.tenantId,
            companyId,
            sessionId: scope.companySessionId,
            action: 'CONFIG_PUBLISHED',
            entityType: 'configuration',
            entityId: String(draft.version),
            before: { parent: draft.parentVersion },
            after: { version: draft.version, diff: this.diff(companyId) },
        });
        return draft;
    }
    rollback(scope, version) {
        const companyId = this.requireLockedCompany(scope);
        const history = this.versions.get(companyId) ?? [];
        const target = history.find((entry) => entry.version === version && entry.status === 'published');
        if (!target)
            throw new ControlPlaneError('Version not found', 'VERSION_NOT_FOUND', 404);
        const restored = {
            ...JSON.parse(JSON.stringify(target)),
            id: (0, node_crypto_1.randomUUID)(),
            version: (this.published.get(companyId)?.version ?? version) + 1,
            parentVersion: this.published.get(companyId)?.version ?? version,
            authorId: scope.actorId,
            publishedAt: nowIso(),
            createdAt: nowIso(),
            status: 'published',
        };
        this.published.set(companyId, restored);
        history.push(restored);
        this.auditEvent({
            actorUserId: scope.actorId,
            actorType: 'platform',
            tenantId: scope.tenantId,
            companyId,
            sessionId: scope.companySessionId,
            action: 'CONFIG_ROLLBACK',
            entityType: 'configuration',
            entityId: String(restored.version),
            before: { restoredFrom: version },
            after: { version: restored.version },
        });
        return restored;
    }
    runtimeConfig(companyId, role = 'ADMIN') {
        const published = this.published.get(companyId) ?? this.blankConfig(companyId, 'system', 1, 'published');
        const page = clonePage(published.page);
        page.columns = page.columns.filter((column) => column.visible && (!column.visibleRoles || column.visibleRoles.includes(role)));
        page.actions = page.actions.filter((action) => action.enabled && (!action.visibleRoles || action.visibleRoles.includes(role)));
        return {
            companyId,
            version: published.version,
            page,
            modules: Object.fromEntries(Object.keys(MODULE_REGISTRY).map((key) => [key, this.isFeatureEnabled(companyId, key)])),
            killSwitches: Object.fromEntries(this.safety.entries()),
            mobilePolicy: published.mobilePolicies.find((policy) => policy.role === role),
        };
    }
    moduleRegistry() {
        return { modules: MODULE_REGISTRY, actions: ACTION_REGISTRY };
    }
    setCompanyModule(scope, moduleKey, enabled) {
        const companyId = this.requireLockedCompany(scope);
        if (enabled && this.safety.get(moduleKey) === false) {
            throw new ControlPlaneError('Platform safety policy forbids enabling this feature', 'SAFETY_FLOOR', 403);
        }
        const planAllows = this.plans.get(this.requireCompany(companyId).planId)?.modules[moduleKey] === true;
        if (enabled && !planAllows && this.entitlements.get(companyId)?.[moduleKey] !== true) {
            throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
        }
        const entitlements = this.entitlements.get(companyId) ?? {};
        entitlements[moduleKey] = enabled;
        this.entitlements.set(companyId, entitlements);
        const draft = this.ensureDraft(scope);
        draft.modules[moduleKey] = enabled;
    }
    upsertWorkflow(scope, workflow) {
        const draft = this.ensureDraft(scope);
        const index = draft.workflows.findIndex((entry) => entry.key === workflow.key);
        if (index >= 0)
            draft.workflows[index] = workflow;
        else
            draft.workflows.push(workflow);
        return draft;
    }
    simulateWorkflow(companyId, workflowKey, context) {
        const published = this.published.get(companyId);
        const workflow = published?.workflows.find((entry) => entry.key === workflowKey);
        if (!workflow)
            throw new ControlPlaneError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
        const thresholdNode = workflow.graph.nodes.find((node) => node.type === 'condition');
        const amount = Number(thresholdNode?.config.amount ?? 100000);
        return {
            outcome: context.value <= amount ? 'auto_approve' : 'manager_approval',
            pinnedVersion: workflow.version,
        };
    }
    // Generic condition/outcome evaluator: no rule key is special-cased, so a
    // rule created through the Studio Rule Builder fires the same way as a
    // seeded one. Condition keys ending in Gt/Gte/Lt/Lte compare a context
    // field numerically (e.g. `adjustmentValueGt: 10000` reads
    // `context.adjustmentValue`); every other key is an equality check. All
    // conditions on a rule must match (AND). This is deterministic on
    // purpose, per the blueprint's "do not hide behind AI" rule (§13).
    evaluateRule(companyId, context) {
        const published = this.published.get(companyId);
        const outcomes = [];
        for (const rule of published?.rules ?? []) {
            if (ruleConditionMatches(rule.condition, context)) {
                outcomes.push(ruleOutcomeAction(rule.outcome));
            }
        }
        return outcomes;
    }
    upsertRule(scope, rule) {
        const draft = this.ensureDraft(scope);
        const index = draft.rules.findIndex((entry) => entry.key === rule.key);
        if (index >= 0)
            draft.rules[index] = rule;
        else
            draft.rules.push(rule);
        return draft;
    }
    upsertReport(scope, report) {
        const draft = this.ensureDraft(scope);
        const index = draft.reports.findIndex((entry) => entry.key === report.key);
        if (index >= 0)
            draft.reports[index] = report;
        else
            draft.reports.push(report);
        return draft;
    }
    upsertAutomation(scope, automation) {
        const draft = this.ensureDraft(scope);
        const index = draft.automations.findIndex((entry) => entry.key === automation.key);
        if (index >= 0)
            draft.automations[index] = automation;
        else
            draft.automations.push(automation);
        return draft;
    }
    upsertMobilePolicy(scope, policy) {
        const draft = this.ensureDraft(scope);
        const index = draft.mobilePolicies.findIndex((entry) => entry.role === policy.role);
        const normalized = { ...policy, encryptedLocalStore: true };
        if (index >= 0)
            draft.mobilePolicies[index] = normalized;
        else
            draft.mobilePolicies.push(normalized);
        return draft;
    }
    enqueueMutation(input) {
        this.assertBillingWritable(input.companyId);
        if (input.entityType === 'inventory' || input.actionType === 'STOCK_ADJUST' || input.actionType === 'POST_STOCK_ADJUSTMENT') {
            this.assertFeature(input.companyId, 'INVENTORY');
        }
        const existing = this.mutations.get(input.mutationId);
        if (existing)
            return existing;
        const mutation = {
            ...input,
            status: input.status ?? 'pending_sync',
            retryCount: 0,
            lastError: null,
            result: null,
            createdAt: nowIso(),
            serverAckAt: null,
        };
        this.mutations.set(mutation.mutationId, mutation);
        return this.processMutation(mutation.mutationId);
    }
    processMutation(mutationId) {
        const mutation = this.mutations.get(mutationId);
        if (!mutation)
            throw new ControlPlaneError('Mutation not found', 'MUTATION_NOT_FOUND', 404);
        if (mutation.status === 'synced')
            return mutation;
        mutation.status = 'syncing';
        if (mutation.actionType === 'STOCK_ADJUST' || mutation.actionType === 'POST_STOCK_ADJUSTMENT') {
            const itemId = String(mutation.payload.itemId ?? 'item-1');
            const delta = Number(mutation.payload.delta);
            if (!Number.isFinite(delta)) {
                mutation.status = 'rejected';
                mutation.lastError = 'Stock mutations must submit a movement delta, not a final quantity.';
                return mutation;
            }
            if (mutation.payload.quantity !== undefined && mutation.payload.delta === undefined) {
                mutation.status = 'rejected';
                mutation.lastError = 'NEVER_LAST_WRITE_WINS_STOCK';
                return mutation;
            }
            const key = this.ledgerKey(mutation.companyId, itemId);
            this.ledger.set(key, (this.ledger.get(key) ?? 0) + delta);
            mutation.result = { itemId, onHand: this.ledger.get(key) };
            mutation.status = 'synced';
            mutation.serverAckAt = nowIso();
            return mutation;
        }
        if (mutation.actionType === 'TASK_COMPLETE' && mutation.payload.alreadyCompleted) {
            mutation.status = 'conflict';
            mutation.lastError = 'Task already completed elsewhere';
            return mutation;
        }
        if (mutation.payload.permissionRevoked) {
            mutation.status = 'rejected';
            mutation.lastError = 'Permission revoked while offline';
            return mutation;
        }
        mutation.status = 'synced';
        mutation.serverAckAt = nowIso();
        mutation.result = { ok: true };
        return mutation;
    }
    stockOnHand(companyId, itemId) {
        return this.ledger.get(this.ledgerKey(companyId, itemId)) ?? 0;
    }
    ledgerKey(companyId, itemId) {
        return `${companyId}:${itemId}`;
    }
    registerDevice(input) {
        const id = `device-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
        this.devices.set(id, { id, companyId: input.companyId, userId: input.userId, status: 'trusted', appVersion: input.appVersion });
        return { id, status: 'trusted' };
    }
    revokeDevice(deviceId) {
        const device = this.devices.get(deviceId);
        if (device)
            device.status = 'revoked';
    }
    createApiKey(scope, name, scopes) {
        const companyId = this.requireLockedCompany(scope);
        this.assertFeature(companyId, 'INTEGRATIONS');
        this.assertFeature(companyId, 'api_access');
        const token = `invx_${(0, node_crypto_1.randomBytes)(16).toString('hex')}`;
        const id = (0, node_crypto_1.randomUUID)();
        const prefix = token.slice(0, 12);
        this.apiKeys.set(id, {
            id,
            companyId,
            name,
            prefix,
            hash: (0, node_crypto_1.createHmac)('sha256', jwtSecret()).update(token).digest('hex'),
            scopes,
            status: 'active',
        });
        this.auditEvent({
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
    verifyApiKey(token) {
        if (!token.startsWith('invx_'))
            return null;
        const expected = (0, node_crypto_1.createHmac)('sha256', jwtSecret()).update(token).digest('hex');
        let matched = null;
        for (const key of this.apiKeys.values()) {
            if (key.hash.length !== expected.length || !timingSafeEqual(key.hash, expected))
                continue;
            matched = key;
            break;
        }
        if (!matched)
            return null;
        if (matched.status !== 'active') {
            throw new ControlPlaneError('API key is revoked', 'API_KEY_REVOKED', 401);
        }
        if (!this.isFeatureEnabled(matched.companyId, 'INTEGRATIONS') || !this.isFeatureEnabled(matched.companyId, 'api_access')) {
            throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
        }
        const { hash: _hash, ...publicKey } = matched;
        return publicKey;
    }
    revokeApiKey(scope, keyId) {
        const companyId = this.requireLockedCompany(scope);
        const key = this.apiKeys.get(keyId);
        if (!key || key.companyId !== companyId) {
            throw new ControlPlaneError('API key not found', 'API_KEY_NOT_FOUND', 404);
        }
        key.status = 'revoked';
        this.auditEvent({
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
    createWebhook(scope, url, events, name = 'Ops webhook') {
        const companyId = this.requireLockedCompany(scope);
        this.assertFeature(companyId, 'INTEGRATIONS');
        const parsedEvents = (0, webhook_events_js_1.parseWebhookEvents)(events);
        const parsedUrl = (0, webhook_events_js_1.parseWebhookEndpoint)(url);
        const id = (0, node_crypto_1.randomUUID)();
        const signingSecret = (0, node_crypto_1.randomBytes)(32).toString('hex');
        this.webhooks.set(id, {
            id,
            companyId,
            name: (0, webhook_events_js_1.parseWebhookName)(name),
            url: parsedUrl.toString(),
            events: parsedEvents,
            status: 'active',
            signingSecret,
            createdAt: nowIso(),
        });
        this.auditEvent({
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
        return { id, signingSecret, name: (0, webhook_events_js_1.parseWebhookName)(name), url: parsedUrl.toString(), events: parsedEvents };
    }
    publicWebhooks(companyId) {
        return [...this.webhooks.values()]
            .filter((hook) => hook.companyId === companyId)
            .map(({ signingSecret: _secret, ...hook }) => hook);
    }
    upsertConnector(scope, type, status = 'healthy') {
        const companyId = this.requireLockedCompany(scope);
        const id = (0, node_crypto_1.randomUUID)();
        this.connectors.set(id, { id, companyId, type, status });
        return { id };
    }
    recordUsage(companyId, meter, increment = 1) {
        const usage = this.usage.get(companyId) ?? {};
        usage[meter] = (usage[meter] ?? 0) + increment;
        this.usage.set(companyId, usage);
    }
    health() {
        return {
            ok: true,
            service: 'invexa-control-plane',
            persistence: 'snapshot',
            companies: this.companies.size,
            sessions: [...this.sessions.values()].filter((session) => session.status === 'active').length,
            queueLag: this.outbox.length,
            syncPending: [...this.mutations.values()].filter((mutation) => mutation.status === 'pending_sync' || mutation.status === 'retry_scheduled').length,
            pastDueCompanies: [...this.billing.entries()].filter(([, billing]) => billing.subscription === 'past_due').map(([companyId]) => companyId),
            suspendedCompanies: [...this.companies.values()].filter((company) => company.status === 'suspended').map((company) => company.id),
            killSwitches: Object.fromEntries(this.safety.entries()),
        };
    }
    billingSnapshot(companyId) {
        return {
            companyId,
            planId: this.requireCompany(companyId).planId,
            billing: this.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 },
            usage: this.usage.get(companyId) ?? {},
            limits: this.effectiveLimits(companyId),
            invoices: this.listInvoices(companyId),
        };
    }
    publicCompany(company) {
        return {
            ...company,
            planId: company.planId,
            entitlements: this.entitlements.get(company.id) ?? {},
            limits: this.effectiveLimits(company.id),
            usage: this.usage.get(company.id) ?? {},
        };
    }
}
exports.ControlPlane = ControlPlane;
exports.controlPlane = new ControlPlane();
