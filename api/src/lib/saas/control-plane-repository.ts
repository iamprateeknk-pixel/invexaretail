import { Prisma } from '@prisma/client';
import { resolveDatabaseUrl } from '../db.js';
import type { ControlPlane } from './control-plane.js';
import {
  applyControlPlaneSnapshot,
  serializeControlPlane,
  type ControlPlaneSnapshot,
} from './snapshot.js';

/**
 * ULTRA P2 — the control plane's row layer.
 *
 * The services in this area are synchronous and operate on in-memory Maps
 * (see control-plane-store.ts); rewriting them all async is a separate
 * programme. This module makes the DATABASE the system of record underneath
 * those Maps instead of the single ControlPlaneState JSON blob:
 *
 * - persist: diff the live plane against the last-persisted snapshot and
 *   upsert/delete only the changed ROWS, in one transaction. Two replicas
 *   that change different records no longer overwrite each other.
 * - hydrate: rebuild the plane from rows on boot (with a one-time import
 *   from the legacy blob when the tables are still empty).
 * - refresh: re-read rows and apply remote changes that this replica did
 *   not dirty locally, so registry reads converge across replicas.
 * - read-through: kill switches, control sessions and API keys are re-read
 *   from their row on the request path (see control-plane.ts Fresh
 *   variants), so a kill switch or revocation set on one replica is
 *   honoured by every other replica immediately.
 * - usage: per-meter rows with atomic increments, so concurrent counters
 *   from two replicas sum instead of racing.
 *
 * Memory/demo mode is untouched: every function here is a no-op when the
 * database is not enabled, and the in-memory services never see a
 * difference. Plans are NOT persisted (they are static code seeds,
 * re-created on every boot and merged back by applyControlPlaneSnapshot).
 *
 * API-key rows store only the HMAC hash, never a token. Webhook rows store
 * the signing secret (needed to sign deliveries); it is never serialised
 * to a public shape.
 */

export function controlPlaneDbEnabled(): boolean {
  if (process.env.NODE_TEST_CONTEXT && process.env.CONTROL_PLANE_PERSIST_IN_TESTS !== '1') {
    return false;
  }
  return Boolean(resolveDatabaseUrl());
}

