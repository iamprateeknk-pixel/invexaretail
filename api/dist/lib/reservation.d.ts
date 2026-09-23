import { DomainError } from './errors.js';
export declare class InsufficientStockError extends DomainError {
    constructor(message: string, traceId?: string);
}
export type ReserveLine = {
    itemId: string;
    lotId: string;
    locationId: string;
    quantity: number;
};
export type ReserveOptions = {
    companyId?: string;
    tenantId?: string;
    actorId?: string;
    requestId?: string;
    traceId?: string;
};
/**
 * Atomically reserves every line or none of them. Lines are processed in a
 * stable sort order (itemId, lotId, locationId) so that two requests
 * reserving an overlapping set of lines always take their row-level locks
 * in the same order and cannot deadlock each other. Each line's check and
 * increment is one conditional `UPDATE`, so no two concurrent callers can
 * ever both succeed against the same over-committed row - the failing side
 * throws and the whole transaction (including any lines already updated in
 * this same call) rolls back, so a partial reservation is never left
 * behind. DB-backed only: memory-mode deployments are single-process
 * demo/dev use and have no real concurrent requests to race.
 */
export declare function reserveStockForTransfer(lines: ReserveLine[], options?: ReserveOptions): Promise<void>;
/**
 * Releases previously reserved quantity when a transfer reaches a terminal
 * state (confirmed, cancelled, rejected, closed). Never throws and clamps
 * at zero via the same single conditional-`UPDATE` shape as the reserve
 * path (no read-decide-write gap): a reservation-bookkeeping failure or
 * drift must not block the status change it is cleaning up after, and the
 * physical stock movement (if any) has already been posted elsewhere by
 * the time this runs.
 */
export declare function releaseReservedStock(lines: ReserveLine[]): Promise<void>;
export declare const TERMINAL_TRANSFER_STATUSES: readonly ["CONFIRMED", "REJECTED", "CANCELLED", "CLOSED"];
