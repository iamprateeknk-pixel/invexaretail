export type PickLot = {
    lotId: string;
    lotNo: string;
    available: number;
    expiryDate?: string | null;
    status?: 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE';
};
export type PickAllocation = {
    lotId: string;
    lotNo: string;
    quantity: number;
    expiryDate?: string | null;
};
/** A lot a picker may take from: available status, stock on the shelf, and not past its expiry. */
export declare function isPickableLot(lot: Pick<PickLot, 'status' | 'available' | 'expiryDate'>, today?: Date): boolean;
export declare function allocatePick(input: {
    requested: number;
    lots: PickLot[];
    strategy: 'FIFO' | 'FEFO';
    today?: Date;
}): {
    allocations: PickAllocation[];
    shortfall: number;
};
/** Items picked by weight from the whole pool rather than from one named lot. */
export declare function isPooledPick(item: {
    pickMethod?: string | null;
}): boolean;
