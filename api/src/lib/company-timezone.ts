import { prisma } from './db.js';
import { cacheCompanyTimezone, validTimezone } from './timezone-context.js';

/** Loads every company's configured zone into the in-process cache (boot, and after a change). */
export async function loadCompanyTimezones(): Promise<number> {
  const rows = await prisma.companyProfile.findMany({ select: { id: true, timezone: true } });
  for (const row of rows) cacheCompanyTimezone(row.id, row.timezone);
  return rows.length;
}

export async function saveCompanyTimezone(companyId: string, timezone: string | null): Promise<string | null> {
  const valid = timezone === null ? null : validTimezone(timezone);
  if (timezone !== null && !valid) throw new RangeError('Unknown timezone. Use an IANA name such as Asia/Kolkata.');
  await prisma.companyProfile.update({ where: { id: companyId }, data: { timezone: valid } });
  cacheCompanyTimezone(companyId, valid);
  return valid;
}
