// QC templates/inspections + exception-inbox routes for
// operations-extension (Phase 4): extracted verbatim from
// operations-extension.ts; the composer mounts this router at the
// cluster's original registration position.
import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { persistAudit } from '../lib/persistence.js';
import { createExceptionCase, applyExceptionDisposition, serializeExceptionCase } from '../lib/exceptions.js';
import { recordQcInspection, DEFAULT_QC_CHECKS, type QcCheckResult, listMemoryQcTemplates, listMemoryQcInspections, createMemoryQcTemplate, patchMemoryQcTemplate } from '../lib/qc-inspection.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { canAccessLocation, requireAdmin } from './opext-shared.js';

const router = Router();

// ============================================================================
// QC CHECKLIST (blueprint §8.2 - seal/packaging/weight/moisture/expiry-
// window checks, replacing a free-text exception description)
// ============================================================================

router.get('/qc-templates', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const templates = await prisma.qcChecklistTemplate.findMany({
    where: { createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ templates: templates.length ? templates : listMemoryQcTemplates() });
});

router.post('/qc-templates', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const checks = Array.isArray(req.body.checks)
    ? req.body.checks.map((check: any) => ({ key: String(check.key ?? '').trim(), label: String(check.label ?? '').trim() })).filter((check: any) => check.key && check.label)
    : DEFAULT_QC_CHECKS;
  if (!label || !checks.length) return res.status(400).json({ message: 'label and at least one check are required.' });
  try {
    const template = await prisma.qcChecklistTemplate.create({
      data: { label, category: req.body.category || null, checks, createdById: req.user!.id },
    });
    return res.status(201).json({ template });
  } catch {
    const template = createMemoryQcTemplate({
      label, category: req.body.category || null, checks, createdById: req.user!.id,
    });
    return res.status(201).json({ template });
  }
});

router.patch('/qc-templates/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data: Record<string, unknown> = {};
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body.label !== undefined) data.label = String(req.body.label).trim();
  if (req.body.category !== undefined) data.category = req.body.category || null;
  if (Array.isArray(req.body.checks)) data.checks = req.body.checks;
  const ownedTemplate = await prisma.qcChecklistTemplate.findFirst({ where: { id: req.params.id, createdBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } }).catch(() => null);
  const template = ownedTemplate ? await prisma.qcChecklistTemplate.update({ where: { id: ownedTemplate.id }, data }).catch(() => null) : null;
  if (template) return res.json({ template });
  const memory = patchMemoryQcTemplate(req.params.id, {
    active: data.active as boolean | undefined,
    label: data.label as string | undefined,
    category: (data.category as string | null | undefined),
    checks: Array.isArray(data.checks) ? data.checks as Array<{ key: string; label: string }> : undefined,
  });
  if (!memory) return res.status(404).json({ message: 'QC checklist template not found.' });
  return res.json({ template: memory });
});

router.get('/qc-inspections', async (req, res) => {
  const sourceDocument = typeof req.query.sourceDocument === 'string' ? req.query.sourceDocument : undefined;
  const sourceLineId = typeof req.query.sourceLineId === 'string' ? req.query.sourceLineId : undefined;
  const inspections = await prisma.qcInspection.findMany({
    where: { inspectedBy: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, ...(sourceDocument ? { sourceDocument } : {}), ...(sourceLineId ? { sourceLineId } : {}) },
    include: {
      template: { select: { id: true, label: true } },
      item: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNo: true } },
      inspectedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => []);
  const memory = listMemoryQcInspections().filter((row) =>
    (!sourceDocument || row.sourceDocument === sourceDocument) && (!sourceLineId || row.sourceLineId === sourceLineId),
  );
  return res.json({ inspections: inspections.length ? inspections : memory });
});

