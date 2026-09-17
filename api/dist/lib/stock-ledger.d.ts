export type StockMovementType = 'OPENING_STOCK' | 'PURCHASE_RECEIPT' | 'SALES_DEDUCTION' | 'SALES_RETURN' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'COUNT_VARIANCE' | 'ADJUSTMENT' | 'WASTE' | 'DAMAGE' | 'EXPIRY_WRITE_OFF';
export type NegativeStockPolicy = 'BLOCK' | 'WARN' | 'ALLOW';
export type StockMovementRecord = {
    id: string;
    itemId: string;
    lotId: string | null;
    locationId: string;
    binId?: string | null;
    movementType: StockMovementType;
    qtyDelta: number;
    beforeBalance: number;
    afterBalance: number;
    sourceDocument?: string;
    sourceLineId?: string;
    actor: string;
    timestamp: string;
    correlationId: string;
    reason?: string;
    reversalOfId?: string;
    reversedById?: string;
    metadata?: Record<string, unknown>;
};
export type StockBalanceKey = {
    itemId: string;
    lotId: string | null;
    locationId: string;
    binId?: string | null;
};
export type StockBalanceRecord = StockBalanceKey & {
    onHand: number;
    reserved: number;
    inTransit: number;
    available: number;
    version: number;
};
export type PostMovementInput = {
    itemId: string;
    lotId?: string | null;
    locationId: string;
    binId?: string | null;
    movementType: StockMovementType;
    qtyDelta: number;
    actor: string;
    sourceDocument?: string;
    sourceLineId?: string;
    correlationId?: string;
    reason?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
    negativeStockPolicy?: NegativeStockPolicy;
};
export declare class NegativeStockBlockedError extends Error {
    readonly key: StockBalanceKey;
    readonly attemptedBalance: number;
    constructor(key: StockBalanceKey, attemptedBalance: number);
}
export declare const UNASSIGNED_BIN_ID = "UNASSIGNED";
/**
 * In-memory projection of the stock ledger. Mirrors the StockMovement /
 * StockBalance Prisma models so the same posting rules can run in tests and
 * in-memory dev mode before being backed by the database in production.
 */
export declare class StockLedger {
    private readonly movements;
    private readonly balances;
    getBalance(key: StockBalanceKey): StockBalanceRecord;
    listMovements(filter?: Partial<StockBalanceKey>): StockMovementRecord[];
    /**
     * Posts one movement transactionally against the current balance. Posted
     * movements are never mutated afterwards — corrections must call
     * reverseMovement() and post a new, corrected movement instead.
     */
    postMovement(input: PostMovementInput): StockMovementRecord;
    /**
     * Reverses a posted movement by posting an equal-and-opposite movement
     * linked back to the original. The original record is left untouched.
     */
    reverseMovement(movementId: string, actor: string, reason: string): StockMovementRecord;
    /** Reserves quantity ahead of a transfer/pick allocation without moving on-hand stock. */
    reserve(key: StockBalanceKey, qty: number): StockBalanceRecord;
    releaseReservation(key: StockBalanceKey, qty: number): StockBalanceRecord;
    /** sum(posted movements) recomputed from scratch, for reconciliation checks against getBalance(). */
    recomputeBalanceFromMovements(key: StockBalanceKey): number;
    /** Location-level on-hand: sum of every bin for this item/lot/location. */
    getLocationOnHand(itemId: string, lotId: string | null, locationId: string): number;
}
