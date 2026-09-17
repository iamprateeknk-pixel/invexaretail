export type SessionType = 'platform' | 'control' | 'tenant' | 'sync';
export type ActorType = 'platform' | 'company' | 'system';
export type CompanyStatus = 'active' | 'suspended';
export type ConfigStatus = 'draft' | 'published' | 'archived';
export type MutationStatus = 'saved_locally' | 'pending_sync' | 'syncing' | 'synced' | 'conflict' | 'rejected' | 'retry_scheduled';
export declare function apiKeyAllowsMethod(scopes: string[], method: string): boolean;
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
export declare class ControlPlaneError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(message: string, code: string, status?: number);
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
    widgets: Array<{
        key: string;
        label: string;
        order: number;
    }>;
    tabs: Array<{
        key: string;
        label: string;
        order: number;
    }>;
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
    graph: {
        nodes: Array<{
            id: string;
            type: string;
            config: Record<string, unknown>;
        }>;
    };
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
declare const DEFAULT_STOCK_PAGE: PageDefinition;
declare const MODULE_REGISTRY: Record<string, {
    name: string;
    dependencies: string[];
    entitlementKey: string;
}>;
declare const ACTION_REGISTRY: Record<string, {
    handlerKey: string;
    permission: string;
}>;
export declare function signControlToken(payload: Omit<ControlTokenPayload, 'issuedAt' | 'expiresAt' | 'tokenType'> & {
    ttlSeconds?: number;
    tokenType?: 'access' | 'refresh';
}): string;
export declare function verifyControlToken(token: string, expectedType?: 'access' | 'refresh'): ControlTokenPayload;
export declare class ControlPlane {
    tenantId: string;
    plans: Map<string, PlanTemplate>;
    companies: Map<string, CompanyRecord>;
    platformUsers: Map<string, PlatformUser>;
    companyUsers: Map<string, CompanyUser>;
    sessions: Map<string, CompanySession>;
    entitlements: Map<string, Record<string, boolean>>;
    limitOverrides: Map<string, Record<string, number>>;
    usage: Map<string, Record<string, number>>;
    audit: AuditEvent[];
    safety: Map<string, boolean>;
    drafts: Map<string, ConfigurationVersion>;
    published: Map<string, ConfigurationVersion>;
    versions: Map<string, ConfigurationVersion[]>;
    fieldValues: Map<string, Record<string, unknown>>;
    ledger: Map<string, number>;
    mutations: Map<string, SyncMutation>;
    devices: Map<string, {
        id: string;
        companyId: string;
        userId: string;
        status: "trusted" | "revoked" | "outdated";
        appVersion: string;
    }>;
    apiKeys: Map<string, {
        id: string;
        companyId: string;
        name: string;
        prefix: string;
        hash: string;
        scopes: string[];
        status: "active" | "revoked";
    }>;
    webhooks: Map<string, ControlPlaneWebhook>;
    connectors: Map<string, {
        id: string;
        companyId: string;
        type: string;
        status: "healthy" | "degraded" | "down";
    }>;
    billing: Map<string, {
        subscription: "trial" | "active" | "past_due";
        cycle: string;
        amount: number;
        stripeCustomerId?: string;
    }>;
    invoices: Map<string, BillingInvoice>;
    outbox: Array<{
        id: string;
        event: string;
        payload: unknown;
        createdAt: string;
    }>;
    seedPassword: string;
    private seedPasswordHash;
    constructor();
    reset(): void;
    seed(): void;
    private createSeedCompany;
    blankConfig(companyId: string, authorId: string, version: number, status: ConfigStatus): ConfigurationVersion;
    auditEvent(input: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent;
    createScope(input: Partial<ScopeContext> & Pick<ScopeContext, 'actorId' | 'sessionType'>): ScopeContext;
    assertCompanyScope(scope: ScopeContext, resourceCompanyId: string): void;
    platformLogin(email: string, password: string): {
        user: Omit<PlatformUser, 'passwordHash'>;
        token: string;
        companies: CompanyRecord[];
    };
    selectCompany(platformUserId: string, companyId: string): {
        session: CompanySession;
        token: string;
    };
    exitSession(sessionId: string, actorId: string): void;
    requireControlSession(token: string): {
        scope: ScopeContext;
        payload: ControlTokenPayload;
        session?: CompanySession;
    };
    requireCompany(companyId: string): CompanyRecord;
    listPlans(): PlanTemplate[];
    createCompany(scope: ScopeContext, input: {
        name: string;
        planId: string;
        adminEmail: string;
        adminName: string;
    }): {
        company: CompanyRecord;
        temporaryPassword: string;
    };
    setCompanyStatus(scope: ScopeContext, companyId: string, status: CompanyStatus, reason: string): CompanyRecord;
    assignPlan(scope: ScopeContext, companyId: string, planId: string, reason: string): {
        company: CompanyRecord;
        downgradePolicy?: string;
    };
    overrideEntitlement(scope: ScopeContext, companyId: string, featureKey: string, enabled: boolean, reason: string): void;
    private entitlementOverrides;
    effectiveLimits(companyId: string): Record<string, number>;
    isFeatureEnabled(companyId: string, featureKey: string): boolean;
    assertFeature(companyId: string, featureKey: string): void;
    assertLimit(companyId: string, limitKey: string, nextCount: number): void;
    assertBillingWritable(companyId: string): void;
    issueInvoice(scope: ScopeContext, companyId: string): BillingInvoice;
    payInvoice(scope: ScopeContext, invoiceId: string): BillingInvoice;
    markInvoicePastDue(scope: ScopeContext, invoiceId: string): BillingInvoice;
    listInvoices(companyId: string): BillingInvoice[];
    setKillSwitch(scope: ScopeContext, featureKey: string, enabled: boolean, reason: string): void;
    listCompanyUsers(companyId: string): Array<Omit<CompanyUser, 'passwordHash'>>;
    createCompanyUser(scope: ScopeContext, input: {
        email: string;
        name: string;
        role: string;
    }): Omit<CompanyUser, 'passwordHash'>;
    resetPassword(scope: ScopeContext, userId: string): {
        temporaryPassword: string;
    };
    deleteCompanyUser(scope: ScopeContext, userId: string): void;
    ensureDraft(scope: ScopeContext): ConfigurationVersion;
    requireLockedCompany(scope: ScopeContext): string;
    addStockColumn(scope: ScopeContext, input: {
        name: string;
        key: string;
        type: string;
        required?: boolean;
        defaultValue?: unknown;
        placement?: string;
        visibleRoles?: string[];
        editableRoles?: string[];
    }): ConfigurationVersion;
    addField(scope: ScopeContext, input: {
        entityType: string;
        key: string;
        name: string;
        type: string;
        required?: boolean;
        defaultValue?: unknown;
        visibleRoles?: string[];
        editableRoles?: string[];
    }): ConfigurationVersion;
    setActionEnabled(scope: ScopeContext, actionKey: string, enabled: boolean): ConfigurationVersion;
    moveTab(scope: ScopeContext, tabKey: string, order: number): ConfigurationVersion;
    preview(scope: ScopeContext, input: {
        role: string;
        device: 'desktop' | 'tablet' | 'mobile';
    }): {
        role: string;
        device: string;
        page: PageDefinition;
        version: number;
    };
    diff(companyId: string): Array<{
        op: '+' | '-' | '~';
        path: string;
        from?: unknown;
        to?: unknown;
    }>;
    publish(scope: ScopeContext): ConfigurationVersion;
    rollback(scope: ScopeContext, version: number): ConfigurationVersion;
    runtimeConfig(companyId: string, role?: string): {
        companyId: string;
        version: number;
        page: PageDefinition;
        modules: Record<string, boolean>;
        killSwitches: Record<string, boolean>;
        mobilePolicy?: MobilePolicy;
    };
    moduleRegistry(): {
        modules: Record<string, {
            name: string;
            dependencies: string[];
            entitlementKey: string;
        }>;
        actions: Record<string, {
            handlerKey: string;
            permission: string;
        }>;
    };
    setCompanyModule(scope: ScopeContext, moduleKey: string, enabled: boolean): void;
    upsertWorkflow(scope: ScopeContext, workflow: WorkflowDefinition): ConfigurationVersion;
    simulateWorkflow(companyId: string, workflowKey: string, context: {
        value: number;
    }): {
        outcome: string;
        pinnedVersion: number;
    };
    evaluateRule(companyId: string, context: Record<string, unknown>): string[];
    upsertRule(scope: ScopeContext, rule: RuleDefinition): ConfigurationVersion;
    upsertReport(scope: ScopeContext, report: ReportDefinition): ConfigurationVersion;
    upsertAutomation(scope: ScopeContext, automation: AutomationDefinition): ConfigurationVersion;
    upsertMobilePolicy(scope: ScopeContext, policy: MobilePolicy): ConfigurationVersion;
    enqueueMutation(input: Omit<SyncMutation, 'status' | 'retryCount' | 'lastError' | 'result' | 'serverAckAt' | 'createdAt'> & {
        status?: MutationStatus;
    }): SyncMutation;
    processMutation(mutationId: string): SyncMutation;
    stockOnHand(companyId: string, itemId: string): number;
    private ledgerKey;
    registerDevice(input: {
        companyId: string;
        userId: string;
        appVersion: string;
    }): {
        id: string;
        status: string;
    };
    revokeDevice(deviceId: string): void;
    createApiKey(scope: ScopeContext, name: string, scopes: string[]): {
        id: string;
        token: string;
        prefix: string;
    };
    verifyApiKey(token: string): PublicApiKey | null;
    revokeApiKey(scope: ScopeContext, keyId: string): PublicApiKey;
    createWebhook(scope: ScopeContext, url: string, events: string[], name?: string): {
        id: string;
        signingSecret: string;
        name: string;
        url: string;
        events: string[];
    };
    publicWebhooks(companyId: string): PublicControlPlaneWebhook[];
    upsertConnector(scope: ScopeContext, type: string, status?: 'healthy' | 'degraded' | 'down'): {
        id: string;
    };
    recordUsage(companyId: string, meter: string, increment?: number): void;
    health(): {
        ok: boolean;
        service: string;
        persistence: string;
        companies: number;
        sessions: number;
        queueLag: number;
        syncPending: number;
        pastDueCompanies: string[];
        suspendedCompanies: string[];
        killSwitches: {
            [k: string]: boolean;
        };
    };
    billingSnapshot(companyId: string): {
        companyId: string;
        planId: string;
        billing: {
            subscription: "trial" | "active" | "past_due";
            cycle: string;
            amount: number;
            stripeCustomerId?: string;
        };
        usage: Record<string, number>;
        limits: Record<string, number>;
        invoices: BillingInvoice[];
    };
    publicCompany(company: CompanyRecord): {
        planId: string;
        entitlements: Record<string, boolean>;
        limits: Record<string, number>;
        usage: Record<string, number>;
        id: string;
        tenantId: string;
        name: string;
        status: CompanyStatus;
        primaryAdminId: string | null;
        createdAt: string;
    };
}
export declare const controlPlane: ControlPlane;
export { DEFAULT_STOCK_PAGE, MODULE_REGISTRY, ACTION_REGISTRY };