async function getPrisma() {
  const { prisma } = await import('../db.js');
  return prisma;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Key-order-insensitive JSON equality: hydration rebuilds objects in a different key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// Snapshot <-> rows mapping
// ---------------------------------------------------------------------------

export type ControlPlaneRows = {
  tenantId: string;
  companies: Array<{
    id: string;
    tenantId: string;
    name: string;
    status: string;
    planId: string;
    primaryAdminId: string | null;
    createdAt: string;
    entitlements: Record<string, boolean>;
    limitOverrides: Record<string, number>;
    billing: { subscription: string; cycle: string; amount: number; stripeCustomerId?: string };
  }>;
  platformUsers: Array<{ id: string; email: string; name: string; passwordHash: string; status: string }>;
  companyUsers: Array<{
    id: string;
    companyId: string;
    email: string;
    name: string;
    role: string;
    status: string;
    passwordHash: string;
    isPrimaryAdmin: boolean;
    createdAt: string;
  }>;
  sessions: Array<{
    id: string;
    platformUserId: string;
    companyId: string;
    tenantId: string;
    status: string;
    issuedAt: string;
    expiresAt: string;
  }>;
  safety: Array<{ featureKey: string; enabled: boolean }>;
  usage: Array<{ companyId: string; meter: string; value: number }>;
  configs: Array<{
    versionId: string;
    companyId: string;
    version: number;
    kind: string;
    status: string;
    payload: ControlPlaneSnapshot['drafts'][number];
  }>;
  fieldValues: Array<{ key: string; value: Record<string, unknown> }>;
  ledger: Array<{ key: string; value: number }>;
  mutations: Array<{
    mutationId: string;
    tenantId: string;
    companyId: string;
    userId: string;
    deviceId: string;
    entityType: string;
    actionType: string;
    payload: Record<string, unknown>;
    status: string;
    retryCount: number;
    lastError: string | null;
    result: unknown;
    createdAt: string;
    serverAckAt: string | null;
  }>;
  devices: Array<{ id: string; companyId: string; userId: string; status: string; appVersion: string }>;
  apiKeys: Array<{
    id: string;
    companyId: string;
    name: string;
    prefix: string;
    hash: string;
    scopes: string[];
    status: string;
    createdAt?: string;
  }>;
  webhooks: Array<{
    id: string;
    companyId: string;
    name: string;
    url: string;
    events: string[];
    status: string;
    signingSecret: string;
    createdAt: string;
  }>;
  connectors: Array<{ id: string; companyId: string; type: string; status: string }>;
  invoices: Array<{
    id: string;
    companyId: string;
    amount: number;
    cycle: string;
    status: string;
    issuedAt: string;
    paidAt: string | null;
    stripeCheckoutSessionId?: string | null;
  }>;
  importProfiles: Array<{ key: string; profile: unknown }>;
  audit: ControlPlaneSnapshot['audit'];
  outbox: ControlPlaneSnapshot['outbox'];
};

export function rowsFromSnapshot(snapshot: ControlPlaneSnapshot): ControlPlaneRows {
  const entitlements = new Map(snapshot.entitlements ?? []);
  const limitOverrides = new Map(snapshot.limitOverrides ?? []);
  const billing = new Map(snapshot.billing ?? []);
  return {
    tenantId: snapshot.tenantId,
    companies: (snapshot.companies ?? []).map((company) => ({
      id: company.id,
      tenantId: company.tenantId,
      name: company.name,
      status: company.status,
      planId: company.planId,
      primaryAdminId: company.primaryAdminId,
      createdAt: company.createdAt,
      entitlements: cloneJson(entitlements.get(company.id) ?? {}),
      limitOverrides: cloneJson(limitOverrides.get(company.id) ?? {}),
      billing: cloneJson(billing.get(company.id) ?? { subscription: 'trial', cycle: 'monthly', amount: 0 }),
    })),
    platformUsers: cloneJson(snapshot.platformUsers ?? []),
    companyUsers: cloneJson(snapshot.companyUsers ?? []),
    sessions: cloneJson(snapshot.sessions ?? []),
    safety: (snapshot.safety ?? []).map(([featureKey, enabled]) => ({ featureKey, enabled })),
    usage: (snapshot.usage ?? []).flatMap(([companyId, meters]) =>
      Object.entries(meters ?? {}).map(([meter, value]) => ({ companyId, meter, value })),
    ),
    configs: [
      ...(snapshot.drafts ?? []).map((draft) => ({
        versionId: draft.id,
        companyId: draft.companyId,
        version: draft.version,
        kind: 'draft',
        status: draft.status,
        payload: cloneJson(draft),
      })),
      ...(snapshot.published ?? []).map((published) => ({
        versionId: published.id,
        companyId: published.companyId,
        version: published.version,
        kind: 'published',
        status: published.status,
        payload: cloneJson(published),
      })),
      ...(snapshot.versions ?? []).flatMap(([, versions]) =>
        (versions ?? []).map((version) => ({
          versionId: version.id,
          companyId: version.companyId,
          version: version.version,
          kind: 'history',
          status: version.status,
          payload: cloneJson(version),
        })),
      ),
    ],
    fieldValues: (snapshot.fieldValues ?? []).map(([key, value]) => ({ key, value: cloneJson(value) })),
    ledger: (snapshot.ledger ?? []).map(([key, value]) => ({ key, value })),
    mutations: cloneJson(snapshot.mutations ?? []),
    devices: (snapshot.devices ?? []).map(([, device]) => ({ ...cloneJson(device) })),
    apiKeys: (snapshot.apiKeys ?? []).map(([, key]) => ({ ...cloneJson(key), createdAt: (key as { createdAt?: string }).createdAt ?? '' })),
    webhooks: (snapshot.webhooks ?? []).map(([, hook]) => ({
      id: hook.id,
      companyId: hook.companyId,
      name: hook.name ?? 'Ops webhook',
      url: hook.url,
      events: [...hook.events],
      status: hook.status,
      signingSecret: hook.signingSecret ?? '',
      createdAt: hook.createdAt ?? new Date(0).toISOString(),
    })),
    connectors: (snapshot.connectors ?? []).map(([, connector]) => ({ ...cloneJson(connector) })),
    invoices: cloneJson(snapshot.invoices ?? []),
    importProfiles: (snapshot.importProfiles ?? []).map(([key, profile]) => ({ key, profile: cloneJson(profile) })),
    audit: cloneJson(snapshot.audit ?? []),
    outbox: cloneJson(snapshot.outbox ?? []),
  };
}

export function snapshotFromRows(rows: ControlPlaneRows): ControlPlaneSnapshot {
  const drafts = rows.configs.filter((row) => row.kind === 'draft').map((row) => cloneJson(row.payload));
  const published = rows.configs.filter((row) => row.kind === 'published').map((row) => cloneJson(row.payload));
  const versions = new Map<string, ControlPlaneSnapshot['drafts'][number][]>();
  for (const row of rows.configs.filter((row) => row.kind === 'history')) {
    versions.set(row.companyId, [...(versions.get(row.companyId) ?? []), cloneJson(row.payload)]);
  }
  const usage = new Map<string, Record<string, number>>();
  for (const row of rows.usage) {
    const meters = usage.get(row.companyId) ?? {};
    meters[row.meter] = row.value;
    usage.set(row.companyId, meters);
  }
  return {
    version: 1,
    tenantId: rows.tenantId,
    plans: [],
    companies: rows.companies.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      status: row.status as ControlPlaneSnapshot['companies'][number]['status'],
      planId: row.planId,
      primaryAdminId: row.primaryAdminId,
      createdAt: row.createdAt,
    })),
    platformUsers: rows.platformUsers.map((row) => ({ ...row, status: row.status as 'active' | 'suspended' })),
    companyUsers: rows.companyUsers.map((row) => ({ ...row, status: row.status as 'active' | 'inactive' | 'suspended' })),
    sessions: rows.sessions.map((row) => ({ ...row, status: row.status as 'active' | 'closed' })),
    entitlements: rows.companies.map((row) => [row.id, cloneJson(row.entitlements)] as [string, Record<string, boolean>]),
    limitOverrides: rows.companies.map((row) => [row.id, cloneJson(row.limitOverrides)] as [string, Record<string, number>]),
    usage: [...usage.entries()],
    audit: [...rows.audit].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-500),
    safety: rows.safety.map((row) => [row.featureKey, row.enabled] as [string, boolean]),
    drafts,
    published,
    versions: [...versions.entries()],
    fieldValues: rows.fieldValues.map((row) => [row.key, cloneJson(row.value)] as [string, Record<string, unknown>]),
    ledger: rows.ledger.map((row) => [row.key, row.value] as [string, number]),
    mutations: rows.mutations.map((row) => ({
      ...row,
      status: row.status as ControlPlaneSnapshot['mutations'][number]['status'],
      lastError: row.lastError ?? null,
      serverAckAt: row.serverAckAt ?? null,
    })),
    devices: rows.devices.map((device) => [device.id, { ...device, status: device.status as 'trusted' | 'revoked' | 'outdated' }] as [string, ControlPlaneSnapshot['devices'][number][1]]),
    apiKeys: rows.apiKeys.map((key) => [key.id, { ...key, status: key.status as 'active' | 'revoked' }] as [string, ControlPlaneSnapshot['apiKeys'][number][1]]),
    webhooks: rows.webhooks.map((hook) => [hook.id, { ...hook, status: hook.status as 'active' | 'disabled' }] as [string, ControlPlaneSnapshot['webhooks'][number][1]]),
    connectors: rows.connectors.map((connector) => [connector.id, { ...connector, status: connector.status as 'healthy' | 'degraded' | 'down' }] as [string, ControlPlaneSnapshot['connectors'][number][1]]),
    billing: rows.companies.map((row) => [row.id, cloneJson(row.billing)] as [string, ControlPlaneSnapshot['billing'][number][1]]),
    invoices: rows.invoices.map((row) => ({ ...row, status: row.status as 'open' | 'paid' | 'past_due' | 'void', paidAt: row.paidAt ?? null })),
    importProfiles: rows.importProfiles.map((row) => [row.key, cloneJson(row.profile)] as [string, ControlPlaneSnapshot['importProfiles'] extends Array<[string, infer P]> | undefined ? P : never]),
    outbox: [...rows.outbox].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-200),
  };
}

// ---------------------------------------------------------------------------
// Diff: keyed, canonical-JSON comparison per collection
// ---------------------------------------------------------------------------

type KeyedJson = Map<string, string>;

function keyed<T>(items: T[], keyOf: (item: T) => string, valueOf: (item: T) => unknown): KeyedJson {
  const map = new Map<string, string>();
  for (const item of items) map.set(keyOf(item), stableStringify(valueOf(item)));
  return map;
}

export type RowDiff = {
  upserts: string[];
  deletes: string[];
};

function diffKeyed(prev: KeyedJson, next: KeyedJson): RowDiff {
  const upserts: string[] = [];
  const deletes: string[] = [];
  for (const [key, value] of next) {
    if (prev.get(key) !== value) upserts.push(key);
  }
  for (const key of prev.keys()) {
    if (!next.has(key)) deletes.push(key);
  }
  return { upserts, deletes };
}

export type SnapshotDiff = Record<string, RowDiff>;