router.post('/qc-inspections', async (req, res) => {
  const results: Record<string, QcCheckResult> = {};
  if (req.body.results && typeof req.body.results === 'object') {
    for (const [key, value] of Object.entries(req.body.results)) {
      if (value === 'PASS' || value === 'FAIL' || value === 'NA') results[key] = value;
    }
  }
  if (!Object.keys(results).length) return res.status(400).json({ message: 'At least one checklist result is required.' });
  // The inspection is stored under the caller's company but GET /qc-inspections joins its template and lot. Both must belong
  // to the caller's company (another company's id looks like a missing one). A database that is not reachable is not a
  // reason to refuse: only a query that ran and found nothing rejects.
  const qcCompanyId = req.companyId ?? DEFAULT_COMPANY_ID;
  if (req.body.templateId) {
    const found = await prisma.qcChecklistTemplate.findFirst({ where: { id: String(req.body.templateId), createdBy: { companyId: qcCompanyId } }, select: { id: true } }).then((row) => ({ ran: true, row }), () => ({ ran: false, row: null }));
    if (found.ran && !found.row) return res.status(404).json({ message: 'QC checklist template not found.' });
  }
  if (req.body.lotId) {
    const found = await prisma.lot.findFirst({ where: { id: String(req.body.lotId), item: { companyId: qcCompanyId } }, select: { id: true } }).then((row) => ({ ran: true, row }), () => ({ ran: false, row: null }));
    if (found.ran && !found.row) return res.status(404).json({ message: 'Lot not found.' });
  }
  try {
    let itemCategory: string | null = null;
    if (req.body.itemId) {
      const item = await prisma.item.findFirst({ where: { id: String(req.body.itemId), companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { category: true } });
      itemCategory = item?.category ?? null;
    }
    let branchId: string | null = null;
    if (req.body.locationId) {
      const location = await prisma.location.findUnique({ where: { id: String(req.body.locationId) }, select: { branchId: true } });
      branchId = location?.branchId ?? null;
    }
    const { inspection, exceptionCase } = await recordQcInspection({
      templateId: req.body.templateId || null,
      itemId: req.body.itemId || null,
      itemCategory,
      lotId: req.body.lotId || null,
      locationId: req.body.locationId || null,
      branchId,
      sourceDocument: req.body.sourceDocument || null,
      sourceLineId: req.body.sourceLineId || null,
      results,
      notes: req.body.notes || null,
      inspectedById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    });
    return res.status(201).json({ inspection, exceptionCase });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'QC inspections are not available on this database yet.' });
  }
});

// ============================================================================
// EXCEPTION INBOX (blueprint Module H + section 18)
// ============================================================================

const EXCEPTION_TYPES = ['DAMAGE', 'SHORT_RECEIPT', 'EXCESS_RECEIPT', 'WRONG_ITEM', 'EXPIRED', 'MISSING_STOCK', 'QC_FAIL', 'TRANSFER_DISCREPANCY', 'COUNT_VARIANCE', 'QUARANTINE'];
const EXCEPTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED', 'REJECTED'];
const EXCEPTION_DISPOSITIONS = ['RESTOCK', 'VENDOR_RETURN', 'MARKDOWN', 'DESTROY', 'REWORK', 'WRITE_OFF', 'ACCEPT', 'RECOUNT', 'ESCALATE', 'NONE'];
const EXCEPTION_MANAGER_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'];

/**
 * An exception case may point at an item, a lot and an owner. Each must belong to the caller's company: another
 * company's id has to look exactly like a missing one (the message is the same either way). Returns the message
 * for the first reference that does not resolve inside the company, or null when every given one does.
 */
async function exceptionReferencesInCompany(companyId: string, refs: { itemId?: unknown; lotId?: unknown; ownerId?: unknown }): Promise<string | null> {
  const id = (value: unknown) => (typeof value === 'string' && value ? value : null);
  const itemId = id(refs.itemId);
  const lotId = id(refs.lotId);
  const ownerId = id(refs.ownerId);
  if (itemId && !(await prisma.item.findFirst({ where: { id: itemId, companyId }, select: { id: true } }))) return 'Item was not found.';
  if (lotId && !(await prisma.lot.findFirst({ where: { id: lotId, item: { companyId } }, select: { id: true } }))) return 'Lot was not found.';
  if (ownerId && !(await prisma.user.findFirst({ where: { id: ownerId, companyId }, select: { id: true } }))) return 'Owner was not found.';
  return null;
}

router.get('/exceptions', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const mine = req.query.mine === 'true';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });

  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const scope = mine
    ? { ownerId: req.user!.id }
    : EXCEPTION_MANAGER_ROLES.includes(req.user!.role) || req.user!.role === 'AUDITOR'
      ? (locationId ? { locationId } : {})
      : { locationId: { in: req.user!.locationIds ?? [] } };

  const cases = await prisma.exceptionCase.findMany({
    where: {
      companyId,
      ...scope,
      ...(status ? { status: status as never } : { status: { notIn: ['CLOSED', 'REJECTED'] as never } }),
      ...(type ? { type: type as never } : {}),
    },
    include: {
      item: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNo: true, expiryDate: true } },
      location: { select: { id: true, code: true, name: true } },
      owner: { select: { id: true, name: true, email: true } },
      reportedBy: { select: { id: true, name: true, email: true } },
    },
    // Highest business risk first: an unresolved critical case must never
    // be buried under a long list of low-value housekeeping cases.
    orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    take: 300,
  });
  return res.json({
    cases: cases.map(serializeExceptionCase),
    summary: {
      open: cases.filter((c) => c.status === 'OPEN').length,
      overdue: cases.filter((c) => c.dueAt && c.dueAt < new Date() && !['CLOSED', 'REJECTED', 'RESOLVED'].includes(c.status)).length,
      critical: cases.filter((c) => c.priority === 'CRITICAL' && !['CLOSED', 'REJECTED'].includes(c.status)).length,
    },
  });
});

