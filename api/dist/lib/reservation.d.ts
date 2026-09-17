export declare class InsufficientStockError extends Error {
}
export type ReserveLine = {
    itemId: string;
    lotId: string;
    locationId: string;
    quantity: number;
};
/**
 * Atomically reserves every line or none of them, checking `onHand -
 * reserved` per line inside one transaction so two concurrent requests for
 * the same lot cannot both succeed. DB-backed only: memory-mode
 * deployments are single-process demo/dev use and have no real concurrent
 * requests to race, so this is a no-op there (consistent with every other
 * DB-only enhancement in this pass - Exception Inbox, putaway, pick waves).
 */
export declare function reserveStockForTransfer(lines: ReserveLine[]): Promise<void>;
/**
 * Releases previously reserved quantity when a transfer reaches a terminal
 * state (confirmed, cancelled, rejected, closed). Never throws and clamps
 * at zero: a reservation-bookkeeping failure or drift must not block the
 * status change it is cleaning up after, and the physical stock movement
 * (if any) has already been posted elsewhere by the time this runs.
 */
export declare function releaseReservedStock(lines: ReserveLine[]): Promise<void>;
export declare const TERMINAL_TRANSFER_STATUSES: readonly ["CONFIRMED", "REJECTED", "CANCELLED", "CLOSED"];
