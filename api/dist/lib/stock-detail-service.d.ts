import type { TenantContext } from './tenant-context.js';
export type BranchBalance = {
    locationId: string;
    locationName: string;
    onHand: number;
    reserved: number;
    quarantine: number;
    damaged: number;
    available: number;
};
export type LotDetail = {
    lotId: string;
    lotNo: string;
    expiryDate: string | null;
    status: string;
    totalOnHand: number;
};
export type MovementRow = {
    id: string;
    movementType: string;
    qtyDelta: number;
    beforeBalance: number;
    afterBalance: number;
    locationId: string;
    lotId: string | null;
    reason: string | null;
    sourceDocument: string | null;
    actor: string | null;
    timestamp: string;
    reversalOf: string | null;
};
export type ReconciliationStatus = {
    explained: boolean;
    journalSum: number;
    onHand: number;
    delta: number;
};
export type StockDetail = {
    itemId: string;
    itemCode: string;
    itemName: string;
    branches: BranchBalance[];
    lots: LotDetail[];
    movements: MovementRow[];
    reconciliation: ReconciliationStatus[];
};
/**
 * Everything Item Detail needs in one server round trip: per-location
 * balances, lot/expiry state, recent movement history and a per-(lot,
 * location) reconciliation status - all derived from StockLedger/
 * StockMovement, never from a client-maintained running total.
 */
export declare function getStockDetail(ctx: TenantContext, itemId: string, movementLimit?: number): Promise<StockDetail>;
