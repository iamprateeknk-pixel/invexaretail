"use strict";
// Blueprint P9 "Retail pricing": resolve the one price that applies to a
// given item/branch/customer-group/moment, out of every PriceList row for
// that item and price type. Deterministic "most specific, currently
// effective" rule - never an average or a guess.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePrice = resolvePrice;
function isEffective(candidate, at) {
    if (candidate.status !== 'ACTIVE')
        return false;
    const from = new Date(candidate.effectiveFrom).getTime();
    if (from > at)
        return false;
    if (candidate.effectiveTo) {
        const to = new Date(candidate.effectiveTo).getTime();
        if (to <= at)
            return false;
    }
    return true;
}
// Specificity score: an exact branch+customer-group match beats a
// customer-group-only or branch-only match, which both beat a
// company-wide (branchId null, customerGroup null) fallback row.
function specificity(candidate, context) {
    let score = 0;
    if (candidate.branchId && candidate.branchId === context.branchId)
        score += 2;
    else if (candidate.branchId)
        return -1;
    if (candidate.customerGroup && candidate.customerGroup === context.customerGroup)
        score += 1;
    else if (candidate.customerGroup)
        return -1;
    return score;
}
function resolvePrice(candidates, context = {}) {
    const at = context.at ? new Date(context.at).getTime() : Date.now();
    let best = null;
    let bestScore = -1;
    let bestFrom = -Infinity;
    for (const candidate of candidates) {
        if (!isEffective(candidate, at))
            continue;
        const score = specificity(candidate, context);
        if (score < 0)
            continue;
        const from = new Date(candidate.effectiveFrom).getTime();
        if (score > bestScore || (score === bestScore && from > bestFrom)) {
            best = candidate;
            bestScore = score;
            bestFrom = from;
        }
    }
    return best;
}
