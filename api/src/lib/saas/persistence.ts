import { Prisma } from '@prisma/client';
import { resolveDatabaseUrl } from '../db.js';
import { controlPlane } from './control-plane.js';
import {
  applyControlPlaneSnapshot,
  CONTROL_PLANE_STATE_ID,
  isControlPlaneSnapshot,
  serializeControlPlane,
  type ControlPlaneSnapshot,
} from './snapshot.js';

function databaseEnabled(): boolean {
  if (process.env.NODE_TEST_CONTEXT && process.env.CONTROL_PLANE_PERSIST_IN_TESTS !== '1') {
    return false;
  }
  return Boolean(resolveDatabaseUrl());
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistInFlight: Promise<void> | undefined;

function asJsonPayload(snapshot: ControlPlaneSnapshot): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}

// ADR-004: ControlPlaneState is a Prisma model; `prisma migrate deploy` owns
// its schema. No-op kept so existing call sites do not need to change.
export async function ensureControlPlaneSchema(): Promise<void> {}

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

export async function saveControlPlaneSnapshot(
  snapshot: ControlPlaneSnapshot = serializeControlPlane(controlPlane),
): Promise<void> {
  if (!databaseEnabled()) return;
  const { prisma } = await import('../db.js');
  const payload = asJsonPayload(snapshot);
  await prisma.controlPlaneState.upsert({
    where: { id: CONTROL_PLANE_STATE_ID },
    create: { id: CONTROL_PLANE_STATE_ID, payload },
    update: { payload },
  });
}

export async function hydrateControlPlaneFromStore(): Promise<'skipped' | 'seeded' | 'restored'> {
  if (!databaseEnabled()) return 'skipped';
  try {
    await ensureControlPlaneSchema();
    const snapshot = await loadControlPlaneSnapshot();
    if (!snapshot) {
      await saveControlPlaneSnapshot();
      return 'seeded';
    }
    applyControlPlaneSnapshot(controlPlane, snapshot);
    return 'restored';
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

