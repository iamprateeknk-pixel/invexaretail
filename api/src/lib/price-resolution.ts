// Blueprint P9 "Retail pricing": resolve the one price that applies to a
// given item/branch/customer-group/moment, out of every PriceList row for
// that item and price type. Deterministic "most specific, currently
// effective" rule - never an average or a guess.

export type PriceCandidate = {
  id: string;
  price: number;
  branchId: string | null;
  customerGroup: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
};

export type PriceResolutionContext = {
  branchId?: string | null;
  customerGroup?: string | null;
  at?: string;
};

function isEffective(candidate: PriceCandidate, at: number): boolean {
  if (candidate.status !== 'ACTIVE') return false;
  const from = new Date(candidate.effectiveFrom).getTime();
  if (from > at) return false;
  if (candidate.effectiveTo) {
    const to = new Date(candidate.effectiveTo).getTime();
    if (to <= at) return false;
  }
  return true;
}

// Specificity score: an exact branch+customer-group match beats a
// customer-group-only or branch-only match, which both beat a
// company-wide (branchId null, customerGroup null) fallback row.
function specificity(candidate: PriceCandidate, context: PriceResolutionContext): number {
  let score = 0;
  if (candidate.branchId && candidate.branchId === context.branchId) score += 2;
  else if (candidate.branchId) return -1;
  if (candidate.customerGroup && candidate.customerGroup === context.customerGroup) score += 1;
  else if (candidate.customerGroup) return -1;
  return score;
}

export function resolvePrice(candidates: PriceCandidate[], context: PriceResolutionContext = {}): PriceCandidate | null {
  const at = context.at ? new Date(context.at).getTime() : Date.now();
  let best: PriceCandidate | null = null;
  let bestScore = -1;
  let bestFrom = -Infinity;
  for (const candidate of candidates) {
    if (!isEffective(candidate, at)) continue;
    const score = specificity(candidate, context);
    if (score < 0) continue;
    const from = new Date(candidate.effectiveFrom).getTime();
    if (score > bestScore || (score === bestScore && from > bestFrom)) {
      best = candidate;
      bestScore = score;
      bestFrom = from;
    }
  }
  return best;
}
