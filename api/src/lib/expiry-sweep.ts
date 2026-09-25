import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { todayDayNumber } from './expiry-date.js';

// Audit S-3: nothing ever moved a lot to EXPIRED when its date passed - the status was
// only set as a side effect of a manual write-off - so reports, transfers and any path
// that trusts `Lot.status` kept treating lapsed stock as AVAILABLE. This daily sweep
// marks every AVAILABLE lot whose expiry date is before today (business timezone) as
// EXPIRED. It only changes the status flag (never quantity - write-off stays a
// controlled, audited human action) and is idempotent.

let timer: NodeJS.Timeout | null = null;

export async function sweepExpiredLots(now: Date = new Date()): Promise<{ expired: number }> {
  // Expiry values are stored as UTC-midnight dates; a lot is expired once its date is before today's business date.
  const todayStart = new Date(todayDayNumber(now) * 86_400_000);
  const stale = await prisma.lot.findMany({
    where: { status: 'AVAILABLE', expiryDate: { lt: todayStart } },
    select: { id: true, itemId: true, lotNo: true, expiryDate: true },
  });
  if (!stale.length) return { expired: 0 };
  const result = await prisma.lot.updateMany({
    where: { id: { in: stale.map((lot) => lot.id) }, status: 'AVAILABLE' },
    data: { status: 'EXPIRED' },
  });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(), actorId: 'system', actorRole: 'SYSTEM', action: 'LOTS_MARKED_EXPIRED',
      entityType: 'Lot', entityId: 'sweep', tenantId: 'tenant-invexa',
      metadata: { count: result.count, lotIds: stale.slice(0, 200).map((lot) => lot.id) } as never,
    },
  }).catch(() => undefined);
  return { expired: result.count };
}

/** Runs once at start-up and then every `intervalMs` (default 6 h, so a lot flips within hours of IST midnight). */
export function startExpirySweep(intervalMs = 6 * 60 * 60 * 1000): void {
  if (timer) return;
  const run = () => sweepExpiredLots().catch((error) => console.error('[expiry-sweep] failed', error));
  void run();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
}

export function stopExpirySweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
