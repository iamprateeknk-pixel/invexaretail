import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../otp-auth.js';
import { DEFAULT_TENANT_ID, PLAN_PRICES } from './tenant-scope.js';
import { profileKey, type ImportKind, type ImportProfile } from '../import-profile.js';
import { FormulaError, STOCK_FORMULA_FIELDS, validateFormula } from '../formula.js';
import { parseWebhookEndpoint, parseWebhookEvents, parseWebhookName } from '../webhook-events.js';
import { ACTION_REGISTRY, COLUMN_ROLES, DEFAULT_STOCK_PAGE, DEFAULT_TABLE_COLUMNS, MODULE_REGISTRY, TABLE_RULES } from './control-plane-defaults.js';
import { signControlToken, verifyControlToken } from './control-plane-tokens.js';
import { createControlPlaneStore, type ControlPlaneStore } from './control-plane-store.js';
import { ControlPlaneBilling } from './control-plane-billing.js';
import { ControlPlaneIntegrations } from './control-plane-integrations.js';
import { ControlPlaneStudio } from './control-plane-studio.js';
import { ControlPlaneSync } from './control-plane-sync.js';

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
  source: 'core' | 'custom' | 'formula' | 'itemField';
  visible: boolean;
  exportEnabled: boolean;
  mobileEnabled: boolean;
  visibleRoles?: string[];
  /** Calculated column: evaluated per stock row from STOCK_FORMULA_FIELDS. */
  formula?: string;
  /** Item custom field (by name) whose value this column shows for each stock row. */
  itemField?: string;
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
  /** Column layouts of other tables (`lots`, `itemLots`). Missing = the built-in default. */
  tables?: Record<string, ColumnDefinition[]>;
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

export type DraftEntryKind = 'fields' | 'workflows' | 'rules' | 'reports' | 'automations' | 'mobilePolicies';

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

export function nowIso(): string {
  return new Date().toISOString();
}

export type TableKey = 'stock' | 'lots' | 'itemLots';
export const TABLE_KEYS: readonly TableKey[] = ['stock', 'lots', 'itemLots'];

/**
 * Which roles may see a column. No list (or every role) = everyone. ADMIN is always included so a layout
 * can never hide a column from the people who manage it.
 */
export function normalizeColumnRoles(input: unknown): string[] | undefined {
  if (input === null || input === undefined) return undefined;
  if (!Array.isArray(input)) throw new ControlPlaneError('Roles must be a list', 'INVALID_ROLE', 400);
  if (input.length === 0) return undefined;
  const roles = new Set<string>(['ADMIN']);
  for (const role of input) {
    if (!(COLUMN_ROLES as readonly string[]).includes(String(role))) throw new ControlPlaneError(`Unknown role "${String(role)}"`, 'INVALID_ROLE', 400);
    roles.add(String(role));
  }
  return roles.size === COLUMN_ROLES.length ? undefined : COLUMN_ROLES.filter((role) => roles.has(role));
}

export function isTableKey(value: unknown): value is TableKey {
  return typeof value === 'string' && (TABLE_KEYS as readonly string[]).includes(value);
}

/** Columns of one table on a page; non-stock tables are created from their defaults on first use. */
export function pageTableColumns(page: PageDefinition, table: TableKey): ColumnDefinition[] {
  if (table === 'stock') return page.columns;
  page.tables ??= {};
  return (page.tables[table] ??= JSON.parse(JSON.stringify(DEFAULT_TABLE_COLUMNS[table])) as ColumnDefinition[]);
}

