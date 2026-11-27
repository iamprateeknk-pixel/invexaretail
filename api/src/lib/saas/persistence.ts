import { createHash } from 'node:crypto';
import { ControlPlaneError, controlPlane, type ControlPlane, type ConfigurationVersion, type ScopeContext } from './control-plane.js';
import {
  controlPlaneDbEnabled,
  controlPlaneRowsExist,
  hydrateControlPlaneRows,
  importBlobSnapshotToRows,
  lastPersistedSnapshot,
  persistControlPlaneRows,
  stableStringify,
} from './control-plane-repository.js';
import {
  CONTROL_PLANE_STATE_ID,
  isControlPlaneSnapshot,
  serializeControlPlane,
  type ControlPlaneSnapshot,
} from './snapshot.js';

function databaseEnabled(): boolean {
  return controlPlaneDbEnabled();
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistInFlight: Promise<void> | undefined;
let persistQueue: Promise<void> = Promise.resolve();

// ADR-004: ControlPlaneState is a Prisma model; `prisma migrate deploy` owns
// its schema. No-op kept so existing call sites do not need to change.
export async function ensureControlPlaneSchema(): Promise<void> {}

/**
 * Legacy blob read: kept only as the one-time import source on first boot
 * after the ULTRA P2 rows migration. Nothing writes the blob anymore.
 */
export async function loadControlPlaneSnapshot(): Promise<ControlPlaneSnapshot | null> {
  if (!databaseEnabled()) return null;
  const { prisma } = await import('../db.js');
  const row = await prisma.controlPlaneState.findUnique({
    where: { id: CONTROL_PLANE_STATE_ID },
  });
  if (!row) return null;
  const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return isControlPlaneSnapshot(parsed) ? parsed : null;
}

/**
 * Persists the plane as ROWS (see control-plane-repository.ts): only the
 * records that changed since the last persist are written, in one
 * transaction. The signature keeps the old blob-save shape; the snapshot
 * argument defaults to the live plane, which is what every caller passes.
 */
export async function saveControlPlaneSnapshot(
  snapshot?: ControlPlaneSnapshot,
): Promise<void> {
  if (!databaseEnabled()) return;
  const write = persistQueue.then(async () => { await persistControlPlaneRows(controlPlane, snapshot ?? serializeControlPlane(controlPlane)); });
  persistQueue = write.catch(() => undefined);
  await write;
}

export function studioDraftRevision(draft: ConfigurationVersion | undefined): string | null {
  return draft ? createHash('sha256').update(stableStringify(JSON.parse(JSON.stringify(draft)))).digest('hex') : null;
}

export async function commitStudioRelease(plane: ControlPlane, scope: ScopeContext, command: { rollbackVersion?: number; draftRevision?: string }) {
  const release = persistQueue.then(async () => {
    if (databaseEnabled() && !lastPersistedSnapshot(plane)) {
      throw new ControlPlaneError('Studio could not verify the saved configuration. Try again when the company configuration has loaded.', 'STUDIO_CONFIG_UNAVAILABLE', 503);
    }
    if (command.draftRevision !== undefined && command.draftRevision !== studioDraftRevision(plane.drafts.get(scope.companyId ?? ''))) {
      throw new ControlPlaneError('The draft changed after preview. Review the latest draft before publishing.', 'STUDIO_CONFIG_CONFLICT', 409);
    }
    const stage = plane.prepareStudioRelease(scope, command.rollbackVersion);
    const { companyId, published, draft, history, audit, outbox } = stage;
    if (databaseEnabled()) {
      const snapshot = serializeControlPlane(plane);
      snapshot.drafts = snapshot.drafts.filter((entry) => entry.companyId !== companyId);
      if (draft) snapshot.drafts.push(draft);
      snapshot.published = [...snapshot.published.filter((entry) => entry.companyId !== companyId), published];
      snapshot.versions = [...snapshot.versions.filter(([id]) => id !== companyId), [companyId, history]];
      snapshot.audit = [...snapshot.audit, ...audit].slice(-500);
      snapshot.outbox = [...snapshot.outbox, ...outbox].slice(-200);
      await persistControlPlaneRows(plane, snapshot);
    }
    if (draft) plane.drafts.set(companyId, draft);
    else plane.drafts.delete(companyId);
    plane.published.set(companyId, published);
    plane.versions.set(companyId, history);
    plane.audit.push(...audit);
    plane.outbox.push(...outbox);
    return published;
  });
  persistQueue = release.then(() => undefined, () => undefined);
  return release;
}

export async function hydrateControlPlaneFromStore(): Promise<'skipped' | 'seeded' | 'restored'> {
  if (!databaseEnabled()) return 'skipped';
  try {
    await ensureControlPlaneSchema();
    if (await controlPlaneRowsExist()) {
      const restored = await hydrateControlPlaneRows(controlPlane);
      return restored ? 'restored' : 'skipped';
    }
    // First boot after the rows migration: import the legacy blob once, if
    // one exists, so existing deployments keep their companies, sessions,
    // keys and kill switches. The blob row is left untouched as a rollback
    // source; afterwards the rows are the system of record.
    const snapshot = await loadControlPlaneSnapshot();
    if (snapshot) {
      await importBlobSnapshotToRows(snapshot);
      await hydrateControlPlaneRows(controlPlane);
      return 'restored';
    }
    await persistControlPlaneRows(controlPlane);
    return 'seeded';
  } catch (error) {
    console.warn(
      'SaaS control plane state could not be hydrated; continuing with in-memory seed.',
      error instanceof Error ? error.message : error,
    );
    return 'skipped';
  }
}

// Mirrors operational tenants (User.companyId rows) and the company profile
// name into the control-plane registry. Run after both are hydrated.
export async function syncOperationalCompaniesIntoControlPlane(): Promise<number> {
  if (!databaseEnabled()) return 0;
  const { prisma } = await import('../db.js');
  const { DEFAULT_COMPANY_ID } = await import('./tenant-scope.js');
  const profile = await prisma.companyProfile.findUnique({ where: { id: 'default' } });
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, passwordHash: true, companyId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const byCompany = new Map<string, typeof users>();
  for (const user of users) {
    const companyId = user.companyId || DEFAULT_COMPANY_ID;
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), user]);
  }
  if (!byCompany.has(DEFAULT_COMPANY_ID)) byCompany.set(DEFAULT_COMPANY_ID, []);
  let changed = 0;
  for (const [companyId, rows] of byCompany) {
    const admin = rows.find((row) => String(row.role).toUpperCase().includes('ADMIN')) ?? null;
    const name = companyId === DEFAULT_COMPANY_ID && profile?.name ? profile.name : '';
    const touched = controlPlane.syncOperationalCompany({
      id: companyId,
      name,
      admin: admin
        ? { id: admin.id, email: admin.email, name: admin.name, passwordHash: admin.passwordHash }
        : null,
    });
    if (touched) changed += 1;
  }
  if (changed > 0) await saveControlPlaneSnapshot();
  return changed;
}

