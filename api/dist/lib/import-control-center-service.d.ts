import type { ControlCenterLocation, MovementActivity } from './import-control-center.js';
/** Movements whose transaction time falls in [from, to), grouped per branch and source. */
export declare function loadMovementActivity(from: string, to: string): Promise<MovementActivity[]>;
/**
 * Rows the day's files rejected, attributed to a branch where the staged row
 * still names one (a row rejected for an unknown branch cannot be attributed).
 */
export declare function loadRejectedRows(batchIds: string[], locations: ControlCenterLocation[]): Promise<{
    byLocation: Map<string, {
        sales: number;
        purchases: number;
    }>;
    unattributed: {
        sales: number;
        purchases: number;
    };
}>;