function keyedCollections(rows: ControlPlaneRows): Record<string, KeyedJson> {
  return {
    companies: keyed(rows.companies, (r) => r.id, (r) => r),
    platformUsers: keyed(rows.platformUsers, (r) => r.id, (r) => r),
    companyUsers: keyed(rows.companyUsers, (r) => r.id, (r) => r),
    sessions: keyed(rows.sessions, (r) => r.id, (r) => r),
    safety: keyed(rows.safety, (r) => r.featureKey, (r) => r.enabled),
    usage: keyed(rows.usage, (r) => `${r.companyId}|${r.meter}`, (r) => r.value),
    configs: keyed(rows.configs, (r) => `${r.versionId}|${r.kind}`, (r) => r),
    fieldValues: keyed(rows.fieldValues, (r) => r.key, (r) => r.value),
    ledger: keyed(rows.ledger, (r) => r.key, (r) => r.value),
    mutations: keyed(rows.mutations, (r) => r.mutationId, (r) => r),
    devices: keyed(rows.devices, (r) => r.id, (r) => r),
    apiKeys: keyed(rows.apiKeys, (r) => r.id, (r) => r),
    webhooks: keyed(rows.webhooks, (r) => r.id, (r) => r),
    connectors: keyed(rows.connectors, (r) => r.id, (r) => r),
    invoices: keyed(rows.invoices, (r) => r.id, (r) => r),
    importProfiles: keyed(rows.importProfiles, (r) => r.key, (r) => r.profile),
    // Audit is append-only: rows are never deleted by a diff (hydration reads
    // the latest 500). Outbox rows are trimmed explicitly, not by diff.
    audit: keyed(rows.audit, (r) => r.id, (r) => r),
    outbox: keyed(rows.outbox, (r) => r.id, (r) => r),
    meta: new Map([['tenantId', stableStringify(rows.tenantId)]]),
  };
}

export function diffSnapshots(prev: ControlPlaneSnapshot, next: ControlPlaneSnapshot): SnapshotDiff {
  const prevRows = rowsFromSnapshot(prev);
  const nextRows = rowsFromSnapshot(next);
  const prevKeyed = keyedCollections(prevRows);
  const nextKeyed = keyedCollections(nextRows);
  const diff: SnapshotDiff = {};
  for (const name of Object.keys(nextKeyed)) {
    const d = diffKeyed(prevKeyed[name], nextKeyed[name]);
    if (name === 'audit') d.deletes = [];
    if (name === 'outbox') d.deletes = [];
    diff[name] = d;
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Row IO
// ---------------------------------------------------------------------------

async function readAllRows(): Promise<ControlPlaneRows> {
  const prisma = await getPrisma();
  const [companies, platformUsers, companyUsers, sessions, safety, usage, configs, fieldValues, ledger, mutations, devices, apiKeys, webhooks, connectors, invoices, importProfiles, audit, outbox, meta] =
    await Promise.all([
      prisma.controlPlaneCompany.findMany(),
      prisma.controlPlanePlatformUser.findMany(),
      prisma.controlPlaneCompanyUser.findMany(),
      prisma.controlPlaneSession.findMany(),
      prisma.controlPlaneKillSwitch.findMany(),
      prisma.controlPlaneUsage.findMany(),
      prisma.controlPlaneConfig.findMany(),
      prisma.controlPlaneFieldValue.findMany(),
      prisma.controlPlaneLedger.findMany(),
      prisma.controlPlaneMutation.findMany(),
      prisma.controlPlaneDevice.findMany(),
      prisma.controlPlaneApiKey.findMany(),
      prisma.controlPlaneWebhook.findMany(),
      prisma.controlPlaneConnector.findMany(),
      prisma.controlPlaneInvoice.findMany(),
      prisma.controlPlaneImportProfile.findMany(),
      prisma.controlPlaneAudit.findMany({ orderBy: { timestamp: 'desc' }, take: 500 }),
      prisma.controlPlaneOutbox.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.controlPlaneMeta.findUnique({ where: { key: 'tenantId' } }),
    ]);
  const pickCompany = (row: (typeof companies)[number]): ControlPlaneRows['companies'][number] => ({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    status: row.status,
    planId: row.planId,
    primaryAdminId: row.primaryAdminId,
    createdAt: row.createdAt,
    entitlements: (row.entitlements ?? {}) as Record<string, boolean>,
    limitOverrides: (row.limitOverrides ?? {}) as Record<string, number>,
    billing: row.billing as ControlPlaneRows['companies'][number]['billing'],
  });
  return {
    tenantId: typeof meta?.value === 'string' ? meta.value : 'default',
    companies: companies.map(pickCompany),
    platformUsers: platformUsers.map((row) => ({ id: row.id, email: row.email, name: row.name, passwordHash: row.passwordHash, status: row.status })),
    companyUsers: companyUsers.map((row) => ({ id: row.id, companyId: row.companyId, email: row.email, name: row.name, role: row.role, status: row.status, passwordHash: row.passwordHash, isPrimaryAdmin: row.isPrimaryAdmin, createdAt: row.createdAt })),
    sessions: sessions.map((row) => ({ id: row.id, platformUserId: row.platformUserId, companyId: row.companyId, tenantId: row.tenantId, status: row.status, issuedAt: row.issuedAt, expiresAt: row.expiresAt })),
    safety: safety.map((row) => ({ featureKey: row.featureKey, enabled: row.enabled })),
    usage: usage.map((row) => ({ companyId: row.companyId, meter: row.meter, value: row.value })),
    configs: configs.map((row) => ({
      versionId: row.versionId,
      companyId: row.companyId,
      version: row.version,
      kind: row.kind,
      status: row.status,
      payload: row.payload as ControlPlaneSnapshot['drafts'][number],
    })),
    fieldValues: fieldValues.map((row) => ({ key: row.key, value: row.value as Record<string, unknown> })),
    ledger: ledger.map((row) => ({ key: row.key, value: row.value })),
    mutations: mutations.map((row) => ({
      ...row,
      payload: row.payload as Record<string, unknown>,
      result: row.result ?? null,
    })),
    devices: devices.map((row) => ({ id: row.id, companyId: row.companyId, userId: row.userId, status: row.status, appVersion: row.appVersion })),
    apiKeys: apiKeys.map((row) => ({ id: row.id, companyId: row.companyId, name: row.name, prefix: row.prefix, hash: row.hash, scopes: row.scopes as string[], status: row.status, createdAt: row.createdAt })),
    webhooks: webhooks.map((row) => ({ id: row.id, companyId: row.companyId, name: row.name, url: row.url, events: row.events as string[], status: row.status, signingSecret: row.signingSecret, createdAt: row.createdAt })),
    connectors: connectors.map((row) => ({ id: row.id, companyId: row.companyId, type: row.type, status: row.status })),
    invoices: invoices.map((row) => ({ id: row.id, companyId: row.companyId, amount: row.amount, cycle: row.cycle, status: row.status, issuedAt: row.issuedAt, paidAt: row.paidAt, stripeCheckoutSessionId: row.stripeCheckoutSessionId })),
    importProfiles: importProfiles.map((row) => ({ key: row.key, profile: row.profile })),
    audit: audit.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorType: row.actorType as ControlPlaneSnapshot['audit'][number]['actorType'],
      tenantId: row.tenantId,
      companyId: row.companyId,
      sessionId: row.sessionId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      reason: row.reason ?? undefined,
      timestamp: row.timestamp,
    })),
    outbox: outbox.map((row) => ({ id: row.id, event: row.event, payload: row.payload, createdAt: row.createdAt })),
  };
}

