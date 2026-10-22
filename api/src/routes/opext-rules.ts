// Approval/tolerance/evidence rules + approval-request routes for
// operations-extension (Phase 4): extracted verbatim from
// operations-extension.ts; the composer mounts this router at the
// cluster's original registration position.
import { thresholdsAsNumbers } from '../lib/decimal-json.js';
import { type Request, Router } from 'express';
import { prisma } from '../lib/db.js';
import { decideApprovalRequest } from '../lib/approval-rules.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { requireAdmin } from './opext-shared.js';

const router = Router();

// ============================================================================
// APPROVAL RULES + REQUESTS (blueprint section 16.2)
// ============================================================================

// Approval, tolerance and evidence rules may be limited to a branch, and every response joins that branch's name. A
// branch of another company must therefore look exactly like a missing one (404), or a rule could be used to read
// another company's branch names.
async function branchMissingInCompany(req: Request, branchId: unknown): Promise<boolean> {
  if (typeof branchId !== 'string' || !branchId) return false;
  const owned = await prisma.branch.findFirst({ where: { id: branchId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true } }).catch(() => null);
  return !owned;
}

router.get('/approval-rules', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const rules = await prisma.approvalRule.findMany({
    where: { createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ rules: rules.map(thresholdsAsNumbers) });
});

router.post('/approval-rules', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const triggerType = typeof req.body.triggerType === 'string' ? req.body.triggerType.trim() : '';
  const valueThreshold = Number(req.body.valueThreshold);
  const requiredApproverRole = typeof req.body.requiredApproverRole === 'string' ? req.body.requiredApproverRole : '';
  if (!label || !triggerType || !Number.isFinite(valueThreshold) || valueThreshold <= 0 || !requiredApproverRole) {
    return res.status(400).json({ message: 'label, triggerType, a positive valueThreshold and requiredApproverRole are required.' });
  }
  if (await branchMissingInCompany(req, req.body.branchId)) return res.status(404).json({ message: 'Branch not found.' });
  try {
    const rule = await prisma.approvalRule.create({
      data: { label, triggerType, valueThreshold, requiredApproverRole, branchId: req.body.branchId || null, createdById: req.user!.id },
      include: { branch: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ rule: thresholdsAsNumbers(rule) });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Approval rules are not available on this database yet.' });
  }
});

router.patch('/approval-rules/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data: Record<string, unknown> = {};
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body.label !== undefined) data.label = String(req.body.label).trim();
  if (req.body.branchId !== undefined) data.branchId = req.body.branchId || null;
  if (req.body.valueThreshold !== undefined) data.valueThreshold = Number(req.body.valueThreshold);
  if (req.body.requiredApproverRole !== undefined) data.requiredApproverRole = req.body.requiredApproverRole;
  if (req.body.branchId !== undefined && await branchMissingInCompany(req, req.body.branchId)) return res.status(404).json({ message: 'Branch not found.' });
  const ownedApprovalRule = await prisma.approvalRule.findFirst({ where: { id: req.params.id, createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } }).catch(() => null);
  const rule = ownedApprovalRule ? await prisma.approvalRule.update({ where: { id: ownedApprovalRule.id }, data, include: { branch: { select: { id: true, name: true } } } }).catch(() => null) : null;
  if (!rule) return res.status(404).json({ message: 'Approval rule not found.' });
  return res.json({ rule: thresholdsAsNumbers(rule) });
});

