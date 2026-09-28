// Per-company cycle-count cadence (audit C-4). Cadence (days between required counts, by ABC
// class) used to be the fixed ABC_CADENCE constant (7/30/90) for every tenant. Mirrors
// timezone-context.ts exactly: a synchronous in-process cache keyed by companyId, loaded at boot
// and updated by the settings route after a save, so the (currently synchronous) cycle-count
// planner in core.ts can read a company's override without an extra database round trip.
import type { AbcClass } from './abc-cycle-count.js';

export type CadenceDays = Record<AbcClass, number>;

/** Defaults when a company has no override: weekly/monthly/quarterly (ABC_CADENCE). */
export const DEFAULT_CADENCE_DAYS: CadenceDays = { A: 7, B: 30, C: 90 };

export function validCadenceDays(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

const byCompany = new Map<string, CadenceDays>();

/** Cache write (used by the loader and by the settings route after a save). An entry with no valid days is cleared. */
export function cacheCompanyCadence(companyId: string, cadence: { cycleCountCadenceADays?: number | null; cycleCountCadenceBDays?: number | null; cycleCountCadenceCDays?: number | null } | null | undefined): void {
  const a = validCadenceDays(cadence?.cycleCountCadenceADays);
  const b = validCadenceDays(cadence?.cycleCountCadenceBDays);
  const c = validCadenceDays(cadence?.cycleCountCadenceCDays);
  if (a === null && b === null && c === null) { byCompany.delete(companyId); return; }
  byCompany.set(companyId, { A: a ?? DEFAULT_CADENCE_DAYS.A, B: b ?? DEFAULT_CADENCE_DAYS.B, C: c ?? DEFAULT_CADENCE_DAYS.C });
}

export function cadenceForCompany(companyId: string | null | undefined): CadenceDays {
  return (companyId ? byCompany.get(companyId) : undefined) ?? DEFAULT_CADENCE_DAYS;
}