export function scheduleControlPlanePersist(): void {
  if (!databaseEnabled()) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistInFlight = saveControlPlaneSnapshot().catch((error) => {
      console.warn('SaaS control plane state could not be saved.', error instanceof Error ? error.message : error);
    });
  }, 250);
}

export async function flushControlPlanePersist(): Promise<void> {
  if (!databaseEnabled()) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    await saveControlPlaneSnapshot();
    return;
  }
  if (persistInFlight) await persistInFlight;
}

/**
 * Makes the platform company list include every company that actually operates in the database: the union of
 * CompanyProfile rows and the distinct companyId on users. Idempotent and read-only on operational tables.
 * The workspace profile with id `default` belongs to `default-company`.
 */
export async function syncOperationalCompanies(): Promise<number> {
  if (!databaseEnabled()) return 0;
  const { prisma } = await import('../db.js');
  const [profiles, userGroups, admins] = await Promise.all([
    prisma.companyProfile.findMany({ select: { id: true, name: true } }),
    prisma.user.groupBy({ by: ['companyId'] }),
    prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true, companyId: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const canonical = (id: string) => (id === 'default' ? 'default-company' : id);
  const names = new Map(profiles.map((profile) => [canonical(profile.id), profile.name]));
  const adminOf = new Map<string, string>();
  for (const admin of admins) if (!adminOf.has(admin.companyId)) adminOf.set(admin.companyId, admin.id);
  const ids = new Set<string>([...names.keys(), ...userGroups.map((group) => group.companyId)]);
  let changed = 0;
  for (const id of ids) {
    if (controlPlane.registerOperationalCompany({ id, name: names.get(id) ?? '', primaryAdminId: adminOf.get(id) ?? null })) changed += 1;
  }
  if (changed) scheduleControlPlanePersist();
  return changed;
}
