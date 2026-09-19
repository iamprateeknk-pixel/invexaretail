export type AllocationLot = {
    lotId: string;
    lotNo: string;
    bookQty: number;
    expiryDate?: string | null;
    status?: 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE';
};
export type WeightAllocation = {
    lotId: string;
    lotNo: string;
    bookQty: number;
    physicalQty: number;
};
/** FEFO: earliest expiry first (no expiry last); FIFO: the order the lots were created. */
export declare function orderLots(lots: AllocationLot[], strategy: 'FIFO' | 'FEFO'): AllocationLot[];
/**
 * Fills each eligible lot up to its book quantity in strategy order, so a
 * shortfall lands on the lots consumed last and matches "we sold the old
 * stock first". Anything counted beyond the total book quantity is an
 * excess and goes on the last lot in the order (its variance shows it).
 */
export declare function allocateWeightCount(total: number, lots: AllocationLot[], strategy: 'FIFO' | 'FEFO'): WeightAllocation[];
export declare function totalVariance(allocation: WeightAllocation[]): number;
