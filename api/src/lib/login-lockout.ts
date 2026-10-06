// Phase 5: per-account lockout. The existing express-rate-limit login limiter
// is per-IP, so a credential-stuffing run spread over many IPs against one
// account was never slowed down. This counts failures per account key instead:
// after MAX_FAILURES within the window the key is locked for LOCK_MS. Postgres
// in database mode (shared across replicas), in-memory otherwise - the same
// dual-mode shape as lib/session-store.ts.
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

export type LockState = { locked: false } | { locked: true; retryAfterSeconds: number };

const memory = new Map<string, { failedCount: number; windowStart: number; lockedUntil: number }>();

const normalize = (key: string) => key.trim().toLowerCase();

const lockedFor = (lockedUntil: number | null | undefined, now: number): LockState =>
  lockedUntil && lockedUntil > now ? { locked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) } : { locked: false };

export async function lockState(key: string, now = Date.now()): Promise<LockState> {
  const id = normalize(key);
  if (databaseEnabled) {
    const row = await prisma.authLockout.findUnique({ where: { key: id } });
    return lockedFor(row?.lockedUntil?.getTime(), now);
  }
  return lockedFor(memory.get(id)?.lockedUntil, now);
}

/** Records one failed attempt; returns the state afterwards (locked once the limit is reached). */
export async function registerFailure(key: string, now = Date.now()): Promise<LockState> {
  const id = normalize(key);
  if (databaseEnabled) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.authLockout.findUnique({ where: { key: id } });
      const fresh = !row || now - row.windowStart.getTime() > FAILURE_WINDOW_MS;
      const failedCount = fresh ? 1 : row.failedCount + 1;
      const lockedUntil = failedCount >= MAX_FAILURES ? new Date(now + LOCK_MS) : null;
      await tx.authLockout.upsert({
        where: { key: id },
        create: { key: id, failedCount, windowStart: new Date(now), lockedUntil },
        update: { failedCount, windowStart: fresh ? new Date(now) : row.windowStart, lockedUntil },
      });
      return lockedFor(lockedUntil?.getTime(), now);
    });
  }
  const current = memory.get(id);
  const fresh = !current || now - current.windowStart > FAILURE_WINDOW_MS;
  const failedCount = fresh ? 1 : current.failedCount + 1;
  const lockedUntil = failedCount >= MAX_FAILURES ? now + LOCK_MS : 0;
  memory.set(id, { failedCount, windowStart: fresh ? now : current.windowStart, lockedUntil });
  return lockedFor(lockedUntil, now);
}

export async function clearFailures(key: string): Promise<void> {
  const id = normalize(key);
  if (databaseEnabled) {
    await prisma.authLockout.deleteMany({ where: { key: id } });
    return;
  }
  memory.delete(id);
}

export function resetLockoutsForTests(): void {
  memory.clear();
}