export function clonePage(page: PageDefinition): PageDefinition {
  return JSON.parse(JSON.stringify(page)) as PageDefinition;
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

  getImportProfile(companyId: string, kind: ImportKind): ImportProfile | undefined {
    return this.importProfiles.get(profileKey(companyId, kind));
  }
  billing = new Map<string, { subscription: 'trial' | 'active' | 'past_due'; cycle: string; amount: number; stripeCustomerId?: string }>();
  invoices = new Map<string, BillingInvoice>();
  outbox: Array<{ id: string; event: string; payload: unknown; createdAt: string }> = [];
  seedPassword = process.env.SEED_PASSWORD ?? 'ChangeMe123!';
  private seedPasswordHash = hashPassword(this.seedPassword);

  readonly store: ControlPlaneStore;
  private readonly billingSvc: ControlPlaneBilling;
  private readonly integrationsSvc: ControlPlaneIntegrations;
  private readonly studioSvc: ControlPlaneStudio;
  private readonly syncSvc: ControlPlaneSync;

  constructor() {
    this.store = createControlPlaneStore(this);
    this.billingSvc = new ControlPlaneBilling(this.store, this);
    this.integrationsSvc = new ControlPlaneIntegrations(this.store, this);
    this.studioSvc = new ControlPlaneStudio(this.store, this);
    this.syncSvc = new ControlPlaneSync(this.store, this);
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

    this.ledger.set(this.syncSvc.ledgerKey('default-company', 'item-1'), 10);
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
    return this.billingSvc.listPlans();
  }

  createCompany(scope: ScopeContext, input: { name: string; planId: string; adminEmail: string; adminName: string }): { company: CompanyRecord; temporaryPassword: string } {
    return this.billingSvc.createCompany(scope, input);
  }

  setCompanyStatus(scope: ScopeContext, companyId: string, status: CompanyStatus, reason: string): CompanyRecord {
    return this.billingSvc.setCompanyStatus(scope, companyId, status, reason);
  }

  assignPlan(scope: ScopeContext, companyId: string, planId: string, reason: string): { company: CompanyRecord; downgradePolicy?: string } {
    return this.billingSvc.assignPlan(scope, companyId, planId, reason);
  }

  overrideEntitlement(scope: ScopeContext, companyId: string, featureKey: string, enabled: boolean, reason: string): void {
    this.billingSvc.overrideEntitlement(scope, companyId, featureKey, enabled, reason);
  }

  private entitlementOverrides(companyId: string): Record<string, boolean> {
    return this.billingSvc.entitlementOverrides(companyId);
  }

  effectiveLimits(companyId: string): Record<string, number> {
    return this.billingSvc.effectiveLimits(companyId);
  }

  isFeatureEnabled(companyId: string, featureKey: string): boolean {
    return this.billingSvc.isFeatureEnabled(companyId, featureKey);
  }

  assertFeature(companyId: string, featureKey: string): void {
    this.billingSvc.assertFeature(companyId, featureKey);
  }

  assertLimit(companyId: string, limitKey: string, nextCount: number): void {
    this.billingSvc.assertLimit(companyId, limitKey, nextCount);
  }

  assertBillingWritable(companyId: string): void {
    this.billingSvc.assertBillingWritable(companyId);
  }

  issueInvoice(scope: ScopeContext, companyId: string): BillingInvoice {
    return this.billingSvc.issueInvoice(scope, companyId);
  }

  payInvoice(scope: ScopeContext, invoiceId: string): BillingInvoice {
    return this.billingSvc.payInvoice(scope, invoiceId);
  }

  markInvoicePastDue(scope: ScopeContext, invoiceId: string): BillingInvoice {
    return this.billingSvc.markInvoicePastDue(scope, invoiceId);
  }

  listInvoices(companyId: string): BillingInvoice[] {
    return this.billingSvc.listInvoices(companyId);
  }

  setKillSwitch(scope: ScopeContext, featureKey: string, enabled: boolean, reason: string): void {
    this.billingSvc.setKillSwitch(scope, featureKey, enabled, reason);
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
    return this.studioSvc.ensureDraft(scope);
  }

  requireLockedCompany(scope: ScopeContext): string {
    return this.studioSvc.requireLockedCompany(scope);
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
    return this.studioSvc.addStockColumn(scope, input);
  }
  addField(scope: ScopeContext, input: {
    entityType: string;
    key: string;
    name: string;
    type: string;
    required?: boolean;
    defaultValue?: unknown;
    visibleRoles?: string[];
    editableRoles?: string[];
    replace?: boolean;
  }): ConfigurationVersion {
    return this.studioSvc.addField(scope, input);
  }

  private tableColumnsOf(draft: ConfigurationVersion, table: TableKey): ColumnDefinition[] {
    return this.studioSvc.tableColumnsOf(draft, table);
  }

  private setTableColumnsOf(draft: ConfigurationVersion, table: TableKey, columns: ColumnDefinition[]): void {
    this.studioSvc.setTableColumnsOf(draft, table, columns);
  }
  getDraftColumns(scope: ScopeContext, table: TableKey = 'stock'): ColumnDefinition[] {
    return this.studioSvc.getDraftColumns(scope, table);
  }
  setStockColumnLayout(scope: ScopeContext, layout: Array<{ key: string; label?: string; visible?: boolean; visibleRoles?: string[] | null }>, table: TableKey = 'stock'): ConfigurationVersion {
    return this.studioSvc.setStockColumnLayout(scope, layout, table);
  }
  setStockFormulaColumn(scope: ScopeContext, input: { key?: string; label: string; formula: string; type?: string }, table: TableKey = 'stock'): ConfigurationVersion {
    return this.studioSvc.setStockFormulaColumn(scope, input, table);
  }
  addItemFieldColumn(scope: ScopeContext, input: { fieldName: string; label?: string }, table: TableKey = 'stock'): ConfigurationVersion {
    return this.studioSvc.addItemFieldColumn(scope, input, table);
  }
  clearStockFormula(scope: ScopeContext, key: string, table: TableKey = 'stock'): ConfigurationVersion {
    return this.studioSvc.clearStockFormula(scope, key, table);
  }

  setActionEnabled(scope: ScopeContext, actionKey: string, enabled: boolean): ConfigurationVersion {
    return this.studioSvc.setActionEnabled(scope, actionKey, enabled);
  }

  moveTab(scope: ScopeContext, tabKey: string, order: number): ConfigurationVersion {
    return this.studioSvc.moveTab(scope, tabKey, order);
  }

  preview(scope: ScopeContext, input: { role: string; device: 'desktop' | 'tablet' | 'mobile' }): {
    role: string;
    device: string;
    page: PageDefinition;
    version: number;
  } {
    return this.studioSvc.preview(scope, input);
  }

  diff(companyId: string): Array<{ op: '+' | '-' | '~'; path: string; from?: unknown; to?: unknown }> {
    return this.studioSvc.diff(companyId);
  }

  publish(scope: ScopeContext): ConfigurationVersion {
    return this.studioSvc.publish(scope);
  }

  rollback(scope: ScopeContext, version: number): ConfigurationVersion {
    return this.studioSvc.rollback(scope, version);
  }

  runtimeConfig(companyId: string, role = 'ADMIN'): {
    companyId: string;
    version: number;
    page: PageDefinition;
    modules: Record<string, boolean>;
    killSwitches: Record<string, boolean>;
    mobilePolicy?: MobilePolicy;
  } {
    return this.studioSvc.runtimeConfig(companyId, role);
  }

  moduleRegistry() {
    return this.studioSvc.moduleRegistry();
  }

  setCompanyModule(scope: ScopeContext, moduleKey: string, enabled: boolean): void {
    this.studioSvc.setCompanyModule(scope, moduleKey, enabled);
  }

  upsertWorkflow(scope: ScopeContext, workflow: WorkflowDefinition): ConfigurationVersion {
    return this.studioSvc.upsertWorkflow(scope, workflow);
  }

  simulateWorkflow(companyId: string, workflowKey: string, context: { value: number }): { outcome: string; pinnedVersion: number } {
    return this.studioSvc.simulateWorkflow(companyId, workflowKey, context);
  }
  evaluateRule(companyId: string, context: Record<string, unknown>): string[] {
    return this.studioSvc.evaluateRule(companyId, context);
  }

  upsertRule(scope: ScopeContext, rule: RuleDefinition): ConfigurationVersion {
    return this.studioSvc.upsertRule(scope, rule);
  }

  upsertReport(scope: ScopeContext, report: ReportDefinition): ConfigurationVersion {
    return this.studioSvc.upsertReport(scope, report);
  }

  upsertAutomation(scope: ScopeContext, automation: AutomationDefinition): ConfigurationVersion {
    return this.studioSvc.upsertAutomation(scope, automation);
  }

  upsertMobilePolicy(scope: ScopeContext, policy: MobilePolicy): ConfigurationVersion {
    return this.studioSvc.upsertMobilePolicy(scope, policy);
  }
  removeDraftEntry(scope: ScopeContext, kind: DraftEntryKind, key: string): ConfigurationVersion {
    return this.studioSvc.removeDraftEntry(scope, kind, key);
  }

  enqueueMutation(input: Omit<SyncMutation, 'status' | 'retryCount' | 'lastError' | 'result' | 'serverAckAt' | 'createdAt'> & { status?: MutationStatus }): SyncMutation {
    return this.syncSvc.enqueueMutation(input);
  }

  processMutation(mutationId: string): SyncMutation {
    return this.syncSvc.processMutation(mutationId);
  }

  stockOnHand(companyId: string, itemId: string): number {
    return this.syncSvc.stockOnHand(companyId, itemId);
  }

  private ledgerKey(companyId: string, itemId: string): string {
    return this.syncSvc.ledgerKey(companyId, itemId);
  }

  registerDevice(input: { companyId: string; userId: string; appVersion: string }): { id: string; status: string } {
    return this.syncSvc.registerDevice(input);
  }

  revokeDevice(deviceId: string): void {
    this.syncSvc.revokeDevice(deviceId);
  }

  createApiKey(scope: ScopeContext, name: string, scopes: string[]): { id: string; token: string; prefix: string } {
    return this.integrationsSvc.createApiKey(scope, name, scopes);
  }

  verifyApiKey(token: string): PublicApiKey | null {
    return this.integrationsSvc.verifyApiKey(token);
  }

  revokeApiKey(scope: ScopeContext, keyId: string): PublicApiKey {
    return this.integrationsSvc.revokeApiKey(scope, keyId);
  }
  rotateApiKey(scope: ScopeContext, keyId: string): { id: string; token: string; prefix: string; rotatedFrom: string } {
    return this.integrationsSvc.rotateApiKey(scope, keyId);
  }

  createWebhook(scope: ScopeContext, url: string, events: string[], name = 'Ops webhook'): { id: string; signingSecret: string; name: string; url: string; events: string[] } {
    return this.integrationsSvc.createWebhook(scope, url, events, name);
  }

  publicWebhooks(companyId: string): PublicControlPlaneWebhook[] {
    return this.integrationsSvc.publicWebhooks(companyId);
  }

  upsertConnector(scope: ScopeContext, type: string, status: 'healthy' | 'degraded' | 'down' = 'healthy'): { id: string } {
    return this.integrationsSvc.upsertConnector(scope, type, status);
  }

  recordUsage(companyId: string, meter: string, increment = 1): void {
    this.integrationsSvc.recordUsage(companyId, meter, increment);
  }

  health() {
    return this.integrationsSvc.health();
  }

  billingSnapshot(companyId: string) {
    return this.integrationsSvc.billingSnapshot(companyId);
  }

  publicCompany(company: CompanyRecord) {
    return this.integrationsSvc.publicCompany(company);
  }
}

export const controlPlane = new ControlPlane();
export { ACTION_REGISTRY, COLUMN_ROLES, DEFAULT_STOCK_PAGE, MODULE_REGISTRY, signControlToken, verifyControlToken };
