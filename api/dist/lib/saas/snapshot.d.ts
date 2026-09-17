import type { AutomationDefinition, AuditEvent, CompanyRecord, CompanySession, CompanyUser, ConfigurationVersion, ControlPlane, FieldDefinition, BillingInvoice, MobilePolicy, PageDefinition, PlanTemplate, PlatformUser, ReportDefinition, RuleDefinition, SyncMutation, WorkflowDefinition } from './control-plane.js';
export declare const CONTROL_PLANE_SNAPSHOT_VERSION = 1;
export declare const CONTROL_PLANE_STATE_ID = "saas-v1";
export type ControlPlaneSnapshot = {
    version: number;
    tenantId: string;
    plans: PlanTemplate[];
    companies: CompanyRecord[];
    platformUsers: PlatformUser[];
    companyUsers: CompanyUser[];
    sessions: CompanySession[];
    entitlements: Array<[string, Record<string, boolean>]>;
    limitOverrides: Array<[string, Record<string, number>]>;
    usage: Array<[string, Record<string, number>]>;
    audit: AuditEvent[];
    safety: Array<[string, boolean]>;
    drafts: ConfigurationVersion[];
    published: ConfigurationVersion[];
    versions: Array<[string, ConfigurationVersion[]]>;
    fieldValues: Array<[string, Record<string, unknown>]>;
    ledger: Array<[string, number]>;
    mutations: SyncMutation[];
    devices: Array<[string, {
        id: string;
        companyId: string;
        userId: string;
        status: 'trusted' | 'revoked' | 'outdated';
        appVersion: string;
    }]>;
    apiKeys: Array<[string, {
        id: string;
        companyId: string;
        name: string;
        prefix: string;
        hash: string;
        scopes: string[];
        status: 'active' | 'revoked';
    }]>;
    webhooks: Array<[
        string,
        {
            id: string;
            companyId: string;
            name?: string;
            url: string;
            events: string[];
            status: 'active' | 'disabled';
            signingSecret?: string;
            createdAt?: string;
        }
    ]>;
    connectors: Array<[string, {
        id: string;
        companyId: string;
        type: string;
        status: 'healthy' | 'degraded' | 'down';
    }]>;
    billing: Array<[string, {
        subscription: 'trial' | 'active' | 'past_due';
        cycle: string;
        amount: number;
        stripeCustomerId?: string;
    }]>;
    invoices: BillingInvoice[];
    outbox: ControlPlane['outbox'];
};
export declare function serializeControlPlane(plane: ControlPlane): ControlPlaneSnapshot;
export declare function applyControlPlaneSnapshot(plane: ControlPlane, snapshot: ControlPlaneSnapshot): void;
export declare function isControlPlaneSnapshot(value: unknown): value is ControlPlaneSnapshot;
export type { PageDefinition, FieldDefinition, WorkflowDefinition, RuleDefinition, ReportDefinition, AutomationDefinition, MobilePolicy };
