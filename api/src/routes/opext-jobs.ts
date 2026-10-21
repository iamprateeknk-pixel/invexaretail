// Asset checkouts, jobs and lot-admin routes for operations-extension
// (Phase 4): extracted verbatim from operations-extension.ts; the
// composer mounts this router at the cluster's original position.
import { newDocumentNumber } from '../lib/document-number.js';
import { type Request, Router } from 'express';
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { ExpiryWriteOffError, setLotExpiryDate, setLotSaleStatus } from '../lib/expiry-lifecycle.js';
import { consumeJobLine, JobConsumeError } from '../lib/job-consumption-service.js';
import { getActiveWorkflow } from '../lib/industry-packs.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { adjustStockLedger, listItems, updateLotExpiry, updateLotStatus } from '../lib/repository.js';
import { DEFAULT_COMPANY_ID, ownerOfItem } from '../lib/saas/tenant-scope.js';
import { NegativeStockBlockedError } from '../lib/inventory-posting-service.js';
import { tenantContextOf, canAccessLocation, requireAdmin } from './opext-shared.js';

const router = Router();

router.get('/asset-checkouts', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  // P0-SEC-002: always company scoped. The admin/auditor branch used to resolve to an empty
  // where clause, which listed every company's checkouts.
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const where = locationId
    ? { companyId, locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? { companyId }
      : { companyId, locationId: { in: req.user!.locationIds ?? [] } };
  const checkouts = await prisma.assetCheckout.findMany({ where: { ...where, companyId }, orderBy: { checkedOutAt: 'desc' } });
  return res.json({ checkouts });
});

router.post('/asset-checkouts', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const quantity = Number(req.body.quantity ?? 1);
  if (!req.body.itemId || !req.body.locationId || !String(req.body.assigneeName || '').trim() || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ message: 'Item, location, assignee and positive quantity are required.' });
  }
  // The item and the location must both belong to the caller's company: a foreign id is
  // indistinguishable from a missing one.
  const checkoutCompany = req.companyId ?? DEFAULT_COMPANY_ID;
  const [ownedItem, ownedLocation] = await Promise.all([
    prisma.item.findFirst({ where: { id: String(req.body.itemId), companyId: checkoutCompany }, select: { id: true } }),
    prisma.location.findFirst({ where: { id: String(req.body.locationId), companyId: checkoutCompany }, select: { id: true } }),
  ]);
  if (!ownedItem || !ownedLocation) return res.status(404).json({ message: 'Item or location not found.' });
  if (!canAccessLocation(req, String(req.body.locationId))) return res.status(403).json({ message: 'Location access denied.' });
  const checkout = await prisma.assetCheckout.create({ data: {
    companyId: checkoutCompany,
    itemId: String(req.body.itemId),
    locationId: String(req.body.locationId),
    assigneeName: String(req.body.assigneeName).trim(),
    quantity,
    dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
    conditionOut: req.body.conditionOut || null,
    createdById: req.user!.id,
  } });
  return res.status(201).json({ checkout });
});

router.patch('/asset-checkouts/:id/return', async (req, res) => {
  const checkout = await prisma.assetCheckout.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!checkout) return res.status(404).json({ message: 'Checkout record not found.' });
  if (!canAccessLocation(req, checkout.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (checkout.status === 'RETURNED') return res.status(409).json({ message: 'This asset has already been returned.' });
  const updated = await prisma.assetCheckout.update({ where: { id: checkout.id, companyId: checkout.companyId }, data: {
    status: 'RETURNED', returnedAt: new Date(), conditionIn: req.body.conditionIn || null,
  } });
  return res.json({ checkout: updated });
});

// Jobs are company scoped (audit T-1): the list, every lookup and every write filter by the caller's
// company, and a job or line of another company resolves 404 exactly like a missing one.
const jobCompany = (req: Request) => req.companyId ?? DEFAULT_COMPANY_ID;

router.get('/jobs', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const scope = locationId
    ? { locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? {}
      : { locationId: { in: req.user!.locationIds ?? [] } };
  const jobs = await prisma.job.findMany({ where: { ...scope, companyId: jobCompany(req) }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  return res.json({ jobs });
});

router.post('/jobs', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || !req.body.locationId) return res.status(400).json({ message: 'Job name and location are required.' });
  const location = await prisma.location.findFirst({ where: { id: String(req.body.locationId), companyId: jobCompany(req) }, select: { id: true } });
  if (!location) return res.status(404).json({ message: 'Location not found.' });
  const job = await prisma.job.create({ data: {
    number: newDocumentNumber('JOB'),
    name,
    companyId: jobCompany(req),
    locationId: location.id,
    createdById: req.user!.id,
    dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
    notes: req.body.notes || null,
  }, include: { lines: true } });
  return res.status(201).json({ job });
});

router.post('/jobs/:id/lines', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const plannedQty = Number(req.body.plannedQty);
  if (!req.body.itemId || !Number.isInteger(plannedQty) || plannedQty < 1) return res.status(400).json({ message: 'Item and positive planned quantity are required.' });
  const job = await prisma.job.findFirst({ where: { id: req.params.id, companyId: jobCompany(req) }, select: { id: true } });
  if (!job) return res.status(404).json({ message: 'Job not found.' });
  const item = await prisma.item.findFirst({ where: { id: String(req.body.itemId), companyId: jobCompany(req) }, select: { id: true } });
  if (!item) return res.status(404).json({ message: 'Item not found.' });
  const line = await prisma.jobLine.create({ data: { jobId: job.id, itemId: item.id, plannedQty } });
  return res.status(201).json({ line });
});

