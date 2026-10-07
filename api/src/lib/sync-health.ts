import { prisma } from './db.js';
import { STALE_IN_PROGRESS_MS } from './mutation-idempotency.js';

// Plan Area H / release checklist: "Admin can see sync health and stuck/poison work."
// Server-side view of offline-capable commands for ONE company, built from the exactly-once
// receipts (MutationReceipt). A receipt that stays IN_PROGRESS past the stale window is a request
// that claimed its mutation id and never finished (crash, timeout) - it is surfaced, never deleted.
// Device-local conflict/reject queues live on the device and are not visible here.

export const SYNC_WINDOW_HOURS = 24;
const SAMPLE_LIMIT = 20;

export type SyncHealth = {
  windowHours: number;
  generatedAt: string;
  completed: number;
  inProgress: number;
  stuck: number;
  stuckSample: Array<{ userId: string; mutationId: string; ageSeconds: number; claimedAt: string }>;
  breached: boolean;
};

export async function getSyncHealth(companyId: string, now = new Date()): Promise<SyncHealth> {
  const since = new Date(now.getTime() - SYNC_WINDOW_HOURS * 3_600_000);
  const staleBefore = new Date(now.getTime() - STALE_IN_PROGRESS_MS);
  const [completed, inProgress, stuck, sample] = await Promise.all([
    prisma.mutationReceipt.count({ where: { companyId, createdAt: { gte: since }, state: { not: 'IN_PROGRESS' } } }),
    prisma.mutationReceipt.count({ where: { companyId, createdAt: { gte: since }, state: 'IN_PROGRESS' } }),
    prisma.mutationReceipt.count({ where: { companyId, state: 'IN_PROGRESS', updatedAt: { lt: staleBefore } } }),
    prisma.mutationReceipt.findMany({
      where: { companyId, state: 'IN_PROGRESS', updatedAt: { lt: staleBefore } },
      orderBy: { updatedAt: 'asc' },
      take: SAMPLE_LIMIT,
      select: { userId: true, mutationId: true, updatedAt: true },
    }),
  ]);
  return {
    windowHours: SYNC_WINDOW_HOURS,
    generatedAt: now.toISOString(),
    completed,
    inProgress,
    stuck,
    stuckSample: sample.map((row) => ({
      userId: row.userId,
      mutationId: row.mutationId,
      ageSeconds: Math.round((now.getTime() - row.updatedAt.getTime()) / 1000),
      claimedAt: row.updatedAt.toISOString(),
    })),
    breached: stuck > 0,
  };
}
