export type PickFaceBin = {
    binId: string;
    code: string;
    onHand: number;
    min: number;
    max: number;
};
export type ReserveBinCandidate = {
    binId: string;
    code: string;
    onHand: number;
};
export type PickFaceReplenishmentSuggestion = {
    fromBinId: string;
    fromBinCode: string;
    toBinId: string;
    toBinCode: string;
    quantity: number;
};
/**
 * Pure and unit-testable: a pick-face bin needs replenishment when its
 * on-hand is below min. The suggested quantity tops it up to max, capped by
 * what the single richest reserve bin actually has on hand (never draining
 * more than one reserve bin can supply in one directed move, and never
 * suggesting a move a reserve bin cannot cover).
 */
export declare function planPickFaceReplenishment(pickFace: PickFaceBin, reserveCandidates: ReserveBinCandidate[]): PickFaceReplenishmentSuggestion | null;