router.patch('/jobs/:jobId/lines/:lineId', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Warehouse Picker access required.' });
  const job = await prisma.job.findFirst({ where: { id: req.params.jobId, companyId: jobCompany(req) } });
  if (!job) return res.status(404).json({ message: 'Job not found.' });
  if (!canAccessLocation(req, job.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  // The line must belong to THIS job (it used to be updated by line id alone, across jobs).
  const existingLine = await prisma.jobLine.findFirst({ where: { id: req.params.lineId, jobId: job.id }, select: { id: true } });
  if (!existingLine) return res.status(404).json({ message: 'Job line not found.' });
  const numeric = ['issuedQty', 'usedQty', 'returnedQty', 'damagedQty'].reduce<Record<string, number>>((result, key) => {
    if (req.body[key] !== undefined) result[key] = Math.max(0, Math.trunc(Number(req.body[key]) || 0));
    return result;
  }, {});
  const line = await prisma.jobLine.update({ where: { id: existingLine.id }, data: numeric });
  return res.json({ line });
});

router.patch('/jobs/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const allowed = ['DRAFT', 'ACTIVE', 'RECONCILING', 'CLOSED', 'CANCELLED'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ message: 'Invalid job status.' });
  const existing = await prisma.job.findFirst({ where: { id: req.params.id, companyId: jobCompany(req) }, select: { id: true } });
  if (!existing) return res.status(404).json({ message: 'Job not found.' });
  const job = await prisma.job.update({ where: { id: existing.id }, data: { status: req.body.status } });
  return res.json({ job });
});

router.post('/jobs/:id/consume', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Admin or Warehouse Picker access required.' });
  }
  const quantity = Number(req.body.quantity);
  const lineId = typeof req.body.lineId === 'string' ? req.body.lineId : '';
  if (!lineId || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'lineId and a positive quantity are required.' });
  }
  // The idempotency key is the caller's, created once per user action (AGENTS.md: never derived server-side).
  const headerKey = req.headers['x-mutation-id'];
  const requestId = typeof req.body.requestId === 'string' && req.body.requestId.trim()
    ? req.body.requestId.trim()
    : typeof headerKey === 'string' ? headerKey.trim() : '';
  if (!requestId) return res.status(400).json({ message: 'requestId (or X-Mutation-Id) is required so a retry can never consume stock twice.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
  try {
    const result = await consumeJobLine({
      tenant: tenantContextOf(req),
      jobId: req.params.id,
      lineId,
      quantity,
      lotId: typeof req.body.lotId === 'string' ? req.body.lotId : undefined,
      requestId,
      strategy: getActiveWorkflow(req.companyId ?? DEFAULT_COMPANY_ID).allocationStrategy,
      canAccessLocation: (locationId) => canAccessLocation(req, locationId),
    });
    // The in-memory stock view is only a read cache: keep it in step for the screens that read it,
    // once per real consume (a replay changes nothing).
    if (!result.duplicate) {
      for (const pick of result.allocations) adjustStockLedger(result.itemId, pick.lotId, result.locationId, -pick.quantity);
    }
    const company = jobCompany(req);
    const refreshed = await prisma.job.findFirst({ where: { id: req.params.id, companyId: company }, include: { lines: true } });
    const line = refreshed?.lines.find((entry) => entry.id === lineId) ?? null;
    return res.json({ job: refreshed, line, allocations: result.allocations, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof JobConsumeError) return res.status(error.status).json({ message: error.message });
    if (error instanceof NegativeStockBlockedError) return res.status(409).json({ message: error.message });
    throw error;
  }
});

/** Memory-mode counterpart of the DB `lot.item.companyId` check (P0-SEC-001). */
function memoryLotOwnedByCompany(lotId: string, companyId: string): boolean {
  const item = listItems().find((candidate) => candidate.lots.some((lot) => lot.id === lotId));
  return Boolean(item && ownerOfItem(item.id) === companyId);
}

router.patch('/lots/:id/manufactured', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'].includes(req.user!.role)) return res.status(403).json({ message: 'Not permitted.' });
  const raw = req.body.manufacturedAt;
  let manufacturedAt: Date | null = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    manufacturedAt = new Date(raw);
    if (Number.isNaN(manufacturedAt.getTime()) || manufacturedAt.getTime() > Date.now() + 86_400_000) return res.status(400).json({ message: 'Manufacturing date is invalid or in the future.' });
  }
  const owned = await prisma.lot.findFirst({ where: { id: req.params.id, item: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true, expiryDate: true } });
  if (!owned) return res.status(404).json({ message: 'Lot not found.' });
  if (manufacturedAt && owned.expiryDate && manufacturedAt >= owned.expiryDate) return res.status(400).json({ message: 'Manufacturing date must be before the expiry date.' });
  const lot = await prisma.lot.update({ where: { id: owned.id }, data: { manufacturedAt } });
  return res.json({ lot });
});