async function hasAnyRows(): Promise<boolean> {
  const prisma = await getPrisma();
  const [company, session, key, killSwitch] = await Promise.all([
    prisma.controlPlaneCompany.findFirst({ select: { id: true } }),
    prisma.controlPlaneSession.findFirst({ select: { id: true } }),
    prisma.controlPlaneApiKey.findFirst({ select: { id: true } }),
    prisma.controlPlaneKillSwitch.findFirst({ select: { featureKey: true } }),
  ]);
  return Boolean(company ?? session ?? key ?? killSwitch);
}

type TxOp = Promise<unknown>;

async function applyDiffInTransaction(diff: SnapshotDiff, nextRows: ControlPlaneRows): Promise<{ written: number; deleted: number }> {
  const prisma = await getPrisma();
  const ops: TxOp[] = [];
  let written = 0;
  let deleted = 0;

  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const companies = byId(nextRows.companies);
  const platformUsers = byId(nextRows.platformUsers);
  const companyUsers = byId(nextRows.companyUsers);
  const sessions = byId(nextRows.sessions);
  const devices = byId(nextRows.devices);
  const apiKeys = byId(nextRows.apiKeys);
  const webhooks = byId(nextRows.webhooks);
  const connectors = byId(nextRows.connectors);
  const invoices = byId(nextRows.invoices);
  const mutations = new Map(nextRows.mutations.map((row) => [row.mutationId, row]));
  const configs = new Map(nextRows.configs.map((row) => [`${row.versionId}|${row.kind}`, row]));
  const usageRows = new Map(nextRows.usage.map((row) => [`${row.companyId}|${row.meter}`, row]));

  const upsertCompany = (id: string) => {
    const row = companies.get(id)!;
    ops.push(prisma.controlPlaneCompany.upsert({
      where: { id },
      create: { ...row, entitlements: asJson(row.entitlements), limitOverrides: asJson(row.limitOverrides), billing: asJson(row.billing) },
      update: { ...row, entitlements: asJson(row.entitlements), limitOverrides: asJson(row.limitOverrides), billing: asJson(row.billing) },
    }));
  };

  for (const id of diff.companies.upserts) { upsertCompany(id); written += 1; }
  for (const id of diff.companies.deletes) { ops.push(prisma.controlPlaneCompany.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.platformUsers.upserts) {
    const row = platformUsers.get(id)!;
    ops.push(prisma.controlPlanePlatformUser.upsert({ where: { id }, create: row, update: row }));
    written += 1;
  }
  for (const id of diff.platformUsers.deletes) { ops.push(prisma.controlPlanePlatformUser.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.companyUsers.upserts) {
    const row = companyUsers.get(id)!;
    ops.push(prisma.controlPlaneCompanyUser.upsert({ where: { id }, create: row, update: row }));
    written += 1;
  }
  for (const id of diff.companyUsers.deletes) { ops.push(prisma.controlPlaneCompanyUser.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.sessions.upserts) {
    const row = sessions.get(id)!;
    ops.push(prisma.controlPlaneSession.upsert({ where: { id }, create: row, update: row }));
    written += 1;
  }
  for (const id of diff.sessions.deletes) { ops.push(prisma.controlPlaneSession.delete({ where: { id } })); deleted += 1; }

  for (const featureKey of diff.safety.upserts) {
    const row = nextRows.safety.find((entry) => entry.featureKey === featureKey)!;
    ops.push(prisma.controlPlaneKillSwitch.upsert({ where: { featureKey }, create: row, update: { enabled: row.enabled } }));
    written += 1;
  }
  for (const featureKey of diff.safety.deletes) { ops.push(prisma.controlPlaneKillSwitch.delete({ where: { featureKey } })); deleted += 1; }

  for (const key of diff.usage.upserts) {
    const row = usageRows.get(key)!;
    ops.push(prisma.controlPlaneUsage.upsert({
      where: { companyId_meter: { companyId: row.companyId, meter: row.meter } },
      create: row,
      update: { value: row.value },
    }));
    written += 1;
  }
  for (const key of diff.usage.deletes) {
    const [companyId, meter] = key.split('|');
    ops.push(prisma.controlPlaneUsage.delete({ where: { companyId_meter: { companyId, meter } } }));
    deleted += 1;
  }

  for (const key of diff.configs.upserts) {
    const row = configs.get(key)!;
    ops.push(prisma.controlPlaneConfig.upsert({
      where: { versionId_kind: { versionId: row.versionId, kind: row.kind } },
      create: { ...row, payload: asJson(row.payload) },
      update: { companyId: row.companyId, version: row.version, status: row.status, payload: asJson(row.payload) },
    }));
    written += 1;
  }
  for (const key of diff.configs.deletes) {
    const [versionId, kind] = key.split('|');
    ops.push(prisma.controlPlaneConfig.delete({ where: { versionId_kind: { versionId, kind } } }));
    deleted += 1;
  }

  for (const key of diff.fieldValues.upserts) {
    const row = nextRows.fieldValues.find((entry) => entry.key === key)!;
    ops.push(prisma.controlPlaneFieldValue.upsert({ where: { key }, create: { key, value: asJson(row.value) }, update: { value: asJson(row.value) } }));
    written += 1;
  }
  for (const key of diff.fieldValues.deletes) { ops.push(prisma.controlPlaneFieldValue.delete({ where: { key } })); deleted += 1; }

  for (const key of diff.ledger.upserts) {
    const row = nextRows.ledger.find((entry) => entry.key === key)!;
    ops.push(prisma.controlPlaneLedger.upsert({ where: { key }, create: row, update: { value: row.value } }));
    written += 1;
  }
  for (const key of diff.ledger.deletes) { ops.push(prisma.controlPlaneLedger.delete({ where: { key } })); deleted += 1; }

  for (const mutationId of diff.mutations.upserts) {
    const row = mutations.get(mutationId)!;
    ops.push(prisma.controlPlaneMutation.upsert({
      where: { mutationId },
      create: { ...row, payload: asJson(row.payload), result: asJson(row.result) },
      update: { ...row, payload: asJson(row.payload), result: asJson(row.result) },
    }));
    written += 1;
  }
  for (const mutationId of diff.mutations.deletes) { ops.push(prisma.controlPlaneMutation.delete({ where: { mutationId } })); deleted += 1; }

  for (const id of diff.devices.upserts) {
    const row = devices.get(id)!;
    ops.push(prisma.controlPlaneDevice.upsert({ where: { id }, create: row, update: row }));
    written += 1;
  }
  for (const id of diff.devices.deletes) { ops.push(prisma.controlPlaneDevice.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.apiKeys.upserts) {
    const row = apiKeys.get(id)!;
    ops.push(prisma.controlPlaneApiKey.upsert({ where: { id }, create: { ...row, scopes: asJson(row.scopes), createdAt: row.createdAt ?? '' }, update: { ...row, scopes: asJson(row.scopes) } }));
    written += 1;
  }
  for (const id of diff.apiKeys.deletes) { ops.push(prisma.controlPlaneApiKey.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.webhooks.upserts) {
    const row = webhooks.get(id)!;
    ops.push(prisma.controlPlaneWebhook.upsert({ where: { id }, create: { ...row, events: asJson(row.events) }, update: { ...row, events: asJson(row.events) } }));
    written += 1;
  }
  for (const id of diff.webhooks.deletes) { ops.push(prisma.controlPlaneWebhook.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.connectors.upserts) {
    const row = connectors.get(id)!;
    ops.push(prisma.controlPlaneConnector.upsert({ where: { id }, create: row, update: row }));
    written += 1;
  }
  for (const id of diff.connectors.deletes) { ops.push(prisma.controlPlaneConnector.delete({ where: { id } })); deleted += 1; }

  for (const id of diff.invoices.upserts) {
    const row = invoices.get(id)!;
    ops.push(prisma.controlPlaneInvoice.upsert({ where: { id }, create: row, update: row }));
    written += 1;
  }
  for (const id of diff.invoices.deletes) { ops.push(prisma.controlPlaneInvoice.delete({ where: { id } })); deleted += 1; }

  for (const key of diff.importProfiles.upserts) {
    const row = nextRows.importProfiles.find((entry) => entry.key === key)!;
    ops.push(prisma.controlPlaneImportProfile.upsert({ where: { key }, create: { key, profile: asJson(row.profile) }, update: { profile: asJson(row.profile) } }));
    written += 1;
  }
  for (const key of diff.importProfiles.deletes) { ops.push(prisma.controlPlaneImportProfile.delete({ where: { key } })); deleted += 1; }

  for (const event of nextRows.audit) {
    if (!diff.audit.upserts.includes(event.id)) continue;
    ops.push(prisma.controlPlaneAudit.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        actorUserId: event.actorUserId,
        actorType: event.actorType,
        tenantId: event.tenantId,
        companyId: event.companyId,
        sessionId: event.sessionId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        before: asJson(event.before ?? null),
        after: asJson(event.after ?? null),
        reason: event.reason ?? null,
        timestamp: event.timestamp,
      },
      update: { timestamp: event.timestamp },
    }));
    written += 1;
  }

  for (const entry of nextRows.outbox) {
    if (!diff.outbox.upserts.includes(entry.id)) continue;
    ops.push(prisma.controlPlaneOutbox.upsert({
      where: { id: entry.id },
      create: { id: entry.id, event: entry.event, payload: asJson(entry.payload), createdAt: entry.createdAt },
      update: { event: entry.event },
    }));
    written += 1;
  }
  // Outbox is a capped queue in memory (200). Trim rows older than the
  // oldest entry still held, so the table does not grow without bound.
  if (nextRows.outbox.length > 0) {
    const oldest = [...nextRows.outbox].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0].createdAt;
    ops.push(prisma.controlPlaneOutbox.deleteMany({ where: { createdAt: { lt: oldest } } }));
  }

  if (diff.meta.upserts.includes('tenantId')) {
    ops.push(prisma.controlPlaneMeta.upsert({
      where: { key: 'tenantId' },
      create: { key: 'tenantId', value: asJson(nextRows.tenantId) },
      update: { value: asJson(nextRows.tenantId) },
    }));
    written += 1;
  }

  if (ops.length > 0) await prisma.$transaction(ops as unknown as Prisma.PrismaPromise<unknown>[]);
  return { written, deleted };
}

// Last-persisted snapshot per plane instance (WeakMap: fresh instances in
// tests never see another instance's baseline).
const lastPersistedByPlane = new WeakMap<object, ControlPlaneSnapshot>();

export function lastPersistedSnapshot(plane: ControlPlane): ControlPlaneSnapshot | undefined {
  return lastPersistedByPlane.get(plane);
}

function setLastPersisted(plane: ControlPlane, snapshot: ControlPlaneSnapshot): void {
  lastPersistedByPlane.set(plane, cloneJson(snapshot));
}

/** Write only the rows that changed since the last persist. No-op when the DB is off. */
export async function persistControlPlaneRows(
  plane: ControlPlane,
  snapshot: ControlPlaneSnapshot = serializeControlPlane(plane),
): Promise<{ written: number; deleted: number }> {
  if (!controlPlaneDbEnabled()) return { written: 0, deleted: 0 };
  const prev = lastPersistedByPlane.get(plane);
  if (!prev) {
    // First persist for this instance (no hydrate/refresh ran first):
    // upsert-only. Without a baseline we cannot tell a key this instance
    // deleted from a key another replica created, and deleting the latter
    // would be data loss. Rows this instance removed reach the database
    // once it has a baseline (hydrate or refresh always runs at boot).
    const current = snapshotFromRows(await readAllRows());
    const diff = diffSnapshots(current, snapshot);
    for (const entry of Object.values(diff)) entry.deletes = [];
    const result = await applyDiffInTransaction(diff, rowsFromSnapshot(snapshot));
    setLastPersisted(plane, snapshot);
    return result;
  }
  const diff = diffSnapshots(prev, snapshot);
  const result = await applyDiffInTransaction(diff, rowsFromSnapshot(snapshot));
  setLastPersisted(plane, snapshot);
  return result;
}

/** Read every row and rebuild the plane from it. Returns false when the tables hold nothing. */
export async function hydrateControlPlaneRows(plane: ControlPlane): Promise<boolean> {
  const rows = await readAllRows();
  const empty =
    rows.companies.length === 0
    && rows.platformUsers.length === 0
    && rows.sessions.length === 0
    && rows.apiKeys.length === 0
    && rows.safety.length === 0
    && rows.configs.length === 0;
  if (empty) return false;
  const snapshot = snapshotFromRows(rows);
  applyControlPlaneSnapshot(plane, snapshot);
  setLastPersisted(plane, snapshot);
  return true;
}

/** One-time import: write a legacy blob snapshot into the (empty) row tables. */
export async function importBlobSnapshotToRows(snapshot: ControlPlaneSnapshot): Promise<{ written: number; deleted: number }> {
  const rows = rowsFromSnapshot(snapshot);
  const empty: ControlPlaneSnapshot = {
    version: 1,
    tenantId: '',
    plans: [],
    companies: [],
    platformUsers: [],
    companyUsers: [],
    sessions: [],
    entitlements: [],
    limitOverrides: [],
    usage: [],
    audit: [],
    safety: [],
    drafts: [],
    published: [],
    versions: [],
    fieldValues: [],
    ledger: [],
    mutations: [],
    devices: [],
    apiKeys: [],
    webhooks: [],
    connectors: [],
    billing: [],
    invoices: [],
    importProfiles: [],
    outbox: [],
  };
  const diff = diffSnapshots(empty, snapshot);
  // Audit/outbox upserts are idempotent; the empty baseline diffs everything in.
  return applyDiffInTransaction(diff, rows);
}

export async function controlPlaneRowsExist(): Promise<boolean> {
  if (!controlPlaneDbEnabled()) return false;
  return hasAnyRows();
}

// ---------------------------------------------------------------------------
// Refresh: apply remote changes that this replica did not dirty locally
// ---------------------------------------------------------------------------

function applyRemoteToKeyed<T>(
  target: Map<string, T>,
  remote: Map<string, T>,
  lastSaved: Map<string, T>,
  current: Map<string, T>,
  clone: (value: T) => T,
): void {
  const keys = new Set([...remote.keys(), ...lastSaved.keys(), ...current.keys()]);
  for (const key of keys) {
    const remoteValue = remote.get(key);
    const savedValue = lastSaved.get(key);
    const currentValue = current.get(key);
    const dirty = stableStringify(currentValue ?? null) !== stableStringify(savedValue ?? null);
    if (dirty) continue;
    if (remoteValue === undefined) {
      target.delete(key);
    } else if (stableStringify(remoteValue) !== stableStringify(savedValue ?? null)) {
      target.set(key, clone(remoteValue));
    }
  }
}

function keyedPairs<T>(pairs: Array<[string, T]>): Map<string, T> {
  return new Map(pairs);
}

function applyRemoteSnapshot(
  plane: ControlPlane,
  remote: ControlPlaneSnapshot,
  lastSaved: ControlPlaneSnapshot,
  current: ControlPlaneSnapshot,
): void {
  const remoteRows = rowsFromSnapshot(remote);
  const savedRows = rowsFromSnapshot(lastSaved);
  const currentRows = rowsFromSnapshot(current);

  // Scalar collections keyed by id.
  const applyRecords = <T,>(
    get: (rows: ControlPlaneRows) => T[],
    keyOf: (row: T) => string,
    set: (items: T[]) => void,
  ) => {
    const remoteMap = new Map(get(remoteRows).map((row) => [keyOf(row), row]));
    const savedMap = new Map(get(savedRows).map((row) => [keyOf(row), row]));
    const currentMap = new Map(get(currentRows).map((row) => [keyOf(row), row]));
    const merged = new Map(currentMap);
    applyRemoteToKeyed(merged, remoteMap, savedMap, currentMap, (v) => cloneJson(v));
    set([...merged.values()]);
  };
  type SnapshotUser = ControlPlaneSnapshot['platformUsers'][number];
  type SnapshotCompanyUser = ControlPlaneSnapshot['companyUsers'][number];
  type SnapshotInvoice = ControlPlaneSnapshot['invoices'][number];
  type SnapshotMutation = ControlPlaneSnapshot['mutations'][number];
  applyRecords((rows) => rows.platformUsers, (row) => row.id, (items) => { plane.platformUsers = new Map(items.map((row) => [row.id, row as unknown as SnapshotUser])); });
  applyRecords((rows) => rows.companyUsers, (row) => row.id, (items) => { plane.companyUsers = new Map(items.map((row) => [row.id, row as unknown as SnapshotCompanyUser])); });
  applyRecords((rows) => rows.invoices, (row) => row.id, (items) => { plane.invoices = new Map(items.map((row) => [row.id, row as unknown as SnapshotInvoice])); });
  applyRecords((rows) => rows.mutations, (row) => row.mutationId, (items) => { plane.mutations = new Map(items.map((row) => [row.mutationId, row as unknown as SnapshotMutation])); });

  // Sessions: mutate in place where the object already exists, so references
  // held by in-flight request handling keep seeing the fresh status.
  {
    const remoteMap = new Map(remoteRows.sessions.map((row) => [row.id, row]));
    const savedMap = new Map(savedRows.sessions.map((row) => [row.id, row]));
    const currentMap = new Map(currentRows.sessions.map((row) => [row.id, row]));
    const merged = new Map(currentMap);
    applyRemoteToKeyed(merged, remoteMap, savedMap, currentMap, (v) => cloneJson(v));
    for (const [id, value] of merged) {
      const existing = plane.sessions.get(id);
      if (existing) Object.assign(existing, value);
      else plane.sessions.set(id, cloneJson(value) as unknown as ControlPlaneSnapshot['sessions'][number]);
    }
    for (const id of [...plane.sessions.keys()]) {
      if (!merged.has(id)) plane.sessions.delete(id);
    }
  }

  // Companies carry their entitlements/limitOverrides/billing on the row.
  {
    const remoteMap = new Map(remoteRows.companies.map((row) => [row.id, row]));
    const savedMap = new Map(savedRows.companies.map((row) => [row.id, row]));
    const currentMap = new Map(currentRows.companies.map((row) => [row.id, row]));
    const merged = new Map(currentMap);
    applyRemoteToKeyed(merged, remoteMap, savedMap, currentMap, (v) => cloneJson(v));
    plane.companies = new Map([...merged.values()].map((row) => [row.id, {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      status: row.status as ControlPlaneSnapshot['companies'][number]['status'],
      planId: row.planId,
      primaryAdminId: row.primaryAdminId,
      createdAt: row.createdAt,
    }]));
    plane.entitlements = new Map([...merged.values()].map((row) => [row.id, cloneJson(row.entitlements)]));
    plane.limitOverrides = new Map([...merged.values()].map((row) => [row.id, cloneJson(row.limitOverrides)]));
    plane.billing = new Map([...merged.values()].map((row) => [row.id, cloneJson(row.billing) as ControlPlaneSnapshot['billing'][number][1]]));
  }

  // Kill switches: single map of feature -> enabled.
  applyRemoteToKeyed(plane.safety, keyedPairs(remote.safety), keyedPairs(lastSaved.safety), keyedPairs(current.safety), (v) => v);

  // Usage: per-meter values grouped per company.
  {
    const toMap = (rows: ControlPlaneRows) => {
      const map = new Map<string, Record<string, number>>();
      for (const row of rows.usage) {
        const meters = map.get(row.companyId) ?? {};
        meters[row.meter] = row.value;
        map.set(row.companyId, meters);
      }
      return map;
    };
    applyRemoteToKeyed(plane.usage, toMap(remoteRows), toMap(savedRows), toMap(currentRows), (v) => ({ ...v }));
  }

  // Config versions: drafts/published singletons + history arrays, via rows.
  {
    const toKindMap = (rows: ControlPlaneRows) => new Map(rows.configs.map((row) => [`${row.versionId} ${row.kind}`, row.payload]));
    const remoteMap = toKindMap(remoteRows);
    const savedMap = toKindMap(savedRows);
    const currentMap = toKindMap(currentRows);
    const merged = new Map(currentMap);
    applyRemoteToKeyed(merged, remoteMap, savedMap, currentMap, (v) => cloneJson(v));
    const drafts = new Map<string, ControlPlaneSnapshot['drafts'][number]>();
    const published = new Map<string, ControlPlaneSnapshot['drafts'][number]>();
    const versions = new Map<string, ControlPlaneSnapshot['drafts'][number][]>();
    for (const [key, payload] of merged) {
      const kind = key.split(' ').pop()!;
      if (kind === 'draft') drafts.set(payload.companyId, payload);
      else if (kind === 'published') published.set(payload.companyId, payload);
      else {
        versions.set(payload.companyId, [...(versions.get(payload.companyId) ?? []), payload]);
      }
    }
    plane.drafts = drafts;
    plane.published = published;
    plane.versions = versions;
  }

  // Pair maps.
  applyRemoteToKeyed(plane.fieldValues, keyedPairs(remote.fieldValues), keyedPairs(lastSaved.fieldValues), keyedPairs(current.fieldValues), (v) => cloneJson(v));
  applyRemoteToKeyed(plane.ledger, keyedPairs(remote.ledger), keyedPairs(lastSaved.ledger), keyedPairs(current.ledger), (v) => v);
  applyRemoteToKeyed(plane.devices, keyedPairs(remote.devices), keyedPairs(lastSaved.devices), keyedPairs(current.devices), (v) => cloneJson(v));
  applyRemoteToKeyed(plane.apiKeys, keyedPairs(remote.apiKeys), keyedPairs(lastSaved.apiKeys), keyedPairs(current.apiKeys), (v) => cloneJson(v));
  applyRemoteToKeyed(plane.webhooks, keyedPairs(remote.webhooks), keyedPairs(lastSaved.webhooks), keyedPairs(current.webhooks), (v) => cloneJson(v));
  applyRemoteToKeyed(plane.connectors, keyedPairs(remote.connectors), keyedPairs(lastSaved.connectors), keyedPairs(current.connectors), (v) => cloneJson(v));
  applyRemoteToKeyed(plane.importProfiles, keyedPairs(remote.importProfiles ?? []), keyedPairs(lastSaved.importProfiles ?? []), keyedPairs(current.importProfiles ?? []), (v) => cloneJson(v));

  // Append-only arrays: union remote with locally-added events, newest first capped.
  const mergeAppendOnly = <T extends { id: string; timestamp?: string; createdAt?: string }>(
    remoteList: T[],
    savedList: T[],
    currentList: T[],
    stampOf: (entry: T) => string,
    cap: number,
  ): T[] => {
    const savedIds = new Set(savedList.map((entry) => entry.id));
    const localNew = currentList.filter((entry) => !savedIds.has(entry.id));
    const merged = new Map<string, T>();
    for (const entry of remoteList) merged.set(entry.id, entry);
    for (const entry of localNew) merged.set(entry.id, entry);
    return [...merged.values()].sort((a, b) => stampOf(a).localeCompare(stampOf(b))).slice(-cap);
  };
  plane.audit = mergeAppendOnly(remote.audit, lastSaved.audit, current.audit, (e) => e.timestamp, 500);
  plane.outbox = mergeAppendOnly(remote.outbox, lastSaved.outbox, current.outbox, (e) => e.createdAt, 200);

}

/** Re-read rows and apply remote changes this replica did not dirty. Returns false when the DB is off. */
export async function refreshControlPlaneFromDb(plane: ControlPlane): Promise<boolean> {
  if (!controlPlaneDbEnabled()) return false;
  const lastSaved = lastPersistedByPlane.get(plane);
  const rows = await readAllRows();
  const remote = snapshotFromRows(rows);
  if (!lastSaved) {
    applyControlPlaneSnapshot(plane, remote);
    setLastPersisted(plane, remote);
    return true;
  }
  const current = serializeControlPlane(plane);
  applyRemoteSnapshot(plane, remote, lastSaved, current);
  // Baseline for the next diff: the remote rows with locally-dirty keys
  // rewound to their saved values (the database still holds the saved value
  // for those keys until the next persist writes the local one).
  const remoteRows = rowsFromSnapshot(remote);
  const savedRows = rowsFromSnapshot(lastSaved);
  const currentRows = rowsFromSnapshot(current);
  const baseline = snapshotFromRows(remoteRows);
  const rewindKeyed = <T>(remoteList: T[], savedList: T[], currentList: T[], keyOf: (item: T) => string): T[] => {
    const savedMap = new Map(savedList.map((item) => [keyOf(item), item]));
    const currentMap = new Map(currentList.map((item) => [keyOf(item), item]));
    const remoteMap = new Map(remoteList.map((item) => [keyOf(item), item]));
    const out = new Map(remoteMap);
    for (const [key, currentItem] of currentMap) {
      if (stableStringify(currentItem) !== stableStringify(savedMap.get(key) ?? null)) {
        const saved = savedMap.get(key);
        if (saved === undefined) out.delete(key);
        else out.set(key, saved);
      }
    }
    for (const [key, savedItem] of savedMap) {
      if (!currentMap.has(key) && stableStringify(savedItem) !== stableStringify(remoteMap.get(key) ?? null)) {
        // Deleted locally: baseline keeps the saved (still-in-DB) value.
        out.set(key, savedItem);
      }
    }
    return [...out.values()];
  };
  const rewound = snapshotFromRows({
    ...remoteRows,
    companies: rewindKeyed(remoteRows.companies, savedRows.companies, currentRows.companies, (r) => r.id),
    platformUsers: rewindKeyed(remoteRows.platformUsers, savedRows.platformUsers, currentRows.platformUsers, (r) => r.id),
    companyUsers: rewindKeyed(remoteRows.companyUsers, savedRows.companyUsers, currentRows.companyUsers, (r) => r.id),
    sessions: rewindKeyed(remoteRows.sessions, savedRows.sessions, currentRows.sessions, (r) => r.id),
    safety: rewindKeyed(remoteRows.safety, savedRows.safety, currentRows.safety, (r) => r.featureKey),
    usage: rewindKeyed(remoteRows.usage, savedRows.usage, currentRows.usage, (r) => `${r.companyId}|${r.meter}`),
    configs: rewindKeyed(remoteRows.configs, savedRows.configs, currentRows.configs, (r) => `${r.versionId}|${r.kind}`),
    fieldValues: rewindKeyed(remoteRows.fieldValues, savedRows.fieldValues, currentRows.fieldValues, (r) => r.key),
    ledger: rewindKeyed(remoteRows.ledger, savedRows.ledger, currentRows.ledger, (r) => r.key),
    mutations: rewindKeyed(remoteRows.mutations, savedRows.mutations, currentRows.mutations, (r) => r.mutationId),
    devices: rewindKeyed(remoteRows.devices, savedRows.devices, currentRows.devices, (r) => r.id),
    apiKeys: rewindKeyed(remoteRows.apiKeys, savedRows.apiKeys, currentRows.apiKeys, (r) => r.id),
    webhooks: rewindKeyed(remoteRows.webhooks, savedRows.webhooks, currentRows.webhooks, (r) => r.id),
    connectors: rewindKeyed(remoteRows.connectors, savedRows.connectors, currentRows.connectors, (r) => r.id),
    invoices: rewindKeyed(remoteRows.invoices, savedRows.invoices, currentRows.invoices, (r) => r.id),
    importProfiles: rewindKeyed(remoteRows.importProfiles, savedRows.importProfiles, currentRows.importProfiles, (r) => r.key),
    audit: remote.audit,
    outbox: remote.outbox,
    tenantId: remote.tenantId,
  });
  setLastPersisted(plane, rewound);
  return true;
}

// ---------------------------------------------------------------------------
// Read-throughs for the request path (kill switches, sessions, API keys)
// ---------------------------------------------------------------------------

/** Re-read every kill-switch row into the plane's safety map (in place). */
export async function refreshKillSwitchesFromDb(plane: ControlPlane): Promise<boolean> {
  if (!controlPlaneDbEnabled()) return false;
  const prisma = await getPrisma();
  const rows = await prisma.controlPlaneKillSwitch.findMany();
  // Merge-only, deliberately: kill-switch keys are set, never deleted, and a
  // key set on this replica but not yet flushed (250ms persist debounce)
  // must survive a concurrent refresh. Remote values win for keys the
  // database holds; local-only keys are left alone and reach the database
  // through the next persist.
  for (const row of rows) plane.safety.set(row.featureKey, row.enabled);
  return true;
}

/** Write one kill-switch row atomically (single field, no whole-row clobber). */
export async function writeKillSwitchRow(featureKey: string, enabled: boolean): Promise<void> {
  if (!controlPlaneDbEnabled()) return;
  const prisma = await getPrisma();
  await prisma.controlPlaneKillSwitch.upsert({
    where: { featureKey },
    create: { featureKey, enabled },
    update: { enabled },
  });
}

/** Re-read one session row into the plane (mutating the held object in place). */
export async function refreshSessionFromDb(
  plane: ControlPlane,
  sessionId: string,
): Promise<'found' | 'missing' | 'skipped'> {
  if (!controlPlaneDbEnabled()) return 'skipped';
  const prisma = await getPrisma();
  const row = await prisma.controlPlaneSession.findUnique({ where: { id: sessionId } });
  if (!row) {
    // A session this replica created but has not flushed yet (250ms persist
    // debounce) has no row either. Only drop it when the persist baseline
    // proves it reached the database before: then the missing row means a
    // genuine close/delete on another replica.
    const baseline = lastPersistedByPlane.get(plane);
    const wasPersisted = (baseline?.sessions ?? []).some((session) => session.id === sessionId);
    if (wasPersisted) plane.sessions.delete(sessionId);
    return 'missing';
  }
  const existing = plane.sessions.get(sessionId);
  const session = {
    id: row.id,
    platformUserId: row.platformUserId,
    companyId: row.companyId,
    tenantId: row.tenantId,
    status: row.status as 'active' | 'closed',
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
  };
  if (existing) Object.assign(existing, session);
  else plane.sessions.set(sessionId, session);
  return 'found';
}

/**
 * Re-read one API-key row (by HMAC hash) into the store's apiKeys map.
 * Map-based (not plane-based): the integrations service holds the store
 * view, not the plane. Never deletes: a key created on this replica but
 * not yet flushed has no row yet, and the map still holds it.
 */
export async function refreshApiKeyFromDb(
  apiKeys: Map<string, { id: string; companyId: string; name: string; prefix: string; hash: string; scopes: string[]; status: 'active' | 'revoked' }>,
  hash: string,
): Promise<'found' | 'missing' | 'skipped'> {
  if (!controlPlaneDbEnabled()) return 'skipped';
  const prisma = await getPrisma();
  const row = await prisma.controlPlaneApiKey.findUnique({ where: { hash } });
  if (!row) return 'missing';
  const key = {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    prefix: row.prefix,
    hash: row.hash,
    scopes: row.scopes as string[],
    status: row.status as 'active' | 'revoked',
  };
  const existing = apiKeys.get(row.id);
  if (existing) Object.assign(existing, key);
  else apiKeys.set(row.id, key);
  return 'found';
}

/**
 * Fire-and-forget row writes for coordination-critical mutations. The
 * debounced diff persist (250ms) is the safety net, but a kill switch,
 * session close or key revocation must reach the database immediately:
 * a concurrent refresh in that window would otherwise read the old row
 * and overwrite the not-yet-flushed map value. Callers fire these without
 * awaiting and log failures; the diff persist retries on its next run.
 */
export async function writeSessionRows(
  sessions: Array<{ id: string; platformUserId: string; companyId: string; tenantId: string; status: string; issuedAt: string; expiresAt: string }>,
): Promise<void> {
  if (!controlPlaneDbEnabled() || sessions.length === 0) return;
  const prisma = await getPrisma();
  await prisma.$transaction(
    sessions.map((session) =>
      prisma.controlPlaneSession.upsert({ where: { id: session.id }, create: session, update: session }),
    ),
  );
}

export async function writeApiKeyRow(key: {
  id: string;
  companyId: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  status: string;
  createdAt?: string;
}): Promise<void> {
  if (!controlPlaneDbEnabled()) return;
  const prisma = await getPrisma();
  await prisma.controlPlaneApiKey.upsert({
    where: { id: key.id },
    create: { ...key, scopes: asJson(key.scopes), createdAt: key.createdAt ?? new Date().toISOString() },
    update: { ...key, scopes: asJson(key.scopes) },
  });
}

/**
 * After an atomic usage increment, align this instance's persist baseline
 * with the database value, so the debounced diff persist does not rewrite
 * the row with a stale total and clobber a concurrent replica's increment.
 */
export function syncUsageBaseline(plane: ControlPlane, companyId: string, meter: string, value: number): void {
  const baseline = lastPersistedByPlane.get(plane);
  if (!baseline) return;
  const meters = new Map(baseline.usage ?? []);
  const record = { ...(meters.get(companyId) ?? {}) };
  record[meter] = value;
  meters.set(companyId, record);
  baseline.usage = [...meters.entries()];
}

/** Atomic per-meter increment. Returns the new total. */
export async function incrementUsage(
  companyId: string,
  meter: string,
  delta = 1,
): Promise<number> {
  const prisma = await getPrisma();
  const row = await prisma.controlPlaneUsage.upsert({
    where: { companyId_meter: { companyId, meter } },
    create: { companyId, meter, value: delta },
    update: { value: { increment: delta } },
  });
  return row.value;
}

// ---------------------------------------------------------------------------
// Background refresh interval (started once at boot, stopped on shutdown)
// ---------------------------------------------------------------------------

let refreshTimer: ReturnType<typeof setInterval> | undefined;

export function controlPlaneRefreshIntervalMs(): number {
  const parsed = Number(process.env.CONTROL_PLANE_REFRESH_MS ?? '30000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

export function startControlPlaneRefresh(plane: ControlPlane): void {
  if (!controlPlaneDbEnabled() || refreshTimer) return;
  refreshTimer = setInterval(() => {
    refreshControlPlaneFromDb(plane).catch((error) => {
      console.warn('Control plane refresh from database failed; continuing with in-memory state.', error instanceof Error ? error.message : error);
    });
  }, controlPlaneRefreshIntervalMs());
  refreshTimer.unref?.();
}

export function stopControlPlaneRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}
