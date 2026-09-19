import { counts, type DailyMovementRecord } from './repository.js';
/**
 * Called after a sales/purchase import posts movements. Any count taken after
 * a movement's transaction time is affected: a pending count gets its book
 * quantity recomputed, an already-approved one is flagged for investigation.
 * Idempotent per movement (the dedupe key is remembered on the count).
 */
export declare function applyLateMovements(movements: DailyMovementRecord[], actorId?: string): Promise<number>;
/** Never lets reconciliation bookkeeping fail the import that triggered it. */
export declare function applyLateMovementsQuietly(movements: DailyMovementRecord[], actorId?: string): Promise<void>;
/** Counts the reviewer still has to look at because of late movements. */
export declare function countsNeedingReconciliation(): typeof counts;
