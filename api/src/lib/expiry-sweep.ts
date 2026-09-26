import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { isExpiredOn } from './expiry-date.js';
import { loadCompanyTimezones } from './company-timezone.js';
import { companyTimezone } from './timezone-context.js';

// Audit S-3: nothing ever moved a lot to EXPIRED when its date passed - the status was
// only set as a side effect of a manual write-off - so reports, transfers and any path
// that trusts `Lot.status` kept treating lapsed stock as AVAILABLE. This daily sweep
// marks every AVAILABLE lot whose expiry date is before today (business timezone) as
// EXPIRED. It only changes the status flag (never quantity - write-off stays a
// controlled, audited human action) and is idempotent.

let timer: NodeJS.Timeout | null = null;

export async function sweepExpiredLots(now: Date = new Date()): Promise<{ expired: number }> {
  // A lot is expired once its date is before today in ITS COMPANY's timezone (audit T-2), so candidates are
  // fetched with a coarse cutoff (the furthest-ahead zone is UTC+14) and judged per company.
  await loadCompanyTimezones().catch(() => undefined);
  const candidates = await prisma.lot.findMany({
    where: { status: 'AVAILABLE', expiryDate: { lt: new Date(now.getTime() + 2 * 86_400_000) } },
    select: { id: true, expiryDate: true, item: { select: { companyId: true } } },
  });
  const stale = candidates.filter((lot) => isExpiredOn(lot.expiryDate, now, companyTimezone(lot.item.companyId)));
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