router.get('/approval-requests', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
  const requests = await prisma.approvalRequest.findMany({
    where: { requestedBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, ...(status === 'all' ? {} : { status }) },
    include: {
      rule: { select: { id: true, label: true, requiredApproverRole: true } },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => []);
  // valueAtStake is a Decimal column (docs/decimal-migration-plan.md) - JSON.stringify would
  // otherwise serialize it as a string (Prisma.Decimal's toJSON), silently changing the API
  // contract for every existing consumer that expects a number.
  return res.json({ requests: requests.map((request) => ({ ...request, valueAtStake: Number(request.valueAtStake) })) });
});

router.post('/approval-requests/:id/decide', async (req, res) => {
  const decision = req.body.decision === 'APPROVED' || req.body.decision === 'REJECTED' ? req.body.decision : null;
  if (!decision) return res.status(400).json({ message: 'decision must be APPROVED or REJECTED.' });
  try {
    const request = await decideApprovalRequest(req.params.id, req.user!.id, req.user!.role, decision, req.body.notes || null, req.companyId ?? DEFAULT_COMPANY_ID);
    // valueAtStake is Decimal (docs/decimal-migration-plan.md) - see the same note on GET /approval-requests.
    return res.json({ request: { ...request, valueAtStake: Number(request.valueAtStake) } });
  } catch (error) {
    return res.status(error instanceof Error && error.message.includes('Only a') ? 403 : 409).json({ message: error instanceof Error ? error.message : 'Unable to decide approval request.' });
  }
});

// ============================================================================
// COUNT TOLERANCE RULES (blueprint Module D / section 10.2)
// ============================================================================

router.get('/tolerance-rules', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const rules = await prisma.toleranceRule.findMany({
    where: { createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
    include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ rules: rules.map(thresholdsAsNumbers) });
});

router.post('/tolerance-rules', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const valueThreshold = req.body.valueThreshold !== undefined && req.body.valueThreshold !== '' ? Number(req.body.valueThreshold) : null;
  const percentThreshold = req.body.percentThreshold !== undefined && req.body.percentThreshold !== '' ? Number(req.body.percentThreshold) : null;
  if (!label || (valueThreshold === null && percentThreshold === null)) {
    return res.status(400).json({ message: 'label and at least one of valueThreshold/percentThreshold are required.' });
  }
  if (await branchMissingInCompany(req, req.body.branchId)) return res.status(404).json({ message: 'Branch not found.' });
  try {
    const rule = await prisma.toleranceRule.create({
      data: {
        label, valueThreshold, percentThreshold,
        category: req.body.category || null,
        branchId: req.body.branchId || null,
        createdById: req.user!.id,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ rule: thresholdsAsNumbers(rule) });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Tolerance rules are not available on this database yet.' });
  }
});

router.patch('/tolerance-rules/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data: Record<string, unknown> = {};
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body.label !== undefined) data.label = String(req.body.label).trim();
  if (req.body.category !== undefined) data.category = req.body.category || null;
  if (req.body.branchId !== undefined) data.branchId = req.body.branchId || null;
  if (req.body.valueThreshold !== undefined) data.valueThreshold = req.body.valueThreshold === '' || req.body.valueThreshold === null ? null : Number(req.body.valueThreshold);
  if (req.body.percentThreshold !== undefined) data.percentThreshold = req.body.percentThreshold === '' || req.body.percentThreshold === null ? null : Number(req.body.percentThreshold);
  if (req.body.branchId !== undefined && await branchMissingInCompany(req, req.body.branchId)) return res.status(404).json({ message: 'Branch not found.' });
  const ownedToleranceRule = await prisma.toleranceRule.findFirst({ where: { id: req.params.id, createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } }).catch(() => null);
  const rule = ownedToleranceRule ? await prisma.toleranceRule.update({ where: { id: ownedToleranceRule.id }, data, include: { branch: { select: { id: true, name: true } } } }).catch(() => null) : null;
  if (!rule) return res.status(404).json({ message: 'Tolerance rule not found.' });
  return res.json({ rule: thresholdsAsNumbers(rule) });
});

// ============================================================================
// EVIDENCE RULES (blueprint section 16.2, "damaged receipt > threshold ->
// photo mandatory")
// ============================================================================

router.get('/evidence-rules', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const rules = await prisma.evidenceRule.findMany({
    where: { createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
    include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ rules: rules.map(thresholdsAsNumbers) });
});

router.post('/evidence-rules', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const triggerType = typeof req.body.triggerType === 'string' ? req.body.triggerType.trim() : '';
  const quantityThreshold = req.body.quantityThreshold !== undefined && req.body.quantityThreshold !== '' ? Number(req.body.quantityThreshold) : null;
  const valueThreshold = req.body.valueThreshold !== undefined && req.body.valueThreshold !== '' ? Number(req.body.valueThreshold) : null;
  if (!label || !triggerType || (quantityThreshold === null && valueThreshold === null)) {
    return res.status(400).json({ message: 'label, triggerType and at least one of quantityThreshold/valueThreshold are required.' });
  }
  if (await branchMissingInCompany(req, req.body.branchId)) return res.status(404).json({ message: 'Branch not found.' });
  try {
    const rule = await prisma.evidenceRule.create({
      data: {
        label, triggerType, quantityThreshold, valueThreshold,
        category: req.body.category || null,
        branchId: req.body.branchId || null,
        createdById: req.user!.id,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ rule: thresholdsAsNumbers(rule) });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Evidence rules are not available on this database yet.' });
  }
});

router.patch('/evidence-rules/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data: Record<string, unknown> = {};
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body.label !== undefined) data.label = String(req.body.label).trim();
  if (req.body.category !== undefined) data.category = req.body.category || null;
  if (req.body.branchId !== undefined) data.branchId = req.body.branchId || null;
  if (req.body.quantityThreshold !== undefined) data.quantityThreshold = req.body.quantityThreshold === '' || req.body.quantityThreshold === null ? null : Number(req.body.quantityThreshold);
  if (req.body.valueThreshold !== undefined) data.valueThreshold = req.body.valueThreshold === '' || req.body.valueThreshold === null ? null : Number(req.body.valueThreshold);
  if (req.body.branchId !== undefined && await branchMissingInCompany(req, req.body.branchId)) return res.status(404).json({ message: 'Branch not found.' });
  const ownedEvidenceRule = await prisma.evidenceRule.findFirst({ where: { id: req.params.id, createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } }).catch(() => null);
  const rule = ownedEvidenceRule ? await prisma.evidenceRule.update({ where: { id: ownedEvidenceRule.id }, data, include: { branch: { select: { id: true, name: true } } } }).catch(() => null) : null;
  if (!rule) return res.status(404).json({ message: 'Evidence rule not found.' });
  return res.json({ rule: thresholdsAsNumbers(rule) });
});

export default router;
