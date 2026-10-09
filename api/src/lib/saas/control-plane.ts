import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../otp-auth.js';
import { DEFAULT_TENANT_ID, PLAN_PRICES } from './tenant-scope.js';
import type { ImportProfile } from '../import-profile.js';
import { parseWebhookEndpoint, parseWebhookEvents, parseWebhookName } from '../webhook-events.js';

export type SessionType = 'platform' | 'control' | 'tenant' | 'sync';
export type ActorType = 'platform' | 'company' | 'system';
export type CompanyStatus = 'active' | 'suspended';
export type ConfigStatus = 'draft' | 'published' | 'archived';
export type MutationStatus =
  | 'saved_locally'
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'rejected'
  | 'retry_scheduled';

export function apiKeyAllowsMethod(scopes: string[], method: string): boolean {
  const normalized = scopes.map((scope) => String(scope).toLowerCase());
  const wildcard = normalized.includes('*');
  const write = wildcard || normalized.some((scope) => scope === 'write' || scope.endsWith('.write'));
  const read = write || normalized.some((scope) => scope === 'read' || scope.endsWith('.read'));
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return read;
  return write;
}

export type ControlPlaneWebhook = {
  id: string;
  companyId: string;
  name: string;
  url: string;
  events: string[];
  status: 'active' | 'disabled';
  signingSecret: string;
  createdAt: string;
};

export type PublicControlPlaneWebhook = Omit<ControlPlaneWebhook, 'signingSecret'>;

export type PublicApiKey = {
  id: string;
  companyId: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: 'active' | 'revoked';
};

export class ControlPlaneError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

export type ScopeContext = {
  tenantId: string;
  companyId: string | null;
  actorId: string;
  actorType: ActorType;
  sessionType: SessionType;
  companySessionId: string | null;
  role: string;
  requestId?: string;
};

export type PlanTemplate = {
  id: string;
  name: string;
  limits: Record<string, number>;
  modules: Record<string, boolean>;
  capabilities: Record<string, boolean>;
};

export type CompanyRecord = {
  id: string;
  tenantId: string;
  name: string;
  status: CompanyStatus;
  planId: string;
  primaryAdminId: string | null;
  createdAt: string;
};

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: 'active' | 'suspended';
};

export type CompanyUser = {
  id: string;
  companyId: string;
  email: string;
  name: string;
  role: string;
  status: 'active' | 'inactive' | 'suspended';
  passwordHash: string;
  isPrimaryAdmin: boolean;
  createdAt: string;
};

export type CompanySession = {
  id: string;
  platformUserId: string;
  companyId: string;
  tenantId: string;
  status: 'active' | 'closed';
  issuedAt: string;
  expiresAt: string;
};

export type BillingInvoice = {
  id: string;
  companyId: string;
  amount: number;
  cycle: string;
  status: 'open' | 'paid' | 'past_due' | 'void';
  issuedAt: string;
  paidAt: string | null;
  stripeCheckoutSessionId?: string | null;
};

export type AuditEvent = {
  id: string;
  actorUserId: string;
  actorType: ActorType;
  tenantId: string;
  companyId: string | null;
  sessionId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason?: string;
  timestamp: string;
};

export type FieldDefinition = {
  id: string;
  companyId: string;
  entityType: string;
  fieldKey: string;
  label: string;
  dataType: string;
  required: boolean;
  defaultValue: unknown;
  placement?: string;
  visibleRoles: string[];
  editableRoles: string[];
  sortFilter: boolean;
  exportEnabled: boolean;
  mobileEnabled: boolean;
  status: 'active' | 'archived';
};

export type ColumnDefinition = {
  key: string;
  label: string;
  type: string;
  source: 'core' | 'custom';
  visible: boolean;
  exportEnabled: boolean;
  mobileEnabled: boolean;
  visibleRoles?: string[];
};

export type PageDefinition = {
  pageKey: string;
  title: string;
  route: string;
  columns: ColumnDefinition[];
  actions: Array<{
    key: string;
    label: string;
    enabled: boolean;
    placement: string;
    visibleRoles?: string[];
    onlinePolicy?: 'ONLINE_ONLY' | 'ALLOW_OFFLINE' | 'OFFLINE_WITH_LIMIT';
  }>;
  widgets: Array<{ key: string; label: string; order: number }>;
  tabs: Array<{ key: string; label: string; order: number }>;
};

export type ConfigurationVersion = {
  id: string;
  companyId: string;
  version: number;
  status: ConfigStatus;
  authorId: string;
  parentVersion: number | null;
  page: PageDefinition;
  fields: FieldDefinition[];
  modules: Record<string, boolean>;
  workflows: WorkflowDefinition[];
  rules: RuleDefinition[];
  reports: ReportDefinition[];
  automations: AutomationDefinition[];
  mobilePolicies: MobilePolicy[];
  publishedAt: string | null;
  createdAt: string;
};

export type WorkflowDefinition = {
  key: string;
  name: string;
  version: number;
  graph: { nodes: Array<{ id: string; type: string; config: Record<string, unknown> }> };
};

export type RuleDefinition = {
  key: string;
  name: string;
  condition: Record<string, unknown>;
  outcome: Record<string, unknown>;
};

export type ReportDefinition = {
  key: string;
  name: string;
  entity: string;
  columns: string[];
  filters: Record<string, unknown>;
};

