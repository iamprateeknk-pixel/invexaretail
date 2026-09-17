"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roleMeetsRequirement = roleMeetsRequirement;
exports.findTriggeredRule = findTriggeredRule;
exports.checkApprovalGate = checkApprovalGate;
exports.decideApprovalRequest = decideApprovalRequest;
const db_js_1 = require("./db.js");
const audit_js_1 = require("./audit.js");
const persistence_js_1 = require("./persistence.js");
// Blueprint section 16.2 (Workflow Builder): "transfer > ₹1 lakh -> regional
// manager approval." Distinct from ToleranceRule (count-tolerance.ts),
// which only ever recommends: an ApprovalRule genuinely gates the
// triggering action until a sufficiently-privileged user decides.
// Higher rank can always satisfy a lower role's approval requirement.
const ROLE_RANK = { ADMIN: 4, ADMIN_USER: 3, BRANCH_MANAGER: 2, AUDITOR: 1, STORE_USER: 1, WAREHOUSE_PICKER: 1 };
function roleMeetsRequirement(role, requiredRole) {
    return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[requiredRole] ?? Infinity);
}
/** Pure: most specific (category/branch-scoped beats global) matching rule whose threshold the value crosses - same shape as ToleranceRule's evaluateTolerance(). */
function findTriggeredRule(rules, ctx) {
    const specificity = (rule) => Number(rule.category !== null) + Number(rule.branchId !== null);
    const triggered = rules
        .filter((rule) => (rule.category === null || rule.category === ctx.category)
        && (rule.branchId === null || rule.branchId === ctx.branchId)
        && ctx.value >= rule.valueThreshold)
        .sort((a, b) => specificity(b) - specificity(a));
    return triggered[0] ?? null;
}
/**
 * Checks whether `triggerType` is gated for this value/branch, and if so,
 * reuses an existing pending/approved request or opens a new one. Never
 * throws (a rule-engine failure must not block the underlying action from
 * at least attempting its normal path) - returns `{ blocked: false }` on
 * any internal error, same fail-open posture as ToleranceRule/Exception
 * Inbox best-effort helpers elsewhere in this app.
 */
async function checkApprovalGate(input) {
    try {
        const rules = await db_js_1.prisma.approvalRule.findMany({ where: { triggerType: input.triggerType, active: true } });
        const matched = findTriggeredRule(rules, { category: input.category ?? null, branchId: input.branchId, value: input.value });
        if (!matched)
            return { blocked: false };
        const existingApproved = await db_js_1.prisma.approvalRequest.findFirst({
            where: { entityType: input.entityType, entityId: input.entityId, ruleId: matched.id, status: 'APPROVED' },
        });
        if (existingApproved)
            return { blocked: false };
        const existingPending = await db_js_1.prisma.approvalRequest.findFirst({
            where: { entityType: input.entityType, entityId: input.entityId, ruleId: matched.id, status: 'PENDING' },
        });
        if (existingPending) {
            return { blocked: true, requestId: existingPending.id, status: 'PENDING', reason: `Awaiting ${matched.requiredApproverRole} approval ("${matched.label}").`, requiredApproverRole: matched.requiredApproverRole };
        }
        const created = await db_js_1.prisma.approvalRequest.create({
            data: {
                ruleId: matched.id, triggerType: input.triggerType, entityType: input.entityType, entityId: input.entityId,
                valueAtStake: input.value, requestedById: input.requestedById,
            },
        });
        await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
            actorId: input.requestedById, actorRole: 'SYSTEM', action: 'APPROVAL_REQUESTED',
            entityType: input.entityType, entityId: input.entityId,
            metadata: { ruleId: matched.id, ruleLabel: matched.label, value: input.value, requiredApproverRole: matched.requiredApproverRole },
        }));
        return { blocked: true, requestId: created.id, status: 'PENDING', reason: `Requires ${matched.requiredApproverRole} approval - value ₹${input.value.toFixed(0)} exceeds the "${matched.label}" threshold.`, requiredApproverRole: matched.requiredApproverRole };
    }
    catch (error) {
        console.error('checkApprovalGate failed (fail-open, non-blocking):', error instanceof Error ? error.message : error);
        return { blocked: false };
    }
}
async function decideApprovalRequest(requestId, deciderId, deciderRole, decision, notes) {
    const request = await db_js_1.prisma.approvalRequest.findUnique({ where: { id: requestId }, include: { rule: true } });
    if (!request)
        throw new Error('Approval request was not found.');
    if (request.status !== 'PENDING')
        throw new Error(`This request is already ${request.status}.`);
    if (!roleMeetsRequirement(deciderRole, request.rule.requiredApproverRole)) {
        throw new Error(`Only a ${request.rule.requiredApproverRole} or higher can decide this request.`);
    }
    const updated = await db_js_1.prisma.approvalRequest.update({
        where: { id: requestId },
        data: { status: decision, decidedById: deciderId, decidedAt: new Date(), decisionNotes: notes ?? null },
    });
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
        actorId: deciderId, actorRole: deciderRole, action: `APPROVAL_${decision}`,
        entityType: request.entityType, entityId: request.entityId,
        metadata: { requestId, ruleId: request.ruleId, notes: notes ?? undefined },
    }));
    return updated;
}