router.post('/exceptions', async (req, res) => {
  const type = typeof req.body.type === 'string' ? req.body.type : '';
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!EXCEPTION_TYPES.includes(type) || !title) {
    return res.status(400).json({ message: `type (one of ${EXCEPTION_TYPES.join(', ')}) and title are required.` });
  }
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : null;
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const quantity = req.body.quantity !== undefined ? Number(req.body.quantity) : null;
  // The case is stored under the caller's company, but GET /exceptions joins the item, lot and owner it points at.
  // Anything named here that belongs to another company would therefore be readable through this company's case.
  const refCompanyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const refs = await exceptionReferencesInCompany(refCompanyId, { itemId: req.body.itemId, lotId: req.body.lotId, ownerId: req.body.ownerId });
  if (refs) return res.status(404).json({ message: refs });
  const exceptionCase = await createExceptionCase({
    type: type as never,
    title,
    description: typeof req.body.description === 'string' ? req.body.description.trim() : null,
    itemId: req.body.itemId || null,
    lotId: req.body.lotId || null,
    locationId,
    branchId: req.body.branchId || null,
    quantity: Number.isFinite(quantity) ? quantity : null,
    sourceDocument: req.body.sourceDocument || null,
    sourceLineId: req.body.sourceLineId || null,
    ownerId: req.body.ownerId || null,
    reportedById: req.user!.id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    dueHours: Number.isFinite(Number(req.body.dueHours)) ? Number(req.body.dueHours) : undefined,
  });
  if (!exceptionCase) return res.status(503).json({ message: 'Exception Inbox is not available on this database yet.' });
  return res.status(201).json({ case: exceptionCase });
});

router.patch('/exceptions/:id', async (req, res) => {
  const existing = await prisma.exceptionCase.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!existing) return res.status(404).json({ message: 'Exception case not found.' });
  const isManager = EXCEPTION_MANAGER_ROLES.includes(req.user!.role);
  const isOwner = existing.ownerId === req.user!.id;
  if (!isManager && !isOwner) return res.status(403).json({ message: 'You do not have access to this exception case.' });

  const data: Record<string, unknown> = {};
  if (isManager) {
    if (req.body.ownerId !== undefined) {
      const refs = await exceptionReferencesInCompany(req.companyId ?? DEFAULT_COMPANY_ID, { ownerId: req.body.ownerId });
      if (refs) return res.status(404).json({ message: refs });
      data.ownerId = req.body.ownerId || null;
    }
    if (req.body.priority !== undefined) {
      if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(req.body.priority)) return res.status(400).json({ message: 'Invalid priority.' });
      data.priority = req.body.priority;
    }
    if (req.body.dueAt !== undefined) data.dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
  }
  if (req.body.status !== undefined) {
    if (!EXCEPTION_STATUSES.includes(req.body.status)) return res.status(400).json({ message: 'Invalid status.' });
    data.status = req.body.status;
  }
  if (!Object.keys(data).length) return res.status(400).json({ message: 'No updatable fields were provided.' });

  const updated = await prisma.exceptionCase.update({ where: { id: existing.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, data });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role,
    action: 'EXCEPTION_UPDATED', entityType: 'ExceptionCase', entityId: existing.id, metadata: data,
  }));
  return res.json({ case: serializeExceptionCase(updated) });
});

router.post('/exceptions/:id/resolve', async (req, res) => {
  const existing = await prisma.exceptionCase.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!existing) return res.status(404).json({ message: 'Exception case not found.' });
  const isManager = EXCEPTION_MANAGER_ROLES.includes(req.user!.role);
  if (!isManager && existing.ownerId !== req.user!.id) return res.status(403).json({ message: 'You do not have access to resolve this exception case.' });
  const disposition = typeof req.body.disposition === 'string' ? req.body.disposition : '';
  if (!EXCEPTION_DISPOSITIONS.includes(disposition)) {
    return res.status(400).json({ message: `disposition must be one of ${EXCEPTION_DISPOSITIONS.join(', ')}.` });
  }
  if (['CLOSED', 'REJECTED'].includes(existing.status)) return res.status(409).json({ message: 'This exception case is already closed.' });
  const resolutionNotes = typeof req.body.resolutionNotes === 'string' ? req.body.resolutionNotes.trim().slice(0, 4000) : null;
  const now = new Date();
  await applyExceptionDisposition(existing, disposition as never, req.user!.id);
  const updated = await prisma.exceptionCase.update({
    where: { id: existing.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    data: { disposition: disposition as never, resolutionNotes, status: 'CLOSED', resolvedAt: now, closedAt: now },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role,
    action: 'EXCEPTION_RESOLVED', entityType: 'ExceptionCase', entityId: existing.id,
    metadata: { disposition, resolutionNotes: resolutionNotes ?? undefined },
  }));
  return res.json({ case: serializeExceptionCase(updated) });
});

export default router;
