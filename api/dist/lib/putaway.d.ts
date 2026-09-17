export type CreatePutawayTaskInput = {
    itemId: string;
    lotId?: string | null;
    locationId: string;
    quantity: number;
    sourceDocument?: string | null;
    sourceLineId?: string | null;
};
export type BinCandidate = {
    id: string;
    capacity: number | null;
    zone: string | null;
    pendingQty: number;
};
/**
 * Pure and unit-testable: ranks bin candidates best-first.
 *
 * Capacity: a bin whose already-pending putaway quantity plus this new
 * receipt would exceed its declared capacity is excluded, unless that
 * would exclude every candidate (a capacity signal is a soft constraint on
 * a suggestion, not a hard block on receiving). Remaining bins are ranked
 * by a fullness proxy: pendingQty/capacity when capacity is known, or
 * pendingQty/(pendingQty+1) when it isn't - the latter has no real
 * capacity to divide by, so it only asymptotically approaches "full" as
 * pending quantity grows, keeping unknown-capacity bins comparable without
 * inventing a capacity number for them.
 *
 * Velocity: for a fast-moving item, zone (assumed to sort roughly by
 * distance from the pick face, same convention as
 * pick-wave.ts's sequenceKeyForBin) is checked before fullness, so a
 * high-velocity item is steered toward the nearest zone with any room
 * rather than strictly the least-utilized bin overall.
 */
export declare function rankBinCandidates(candidates: BinCandidate[], ctx: {
    incomingQty: number;
    highVelocity: boolean;
}): string | null;
/**
 * Opens a putaway task for newly received good stock. Never throws - a
 * missing/legacy table on an older Hostinger database, or any bin-lookup
 * failure, must not block the receiving transaction that already
 * committed the stock. Putaway is an organizational follow-up, not a
 * precondition for stock being on hand.
 */
export declare function createPutawayTask(input: CreatePutawayTaskInput): Promise<void>;
