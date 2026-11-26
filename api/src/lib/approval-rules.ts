import { createHash } from 'node:crypto';
import { prisma, resolveDatabaseUrl } from './db.js';
import { DomainError } from './errors.js';
import { thresholdsAsNumbers } from './decimal-json.js';
import { rememberPersistedAudit } from './audit.js';
import { databaseEnabled } from './persistence.js';
import { publishedWorkflowApprovals, storedWorkflowApproval, STUDIO_APPROVAL_SNAPSHOT_TRIGGER, usesStudioApproval, type StudioApprovalPolicy } from './saas/workflow-approval-policy.js';
import { matchingLiveStudioRules, publishedLiveStudioRules } from './saas/live-studio-rules.js';

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

type IntentValue = string | number | boolean | null | readonly IntentValue[];

export function approvalIntentFingerprint(parts: readonly IntentValue[]): string {
  return createHash('sha256').update(JSON.stringify(['approval-v1', ...parts])).digest('hex');
}

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
  /** Normalized data the command would post. Use arrays in stable order. */
  intent: readonly IntentValue[];
  requestedById: string;
  /** Only this company's rules apply; another company's thresholds must never gate this one. */
  companyId: string;
}): Promise<GateResult> {
  if (!databaseEnabled && !resolveDatabaseUrl() && process.env.REQUIRE_DATABASE !== 'true') {
    return { blocked: false };
  }
  try {
    const [rules, published] = await Promise.all([
      prisma.approvalRule.findMany({ where: { triggerType: input.triggerType, active: true, createdBy: { companyId: input.companyId } } }),
      usesStudioApproval(input.triggerType) ? prisma.controlPlaneConfig.findFirst({
        where: { companyId: input.companyId, kind: 'published', status: 'published' },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
        select: { version: true, versionId: true, payload: true },
      }) : null,
    ]);
    const workflowPolicies = publishedWorkflowApprovals(published?.payload, input.triggerType);
    const studioRules = publishedLiveStudioRules(published?.payload, input.triggerType);
    if (rules.length === 0 && workflowPolicies.length === 0 && !studioRules.length) return { blocked: false };

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
    const matchingRules = matchingLiveStudioRules(studioRules, input.triggerType, value);
    const stop = matchingRules.find((rule) => rule.outcome.action === 'BLOCK');
    if (stop && published) {
      const auditId = approvalIntentFingerprint(['studio-block', input.companyId, input.requestedById, input.triggerType,
        input.entityId, published.versionId, stop.key, value, input.intent]);
      await prisma.auditLog.upsert({ where: { id: auditId }, update: {}, create: {
        id: auditId, actorId: input.requestedById, actorRole: 'SYSTEM', action: 'STUDIO_RULE_BLOCKED',
        entityType: input.entityType, entityId: input.entityId, metadata: { ruleKey: stop.key, version: published.version, value },
      } });
      throw new DomainError('STUDIO_RULE_BLOCKED', `The published Studio rule “${stop.name}” stopped this command.`);
    }
    const ruleApprovals = matchingRules.flatMap<StudioApprovalPolicy>((rule) => {
      const role = rule.outcome.requireApproval;
      return role === 'ADMIN' || role === 'BRANCH_MANAGER' ? [{
        workflowKey: `rule:${rule.key}`, label: rule.name, triggerType: input.triggerType, threshold: 0, requiredApproverRole: role,
      }] : [];
    });
    const triggered = [...workflowPolicies.filter((policy) => value > policy.threshold), ...ruleApprovals]
      .sort((a, b) => ROLE_RANK[b.requiredApproverRole] - ROLE_RANK[a.requiredApproverRole] || a.workflowKey.localeCompare(b.workflowKey));
    const strongest = triggered[0];
    if (!matched && !strongest) return { blocked: false };
    const useStudio = strongest && published && (!matched || roleMeetsRequirement(strongest.requiredApproverRole, matched.requiredApproverRole));
    const workflowPolicy = useStudio ? { ...strongest, configVersion: published.version, versionId: published.versionId, locationId: input.locationId ?? null } : null;
    const requiredApproverRole = workflowPolicy?.requiredApproverRole ?? matched!.requiredApproverRole;
    const label = workflowPolicy?.label ?? matched!.label;

    const intentFingerprint = approvalIntentFingerprint([
      input.companyId, input.requestedById, input.triggerType, input.entityType, input.entityId,
      input.locationId ?? null, input.category ?? null, branchId, value,
      matched?.id ?? null, matched?.category ?? null, matched?.branchId ?? null, matched?.valueThreshold ?? null, matched?.requiredApproverRole ?? null,
      input.intent,
      ...(triggered.length && published ? [published.versionId, triggered.map((policy) => [policy.workflowKey, policy.threshold, policy.requiredApproverRole])] : []),
    ]);
    const ruleId = workflowPolicy ? `studio-snapshot:${intentFingerprint}` : matched!.id;
    const metadata = { ruleId, ruleLabel: label, value, requiredApproverRole, ...(workflowPolicy ? { workflowPolicy } : {}) };
    const { request, audit } = await prisma.$transaction(async (tx) => {
      // Serialize identical requests across API replicas while retaining rejected rows for history.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${intentFingerprint}, 0))`;
      const existing = await tx.approvalRequest.findFirst({
        where: { intentFingerprint, requestedById: input.requestedById, status: { in: ['APPROVED', 'PENDING'] } },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      if (existing) return { request: existing, audit: null };
      if (workflowPolicy) {
        // The inactive row keeps the required legacy relation during an application rollback.
        await tx.approvalRule.upsert({
          where: { id: ruleId }, update: {}, create: {
            id: ruleId, label, triggerType: STUDIO_APPROVAL_SNAPSHOT_TRIGGER, active: false,
            valueThreshold: workflowPolicy.threshold, requiredApproverRole, createdById: input.requestedById,
          },
        });
      }
      const request = await tx.approvalRequest.create({
        data: {
          ruleId, ...(workflowPolicy ? { workflowPolicy } : {}), triggerType: input.triggerType, entityType: input.entityType, entityId: input.entityId,
          valueAtStake: value, requestedById: input.requestedById, intentFingerprint,
        },
      });
      const audit = await tx.auditLog.create({
        data: {
          actorId: input.requestedById, actorRole: 'SYSTEM', action: 'APPROVAL_REQUESTED',
          entityType: input.entityType, entityId: input.entityId, metadata: { ...metadata, requestId: request.id },
        },
      });
      return { request, audit };
    });
    if (request.status === 'APPROVED') return { blocked: false };
    if (audit) {
      rememberPersistedAudit({ ...audit, metadata: { ...metadata, requestId: request.id }, createdAt: audit.createdAt.toISOString() });
    }
    return { blocked: true, requestId: request.id, status: 'PENDING', reason: `Awaiting ${requiredApproverRole} approval ("${label}").`, requiredApproverRole };
  } catch (error) {
    if (error instanceof DomainError && error.code === 'STUDIO_RULE_BLOCKED') throw error;
    const unavailable = new DomainError('APPROVAL_UNAVAILABLE', 'Approval could not be verified. Retry when the service is available.');
    console.error('Approval policy evaluation failed', {
      triggerType: input.triggerType, traceId: unavailable.traceId, errorType: error instanceof Error ? error.name : 'Unknown',
    });
    throw unavailable;
  }
}

export function assertApprovalReviewer(deciderId: string, deciderRole: string, requesterId: string, requiredRole: string): void {
  if (deciderId === requesterId) {
    throw new DomainError('SELF_REVIEW', 'A different reviewer must decide this approval request.');
  }
  if (!roleMeetsRequirement(deciderRole, requiredRole)) {
    throw new DomainError('FORBIDDEN', `Only a ${requiredRole} or higher can decide this request.`);
  }
}

export async function decideApprovalRequest(requestId: string, deciderId: string, deciderRole: string, decision: 'APPROVED' | 'REJECTED', notes: string | null | undefined, companyId: string, assignedLocations: readonly string[] = []) {
  const { updated, audit, metadata } = await prisma.$transaction(async (tx) => {
    // A request of another company is indistinguishable from a missing one.
    const scope = { id: requestId, requestedBy: { companyId }, rule: { createdBy: { companyId } } };
    const request = await tx.approvalRequest.findFirst({ where: scope, include: { rule: true } });
    if (!request) throw new DomainError('CONFLICT', 'Approval request was not found.');
    const workflowPolicy = storedWorkflowApproval(request.workflowPolicy);
    if (workflowPolicy && deciderRole === 'BRANCH_MANAGER' &&
        (!workflowPolicy.locationId || !assignedLocations.includes(workflowPolicy.locationId))) {
      throw new DomainError('CONFLICT', 'Approval request was not found.');
    }
    if (request.status !== 'PENDING') throw new DomainError('CONFLICT', `This request is already ${request.status}.`);
    if (request.rule.triggerType === STUDIO_APPROVAL_SNAPSHOT_TRIGGER && !workflowPolicy) {
      throw new DomainError('CONFLICT', 'The approval policy for this request is unavailable.');
    }
    const requiredRole = workflowPolicy?.requiredApproverRole ?? request.rule.requiredApproverRole;
    assertApprovalReviewer(deciderId, deciderRole, request.requestedById, requiredRole);

    const decidedAt = new Date();
    const [updated] = await tx.approvalRequest.updateManyAndReturn({
      where: {
        ...scope, status: 'PENDING', requestedById: request.requestedById, ruleId: request.ruleId,
        ...(workflowPolicy ? {} : { rule: { ...scope.rule, requiredApproverRole: requiredRole } }),
      },
      data: { status: decision, decidedById: deciderId, decidedAt, decisionNotes: notes ?? null },
    });
    if (!updated) throw new DomainError('CONFLICT', 'The approval request or its rule has changed. Refresh to see the current state.');

    const metadata = { requestId, ruleId: request.ruleId, ...(workflowPolicy ? { workflowPolicy } : {}), ...(notes ? { notes } : {}) };
    const audit = await tx.auditLog.create({
      data: {
        actorId: deciderId, actorRole: deciderRole, action: `APPROVAL_${decision}`,
        entityType: request.entityType, entityId: request.entityId, metadata, createdAt: decidedAt,
      },
    });
    return { updated, audit, metadata };
  });
  rememberPersistedAudit({ ...audit, metadata, createdAt: audit.createdAt.toISOString() });
  return updated;
}
