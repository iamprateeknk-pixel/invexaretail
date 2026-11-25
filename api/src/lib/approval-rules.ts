import { prisma, resolveDatabaseUrl } from './db.js';
import { DomainError } from './errors.js';
import { thresholdsAsNumbers } from './decimal-json.js';
import { recordAudit } from './audit.js';
import { databaseEnabled, persistAudit } from './persistence.js';

// Blueprint section 16.2 (Workflow Builder): "transfer > ₹1 lakh -> regional
// manager approval." Distinct from ToleranceRule (count-tolerance.ts),
// which only ever recommends: an ApprovalRule genuinely gates the
// triggering action until a sufficiently-privileged user decides.

// Higher rank can always satisfy a lower role's approval requirement.
const ROLE_RANK: Record<string, number> = { ADMIN: 4, ADMIN_USER: 3, BRANCH_MANAGER: 2, AUDITOR: 1, STORE_USER: 1, WAREHOUSE_PICKER: 1 };

export function roleMeetsRequirement(role: string, requiredRole: string): boolean {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[requiredRole] ?? Infinity);
}

export type ApprovalRuleLike = { id: string; category: string | null; branchId: string | null; valueThreshold: number; requiredApproverRole: string };

/** Pure: most specific (category/branch-scoped beats global) matching rule whose threshold the value crosses - same shape as ToleranceRule's evaluateTolerance(). */
export function findTriggeredRule<T extends ApprovalRuleLike>(rules: T[], ctx: { category: string | null; branchId: string | null; value: number }): T | null {
  const specificity = (rule: T) => Number(rule.category !== null) + Number(rule.branchId !== null);
  const triggered = rules
    .filter((rule) =>
      (rule.category === null || rule.category === ctx.category)
      && (rule.branchId === null || rule.branchId === ctx.branchId)
      && ctx.value >= rule.valueThreshold)
    .sort((a, b) => specificity(b) - specificity(a));
  return triggered[0] ?? null;
}

export type GateResult =
  | { blocked: false }
  | { blocked: true; requestId: string; status: 'PENDING'; reason: string; requiredApproverRole: string };

/**
 * Checks whether `triggerType` is gated for this value/branch, and if so,
 * reuses an existing pending/approved request or opens a new one.
 * A configured policy store must be available before the command can proceed.
 */
export async function checkApprovalGate(input: {
  triggerType: string;
  entityType: string;
  entityId: string;
  category?: string | null;
  branchId?: string | null;
  locationId?: string;
  value: number | (() => Promise<number>);
  requestedById: string;
  /** Only this company's rules apply; another company's thresholds must never gate this one. */
  companyId: string;
}): Promise<GateResult> {
  if (!databaseEnabled && !resolveDatabaseUrl() && process.env.REQUIRE_DATABASE !== 'true') {
    return { blocked: false };
  }
  try {
    const rules = await prisma.approvalRule.findMany({ where: { triggerType: input.triggerType, active: true, createdBy: { companyId: input.companyId } } });
    if (rules.length === 0) return { blocked: false };

    let branchId = input.branchId ?? null;
    if (input.locationId && rules.some((rule) => rule.branchId !== null)) {
      const location = await prisma.location.findFirstOrThrow({
        where: { id: input.locationId, companyId: input.companyId }, select: { branchId: true },
      });
      branchId = location.branchId;
    }
    const value = typeof input.value === 'function' ? await input.value() : input.value;
    if (!Number.isFinite(value)) throw new Error('Invalid approval value');
    const matched = findTriggeredRule(rules.map(thresholdsAsNumbers), { category: input.category ?? null, branchId, value });
    if (!matched) return { blocked: false };

    const existingApproved = await prisma.approvalRequest.findFirst({
      where: { entityType: input.entityType, entityId: input.entityId, ruleId: matched.id, status: 'APPROVED' },
    });
    if (existingApproved) return { blocked: false };

    const existingPending = await prisma.approvalRequest.findFirst({
      where: { entityType: input.entityType, entityId: input.entityId, ruleId: matched.id, status: 'PENDING' },
    });
    if (existingPending) {
      return { blocked: true, requestId: existingPending.id, status: 'PENDING', reason: `Awaiting ${matched.requiredApproverRole} approval ("${matched.label}").`, requiredApproverRole: matched.requiredApproverRole };
    }

    const created = await prisma.approvalRequest.create({
      data: {
        ruleId: matched.id, triggerType: input.triggerType, entityType: input.entityType, entityId: input.entityId,
        valueAtStake: value, requestedById: input.requestedById,
      },
    });
    await persistAudit(recordAudit({
      actorId: input.requestedById, actorRole: 'SYSTEM', action: 'APPROVAL_REQUESTED',
      entityType: input.entityType, entityId: input.entityId,
      metadata: { ruleId: matched.id, ruleLabel: matched.label, value, requiredApproverRole: matched.requiredApproverRole },
    }));
    return { blocked: true, requestId: created.id, status: 'PENDING', reason: `Requires ${matched.requiredApproverRole} approval - value ₹${value.toFixed(0)} exceeds the "${matched.label}" threshold.`, requiredApproverRole: matched.requiredApproverRole };
  } catch (error) {
    const unavailable = new DomainError('APPROVAL_UNAVAILABLE', 'Approval could not be verified. Retry when the service is available.');
    console.error('Approval policy evaluation failed', {
      triggerType: input.triggerType, traceId: unavailable.traceId, errorType: error instanceof Error ? error.name : 'Unknown',
    });
    throw unavailable;
  }
}

export async function decideApprovalRequest(requestId: string, deciderId: string, deciderRole: string, decision: 'APPROVED' | 'REJECTED', notes: string | null | undefined, companyId: string) {
  // A request of another company is indistinguishable from a missing one.
  const request = await prisma.approvalRequest.findFirst({ where: { id: requestId, requestedBy: { companyId } }, include: { rule: true } });
  if (!request) throw new Error('Approval request was not found.');
  if (request.status !== 'PENDING') throw new Error(`This request is already ${request.status}.`);
  if (!roleMeetsRequirement(deciderRole, request.rule.requiredApproverRole)) {
    throw new Error(`Only a ${request.rule.requiredApproverRole} or higher can decide this request.`);
  }
  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: decision, decidedById: deciderId, decidedAt: new Date(), decisionNotes: notes ?? null },
  });
  await persistAudit(recordAudit({
    actorId: deciderId, actorRole: deciderRole, action: `APPROVAL_${decision}`,
    entityType: request.entityType, entityId: request.entityId,
    metadata: { requestId, ruleId: request.ruleId, notes: notes ?? undefined },
  }));
  return updated;
}
