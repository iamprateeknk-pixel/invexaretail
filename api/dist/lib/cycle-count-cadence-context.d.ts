import type { AbcClass } from './abc-cycle-count.js';
export type CadenceDays = Record<AbcClass, number>;
/** Defaults when a company has no override: weekly/monthly/quarterly (ABC_CADENCE). */
export declare const DEFAULT_CADENCE_DAYS: CadenceDays;
export declare function validCadenceDays(value: unknown): number | null;
/** Cache write (used by the loader and by the settings route after a save). An entry with no valid days is cleared. */
export declare function cacheCompanyCadence(companyId: string, cadence: {
    cycleCountCadenceADays?: number | null;
    cycleCountCadenceBDays?: number | null;
    cycleCountCadenceCDays?: number | null;
} | null | undefined): void;
export declare function cadenceForCompany(companyId: string | null | undefined): CadenceDays;
