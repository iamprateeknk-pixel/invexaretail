import { type CadenceDays } from './cycle-count-cadence-context.js';
import type { AbcClass } from './abc-cycle-count.js';
/** Loads every company's configured cadence into the in-process cache (boot, and after a change). */
export declare function loadCompanyCycleCountCadences(): Promise<number>;
export declare function saveCompanyCycleCountCadence(companyId: string, days: Partial<Record<AbcClass, number | null>>): Promise<CadenceDays>;
