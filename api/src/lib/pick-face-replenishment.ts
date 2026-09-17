// Blueprint P4 "WMS 3.0: Internal replenishment" - reserve-to-pick-face
// tasks triggered by pick-face min/max. A pick-face bin below its min needs
// topping up from reserve stock of the same item at the same location; this
// module only decides what to suggest (source bin, quantity) - the actual
// move is persisted via lib/bin-move.ts + moveBinStockPersisted(), the same
// path a manually scanned bin transfer uses.

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
export function planPickFaceReplenishment(
  pickFace: PickFaceBin,
  reserveCandidates: ReserveBinCandidate[],
): PickFaceReplenishmentSuggestion | null {
  if (pickFace.onHand >= pickFace.min) return null;
  const needed = pickFace.max - pickFace.onHand;
  if (needed <= 0) return null;

  const source = [...reserveCandidates]
    .filter((bin) => bin.onHand > 0)
    .sort((a, b) => b.onHand - a.onHand)[0];
  if (!source) return null;

  const quantity = Math.min(needed, source.onHand);
  if (quantity <= 0) return null;

  return {
    fromBinId: source.binId,
    fromBinCode: source.code,
    toBinId: pickFace.binId,
    toBinCode: pickFace.code,
    quantity,
  };
}
