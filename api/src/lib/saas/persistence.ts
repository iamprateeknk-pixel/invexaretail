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