export type AutomationDefinition = {
  key: string;
  name: string;
  trigger: 'schedule' | 'event';
  expression: string;
  actionKey: string;
};

export type MobilePolicy = {
  role: string;
  offlineMaxHours: number;
  syncScope: string[];
  navigation: string[];
  encryptedLocalStore: true;
};

export type SyncMutation = {
  mutationId: string;
  tenantId: string;
  companyId: string;
  userId: string;
  deviceId: string;
  entityType: string;
  actionType: string;
  payload: Record<string, unknown>;
  status: MutationStatus;
  retryCount: number;
  lastError: string | null;
  result: unknown;
  createdAt: string;
  serverAckAt: string | null;
};

export type ControlTokenPayload = {
  platformUserId?: string;
  userId: string;
  tenantId: string;
  companyId: string;
  companySessionId: string;
  sessionType: SessionType;
  permissions: string[];
  issuedAt: number;
  expiresAt: number;
  tokenType: 'access' | 'refresh';
};

const DEFAULT_STOCK_PAGE: PageDefinition = {
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

const MODULE_REGISTRY: Record<string, { name: string; dependencies: string[]; entitlementKey: string }> = {
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

const ACTION_REGISTRY: Record<string, { handlerKey: string; permission: string }> = {
  CREATE_TRANSFER: { handlerKey: 'transfers.create', permission: 'inventory.create' },
  APPROVE_TRANSFER: { handlerKey: 'transfers.approve', permission: 'inventory.approve' },
  POST_STOCK_ADJUSTMENT: { handlerKey: 'inventory.adjust', permission: 'inventory.adjust' },
  CREATE_PO: { handlerKey: 'purchasing.create', permission: 'purchasing.create' },
  BLOCK_LOT: { handlerKey: 'inventory.block_lot', permission: 'inventory.edit' },
  CREATE_TASK: { handlerKey: 'tasks.create', permission: 'inventory.create' },
  SEND_NOTIFICATION: { handlerKey: 'notify.send', permission: 'inventory.view' },
  CALL_WEBHOOK: { handlerKey: 'integrations.webhook', permission: 'integrations.edit' },
};

function nowIso(): string {
  return new Date().toISOString();
}

function jwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  return 'dev-secret-key-change-in-production';
}

export function signControlToken(payload: Omit<ControlTokenPayload, 'issuedAt' | 'expiresAt' | 'tokenType'> & {
  ttlSeconds?: number;
  tokenType?: 'access' | 'refresh';
}): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokenType = payload.tokenType ?? 'access';
  const ttlSeconds = payload.ttlSeconds ?? (tokenType === 'refresh' ? 60 * 60 * 24 * 7 : 60 * 60);
  const body: ControlTokenPayload = {
    ...payload,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    tokenType,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = createHmac('sha256', jwtSecret()).update(`${header}.${encoded}`).digest('base64url');
  return `${header}.${encoded}.${signature}`;
}

export function verifyControlToken(token: string, expectedType: 'access' | 'refresh' = 'access'): ControlTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new ControlPlaneError('Invalid control token', 'INVALID_TOKEN', 401);
  }
  const [header, encoded, signature] = parts;
  const expected = createHmac('sha256', jwtSecret()).update(`${header}.${encoded}`).digest('base64url');
  if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) {
    throw new ControlPlaneError('Invalid control token', 'INVALID_TOKEN', 401);
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ControlTokenPayload;
  if (payload.expiresAt < Math.floor(Date.now() / 1000)) {
    throw new ControlPlaneError('Control token expired', 'TOKEN_EXPIRED', 401);
  }
  if ((payload.tokenType ?? 'access') !== expectedType) {
    throw new ControlPlaneError('Wrong token type', 'INVALID_TOKEN', 401);
  }
  return payload;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clonePage(page: PageDefinition): PageDefinition {
  return JSON.parse(JSON.stringify(page)) as PageDefinition;
}

const COMPARATOR_SUFFIXES = ['Gte', 'Lte', 'Gt', 'Lt'] as const;

function ruleConditionMatches(condition: Record<string, unknown>, context: Record<string, unknown>): boolean {
  return Object.entries(condition).every(([key, expected]) => {
    const comparator = COMPARATOR_SUFFIXES.find((suffix) => key.endsWith(suffix));
    if (!comparator) return context[key] === expected;
    const field = key.slice(0, -comparator.length);
    const actual = Number(context[field]);
    const threshold = Number(expected);
    if (Number.isNaN(actual) || Number.isNaN(threshold)) return false;
    if (comparator === 'Gt') return actual > threshold;
    if (comparator === 'Gte') return actual >= threshold;
    if (comparator === 'Lt') return actual < threshold;
    return actual <= threshold;
  });
}

function ruleOutcomeAction(outcome: Record<string, unknown>): string {
  if (typeof outcome.action === 'string') return outcome.action;
  const [first] = Object.values(outcome);
  return String(first ?? '');
}

export class ControlPlane {
  tenantId = DEFAULT_TENANT_ID;
  plans = new Map<string, PlanTemplate>();
  companies = new Map<string, CompanyRecord>();
  platformUsers = new Map<string, PlatformUser>();
  companyUsers = new Map<string, CompanyUser>();
  sessions = new Map<string, CompanySession>();
  entitlements = new Map<string, Record<string, boolean>>();
  limitOverrides = new Map<string, Record<string, number>>();
  usage = new Map<string, Record<string, number>>();
  audit: AuditEvent[] = [];
  safety = new Map<string, boolean>();
  drafts = new Map<string, ConfigurationVersion>();
  published = new Map<string, ConfigurationVersion>();
  versions = new Map<string, ConfigurationVersion[]>();
  fieldValues = new Map<string, Record<string, unknown>>();
  ledger = new Map<string, number>();
  mutations = new Map<string, SyncMutation>();
  devices = new Map<string, { id: string; companyId: string; userId: string; status: 'trusted' | 'revoked' | 'outdated'; appVersion: string }>();
  apiKeys = new Map<string, { id: string; companyId: string; name: string; prefix: string; hash: string; scopes: string[]; status: 'active' | 'revoked' }>();
  webhooks = new Map<string, ControlPlaneWebhook>();
  connectors = new Map<string, { id: string; companyId: string; type: string; status: 'healthy' | 'degraded' | 'down' }>();
  importProfiles = new Map<string, ImportProfile>();
  billing = new Map<string, { subscription: 'trial' | 'active' | 'past_due'; cycle: string; amount: number; stripeCustomerId?: string }>();
  invoices = new Map<string, BillingInvoice>();
  outbox: Array<{ id: string; event: string; payload: unknown; createdAt: string }> = [];
  seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
  private seedPasswordHash = hashPassword(this.seedPassword);

  constructor() {
    this.seed();
  }

  reset(): void {
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
    this.seedPasswordHash = hashPassword(this.seedPassword);
    this.seed();
  }

  seed(): void {
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

  /**
   * Companies are born in two places: the control plane (create company) and operational data (a CompanyProfile
   * or users already carrying a companyId - seeded, imported or created before the control plane tracked them).
   * The platform list only knew the first group, so an operating company could be invisible to the super admin.
   * This adds the missing one with the default plan and keeps the display name equal to the workspace name.
   * Returns true when something changed (so the caller can persist).
   */
  registerOperationalCompany(input: { id: string; name: string; primaryAdminId?: string | null }): boolean {
    const name = input.name.trim() || input.id;
    const existing = this.companies.get(input.id);
    if (existing) {
      if (input.name.trim() && existing.name !== name) {
        existing.name = name;
        return true;
      }
      return false;
    }
    this.companies.set(input.id, {
      id: input.id,
      tenantId: this.tenantId,
      name,
      status: 'active',
      planId: 'pro',
      primaryAdminId: input.primaryAdminId ?? null,
      createdAt: nowIso(),
    });
    return true;
  }

  /**
   * Operational tenants (Postgres User/Location/CompanyProfile rows) are not
   * created through the control plane, so they must be mirrored into the
   * registry or the Control Plane company list never shows them.
   */
  syncOperationalCompany(input: {
    id: string;
    name: string;
    admin: { id: string; email: string; name: string; passwordHash: string } | null;
  }): boolean {
    const existing = this.companies.get(input.id);
    if (existing) {
      if (input.name && existing.name !== input.name) {
        existing.name = input.name;
        return true;
      }
      return false;
    }
    const createdAt = nowIso();
    const planId = this.plans.has('pro') ? 'pro' : [...this.plans.keys()][0];
    const plan = this.plans.get(planId)!;
    this.companies.set(input.id, {
      id: input.id,
      tenantId: this.tenantId,
      name: input.name || input.id,
      status: 'active',
      planId,
      primaryAdminId: input.admin?.id ?? null,
      createdAt,
    });
    if (input.admin && !this.companyUsers.has(input.admin.id)) {
      this.companyUsers.set(input.admin.id, {
        id: input.admin.id,
        companyId: input.id,
        email: input.admin.email.toLowerCase(),
        name: input.admin.name,
        role: 'ADMIN',
        status: 'active',
        passwordHash: input.admin.passwordHash,
        isPrimaryAdmin: true,
        createdAt,
      });
    }
    this.entitlements.set(input.id, { ...plan.modules });
    this.usage.set(input.id, { users: input.admin ? 1 : 0, company_admins: input.admin ? 1 : 0, api_requests: 0 });
    const published = this.blankConfig(input.id, input.admin?.id ?? 'system', 1, 'published');
    published.publishedAt = createdAt;
    this.published.set(input.id, published);
    this.versions.set(input.id, [published]);
    if (!this.billing.has(input.id)) this.billing.set(input.id, { subscription: 'active', cycle: 'monthly', amount: 0 });
    return true;
  }

  private createSeedCompany(input: {
    id: string;
    name: string;
    planId: string;
    admin: { id: string; email: string; name: string; role: string };
  }): void {
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
    const plan = this.plans.get(input.planId)!;
    this.entitlements.set(input.id, { ...plan.modules });
    this.usage.set(input.id, { users: 1, company_admins: 1, api_requests: 0 });
    const published = this.blankConfig(input.id, input.admin.id, 1, 'published');
    published.publishedAt = createdAt;
    this.published.set(input.id, published);
    this.versions.set(input.id, [published]);
  }

  blankConfig(companyId: string, authorId: string, version: number, status: ConfigStatus): ConfigurationVersion {
    return {
      id: randomUUID(),
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

  auditEvent(input: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const event: AuditEvent = { ...input, id: randomUUID(), timestamp: nowIso() };
    this.audit.push(event);
    this.outbox.push({ id: event.id, event: `audit.${input.action.toLowerCase()}`, payload: event, createdAt: event.timestamp });
    return event;
  }

  createScope(input: Partial<ScopeContext> & Pick<ScopeContext, 'actorId' | 'sessionType'>): ScopeContext {
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

  assertCompanyScope(scope: ScopeContext, resourceCompanyId: string): void {
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

  platformLogin(email: string, password: string): { user: Omit<PlatformUser, 'passwordHash'>; token: string; companies: CompanyRecord[] } {
    const user = [...this.platformUsers.values()].find((entry) => entry.email === email.toLowerCase());
    if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
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

  selectCompany(platformUserId: string, companyId: string): { session: CompanySession; token: string } {
    const company = this.requireCompany(companyId);
    if (company.status !== 'active') {
      throw new ControlPlaneError('Company is suspended', 'COMPANY_SUSPENDED', 403);
    }
    for (const session of this.sessions.values()) {
      if (session.platformUserId === platformUserId && session.status === 'active') {
        session.status = 'closed';
      }
    }
    const session: CompanySession = {
      id: randomUUID(),
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

  exitSession(sessionId: string, actorId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ControlPlaneError('Session not found', 'SESSION_NOT_FOUND', 404);
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

  requireControlSession(token: string): { scope: ScopeContext; payload: ControlTokenPayload; session?: CompanySession } {
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

  requireCompany(companyId: string): CompanyRecord {
    const company = this.companies.get(companyId);
    if (!company) throw new ControlPlaneError('Company not found', 'COMPANY_NOT_FOUND', 404);
    return company;
  }

  listPlans(): PlanTemplate[] {
    return [...this.plans.values()].map((plan) => ({ ...plan, limits: { ...plan.limits }, modules: { ...plan.modules } }));
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
    if ([...this.companyUsers.values()].some((user) => user.email === adminEmail)) {
      throw new ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
    }
    const plan = this.plans.get(input.planId);
    if (!plan) throw new ControlPlaneError('Unknown plan', 'PLAN_NOT_FOUND', 404);
    const id = `company-${randomBytes(4).toString('hex')}`;
    const adminId = `user-${randomBytes(4).toString('hex')}`;
    const temporaryPassword = `Invexa${randomBytes(3).toString('hex')}9A`;
    const company: CompanyRecord = {
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
      passwordHash: hashPassword(temporaryPassword),
      isPrimaryAdmin: true,
      createdAt: nowIso(),
    });
    this.entitlements.set(id, { ...plan.modules });
    this.usage.set(id, { users: 1, company_admins: 1, api_requests: 0 });
    const published = this.blankConfig(id, scope.actorId, 1, 'published');
    this.published.set(id, published);
    this.versions.set(id, [published]);
    this.billing.set(id, {
      subscription: PLAN_PRICES[input.planId] > 0 ? 'active' : 'trial',
      cycle: 'monthly',
      amount: PLAN_PRICES[input.planId] ?? 0,
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

  setCompanyStatus(scope: ScopeContext, companyId: string, status: CompanyStatus, reason: string): CompanyRecord {
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

  assignPlan(scope: ScopeContext, companyId: string, planId: string, reason: string): { company: CompanyRecord; downgradePolicy?: string } {
    if (scope.sessionType !== 'platform' || scope.companyId) this.assertCompanyScope(scope, companyId);
    const company = this.requireCompany(companyId);
    const plan = this.plans.get(planId);
    if (!plan) throw new ControlPlaneError('Unknown plan', 'PLAN_NOT_FOUND', 404);
    const previous = company.planId;
    company.planId = planId;
    const current = this.entitlements.get(companyId) ?? {};
    this.entitlements.set(companyId, { ...plan.modules });
    const billing = this.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 };
    billing.amount = PLAN_PRICES[planId] ?? billing.amount;
    if (billing.amount > 0 && billing.subscription === 'trial') billing.subscription = 'active';
    this.billing.set(companyId, billing);
    const usage = this.usage.get(companyId) ?? {};
    let downgradePolicy: string | undefined;
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

  overrideEntitlement(scope: ScopeContext, companyId: string, featureKey: string, enabled: boolean, reason: string): void {
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

  private entitlementOverrides(companyId: string): Record<string, boolean> {
    const record = this.entitlements.get(companyId) ?? {};
    return { ...record };
  }

  effectiveLimits(companyId: string): Record<string, number> {
    const company = this.requireCompany(companyId);
    const plan = this.plans.get(company.planId)!;
    return { ...plan.limits, ...(this.limitOverrides.get(companyId) ?? {}) };
  }

  isFeatureEnabled(companyId: string, featureKey: string): boolean {
    if (this.safety.get(featureKey) === false) return false;
    const company = this.requireCompany(companyId);
    const plan = this.plans.get(company.planId)!;
    const fromPlan = plan.modules[featureKey] ?? plan.capabilities[featureKey] ?? false;
    const companyValue = this.entitlements.get(companyId)?.[featureKey];
    if (this.safety.get(featureKey) === false) return false;
    return companyValue ?? fromPlan;
  }

  assertFeature(companyId: string, featureKey: string): void {
    if (this.safety.get(featureKey) === false) {
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
    const company = this.requireCompany(companyId);
    if (company.status === 'suspended') {
      throw new ControlPlaneError('Company is suspended', 'COMPANY_SUSPENDED', 403);
    }
    if (this.billing.get(companyId)?.subscription === 'past_due') {
      throw new ControlPlaneError('Billing is past due; mutating control-plane actions are on hold', 'BILLING_HOLD', 402);
    }
  }

  issueInvoice(scope: ScopeContext, companyId: string): BillingInvoice {
    if (scope.sessionType !== 'platform' || scope.companyId) this.assertCompanyScope(scope, companyId);
    const billing = this.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 };
    const invoice: BillingInvoice = {
      id: randomUUID(),
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

  payInvoice(scope: ScopeContext, invoiceId: string): BillingInvoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new ControlPlaneError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    if (scope.sessionType !== 'platform' || scope.companyId) this.assertCompanyScope(scope, invoice.companyId);
    if (invoice.status === 'paid') return invoice;
    invoice.status = 'paid';
    invoice.paidAt = nowIso();
    const remainingPastDue = [...this.invoices.values()].some(
      (entry) =>
        entry.companyId === invoice.companyId
        && entry.id !== invoice.id
        && entry.status === 'past_due',
    );
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

  markInvoicePastDue(scope: ScopeContext, invoiceId: string): BillingInvoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new ControlPlaneError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    if (scope.sessionType !== 'platform' || scope.companyId) this.assertCompanyScope(scope, invoice.companyId);
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

  listInvoices(companyId: string): BillingInvoice[] {
    return [...this.invoices.values()].filter((invoice) => invoice.companyId === companyId);
  }

  setKillSwitch(scope: ScopeContext, featureKey: string, enabled: boolean, reason: string): void {
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

  listCompanyUsers(companyId: string): Array<Omit<CompanyUser, 'passwordHash'>> {
    return [...this.companyUsers.values()]
      .filter((user) => user.companyId === companyId)
      .map(({ passwordHash: _passwordHash, ...user }) => user);
  }

  createCompanyUser(scope: ScopeContext, input: { email: string; name: string; role: string }): Omit<CompanyUser, 'passwordHash'> {
    const companyId = scope.companyId;
    if (!companyId) throw new ControlPlaneError('Company session required', 'SESSION_REQUIRED', 401);
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
    const user: CompanyUser = {
      id: `user-${randomBytes(4).toString('hex')}`,
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
    if (user.role === 'ADMIN') usage.company_admins = (usage.company_admins ?? 0) + 1;
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

  resetPassword(scope: ScopeContext, userId: string): { temporaryPassword: string } {
    const user = this.companyUsers.get(userId);
    if (!user) throw new ControlPlaneError('User not found', 'USER_NOT_FOUND', 404);
    if (scope.companyId) this.assertCompanyScope(scope, user.companyId);
    const temporaryPassword = `Invexa${randomBytes(3).toString('hex')}9A`;
    user.passwordHash = hashPassword(temporaryPassword);
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

  deleteCompanyUser(scope: ScopeContext, userId: string): void {
    const user = this.companyUsers.get(userId);
    if (!user) throw new ControlPlaneError('User not found', 'USER_NOT_FOUND', 404);
    if (scope.companyId) this.assertCompanyScope(scope, user.companyId);
    if (user.isPrimaryAdmin) {
      throw new ControlPlaneError('Primary Company Admin cannot be deleted', 'PRIMARY_ADMIN_PROTECTED', 403);
    }
    user.status = 'inactive';
  }

  ensureDraft(scope: ScopeContext): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    const existing = this.drafts.get(companyId);
    if (existing) return existing;
    const published = this.published.get(companyId) ?? this.blankConfig(companyId, scope.actorId, 1, 'published');
    const draft = {
      ...JSON.parse(JSON.stringify(published)) as ConfigurationVersion,
      id: randomUUID(),
      version: published.version + 1,
      status: 'draft' as const,
      authorId: scope.actorId,
      parentVersion: published.version,
      publishedAt: null,
      createdAt: nowIso(),
    };
    this.drafts.set(companyId, draft);
    return draft;
  }

  requireLockedCompany(scope: ScopeContext): string {
    if (scope.sessionType !== 'control' || !scope.companyId || !scope.companySessionId) {
      throw new ControlPlaneError('Hard-locked company control session required', 'SESSION_REQUIRED', 401);
    }
    const session = this.sessions.get(scope.companySessionId);
    if (!session || session.status !== 'active' || session.companyId !== scope.companyId) {
      throw new ControlPlaneError('Company control session is closed', 'SESSION_CLOSED', 401);
    }
    return scope.companyId;
  }

  addStockColumn(scope: ScopeContext, input: {
    name: string;
    key: string;
    type: string;
    required?: boolean;
    defaultValue?: unknown;
    placement?: string;
    visibleRoles?: string[];
    editableRoles?: string[];
  }): ConfigurationVersion {
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
    const field: FieldDefinition = {
      id: randomUUID(),
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
    const column: ColumnDefinition = {
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
    if (afterIndex >= 0) draft.page.columns.splice(afterIndex + 1, 0, column);
    else draft.page.columns.push(column);
    return draft;
  }

  // Generic Field Builder (blueprint §16 "Field builder"): works across any
  // entity type, not only the stock page. addStockColumn() above is kept
  // as-is for backward compatibility (it also mirrors into page.columns,
  // which only the stock page renders today) - this is the path for
  // fields on entities that don't have a page-rendering surface yet.
  addField(scope: ScopeContext, input: {
    entityType: string;
    key: string;
    name: string;
    type: string;
    required?: boolean;
    defaultValue?: unknown;
    visibleRoles?: string[];
    editableRoles?: string[];
  }): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.assertBillingWritable(companyId);
    if (!this.plans.get(this.requireCompany(companyId).planId)?.capabilities.custom_fields) {
      throw new ControlPlaneError('Custom fields are not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
    const draft = this.ensureDraft(scope);
    if (draft.fields.some((entry) => entry.entityType === input.entityType && entry.fieldKey === input.key)) {
      throw new ControlPlaneError('Duplicate field key for this entity', 'RESERVED_FIELD', 400);
    }
    const field: FieldDefinition = {
      id: randomUUID(),
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

  /**
   * Reorders, renames and shows/hides the stock table's columns (core and custom) in the draft.
   * `layout` lists column keys in the wanted order; columns left out keep their relative order
   * after the listed ones. The item code/name column can be renamed and moved but never hidden.
   */
  setStockColumnLayout(scope: ScopeContext, layout: Array<{ key: string; label?: string; visible?: boolean }>): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.assertBillingWritable(companyId);
    const draft = this.ensureDraft(scope);
    const byKey = new Map(draft.page.columns.map((column) => [column.key, column]));
    const seen = new Set<string>();
    const ordered: ColumnDefinition[] = [];
    for (const entry of layout) {
      const column = byKey.get(String(entry?.key ?? ''));
      if (!column) throw new ControlPlaneError(`Unknown column "${String(entry?.key ?? '')}"`, 'COLUMN_NOT_FOUND', 404);
      if (seen.has(column.key)) throw new ControlPlaneError(`Column "${column.label}" is listed twice`, 'DUPLICATE_COLUMN', 400);
      seen.add(column.key);
      if (entry.label !== undefined) {
        const label = String(entry.label).replace(/[ -]/g, ' ').trim().slice(0, 60);
        if (!label) throw new ControlPlaneError('Every column needs a name', 'INVALID_COLUMN_LABEL', 400);
        column.label = label;
      }
      if (entry.visible !== undefined) {
        if (column.key === 'item_code' && entry.visible === false) {
          throw new ControlPlaneError('The item code & name column cannot be hidden', 'COLUMN_REQUIRED', 400);
        }
        column.visible = Boolean(entry.visible);
      }
      ordered.push(column);
    }
    draft.page.columns = [...ordered, ...draft.page.columns.filter((column) => !seen.has(column.key))];
    return draft;
  }

  setActionEnabled(scope: ScopeContext, actionKey: string, enabled: boolean): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const action = draft.page.actions.find((entry) => entry.key === actionKey);
    if (!action) throw new ControlPlaneError('Unknown action', 'ACTION_NOT_FOUND', 404);
    action.enabled = enabled;
    return draft;
  }

  moveTab(scope: ScopeContext, tabKey: string, order: number): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const tab = draft.page.tabs.find((entry) => entry.key === tabKey);
    if (!tab) throw new ControlPlaneError('Unknown tab', 'TAB_NOT_FOUND', 404);
    tab.order = order;
    draft.page.tabs.sort((left, right) => left.order - right.order);
    return draft;
  }

  preview(scope: ScopeContext, input: { role: string; device: 'desktop' | 'tablet' | 'mobile' }): {
    role: string;
    device: string;
    page: PageDefinition;
    version: number;
  } {
    const draft = this.ensureDraft(scope);
    const page = clonePage(draft.page);
    page.columns = page.columns.filter((column) => !column.visibleRoles || column.visibleRoles.includes(input.role));
    page.actions = page.actions.filter((action) => action.enabled && (!action.visibleRoles || action.visibleRoles.includes(input.role)));
    if (input.device === 'mobile') {
      page.columns = page.columns.filter((column) => column.mobileEnabled);
    }
    return { role: input.role, device: input.device, page, version: draft.version };
  }

  diff(companyId: string): Array<{ op: '+' | '-' | '~'; path: string; from?: unknown; to?: unknown }> {
    const published = this.published.get(companyId);
    const draft = this.drafts.get(companyId);
    if (!published || !draft) return [];
    const changes: Array<{ op: '+' | '-' | '~'; path: string; from?: unknown; to?: unknown }> = [];
    const publishedKeys = new Set(published.page.columns.map((column) => column.key));
    for (const column of draft.page.columns) {
      if (!publishedKeys.has(column.key)) changes.push({ op: '+', path: `columns.${column.key}`, to: column.label });
    }
    for (const action of draft.page.actions) {
      const previous = published.page.actions.find((entry) => entry.key === action.key);
      if (previous && previous.enabled !== action.enabled) {
        changes.push({ op: action.enabled ? '+' : '-', path: `actions.${action.key}`, from: previous.enabled, to: action.enabled });
      }
    }
    return changes;
  }

  publish(scope: ScopeContext): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    this.assertBillingWritable(companyId);
    const draft = this.ensureDraft(scope);
    draft.status = 'published';
    draft.publishedAt = nowIso();
    this.published.set(companyId, JSON.parse(JSON.stringify(draft)) as ConfigurationVersion);
    const history = this.versions.get(companyId) ?? [];
    history.push(JSON.parse(JSON.stringify(draft)) as ConfigurationVersion);
    this.versions.set(companyId, history);
    this.drafts.delete(companyId);
    this.outbox.push({ id: randomUUID(), event: 'config.published', payload: { companyId, version: draft.version }, createdAt: nowIso() });
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

  rollback(scope: ScopeContext, version: number): ConfigurationVersion {
    const companyId = this.requireLockedCompany(scope);
    const history = this.versions.get(companyId) ?? [];
    const target = history.find((entry) => entry.version === version && entry.status === 'published');
    if (!target) throw new ControlPlaneError('Version not found', 'VERSION_NOT_FOUND', 404);
    const restored = {
      ...JSON.parse(JSON.stringify(target)) as ConfigurationVersion,
      id: randomUUID(),
      version: (this.published.get(companyId)?.version ?? version) + 1,
      parentVersion: this.published.get(companyId)?.version ?? version,
      authorId: scope.actorId,
      publishedAt: nowIso(),
      createdAt: nowIso(),
      status: 'published' as const,
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

  runtimeConfig(companyId: string, role = 'ADMIN'): {
    companyId: string;
    version: number;
    page: PageDefinition;
    modules: Record<string, boolean>;
    killSwitches: Record<string, boolean>;
    mobilePolicy?: MobilePolicy;
  } {
    const published = this.published.get(companyId) ?? this.blankConfig(companyId, 'system', 1, 'published');
    const page = clonePage(published.page);
    page.columns = page.columns.filter((column) => column.visible && (!column.visibleRoles || column.visibleRoles.includes(role)));
    page.actions = page.actions.filter((action) => action.enabled && (!action.visibleRoles || action.visibleRoles.includes(role)));
    return {
      companyId,
      version: published.version,
      page,
      modules: Object.fromEntries(
        Object.keys(MODULE_REGISTRY).map((key) => [key, this.isFeatureEnabled(companyId, key)]),
      ),
      killSwitches: Object.fromEntries(this.safety.entries()),
      mobilePolicy: published.mobilePolicies.find((policy) => policy.role === role),
    };
  }

  moduleRegistry() {
    return { modules: MODULE_REGISTRY, actions: ACTION_REGISTRY };
  }

  setCompanyModule(scope: ScopeContext, moduleKey: string, enabled: boolean): void {
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

  upsertWorkflow(scope: ScopeContext, workflow: WorkflowDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.workflows.findIndex((entry) => entry.key === workflow.key);
    if (index >= 0) draft.workflows[index] = workflow;
    else draft.workflows.push(workflow);
    return draft;
  }

  simulateWorkflow(companyId: string, workflowKey: string, context: { value: number }): { outcome: string; pinnedVersion: number } {
    const published = this.published.get(companyId);
    const workflow = published?.workflows.find((entry) => entry.key === workflowKey);
    if (!workflow) throw new ControlPlaneError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
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
  evaluateRule(companyId: string, context: Record<string, unknown>): string[] {
    const published = this.published.get(companyId);
    const outcomes: string[] = [];
    for (const rule of published?.rules ?? []) {
      if (ruleConditionMatches(rule.condition, context)) {
        outcomes.push(ruleOutcomeAction(rule.outcome));
      }
    }
    return outcomes;
  }

  upsertRule(scope: ScopeContext, rule: RuleDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.rules.findIndex((entry) => entry.key === rule.key);
    if (index >= 0) draft.rules[index] = rule;
    else draft.rules.push(rule);
    return draft;
  }

  upsertReport(scope: ScopeContext, report: ReportDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.reports.findIndex((entry) => entry.key === report.key);
    if (index >= 0) draft.reports[index] = report;
    else draft.reports.push(report);
    return draft;
  }

  upsertAutomation(scope: ScopeContext, automation: AutomationDefinition): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.automations.findIndex((entry) => entry.key === automation.key);
    if (index >= 0) draft.automations[index] = automation;
    else draft.automations.push(automation);
    return draft;
  }

  upsertMobilePolicy(scope: ScopeContext, policy: MobilePolicy): ConfigurationVersion {
    const draft = this.ensureDraft(scope);
    const index = draft.mobilePolicies.findIndex((entry) => entry.role === policy.role);
    const normalized: MobilePolicy = { ...policy, encryptedLocalStore: true };
    if (index >= 0) draft.mobilePolicies[index] = normalized;
    else draft.mobilePolicies.push(normalized);
    return draft;
  }

  enqueueMutation(input: Omit<SyncMutation, 'status' | 'retryCount' | 'lastError' | 'result' | 'serverAckAt' | 'createdAt'> & { status?: MutationStatus }): SyncMutation {
    this.assertBillingWritable(input.companyId);
    if (input.entityType === 'inventory' || input.actionType === 'STOCK_ADJUST' || input.actionType === 'POST_STOCK_ADJUSTMENT') {
      this.assertFeature(input.companyId, 'INVENTORY');
    }
    const existing = this.mutations.get(input.mutationId);
    if (existing) return existing;
    const mutation: SyncMutation = {
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

  processMutation(mutationId: string): SyncMutation {
    const mutation = this.mutations.get(mutationId);
    if (!mutation) throw new ControlPlaneError('Mutation not found', 'MUTATION_NOT_FOUND', 404);
    if (mutation.status === 'synced') return mutation;
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

  stockOnHand(companyId: string, itemId: string): number {
    return this.ledger.get(this.ledgerKey(companyId, itemId)) ?? 0;
  }

  private ledgerKey(companyId: string, itemId: string): string {
    return `${companyId}:${itemId}`;
  }

  registerDevice(input: { companyId: string; userId: string; appVersion: string }): { id: string; status: string } {
    const id = `device-${randomBytes(4).toString('hex')}`;
    this.devices.set(id, { id, companyId: input.companyId, userId: input.userId, status: 'trusted', appVersion: input.appVersion });
    return { id, status: 'trusted' };
  }

  revokeDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) device.status = 'revoked';
  }

  createApiKey(scope: ScopeContext, name: string, scopes: string[]): { id: string; token: string; prefix: string } {
    const companyId = this.requireLockedCompany(scope);
    this.assertFeature(companyId, 'INTEGRATIONS');
    this.assertFeature(companyId, 'api_access');
    const token = `invx_${randomBytes(16).toString('hex')}`;
    const id = randomUUID();
    const prefix = token.slice(0, 12);
    this.apiKeys.set(id, {
      id,
      companyId,
      name,
      prefix,
      hash: createHmac('sha256', jwtSecret()).update(token).digest('hex'),
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

  verifyApiKey(token: string): PublicApiKey | null {
    if (!token.startsWith('invx_')) return null;
    const expected = createHmac('sha256', jwtSecret()).update(token).digest('hex');
    let matched: { id: string; companyId: string; name: string; prefix: string; hash: string; scopes: string[]; status: 'active' | 'revoked' } | null = null;
    for (const key of this.apiKeys.values()) {
      if (key.hash.length !== expected.length || !timingSafeEqual(key.hash, expected)) continue;
      matched = key;
      break;
    }
    if (!matched) return null;
    if (matched.status !== 'active') {
      throw new ControlPlaneError('API key is revoked', 'API_KEY_REVOKED', 401);
    }
    if (!this.isFeatureEnabled(matched.companyId, 'INTEGRATIONS') || !this.isFeatureEnabled(matched.companyId, 'api_access')) {
      throw new ControlPlaneError('Feature is not entitled', 'FEATURE_NOT_ENTITLED', 403);
    }
    const { hash: _hash, ...publicKey } = matched;
    return publicKey;
  }

  revokeApiKey(scope: ScopeContext, keyId: string): PublicApiKey {
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

  /**
   * Issues a replacement key with the same name and scopes and revokes the old
   * one in a single step, so a leaked or aging key can be replaced without a gap
   * in which two keys are valid. The new token is returned once and never again;
   * the audit record names both key ids, never a token.
   */
  rotateApiKey(scope: ScopeContext, keyId: string): { id: string; token: string; prefix: string; rotatedFrom: string } {
    const companyId = this.requireLockedCompany(scope);
    const old = this.apiKeys.get(keyId);
    if (!old || old.companyId !== companyId) {
      throw new ControlPlaneError('API key not found', 'API_KEY_NOT_FOUND', 404);
    }
    if (old.status !== 'active') {
      throw new ControlPlaneError('Only an active API key can be rotated', 'API_KEY_REVOKED', 409);
    }
    const created = this.createApiKey(scope, old.name, [...old.scopes]);
    old.status = 'revoked';
    this.auditEvent({
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
    const companyId = this.requireLockedCompany(scope);
    this.assertFeature(companyId, 'INTEGRATIONS');
    const parsedEvents = parseWebhookEvents(events);
    const parsedUrl = parseWebhookEndpoint(url);
    const id = randomUUID();
    const signingSecret = randomBytes(32).toString('hex');
    this.webhooks.set(id, {
      id,
      companyId,
      name: parseWebhookName(name),
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
    return { id, signingSecret, name: parseWebhookName(name), url: parsedUrl.toString(), events: parsedEvents };
  }

  publicWebhooks(companyId: string): PublicControlPlaneWebhook[] {
    return [...this.webhooks.values()]
      .filter((hook) => hook.companyId === companyId)
      .map(({ signingSecret: _secret, ...hook }) => hook);
  }

  upsertConnector(scope: ScopeContext, type: string, status: 'healthy' | 'degraded' | 'down' = 'healthy'): { id: string } {
    const companyId = this.requireLockedCompany(scope);
    const id = randomUUID();
    this.connectors.set(id, { id, companyId, type, status });
    return { id };
  }

  recordUsage(companyId: string, meter: string, increment = 1): void {
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

  billingSnapshot(companyId: string) {
    return {
      companyId,
      planId: this.requireCompany(companyId).planId,
      billing: this.billing.get(companyId) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 },
      usage: this.usage.get(companyId) ?? {},
      limits: this.effectiveLimits(companyId),
      invoices: this.listInvoices(companyId),
    };
  }

  publicCompany(company: CompanyRecord) {
    return {
      ...company,
      planId: company.planId,
      entitlements: this.entitlements.get(company.id) ?? {},
      limits: this.effectiveLimits(company.id),
      usage: this.usage.get(company.id) ?? {},
    };
  }
}

export const controlPlane = new ControlPlane();
export { DEFAULT_STOCK_PAGE, MODULE_REGISTRY, ACTION_REGISTRY };
