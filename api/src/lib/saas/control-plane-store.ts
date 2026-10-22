import type { ImportProfile } from '../import-profile.js';
import type {
  AuditEvent,
  BillingInvoice,
  CompanyRecord,
  CompanySession,
  CompanyUser,
  ConfigurationVersion,
  ControlPlaneWebhook,
  PlatformUser,
  PlanTemplate,
  SyncMutation,
} from './control-plane.js';

/**
 * The control plane's in-memory state, as one explicit object (Phase 4 facade split).
 * The ControlPlane class still owns the underlying Maps/arrays; this store is a live
 * view over them, handed to the facade area services. Accessors (not snapshots of the
 * references) so snapshot hydration / reset(), which replace the Maps on the class,
 * are always observed through the store. State architecture is unchanged (see R4).
 */
export interface ControlPlaneStore {
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
  devices: Map<string, { id: string; companyId: string; userId: string; status: 'trusted' | 'revoked' | 'outdated'; appVersion: string }>;
  apiKeys: Map<string, { id: string; companyId: string; name: string; prefix: string; hash: string; scopes: string[]; status: 'active' | 'revoked' }>;
  webhooks: Map<string, ControlPlaneWebhook>;
  connectors: Map<string, { id: string; companyId: string; type: string; status: 'healthy' | 'degraded' | 'down' }>;
  importProfiles: Map<string, ImportProfile>;
  billing: Map<string, { subscription: 'trial' | 'active' | 'past_due'; cycle: string; amount: number; stripeCustomerId?: string }>;
  invoices: Map<string, BillingInvoice>;
  outbox: Array<{ id: string; event: string; payload: unknown; createdAt: string }>;
}

export function createControlPlaneStore(plane: ControlPlaneStore): ControlPlaneStore {
  return {
    get tenantId() { return plane.tenantId; },
    set tenantId(value) { plane.tenantId = value; },
    get plans() { return plane.plans; },
    set plans(value) { plane.plans = value; },
    get companies() { return plane.companies; },
    set companies(value) { plane.companies = value; },
    get platformUsers() { return plane.platformUsers; },
    set platformUsers(value) { plane.platformUsers = value; },
    get companyUsers() { return plane.companyUsers; },
    set companyUsers(value) { plane.companyUsers = value; },
    get sessions() { return plane.sessions; },
    set sessions(value) { plane.sessions = value; },
    get entitlements() { return plane.entitlements; },
    set entitlements(value) { plane.entitlements = value; },
    get limitOverrides() { return plane.limitOverrides; },
    set limitOverrides(value) { plane.limitOverrides = value; },
    get usage() { return plane.usage; },
    set usage(value) { plane.usage = value; },
    get audit() { return plane.audit; },
    set audit(value) { plane.audit = value; },
    get safety() { return plane.safety; },
    set safety(value) { plane.safety = value; },
    get drafts() { return plane.drafts; },
    set drafts(value) { plane.drafts = value; },
    get published() { return plane.published; },
    set published(value) { plane.published = value; },
    get versions() { return plane.versions; },
    set versions(value) { plane.versions = value; },
    get fieldValues() { return plane.fieldValues; },
    set fieldValues(value) { plane.fieldValues = value; },
    get ledger() { return plane.ledger; },
    set ledger(value) { plane.ledger = value; },
    get mutations() { return plane.mutations; },
    set mutations(value) { plane.mutations = value; },
    get devices() { return plane.devices; },
    set devices(value) { plane.devices = value; },
    get apiKeys() { return plane.apiKeys; },
    set apiKeys(value) { plane.apiKeys = value; },
    get webhooks() { return plane.webhooks; },
    set webhooks(value) { plane.webhooks = value; },
    get connectors() { return plane.connectors; },
    set connectors(value) { plane.connectors = value; },
    get importProfiles() { return plane.importProfiles; },
    set importProfiles(value) { plane.importProfiles = value; },
    get billing() { return plane.billing; },
    set billing(value) { plane.billing = value; },
    get invoices() { return plane.invoices; },
    set invoices(value) { plane.invoices = value; },
    get outbox() { return plane.outbox; },
    set outbox(value) { plane.outbox = value; },
  };
}
