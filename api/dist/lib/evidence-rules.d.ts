export type EvidenceRuleLike = {
    id: string;
    label: string;
    category: string | null;
    branchId: string | null;
    quantityThreshold: number | null;
    valueThreshold: number | null;
};
export type EvidenceContext = {
    category: string | null;
    branchId: string | null;
    quantity: number;
    value: number;
};
/** Pure: does this rule's scope (category/branch) apply, and does either independent threshold trigger? Same shape as ToleranceRule's ruleTriggers(). */
export declare function ruleTriggers(rule: EvidenceRuleLike, ctx: EvidenceContext): boolean;
/** Picks the most specific matching, triggered rule: category+branch beats category-only or branch-only beats a global (both null) rule. */
export declare function findTriggeredEvidenceRule<T extends EvidenceRuleLike>(rules: T[], ctx: EvidenceContext): T | null;
export type EvidenceGateResult = {
    blocked: false;
} | {
    blocked: true;
    reason: string;
    matchedRuleId: string;
};
/**
 * Checks whether a damaged receipt line is gated by an active EvidenceRule
 * and, if so, whether evidence already exists for the transfer. Never
 * throws (a rule-engine failure must not block the underlying receipt from
 * at least attempting its normal path) - returns `{ blocked: false }` on
 * any internal error, same fail-open posture as checkApprovalGate /
 * getCountRecommendation elsewhere in this app.
 */
export declare function requireEvidenceForDamage(input: {
    transferId: string;
    triggerType: string;
    itemId: string;
    branchId: string | null;
    damagedQty: number;
}): Promise<EvidenceGateResult>;