router.patch('/lots/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const validStatuses = ['AVAILABLE', 'EXPIRED', 'BLOCKED', 'QUARANTINE'] as const;
  if (!validStatuses.includes(req.body.status)) return res.status(400).json({ message: 'Invalid lot status.' });
  if (!databaseEnabled) {
    // P0-SEC-001: the in-memory catalogue is company scoped through the lot's item as well.
    if (!memoryLotOwnedByCompany(req.params.id, req.companyId ?? DEFAULT_COMPANY_ID)) return res.status(404).json({ message: 'Lot not found.' });
    try {
      const lot = setLotSaleStatus(req.params.id, req.body.status);
      await persistAudit(recordAudit({
        actorId: req.user!.id, actorRole: req.user!.role, action: `LOT_STATUS_${req.body.status}`,
        entityType: 'Lot', entityId: lot.id, metadata: { lotNo: lot.lotNo, status: req.body.status },
      }));
      return res.json({ lot });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lot not found.';
      return res.status(message.includes('not found') ? 404 : 400).json({ message });
    }
  }
  // P0-SEC-001: resolve the lot through its item's company first, then update only that owned id.
  const ownedLot = await prisma.lot.findFirst({ where: { id: req.params.id, item: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } });
  if (!ownedLot) return res.status(404).json({ message: 'Lot not found.' });
  const lot = await prisma.lot.update({ where: { id: ownedLot.id }, data: { status: req.body.status } }).catch(() => null);
  if (!lot) return res.status(404).json({ message: 'Lot not found.' });
  try {
    updateLotStatus(lot.id, req.body.status);
  } catch {
    // In-memory catalogue may not contain this lot during isolated API use.
  }
  await prisma.auditLog.create({
    data: {
      actorId: req.user!.id, actorRole: req.user!.role, action: `LOT_STATUS_${req.body.status}`,
      entityType: 'Lot', entityId: lot.id,
      metadata: { lotNo: lot.lotNo, status: req.body.status },
    },
  }).catch(() => undefined);
  return res.json({ lot });
});

router.patch('/lots/:id/expiry', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const raw = req.body.expiryDate;
  if (!databaseEnabled) {
    if (!memoryLotOwnedByCompany(req.params.id, req.companyId ?? DEFAULT_COMPANY_ID)) return res.status(404).json({ message: 'Lot not found.' });
    try {
      const lot = setLotExpiryDate(req.params.id, raw);
      await persistAudit(recordAudit({
        actorId: req.user!.id, actorRole: req.user!.role, action: 'LOT_EXPIRY_SET',
        entityType: 'Lot', entityId: lot.id, metadata: { lotNo: lot.lotNo, expiryDate: lot.expiryDate ?? null },
      }));
      return res.json({ lot: { ...lot, expiryDate: lot.expiryDate ?? null } });
    } catch (error) {
      const status = error instanceof ExpiryWriteOffError ? error.status : 400;
      return res.status(status === 400 && error instanceof Error && error.message.includes('not found') ? 404 : status)
        .json({ message: error instanceof Error ? error.message : 'Lot not found.' });
    }
  }
  let expiryDate: Date | null = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    expiryDate = new Date(raw);
    if (Number.isNaN(expiryDate.getTime())) return res.status(400).json({ message: 'Expiry date is invalid.' });
  }
  const ownedLot = await prisma.lot.findFirst({ where: { id: req.params.id, item: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } }, select: { id: true } });
  if (!ownedLot) return res.status(404).json({ message: 'Lot not found.' });
  const lot = await prisma.lot.update({ where: { id: ownedLot.id }, data: { expiryDate } }).catch(() => null);
  if (!lot) return res.status(404).json({ message: 'Lot not found.' });
  try {
    updateLotExpiry(lot.id, lot.expiryDate?.toISOString() ?? null);
  } catch {
    // In-memory catalogue may not contain this lot during isolated API use.
  }
  await prisma.auditLog.create({
    data: {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'LOT_EXPIRY_SET',
      entityType: 'Lot', entityId: lot.id,
      metadata: { lotNo: lot.lotNo, expiryDate: lot.expiryDate?.toISOString() ?? null },
    },
  }).catch(() => undefined);
  return res.json({ lot: { ...lot, expiryDate: lot.expiryDate?.toISOString() ?? null } });
});

export default router;
