import { prisma } from './db.js';
import { cacheCompanyCadence, cadenceForCompany, validCadenceDays, type CadenceDays } from './cycle-count-cadence-context.js';
import type { AbcClass } from './abc-cycle-count.js';

/** Loads every company's configured cadence into the in-process cache (boot, and after a change). */
export async function loadCompanyCycleCountCadences(): Promise<number> {
  const rows = await prisma.companyProfile.findMany({
    select: { id: true, cycleCountCadenceADays: true, cycleCountCadenceBDays: true, cycleCountCadenceCDays: true },
  });
  for (const row of rows) cacheCompanyCadence(row.id, row);
  return rows.length;
}

export async function saveCompanyCycleCountCadence(companyId: string, days: Partial<Record<AbcClass, number | null>>): Promise<CadenceDays> {
  const data: { cycleCountCadenceADays?: number | null; cycleCountCadenceBDays?: number | null; cycleCountCadenceCDays?: number | null } = {};
  for (const [cls, field] of [['A', 'cycleCountCadenceADays'], ['B', 'cycleCountCadenceBDays'], ['C', 'cycleCountCadenceCDays']] as const) {
    if (!(cls in days)) continue;
    const requested = days[cls];
    if (requested === null) { data[field] = null; continue; }
    const valid = validCadenceDays(requested);
    if (valid === null) throw new RangeError(`${cls} cadence must be a whole number of days between 1 and 3650.`);
    data[field] = valid;
  }
  const updated = await prisma.companyProfile.update({ where: { id: companyId }, data });
  cacheCompanyCadence(companyId, updated);
  return cadenceForCompany(companyId);
}
