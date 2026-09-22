export declare function roleMeetsRequirement(role: string, requiredRole: string): boolean;
export type ApprovalRuleLike = {
    id: string;
    category: string | null;
    branchId: string | null;
    valueThreshold: number;
    requiredApproverRole: string;
};
/** Pure: most specific (category/branch-scoped beats global) matching rule whose threshold the value crosses - same shape as ToleranceRule's evaluateTolerance(). */
export declare function findTriggeredRule<T extends ApprovalRuleLike>(rules: T[], ctx: {
    category: string | null;
    branchId: string | null;
    value: number;
}): T | null;
export type GateResult = {
    blocked: false;
} | {
    blocked: true;
    requestId: string;
    status: 'PENDING';
    reason: string;
    requiredApproverRole: string;
};
/**
 * Checks whether `triggerType` is gated for this value/branch, and if so,
 * reuses an existing pending/approved request or opens a new one. Never
 * throws (a rule-engine failure must not block the underlying action from
 * at least attempting its normal path) - returns `{ blocked: false }` on
 * any internal error, same fail-open posture as ToleranceRule/Exception
 * Inbox best-effort helpers elsewhere in this app.
 */
export declare function checkApprovalGate(input: {
    triggerType: string;
    entityType: string;
    entityId: string;
    category?: string | null;
    branchId: string | null;
    value: number;
    requestedById: string;
}): Promise<GateResult>;
export declare function decideApprovalRequest(requestId: string, deciderId: string, deciderRole: string, decision: 'APPROVED' | 'REJECTED', notes?: string | null): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    requestedById: string;
    triggerType: string;
    ruleId: string;
    entityType: string;
    entityId: string;
    valueAtStake: number;
    decidedById: string | null;
    decidedAt: Date | null;
    decisionNotes: string | null;
}>;
