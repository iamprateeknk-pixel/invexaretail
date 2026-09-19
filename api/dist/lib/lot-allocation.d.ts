export type LotAllocationStrategy = 'FIFO' | 'FEFO';
export type LotAllocationInput = {
    lotId: string;
    onHand: number;
    expiryDate?: string | null;
    receivedAt?: string | null;
    sequence?: number;
};
export type LotPhysicalAllocation = {
    lotId: string;
    bookQty: number;
    physicalQty: number;
    variance: number;
};
export type LotAllocationResult = {
    allocations: LotPhysicalAllocation[];
    totalBookQty: number;
    physicalQty: number;
    allocatedQty: number;
    excessQty: number;
    totalVariance: number;
};
/**
 * Deterministically allocates one item-level physical quantity across its
 * positive book lots. This is used by loose/weighted inventory where the
 * operator counts an item in KG instead of pretending to know the physical
 * quantity of every ERP lot.
 *
 * The allocator never creates a negative lot quantity. Quantity beyond the
 * total book stock is returned as excessQty and must be handled explicitly by
 * the caller (for example an exception/reconciliation bucket).
 */
export declare function allocatePhysicalAcrossLots(input: {
    physicalQty: number;
    lots: LotAllocationInput[];
    strategy?: LotAllocationStrategy;
    precision?: number;
}): LotAllocationResult;
