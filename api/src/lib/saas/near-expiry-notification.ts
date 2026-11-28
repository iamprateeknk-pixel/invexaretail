import type { Prisma } from '@prisma/client';
import { daysUntilExpiryDate } from '../expiry-date.js';
import { BUSINESS_TIMEZONE, validTimezone } from '../timezone-context.js';

export const NEAR_EXPIRY_DAYS = 30;

/** An invalidated reminder is cancelled before it reaches the company inbox. */
export async function nearExpiryNotification(
  tx: Prisma.TransactionClient,
  run: { companyId: string; occurrence: string },
  now: Date,
): Promise<string | null> {
  const occurrence: unknown = JSON.parse(run.occurrence.slice('item.near_expiry:'.length));
  if (!Array.isArray(occurrence) || occurrence.length !== 4 || occurrence.some((part) => typeof part !== 'string')) return null;
  const [itemId, lotId, locationId, expiryDay] = occurrence as string[];
  const stock = await tx.stockLedger.findFirst({
    where: { itemId, lotId, locationId, companyId: run.companyId, onHand: { gt: 0 }, item: { companyId: run.companyId },
      location: { companyId: run.companyId }, lot: { status: 'AVAILABLE' } },
    select: { itemId: true, item: { select: { name: true } }, location: { select: { name: true } },
      lot: { select: { itemId: true, lotNo: true, expiryDate: true } } },
  });
  if (!stock?.lot.expiryDate || stock.lot.itemId !== stock.itemId || stock.lot.expiryDate.toISOString().slice(0, 10) !== expiryDay) return null;
  const company = await tx.companyProfile.findUnique({ where: { id: run.companyId }, select: { timezone: true } });
  const days = daysUntilExpiryDate(stock.lot.expiryDate, now, validTimezone(company?.timezone) ?? BUSINESS_TIMEZONE);
  if (days === null || days < 0 || days > NEAR_EXPIRY_DAYS) return null;
  return `${stock.item.name}, lot ${stock.lot.lotNo}, expires on ${expiryDay} at ${stock.location.name}.`;
}
