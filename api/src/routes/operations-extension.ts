import { loadSalesEvents, signedSalesQty, totalsByItem } from '../lib/sales-demand.js';
import { newDocumentNumber } from '../lib/document-number.js';
import { type Request, type Response, Router } from 'express';
import { createHash } from 'node:crypto';

import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { recordAudit } from '../lib/audit.js';
import { planRuleReplenishment } from '../lib/replenishment.js';
import { sellableQuantity, totalSellable } from '../lib/sellable-stock.js';
import { daysUntilExpiry, expirySeverity, recommendedExpiryAction } from '../lib/expiry-alerts.js';
import { buildExpiryBoard, emptyExpiryBoard } from '../lib/expiry-board.js';
import {
  ExpiryWriteOffError,
  buildLocationExpiryBoard,
  listLocationExpiryAlerts,
  setLotExpiryDate,
  setLotSaleStatus,
  writeOffExpiryLot,
} from '../lib/expiry-lifecycle.js';
import { allocateLots } from '../lib/warehouse-workflow.js';
import { getActiveWorkflow } from '../lib/industry-packs.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { buildReplenishmentIntelligence, listReorderRules } from '../lib/reorder-store.js';
import { adjustQuarantineLedger, adjustStockLedger, ensureLotRecord, listItems, listLocations, listStockLedger, listStockLedgerForLocation, updateLotExpiry, updateLotStatus } from '../lib/repository.js';
import { encryptWebhookSecret, WebhookValidationError } from '../lib/webhook-events.js';
import { maybeEmitStockLow } from '../lib/webhook-dispatcher.js';
import { createExceptionCase, applyExceptionDisposition } from '../lib/exceptions.js';
import { createPutawayTask } from '../lib/putaway.js';
import { createOrderWithReservation, fulfillOrder, cancelOrder, expireStaleReservations, retryBackorderedOrders, retryBackorderAllocation, OrderShortageError, InsufficientStockError as OrderInsufficientStockError, listMemoryOrders } from '../lib/orders.js';
import { decideApprovalRequest } from '../lib/approval-rules.js';
import {
  recordQcInspection,
  DEFAULT_QC_CHECKS,
  type QcCheckResult,
  listMemoryQcTemplates,
  listMemoryQcInspections,
  createMemoryQcTemplate,
  patchMemoryQcTemplate,
} from '../lib/qc-inspection.js';
import { assertPutawayScan, assertGuidedWalkScan } from '../lib/scan-enforcement.js';
import { persistBinStockDelta, moveBinStockPersisted, STAGING_BIN_ID, memoryBinStock, listMemoryBins, createMemoryBin } from '../lib/bin-stock.js';
import { assertValidBinMove, BinMoveValidationError } from '../lib/bin-move.js';
import { planPickFaceReplenishment } from '../lib/pick-face-replenishment.js';
import { verifyPackScan } from '../lib/pack-verification.js';
import { getCarrierAdapter } from '../lib/carrier-adapter.js';
import { canCloseReturn, isPendingDisposition, nextReturnStatus, parseRefundDecision, planReturnLine, validateReturnLines, type ReturnAction } from '../lib/returns-rma.js';
import { transitionReturnStatus } from '../lib/domain-policies.js';
import { verdictForLine, type InspectionLike } from '../lib/qc-gate.js';
import { findTemplateForCategory } from '../lib/qc-inspection.js';
import { censorStockoutDays, classifyDemandPattern, computeDemandStats, openingBalancesByDay, crostonDailyDemand, suggestReplenishment, xyzClass } from '../lib/demand-forecast.js';
import { OPEN_PO_STATUSES } from '../lib/po-planning.js';
import { sequenceKeyForBin, lastKnownBin } from '../lib/pick-wave.js';
import {
  buildExpiryActionRecommendations,
  buildLotBlockRecommendations,
  buildOverstockRecommendations,
} from '../lib/intelligence-actions.js';
import {
  createConnector,
  findConnector,
  listConnectors,
  mapMarketplaceOrder,
  markConnectorIngested,
  validateNormalizedOrder,
  type ConnectorPlatform,
} from '../lib/connectors.js';
import {
  findPlan,
  listTenants,
  provisionTenant,
  SAAS_PLANS,
  tenantAllows,
} from '../lib/saas.js';
import { mobileHomeForRole } from '../lib/mobile-role.js';
import { createCompany, createEnhancedUser, findUserByEmail } from '../lib/enterprise-repository.js';
import { hashPassword } from '../lib/otp-auth.js';
import {
  createWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  setWebhookSubscriptionStatus,
} from '../lib/webhook-store.js';
import { replayDelivery, retryDueDeliveries, WebhookReplayError } from '../lib/webhook-dispatcher.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID, ownerOfLocation, companyOwnsLocation } from '../lib/saas/tenant-scope.js';
import { postInventoryMovementInTransaction } from '../lib/inventory-posting-service.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { buildRecallTrace, planSerialMovement, type SerialStatus } from '../lib/serial-tracking.js';

const router = Router();

function tenantContextOf(req: Request): TenantContext {
  return { companyId: req.companyId ?? DEFAULT_COMPANY_ID, tenantId: DEFAULT_TENANT_ID, userId: req.user!.id, role: req.user!.role as TenantContext['role'] };
}
router.use(extractToken, requireAuth, enforcePermissionOverrides, respondWhenMemoryUnavailable);

// Centralized fix (see docs/tenant-scope-coverage.md's bare-id call-site
// migration, slice 5): the role-only check below let ADMIN/ADMIN_USER/
// AUDITOR through for ANY locationId, including one belonging to a
// different company - the root cause behind most of the cross-tenant
// findings in slices 1-4. A location whose company ownership is known
// (registered via registerLocationCompany, or hydrated at boot) and
// mismatches the caller's own company is now always denied, before the
// role check runs, same fail-safe-if-unknown pattern already trusted
// globally by enforceOperationalCompanyScope. A location not yet tracked
// in the in-memory ownership map falls through to the original role/
// assignment check unchanged, so this closes the verified vulnerability
// class without risking a false-deny on data the map hasn't seen yet.
function canAccessLocation(req: Request, locationId: string): boolean {
  if (req.companyId && ownerOfLocation(locationId) && !companyOwnsLocation(req.companyId, locationId)) {
    return false;
  }
  return ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role) || (req.user!.locationIds ?? []).includes(locationId);
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

router.get('/asset-checkouts', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const where = locationId
    ? { locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? {}
      : { locationId: { in: req.user!.locationIds ?? [] } };
  const checkouts = await prisma.assetCheckout.findMany({ where, orderBy: { checkedOutAt: 'desc' } });
  return res.json({ checkouts });
});

router.post('/asset-checkouts', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const quantity = Number(req.body.quantity ?? 1);
  if (!req.body.itemId || !req.body.locationId || !String(req.body.assigneeName || '').trim() || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ message: 'Item, location, assignee and positive quantity are required.' });
  }
  const checkout = await prisma.assetCheckout.create({ data: {
    itemId: req.body.itemId,
    locationId: req.body.locationId,
    assigneeName: String(req.body.assigneeName).trim(),
    quantity,
    dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
    conditionOut: req.body.conditionOut || null,
    createdById: req.user!.id,
  } });
  return res.status(201).json({ checkout });
});

router.patch('/asset-checkouts/:id/return', async (req, res) => {
  const checkout = await prisma.assetCheckout.findUnique({ where: { id: req.params.id } });
  if (!checkout) return res.status(404).json({ message: 'Checkout record not found.' });
  if (!canAccessLocation(req, checkout.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (checkout.status === 'RETURNED') return res.status(409).json({ message: 'This asset has already been returned.' });
  const updated = await prisma.assetCheckout.update({ where: { id: checkout.id }, data: {
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
  const job = await prisma.job.findFirst({ where: { id: req.params.id, companyId: jobCompany(req) }, include: { lines: true } });
  if (!job) return res.status(404).json({ message: 'Job not found.' });
  if (!canAccessLocation(req, job.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (job.status !== 'ACTIVE') return res.status(409).json({ message: 'Start the job before consuming inventory.' });
  const line = job.lines.find((entry) => entry.id === lineId);
  if (!line) return res.status(404).json({ message: 'Job line not found.' });

  const item = listItems().find((entry) => entry.id === line.itemId);
  const sourceStock = listStockLedgerForLocation(job.locationId);
  const lots = (item?.lots ?? []).map((lot) => ({
    lotId: lot.id,
    lotNo: lot.lotNo,
    expiryDate: lot.expiryDate,
    available: sourceStock.find((row) => row.itemId === line.itemId && row.lotId === lot.id)?.onHand ?? 0,
    status: lot.status ?? 'AVAILABLE' as const,
  }));
  const requestedLot = typeof req.body.lotId === 'string' ? lots.filter((lot) => lot.lotId === req.body.lotId) : lots;
  const allocation = allocateLots(requestedLot, quantity, getActiveWorkflow().allocationStrategy);
  if (allocation.shortage > 1e-8) {
    return res.status(409).json({ message: `Only ${quantity - allocation.shortage} units are available to consume.` });
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const pick of allocation.allocations) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: pick.lotId, locationId: job.locationId } },
      });
      if (!ledger || ledger.onHand < pick.quantity) throw new Error(`Insufficient stock for lot ${pick.lotNo}.`);
      await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId: line.itemId, lotId: pick.lotId, locationId: job.locationId,
        movementType: 'ADJUSTMENT', qtyDelta: -pick.quantity,
        // One consume request = one movement per lot; the line's running issuedQty makes each request distinct.
        idempotencyKey: `job-consume:${line.id}:${line.issuedQty}:${pick.lotId}`,
        reason: 'Job consumption', sourceDocument: job.id, sourceLineId: line.id, correlationId: job.id,
      });
    }
    return tx.jobLine.update({
      where: { id: line.id },
      data: { issuedQty: { increment: Math.trunc(quantity) }, usedQty: { increment: Math.trunc(quantity) } },
    });
  });

  for (const pick of allocation.allocations) {
    adjustStockLedger(line.itemId, pick.lotId, job.locationId, -pick.quantity);
  }
  const refreshed = await prisma.job.findUnique({ where: { id: job.id }, include: { lines: true } });
  return res.json({ job: refreshed, line: updated, allocations: allocation.allocations });
});

function expiryAlertId(itemId: string, lotId: string, locationId: string): string {
  return `expiry-${createHash('sha1').update(`${itemId}|${lotId}|${locationId}`).digest('hex').slice(0, 24)}`;
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
  const lot = await prisma.lot.update({ where: { id: req.params.id }, data: { status: req.body.status } }).catch(() => null);
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
  const lot = await prisma.lot.update({ where: { id: req.params.id }, data: { expiryDate } }).catch(() => null);
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

router.get('/comments/:entityType/:entityId', async (req, res) => {
  const comments = await prisma.contextComment.findMany({
    where: { entityType: req.params.entityType, entityId: req.params.entityId },
    orderBy: { createdAt: 'asc' },
  });
  return res.json({ comments });
});

router.post('/comments/:entityType/:entityId', async (req, res) => {
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty.' });
  const mentions = [...body.matchAll(/@([\w.-]+)/g)].map((match) => match[1]);
  const comment = await prisma.contextComment.create({ data: {
    entityType: req.params.entityType,
    entityId: req.params.entityId,
    authorId: req.user!.id,
    authorName: req.user!.name || req.user!.email || req.user!.id,
    body,
    mentions,
  } });
  return res.status(201).json({ comment });
});

router.get('/notification-inbox', async (req, res) => {
  const notifications = await prisma.userNotification.findMany({
    where: { OR: [{ userId: req.user!.id }, { role: req.user!.role }, { userId: null, role: null }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json({ notifications });
});

router.patch('/notification-inbox/:id/read', async (req, res) => {
  const notice = await prisma.userNotification.findUnique({ where: { id: req.params.id } });
  if (!notice || (notice.userId && notice.userId !== req.user!.id) || (notice.role && notice.role !== req.user!.role)) {
    return res.status(404).json({ message: 'Notification not found.' });
  }
  const notification = await prisma.userNotification.update({ where: { id: notice.id }, data: { readAt: new Date() } });
  return res.json({ notification });
});

router.get('/expiry-alerts', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) {
    return res.json({ alerts: listLocationExpiryAlerts(locationId) });
  }
  const ledger = await prisma.stockLedger.findMany({
    where: { locationId, onHand: { gt: 0 }, lot: { expiryDate: { not: null } } },
    include: {
      lot: { select: { lotNo: true, status: true, expiryDate: true } },
      item: { select: { code: true, name: true } },
    },
    orderBy: { onHand: 'desc' },
  });
  const alerts = ledger
    .filter((row) => row.lot.expiryDate)
    .map((row) => {
      const days = daysUntilExpiry(row.lot.expiryDate!);
      return {
        id: `expiry-${createHash('sha1').update(`${row.itemId}|${row.lotId}|${row.locationId}`).digest('hex').slice(0, 24)}`,
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        quantity: row.onHand,
        expiryDate: row.lot.expiryDate,
        daysUntilExpiry: days,
        status: 'ACTIVE',
        recommendedAction: recommendedExpiryAction(days),
        item: row.item,
        lot: { lotNo: row.lot.lotNo, status: row.lot.status },
        severity: expirySeverity(days),
      };
    })
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return res.json({ alerts });
});

router.get('/expiry-board', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) {
    return res.json({ board: buildLocationExpiryBoard(locationId) });
  }
  const ledger = await prisma.stockLedger.findMany({
    where: { locationId, onHand: { gt: 0 } },
    include: {
      lot: { select: { id: true, lotNo: true, status: true, expiryDate: true, attributes: true } },
      item: { select: { id: true, code: true, name: true, category: true, subcategory: true, company: true, unit: true } },
    },
  });
  const board = ledger.length
    ? buildExpiryBoard({
        items: ledger.map((row) => row.item),
        lots: ledger.map((row) => ({
          id: row.lot.id,
          lotNo: row.lot.lotNo,
          expiryDate: row.lot.expiryDate,
          status: row.lot.status,
          attributes: (row.lot.attributes as Record<string, unknown> | null) ?? null,
        })),
        stock: ledger.map((row) => ({
          itemId: row.itemId,
          lotId: row.lotId,
          locationId: row.locationId,
          quantity: row.onHand,
        })),
      })
    : emptyExpiryBoard();
  return res.json({ board });
});

router.post('/expiry-write-off', async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only the Main Admin can post an expiry write-off.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) return res.status(400).json({ message: 'A write-off reason of at least 5 characters is required.' });
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const lotId = typeof req.body.lotId === 'string' ? req.body.lotId : '';
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : '';
  if (!itemId || !lotId || !locationId) return res.status(400).json({ message: 'itemId, lotId and locationId are required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const requestedQty = Number(req.body.quantity);
  if (!databaseEnabled) {
    try {
      const result = writeOffExpiryLot({
        itemId, lotId, locationId, quantity: requestedQty, reason, actorId: req.user!.id, role: req.user!.role,
      });
      await persistAudit(recordAudit({
        actorId: req.user!.id, actorRole: req.user!.role, action: 'EXPIRY_STOCK_WRITTEN_OFF',
        entityType: 'ExpiryAlert', entityId: result.alertId,
        metadata: { quantity: result.quantity, beforeBalance: result.beforeBalance, afterBalance: result.afterBalance, movementId: result.movementId, reason, itemId, lotId, locationId },
      }));
      maybeEmitStockLow(itemId, locationId, result.beforeBalance);
      return res.json({ success: true, result });
    } catch (error) {
      const status = error instanceof ExpiryWriteOffError ? error.status : 400;
      return res.status(status).json({ message: error instanceof Error ? error.message : 'Expiry write-off failed.' });
    }
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const [ledger, lot] = await Promise.all([
        tx.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } }),
        tx.lot.findUnique({ where: { id: lotId } }),
      ]);
      if (!lot) throw new Error('Lot not found.');
      const quantity = Number.isFinite(requestedQty) && requestedQty > 0 ? requestedQty : Number(ledger?.onHand ?? 0);
      if (!ledger || quantity <= 0 || quantity > ledger.onHand) throw new Error('Write-off quantity exceeds current lot stock.');
      const days = lot.expiryDate ? daysUntilExpiry(lot.expiryDate) : 0;
      const alertId = expiryAlertId(itemId, lotId, locationId);
      await tx.expiryAlert.upsert({
        where: { id: alertId },
        create: {
          id: alertId, itemId, lotId, locationId,
          quantity: ledger.onHand, expiryDate: lot.expiryDate ?? new Date(), daysUntilExpiry: days,
          status: 'ACTIVE', recommendedAction: recommendedExpiryAction(days),
          metadata: { severity: lot.expiryDate ? expirySeverity(days) : 'MISSING' },
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        },
        update: {
          quantity: ledger.onHand, expiryDate: lot.expiryDate ?? new Date(), daysUntilExpiry: days,
          status: 'ACTIVE', resolvedAt: null,
          recommendedAction: recommendedExpiryAction(days),
        },
      });
      const claimed = await tx.expiryAlert.updateMany({
        where: { id: alertId, companyId: req.companyId ?? DEFAULT_COMPANY_ID, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        data: { status: 'RESOLVED_BY_WRITE_OFF', resolvedAt: new Date(), quantity: Math.max(0, ledger.onHand - quantity) },
      });
      if (claimed.count !== 1) throw new Error('Expiry alert was already processed.');
      const afterBalance = ledger.onHand - quantity;
      // Canonical posting inside this transaction (journal + ledger + audit + outbox).
      // The key carries the ledger version so a later, legitimate write-off of the same
      // lot (the alert id is deterministic per item/lot/location) is a new movement.
      const { movement } = await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId, lotId, locationId,
        movementType: 'EXPIRY_WRITE_OFF', qtyDelta: -quantity,
        idempotencyKey: `expiry-writeoff:${alertId}:${ledger.version}`,
        reason, sourceDocument: alertId, correlationId: alertId,
        metadata: { expiryDate: lot.expiryDate?.toISOString() ?? null, alertId },
      });
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'EXPIRY_STOCK_WRITTEN_OFF',
        entityType: 'ExpiryAlert', entityId: alertId,
        metadata: { quantity, beforeBalance: ledger.onHand, afterBalance, movementId: movement.id, reason, itemId, lotId, locationId },
      } });
      return { alertId, movementId: movement.id, quantity, beforeBalance: ledger.onHand, afterBalance };
    });
    try {
      adjustStockLedger(itemId, lotId, locationId, -result.quantity);
    } catch {
      // Hydrated ledger may not contain this row in isolated API use.
    }
    maybeEmitStockLow(itemId, locationId, result.beforeBalance);
    return res.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Expiry write-off failed.';
    return res.status(message.includes('not found') ? 404 : message.includes('already') ? 409 : 400).json({ message });
  }
});

router.patch('/expiry-alerts/:id/status', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin access required.' });
  const status = String(req.body.status ?? '');
  if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) return res.status(400).json({ message: 'Status must be ACKNOWLEDGED or RESOLVED.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (status === 'RESOLVED' && reason.length < 5) return res.status(400).json({ message: 'A resolution reason of at least 5 characters is required.' });
  const current = await prisma.expiryAlert.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!current) return res.status(404).json({ message: 'Expiry alert not found.' });
  if (!canAccessLocation(req, current.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const alert = await prisma.expiryAlert.update({
    where: { id: current.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    data: {
      status: status as any,
      acknowledgedAt: status === 'ACKNOWLEDGED' ? new Date() : current.acknowledgedAt,
      resolvedAt: status === 'RESOLVED' ? new Date() : null,
      metadata: { ...(current.metadata && typeof current.metadata === 'object' ? current.metadata as object : {}), statusReason: reason || undefined, statusActorId: req.user!.id },
    },
  });
  await prisma.auditLog.create({ data: {
    actorId: req.user!.id, actorRole: req.user!.role, action: `EXPIRY_ALERT_${status}`,
    entityType: 'ExpiryAlert', entityId: alert.id, metadata: { reason, locationId: alert.locationId },
  } });
  return res.json({ alert });
});

router.post('/expiry-alerts/:id/write-off', async (req, res) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ message: 'Only the Main Admin can post an expiry write-off.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5) return res.status(400).json({ message: 'A write-off reason of at least 5 characters is required.' });
  const requestedQty = Number(req.body.quantity);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const alert = await tx.expiryAlert.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
      if (!alert) throw new Error('Expiry alert not found.');
      if (!['ACTIVE', 'ACKNOWLEDGED'].includes(String(alert.status))) throw new Error('Expiry alert is already resolved.');
      if (!canAccessLocation(req, alert.locationId)) throw new Error('Location access denied.');
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: alert.itemId, lotId: alert.lotId, locationId: alert.locationId } },
      });
      const quantity = Number.isFinite(requestedQty) && requestedQty > 0 ? requestedQty : Number(alert.quantity);
      if (!ledger || quantity <= 0 || quantity > ledger.onHand) throw new Error('Write-off quantity exceeds current lot stock.');
      const claimed = await tx.expiryAlert.updateMany({
        where: { id: alert.id, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        data: { status: 'RESOLVED_BY_WRITE_OFF', resolvedAt: new Date(), quantity: Math.max(0, alert.quantity - quantity) },
      });
      if (claimed.count !== 1) throw new Error('Expiry alert was already processed.');
      const afterBalance = ledger.onHand - quantity;
      const { movement } = await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId: alert.itemId, lotId: alert.lotId, locationId: alert.locationId,
        movementType: 'EXPIRY_WRITE_OFF', qtyDelta: -quantity,
        idempotencyKey: `expiry-writeoff:${alert.id}:${ledger.version}`,
        reason, sourceDocument: alert.id, correlationId: alert.id,
        metadata: { expiryDate: alert.expiryDate.toISOString(), alertId: alert.id },
      });
      await tx.auditLog.create({ data: {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'EXPIRY_STOCK_WRITTEN_OFF',
        entityType: 'ExpiryAlert', entityId: alert.id,
        metadata: { quantity, beforeBalance: ledger.onHand, afterBalance, movementId: movement.id, reason },
      } });
      return { alertId: alert.id, movementId: movement.id, quantity, beforeBalance: ledger.onHand, afterBalance };
    });
    return res.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Expiry write-off failed.';
    return res.status(message.includes('not found') ? 404 : message.includes('Access denied') ? 403 : message.includes('already') ? 409 : 400).json({ message });
  }
});

router.get('/items/:itemId/forecast', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) return res.status(400).json({ message: 'locationId is required.' });
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) return res.status(501).json({ message: 'Forecasting requires a connected database.' });

  const windowDays = Number(req.query.windowDays) > 0 ? Number(req.query.windowDays) : 30;
  const leadTimeDays = Number(req.query.leadTimeDays) > 0 ? Number(req.query.leadTimeDays) : 7;
  const servicePercent = Number(req.query.servicePercent) > 0 ? Number(req.query.servicePercent) : 95;
  if (servicePercent < 50 || servicePercent > 99.99) return res.status(400).json({ message: 'servicePercent must be between 50 and 99.99.' });
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const movements = await loadSalesEvents({ since, locationId, itemIds: [req.params.itemId] });
  // Demand is NET sales: a return in the window offsets a sale (it used to be ignored, overstating demand).
  const soldByDay = new Map<string, number>();
  for (const movement of movements) {
    const day = movement.timestamp.toISOString().slice(0, 10);
    soldByDay.set(day, (soldByDay.get(day) ?? 0) + movement.qty);
  }
  const dailyDemand: number[] = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const day = new Date(since.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dailyDemand.push(soldByDay.get(day) ?? 0);
  }
  // Days with nothing on the shelf are censored, not counted as zero demand (audit O-2).
  const allMovements = await prisma.stockMovement.findMany({ where: { itemId: req.params.itemId, locationId, timestamp: { gte: since } }, select: { qtyDelta: true, timestamp: true } });
  const currentLedger = await prisma.stockLedger.findMany({ where: { itemId: req.params.itemId, locationId }, select: { onHand: true } });
  const opening = openingBalancesByDay({ currentOnHand: currentLedger.reduce((sum, row) => sum + row.onHand, 0), movements: allMovements, windowStart: since, windowDays });
  const censored = censorStockoutDays(dailyDemand.map((value) => Math.max(0, value)), opening);
  const netDailyDemand = censored.demand.length ? censored.demand : dailyDemand.map((value) => Math.max(0, value));
  const plainDemand = computeDemandStats(netDailyDemand);
  const { pattern: demandPattern } = classifyDemandPattern(netDailyDemand);
  // Sparse items are forecast with Croston (SBA); averaging their zeros misstates the rate (audit O-2).
  const intermittent = demandPattern === 'INTERMITTENT' || demandPattern === 'LUMPY';
  const demand = intermittent ? { ...plainDemand, averageDailyDemand: crostonDailyDemand(netDailyDemand) } : plainDemand;

  const ledgerRows = await prisma.stockLedger.findMany({ where: { itemId: req.params.itemId, locationId }, include: { lot: { select: { status: true, expiryDate: true } } } });
  // Cover is sellable stock only: blocked, quarantined and expired lots do not count (audit O-6).
  const onHand = totalSellable(ledgerRows);
  const openLines = await prisma.purchaseOrderLine.findMany({
    where: { itemId: req.params.itemId, purchaseOrder: { locationId, status: { in: [...OPEN_PO_STATUSES] } } },
  });
  const onOrder = openLines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.receivedQty), 0);

  const suggestion = suggestReplenishment({ onHand, onOrder, demand, averageLeadTimeDays: leadTimeDays, servicePercent });

  const item = await prisma.item.findFirst({ where: { id: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { name: true, shelfLifeDays: true } });
  const lots = await prisma.lot.findMany({
    where: { itemId: req.params.itemId, stock: { some: { locationId, onHand: { gt: 0 } } } },
    include: { stock: { where: { locationId } } },
  }).catch(() => []);
  const lotInputs = lots.flatMap((lot) => lot.stock.filter((row) => row.onHand > 0).map((row) => ({
    itemId: req.params.itemId,
    itemName: item?.name ?? req.params.itemId,
    lotId: lot.id,
    lotNo: lot.lotNo,
    locationId: row.locationId,
    onHand: row.onHand,
    status: lot.status,
    expiryDate: lot.expiryDate?.toISOString() ?? null,
  })));
  const expiryActions = buildExpiryActionRecommendations(lotInputs, new Date(), {
    demandByItem: demand.sampleDays > 0 ? new Map([[req.params.itemId, demand.averageDailyDemand]]) : undefined,
    shelfLifeByItem: new Map([[req.params.itemId, item?.shelfLifeDays]]),
  });

  const rules = await prisma.reorderRule.findMany({ where: { itemId: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  const networkLedger = await prisma.stockLedger.findMany({
    where: { itemId: req.params.itemId },
    select: { locationId: true, onHand: true, location: { select: { name: true } } },
  });
  const overstockRows = rules.map((rule) => {
    const here = networkLedger.filter((row) => row.locationId === rule.locationId).reduce((sum, row) => sum + row.onHand, 0);
    const location = networkLedger.find((row) => row.locationId === rule.locationId)?.location;
    return {
      itemId: req.params.itemId,
      itemName: item?.name ?? req.params.itemId,
      locationId: rule.locationId,
      locationName: location?.name ?? rule.locationId,
      onHand: here,
      targetQty: rule.targetQty,
      minQty: rule.minQty,
    };
  });
  const overstock = buildOverstockRecommendations(overstockRows, locationId);

  return res.json({
    itemId: req.params.itemId, locationId, windowDays, leadTimeDays, servicePercent,
    demand, demandPattern, variabilityClass: xyzClass(netDailyDemand), forecastMethod: intermittent ? 'CROSTON_SBA' : 'MOVING_AVERAGE', stockoutDaysExcluded: censored.censoredDays,
    onHand, onOrder, suggestion, expiryActions, overstock,
  });
});

// A dismissal hides a recommendation for 24h, then it resurfaces if still
// genuinely valid - see the IntelligenceDismissal model comment.
const INTELLIGENCE_DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

router.get('/intelligence/:locationId', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Intelligence insights require Admin or Auditor access.' });
  if (!canAccessLocation(req, req.params.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) {
    const locationId = req.params.locationId;
    const items = listItems();
    const locations = listLocations();
    const ledger = listStockLedger();
    const lotInputs = ledger.filter((row) => row.locationId === locationId && row.onHand > 0).map((row) => {
      const item = items.find((entry) => entry.id === row.itemId);
      const lot = item?.lots.find((entry) => entry.id === row.lotId);
      return {
        itemId: row.itemId,
        itemName: item?.name ?? row.itemId,
        lotId: row.lotId,
        lotNo: lot?.lotNo ?? row.lotId,
        locationId: row.locationId,
        onHand: row.onHand,
        status: lot?.status ?? 'AVAILABLE',
        expiryDate: lot?.expiryDate ?? null,
      };
    });
    const overstockRows = listReorderRules(locationId).flatMap((rule) => {
      const item = items.find((entry) => entry.id === rule.itemId);
      return locations.map((location) => {
        const onHand = ledger
          .filter((row) => row.itemId === rule.itemId && row.locationId === location.id)
          .reduce((sum, row) => sum + row.onHand, 0);
        return {
          itemId: rule.itemId,
          itemName: item?.name ?? rule.itemId,
          locationId: location.id,
          locationName: location.name,
          onHand,
          targetQty: rule.targetQty,
          minQty: rule.minQty,
        };
      });
    });
    return res.json({
      intelligence: {
        ...buildReplenishmentIntelligence(locationId),
        lotBlocks: buildLotBlockRecommendations(lotInputs),
        expiryActions: buildExpiryActionRecommendations(lotInputs),
        overstock: buildOverstockRecommendations(overstockRows, locationId),
      },
    });
  }
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const dismissedSince = new Date(Date.now() - INTELLIGENCE_DISMISSAL_TTL_MS);
  const [rules, ledger, counts, dismissals, destinationLocation] = await Promise.all([
    prisma.reorderRule.findMany({ where: { locationId: req.params.locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { item: true } }),
    // Scoped to this company's locations (it used to read every tenant's whole ledger on each request)
    // and to the items that have rules, with the lot fields needed to judge what is sellable.
    prisma.stockLedger.findMany({
      where: { location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
      select: { itemId: true, locationId: true, onHand: true, reserved: true, inTransit: true, lot: { select: { status: true, expiryDate: true } }, location: { select: { name: true, type: true, latitude: true, longitude: true, shippingCostPerKm: true, deliverySlaHours: true } } },
    }),
    prisma.stockCount.findMany({ where: { locationId: req.params.locationId, countDate: { gte: since }, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { item: true }, orderBy: { countDate: 'desc' }, take: 250 }),
    prisma.intelligenceDismissal.findMany({ where: { locationId: req.params.locationId, createdAt: { gte: dismissedSince } } }),
    // Audit R-1: donors are ranked by estimated shipping cost/lead time when this and the donor both have coordinates.
    prisma.location.findFirst({ where: { id: req.params.locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { latitude: true, longitude: true, shippingCostPerKm: true } }),
  ]);
  const dismissedItemIds = new Set(dismissals.filter((d) => d.type === 'REPLENISHMENT').map((d) => d.itemId));
  const dismissedCountIds = new Set(dismissals.filter((d) => d.type === 'ANOMALY' && d.countId).map((d) => d.countId));
  const quantities = new Map<string, { onHand: number; reserved: number; inTransit: number }>();
  const network = new Map<string, Map<string, { locationId: string; locationName: string; locationType: string; available: number }>>();
  for (const entry of ledger) {
    if (entry.locationId === req.params.locationId) {
      const current = quantities.get(entry.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
      const sellableHere = sellableQuantity({ onHand: entry.onHand, reserved: 0, lot: entry.lot });
      current.onHand += sellableHere;
      current.reserved += sellableHere > 0 ? entry.reserved : 0;
      current.inTransit += entry.inTransit;
      quantities.set(entry.itemId, current);
    }
    const byLocation = network.get(entry.itemId) ?? new Map();
    const source = byLocation.get(entry.locationId) ?? {
      locationId: entry.locationId,
      locationName: entry.location.name,
      locationType: entry.location.type,
      available: 0,
      latitude: entry.location.latitude,
      longitude: entry.location.longitude,
      shippingCostPerKm: entry.location.shippingCostPerKm,
      deliverySlaHours: entry.location.deliverySlaHours,
    };
    source.available += sellableQuantity({ onHand: entry.onHand, reserved: entry.reserved, lot: entry.lot });
    byLocation.set(entry.locationId, source);
    network.set(entry.itemId, byLocation);
  }
  // StockLedger.inTransit is never written (dispatch does not post to it), so stock already
  // on its way is read from the Transfer table - the same source the purchase plan uses. Fetched
  // company-wide (not just this location) so the overstock/network-need calc below (audit R-1:
  // "they use on-hand, not available - reserved/in-transit ignored") can also see what is already
  // headed to a DIFFERENT needy store, not only what is headed here.
  const inboundTransfers = await prisma.transfer.findMany({
    where: { status: { in: ['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'] }, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    include: { lines: true },
  });
  const incoming = new Map<string, number>();
  const networkIncoming = new Map<string, number>();
  for (const transfer of inboundTransfers) {
    for (const line of transfer.lines) {
      const qty = Math.max(0, line.requestedQty - line.receivedQty - line.damagedQty - line.shortageQty);
      if (transfer.destinationLocationId === req.params.locationId) incoming.set(line.itemId, (incoming.get(line.itemId) ?? 0) + qty);
      const key = `${line.itemId}|${transfer.destinationLocationId}`;
      networkIncoming.set(key, (networkIncoming.get(key) ?? 0) + qty);
    }
  }
  // A donor keeps its own reorder minimum for the item.
  const donorRules = await prisma.reorderRule.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, itemId: { in: rules.map((rule) => rule.itemId) } },
    select: { itemId: true, locationId: true, minQty: true },
  });
  const minimumAt = (itemId: string, donorLocationId: string) => donorRules.find((row) => row.itemId === itemId && row.locationId === donorLocationId)?.minQty ?? 0;

  const recommendations = rules.map((rule) => {
    const stock = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const plan = planRuleReplenishment({
      destinationLocationId: req.params.locationId,
      availableHere: stock.onHand - stock.reserved,
      incoming: incoming.get(rule.itemId) ?? 0,
      minQty: rule.minQty, targetQty: rule.targetQty,
      network: [...(network.get(rule.itemId)?.values() ?? [])].map((row) => ({ ...row, protectedQty: minimumAt(rule.itemId, row.locationId) })),
      destination: destinationLocation ?? undefined,
    });
    const available = plan.position;
    const suggestedOrderQty = plan.suggestedOrderQty;
    const route = plan.route;
    const history = counts.filter((count) => count.itemId === rule.itemId);
    const meanVariance = history.length ? history.reduce((sum, count) => sum + Math.abs(count.physicalQty - count.bookQty), 0) / history.length : 0;
    return {
      itemId: rule.itemId,
      itemName: rule.item.name,
      available,
      minQty: rule.minQty,
      targetQty: rule.targetQty,
      suggestedOrderQty,
      suggestedAction: route.action,
      sourceLocationId: route.sourceLocationId,
      sourceLocationName: route.sourceLocationName,
      suggestedTransferQty: route.suggestedTransferQty,
      actionReason: route.reason,
      risk: plan.risk,
      confidence: history.length >= 3 && meanVariance <= Math.max(1, rule.minQty * 0.1) ? 'HIGH' : history.length ? 'MEDIUM' : 'LOW',
    };
  }).filter((entry) => !dismissedItemIds.has(entry.itemId)).sort((a, b) => b.suggestedOrderQty - a.suggestedOrderQty);
  const anomalies = counts
    .map((count) => ({ itemId: count.itemId, itemName: count.item.name, countId: count.id, bookQty: count.bookQty, physicalQty: count.physicalQty, variance: count.physicalQty - count.bookQty, countDate: count.countDate }))
    .filter((count) => Math.abs(count.variance) >= Math.max(3, Math.abs(count.bookQty) * 0.1))
    .filter((count) => !dismissedCountIds.has(count.countId))
    .slice(0, 20);
  const critical = recommendations.filter((entry) => entry.risk === 'CRITICAL').length;
  const transfers = recommendations.filter((entry) => entry.suggestedAction === 'TRANSFER').length;
  const purchases = recommendations.filter((entry) => entry.suggestedAction === 'PURCHASE').length;
  const executiveSummary = critical
    ? `${critical} critical item${critical === 1 ? '' : 's'}; ${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} purchase action${purchases === 1 ? '' : 's'} recommended.`
    : transfers || purchases
      ? `${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} H.O. Basni purchase action${purchases === 1 ? '' : 's'} recommended.`
      : 'Configured inventory is above reorder targets. Continue monitoring count variance.';

  const lots = await prisma.lot.findMany({
    where: { stock: { some: { locationId: req.params.locationId, onHand: { gt: 0 } } } },
    include: { item: { select: { id: true, name: true, shelfLifeDays: true } }, stock: { where: { locationId: req.params.locationId } } },
    take: 400,
  }).catch(() => []);
  // Recent sales rate per item here, so expiry advice can ask "will it sell before it expires?".
  const salesSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentSales = [...totalsByItem(await loadSalesEvents({ since: salesSince, locationId: req.params.locationId }).catch(() => [])).entries()].map(([itemId, units]) => ({ itemId, units: Math.max(0, units) }));
  const demandByItem = new Map<string, number>(recentSales.map((row) => [row.itemId, row.units / 30] as [string, number]));
  // Items with no sales at all in the window are known-zero demand only if we actually have sales history for the location.
  if (recentSales.length > 0) for (const lot of lots) if (!demandByItem.has(lot.itemId)) demandByItem.set(lot.itemId, 0);
  const shelfLifeByItem = new Map<string, number | null | undefined>(lots.map((lot) => [lot.itemId, lot.item.shelfLifeDays] as [string, number | null | undefined]));
  // Other locations' demand for these same items, so an expiring lot can be offered a TRANSFER to
  // a genuinely faster-selling branch instead of only ever MARKDOWN here (audit R-1).
  const expiringItemIds = [...new Set(lots.map((lot) => lot.itemId))];
  const networkMovements = expiringItemIds.length
    ? await prisma.stockMovement.findMany({
        where: { itemId: { in: expiringItemIds }, movementType: { in: ['SALES_DEDUCTION', 'SALES_RETURN'] }, timestamp: { gte: salesSince }, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
        select: { itemId: true, locationId: true, qtyDelta: true, movementType: true },
      }).catch(() => [])
    : [];
  const networkUnitsByKey = new Map<string, number>();
  for (const m of networkMovements) {
    const key = `${m.itemId}|${m.locationId}`;
    networkUnitsByKey.set(key, (networkUnitsByKey.get(key) ?? 0) + signedSalesQty(m.movementType, m.qtyDelta));
  }
  const networkByItem = new Map<string, Array<{ locationId: string; locationName: string; avgDailyDemand: number; onHand: number }>>();
  for (const itemId of expiringItemIds) {
    const locations = [...(network.get(itemId)?.values() ?? [])]
      .filter((entry) => entry.locationId !== req.params.locationId)
      .map((entry) => ({
        locationId: entry.locationId, locationName: entry.locationName, onHand: entry.available,
        avgDailyDemand: Math.max(0, (networkUnitsByKey.get(`${itemId}|${entry.locationId}`) ?? 0) / 30),
      }));
    if (locations.length) networkByItem.set(itemId, locations);
  }
  const lotInputs = lots.flatMap((lot) => lot.stock.filter((row) => row.onHand > 0).map((row) => ({
    itemId: lot.itemId,
    itemName: lot.item.name,
    lotId: lot.id,
    lotNo: lot.lotNo,
    locationId: row.locationId,
    onHand: row.onHand,
    status: lot.status,
    expiryDate: lot.expiryDate?.toISOString() ?? null,
  })));
  const dismissedTypes = new Set(dismissals.map((row) => `${row.type}:${row.itemId}`));
  const lotBlocks = buildLotBlockRecommendations(lotInputs).filter((row) => !dismissedTypes.has(`LOT_BLOCK:${row.itemId}`));
  const expiryActions = buildExpiryActionRecommendations(lotInputs, new Date(), { demandByItem, shelfLifeByItem, networkByItem }).filter((row) => !dismissedTypes.has(`EXPIRY:${row.itemId}`));
  const overstockRows = rules.flatMap((rule) => {
    const here = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const networkRows = [...(network.get(rule.itemId)?.values() ?? [])].map((entry) => ({
      itemId: rule.itemId,
      itemName: rule.item.name,
      locationId: entry.locationId,
      locationName: entry.locationName,
      onHand: entry.available + (entry.locationId === req.params.locationId ? here.reserved : 0),
      targetQty: rule.targetQty,
      minQty: rule.minQty,
    }));
    if (!networkRows.some((row) => row.locationId === req.params.locationId)) {
      networkRows.push({
        itemId: rule.itemId, itemName: rule.item.name, locationId: req.params.locationId,
        locationName: 'Here', onHand: here.onHand, targetQty: rule.targetQty, minQty: rule.minQty,
      });
    }
    return networkRows;
  });
  const overstock = buildOverstockRecommendations(overstockRows, req.params.locationId, networkIncoming).filter((row) => !dismissedTypes.has(`OVERSTOCK:${row.itemId}`));

  return res.json({
    intelligence: {
      generatedAt: new Date().toISOString(), executiveSummary, recommendations, anomalies,
      lotBlocks, expiryActions, overstock,
    },
  });
});

// Dismiss half of the Action Center's "accept/edit/dismiss with an audit
// trail" (blueprint §17.1) - accept already has one via the real
// Transfer/PurchaseOrder record it creates. type REPLENISHMENT dismisses
// by itemId; type ANOMALY dismisses one specific countId (a fresh variance
// on the same item should still surface). type REORDER_SUGGESTION dismisses
// a reorder-rule suggestion (audit O-1) by itemId - its own accept is
// POST /reorder-rules/suggestions/:itemId/accept in catalog-procurement.ts.
router.post('/intelligence/:locationId/dismiss', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Intelligence insights require Admin or Auditor access.' });
  if (!canAccessLocation(req, req.params.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const type = ['ANOMALY', 'REPLENISHMENT', 'LOT_BLOCK', 'EXPIRY', 'OVERSTOCK', 'REORDER_SUGGESTION'].includes(req.body.type) ? req.body.type : null;
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const countId = typeof req.body.countId === 'string' ? req.body.countId : null;
  if (!type || !itemId || (type === 'ANOMALY' && !countId)) {
    return res.status(400).json({ message: 'type, itemId, and countId for ANOMALY are required.' });
  }
  try {
    const dismissal = await prisma.intelligenceDismissal.create({
      data: { locationId: req.params.locationId, itemId, type, countId, reason: req.body.reason || null, dismissedById: req.user!.id },
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'INTELLIGENCE_RECOMMENDATION_DISMISSED',
      entityType: 'IntelligenceDismissal', entityId: dismissal.id,
      metadata: { locationId: req.params.locationId, itemId, type, countId, reason: req.body.reason ?? undefined },
    }));
    return res.status(201).json({ dismissal });
  } catch (error) {
    return res.status(503).json({ message: error instanceof Error ? error.message : 'Intelligence dismissals are not available on this database yet.' });
  }
});

router.get('/webhook-subscriptions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!databaseEnabled) return res.json({ subscriptions: listWebhookSubscriptions() });
  const subscriptions = await prisma.webhookSubscription.findMany({
    select: { id: true, name: true, endpointUrl: true, events: true, status: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ subscriptions });
});

router.post('/webhook-subscriptions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const created = createWebhookSubscription({
      name: req.body.name,
      endpointUrl: req.body.endpointUrl,
      events: req.body.events,
      allowPrivate: !databaseEnabled,
    });
    if (databaseEnabled) {
      await prisma.webhookSubscription.create({
        data: {
          id: created.subscription.id,
          name: created.subscription.name,
          endpointUrl: created.subscription.endpointUrl,
          events: created.subscription.events,
          secretHash: createHash('sha256').update(created.signingSecret).digest('hex'),
          secretEncrypted: encryptWebhookSecret(created.signingSecret),
        },
        select: { id: true, name: true, endpointUrl: true, events: true, status: true, createdAt: true, updatedAt: true },
      });
    }
    return res.status(201).json(created);
  } catch (error) {
    const status = error instanceof WebhookValidationError ? error.status : 400;
    return res.status(status).json({ message: error instanceof Error ? error.message : 'Unable to create webhook.' });
  }
});

router.patch('/webhook-subscriptions/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const subscription = setWebhookSubscriptionStatus(req.params.id, req.body.status);
    if (databaseEnabled) {
      await prisma.webhookSubscription.update({
        where: { id: req.params.id },
        data: { status: req.body.status },
        select: { id: true, name: true, endpointUrl: true, events: true, status: true, createdAt: true, updatedAt: true },
      }).catch(() => undefined);
    }
    return res.json({ subscription });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update webhook.';
    return res.status(message.includes('not found') ? 404 : 400).json({ message });
  }
});

// ============================================================================
// BIN DIRECTORY + PUTAWAY (blueprint Module B / sections 6 & 8.3)
// ============================================================================

router.get('/locations/:locationId/bins', async (req, res) => {
  const locationId = req.params.locationId;
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) return res.json({ bins: listMemoryBins(locationId) });
  const bins = await prisma.bin.findMany({ where: { locationId }, orderBy: { code: 'asc' } });
  return res.json({ bins });
});

router.post('/locations/:locationId/bins', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const locationId = req.params.locationId;
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!code) return res.status(400).json({ message: 'Bin code is required.' });
  if (!databaseEnabled) {
    const bin = createMemoryBin({
      locationId, code,
      zone: req.body.zone || null, aisle: req.body.aisle || null, rack: req.body.rack || null, shelf: req.body.shelf || null,
      capacity: req.body.capacity !== undefined ? Number(req.body.capacity) : null,
      storageClass: req.body.storageClass || null,
    });
    return res.status(201).json({ bin });
  }
  try {
    const bin = await prisma.bin.create({
      data: {
        locationId, code,
        zone: req.body.zone || null, aisle: req.body.aisle || null, rack: req.body.rack || null, shelf: req.body.shelf || null,
        capacity: req.body.capacity !== undefined ? Number(req.body.capacity) : null,
        storageClass: req.body.storageClass || null,
        isPickFace: req.body.isPickFace === true,
        pickFaceMin: req.body.pickFaceMin !== undefined ? Number(req.body.pickFaceMin) : null,
        pickFaceMax: req.body.pickFaceMax !== undefined ? Number(req.body.pickFaceMax) : null,
      },
    });
    return res.status(201).json({ bin });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error && error.message.includes('Unique') ? 'A bin with this code already exists at this location.' : 'Unable to create bin.' });
  }
});

router.patch('/bins/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data: Record<string, unknown> = {};
  for (const field of ['zone', 'aisle', 'rack', 'shelf', 'storageClass', 'status']) {
    if (req.body[field] !== undefined) data[field] = req.body[field] || null;
  }
  if (req.body.capacity !== undefined) data.capacity = req.body.capacity === null ? null : Number(req.body.capacity);
  if (req.body.isPickFace !== undefined) data.isPickFace = req.body.isPickFace === true;
  if (req.body.pickFaceMin !== undefined) data.pickFaceMin = req.body.pickFaceMin === null ? null : Number(req.body.pickFaceMin);
  if (req.body.pickFaceMax !== undefined) data.pickFaceMax = req.body.pickFaceMax === null ? null : Number(req.body.pickFaceMax);
  const bin = await prisma.bin.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!bin) return res.status(404).json({ message: 'Bin not found.' });
  return res.json({ bin });
});

router.post('/locations/:locationId/bin-transfers', async (req, res) => {
  const locationId = req.params.locationId;
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const scannedFromBinCode = typeof req.body.fromBinCode === 'string' ? req.body.fromBinCode : '';
  const scannedToBinCode = typeof req.body.toBinCode === 'string' ? req.body.toBinCode : '';
  const quantity = Number(req.body.quantity);
  if (!itemId) return res.status(400).json({ message: 'itemId is required.' });

  const bins = databaseEnabled
    ? await prisma.bin.findMany({ where: { locationId, status: 'ACTIVE' } })
    : listMemoryBins(locationId);
  const allowedBinCodes = bins.map((bin) => bin.code);

  try {
    assertValidBinMove({ scannedFromBinCode, scannedToBinCode, allowedBinCodes, quantity });
  } catch (error) {
    if (error instanceof BinMoveValidationError) return res.status(400).json({ message: error.message });
    throw error;
  }

  const normalize = (code: string) => code.trim().toUpperCase();
  const fromBin = bins.find((bin) => normalize(bin.code) === normalize(scannedFromBinCode));
  const toBin = bins.find((bin) => normalize(bin.code) === normalize(scannedToBinCode));
  if (!fromBin || !toBin) return res.status(404).json({ message: 'Bin was not found at this location.' });

  try {
    const movement = await moveBinStockPersisted({
      itemId, lotId: typeof req.body.lotId === 'string' ? req.body.lotId : null,
      locationId, binId: fromBin.id, toBinId: toBin.id, quantity,
      reference: typeof req.body.reference === 'string' ? req.body.reference : null,
      actorId: req.user!.id,
    });
    return res.status(201).json({ movement });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to move bin stock.' });
  }
});

router.get('/locations/:locationId/pick-face-replenishment', async (req, res) => {
  const locationId = req.params.locationId;
  if (!canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (!databaseEnabled) return res.json({ suggestions: [] });

  const bins = await prisma.bin.findMany({ where: { locationId, status: 'ACTIVE' } });
  const pickFaceBins = bins.filter((bin) => bin.isPickFace && bin.pickFaceMin !== null);
  if (!pickFaceBins.length) return res.json({ suggestions: [] });
  const reserveBinCodeById = new Map(bins.filter((bin) => !bin.isPickFace).map((bin) => [bin.id, bin.code]));

  const suggestions: Array<{ itemId: string; lotId?: string; fromBinId: string; fromBinCode: string; toBinId: string; toBinCode: string; quantity: number }> = [];
  for (const bin of pickFaceBins) {
    const pickFaceStock = await prisma.binStock.findMany({ where: { locationId, binId: bin.id } });
    const min = bin.pickFaceMin ?? 0;
    const max = bin.pickFaceMax ?? min;
    // One decision per item in this pick face (its rows are per lot, and were suggested separately).
    const onHandByItem = new Map<string, number>();
    for (const row of pickFaceStock) onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + row.onHand);
    for (const [itemId, onHand] of onHandByItem) {
      const reserveRows = await prisma.binStock.findMany({
        where: { locationId, itemId, binId: { in: [...reserveBinCodeById.keys()] } },
      });
      const lotIds = [...new Set(reserveRows.map((row) => row.lotId).filter(Boolean))];
      const lotInfo = new Map((lotIds.length ? await prisma.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, status: true, expiryDate: true } }) : []).map((lot) => [lot.id, lot]));
      const reserveCandidates = reserveRows
        .filter((row) => {
          const lot = lotInfo.get(row.lotId);
          // Never replenish a pick face from a blocked, quarantined or expired lot.
          return !lot || sellableQuantity({ onHand: row.onHand, lot }) > 0;
        })
        .map((row) => ({ binId: row.binId, code: reserveBinCodeById.get(row.binId) ?? row.binId, onHand: row.onHand, lotId: row.lotId || undefined, expiryDate: lotInfo.get(row.lotId)?.expiryDate?.toISOString() ?? null }));
      const suggestion = planPickFaceReplenishment({ binId: bin.id, code: bin.code, onHand, min, max }, reserveCandidates);
      if (suggestion) suggestions.push({ itemId, ...suggestion });
    }
  }
  return res.json({ suggestions });
});

router.get('/putaway-tasks', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const scope = locationId
    ? { locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? {}
      : { locationId: { in: req.user!.locationIds ?? [] } };
  const tasks = await prisma.putawayTask.findMany({
    where: { ...scope, ...(status ? { status } : { status: 'PENDING' }) },
    include: {
      item: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNo: true, expiryDate: true } },
      location: { select: { id: true, code: true, name: true } },
      suggestedBin: { select: { id: true, code: true, zone: true, aisle: true, rack: true, shelf: true } },
      confirmedBin: { select: { id: true, code: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  return res.json({ tasks });
});

router.post('/putaway-tasks/:id/confirm', async (req, res) => {
  const task = await prisma.putawayTask.findUnique({
    where: { id: req.params.id },
    include: { suggestedBin: { select: { id: true, code: true } } },
  });
  if (!task) return res.status(404).json({ message: 'Putaway task not found.' });
  if (!canAccessLocation(req, task.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (task.status !== 'PENDING') return res.status(409).json({ message: 'This putaway task is already resolved.' });
  const bins = await prisma.bin.findMany({ where: { locationId: task.locationId, status: 'ACTIVE' } });
  const requireScan = req.user!.role === 'WAREHOUSE_PICKER' || Boolean(req.body.requireScan);
  let scannedBinCode = typeof req.body.scannedBinCode === 'string' ? req.body.scannedBinCode : '';
  const requestedBinId = typeof req.body.binId === 'string' && req.body.binId ? req.body.binId : task.suggestedBinId;
  const requestedBin = requestedBinId ? bins.find((bin) => bin.id === requestedBinId) : undefined;
  if (!scannedBinCode && requestedBin && !requireScan) scannedBinCode = requestedBin.code;
  const allowOverride = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role) && Boolean(req.body.allowOverride);
  const scanned = assertPutawayScan({
    scannedBinCode,
    suggestedBinCode: task.suggestedBin?.code ?? null,
    allowedBinCodes: bins.map((bin) => bin.code),
    allowOverride,
  });
  if (scanned.ok === false) return res.status(400).json({ message: scanned.message, code: scanned.code });
  const confirmedCode = (scannedBinCode || req.body.binCode || '').toString().trim().toUpperCase();
  const binFromScan = bins.find((bin) => bin.code.toUpperCase() === confirmedCode);
  const binId = binFromScan?.id ?? (typeof req.body.binId === 'string' && req.body.binId ? req.body.binId : task.suggestedBinId);
  if (!binId) return res.status(400).json({ message: 'A bin must be selected to confirm putaway.' });
  const bin = bins.find((row) => row.id === binId) ?? await prisma.bin.findFirst({ where: { id: binId, locationId: task.locationId } });
  if (!bin) return res.status(400).json({ message: 'Bin does not belong to this location.' });
  if (!allowOverride && task.suggestedBin?.code && bin.code.toUpperCase() !== task.suggestedBin.code.toUpperCase()) {
    return res.status(400).json({ message: `Expected bin ${task.suggestedBin.code}; scanned ${bin.code}. Override is required to confirm a different bin.`, code: 'WRONG_BIN' });
  }
  const updated = await prisma.putawayTask.update({
    where: { id: task.id },
    data: { status: 'CONFIRMED', confirmedBinId: bin.id, confirmedAt: new Date(), assignedToId: req.user!.id },
  });
  try {
    await persistBinStockDelta({
      itemId: task.itemId, lotId: task.lotId, locationId: task.locationId, binId: STAGING_BIN_ID, qtyDelta: -task.quantity,
    });
    await persistBinStockDelta({
      itemId: task.itemId, lotId: task.lotId, locationId: task.locationId, binId: bin.id, qtyDelta: task.quantity,
    });
  } catch (error) {
    console.error('bin stock putaway persist failed (non-blocking):', error instanceof Error ? error.message : error);
  }
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'PUTAWAY_CONFIRMED',
    entityType: 'PutawayTask', entityId: task.id, metadata: { binId: bin.id, binCode: bin.code, scanned: true },
  }));
  return res.json({ task: updated, bin: { id: bin.id, code: bin.code } });
});

// ============================================================================
// Serial tracking (blueprint P3 "Traceability 3.0")
// ============================================================================

router.post('/items/:itemId/serials', async (req, res) => {
  const itemId = req.params.itemId;
  const serial = typeof req.body.serial === 'string' ? req.body.serial.trim() : '';
  if (!serial) return res.status(400).json({ message: 'Serial number is required.' });
  const locationId = typeof req.body.locationId === 'string' ? req.body.locationId : null;
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const item = await prisma.item.findFirst({ where: { id: itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!item) return res.status(404).json({ message: 'Item was not found.' });
  const movement = planSerialMovement({
    currentStatus: 'IN_STOCK',
    toStatus: 'IN_STOCK',
    movementType: 'RECEIVE',
    toLocationId: locationId,
    reference: typeof req.body.reference === 'string' ? req.body.reference : null,
    actorId: req.user!.id,
  });
  try {
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.serialNumber.create({
        data: {
          itemId,
          lotId: typeof req.body.lotId === 'string' ? req.body.lotId : null,
          serial,
          status: 'IN_STOCK',
          currentLocationId: locationId,
          warrantyEnd: req.body.warrantyEnd ? new Date(req.body.warrantyEnd) : null,
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        },
      });
      await tx.serialMovement.create({ data: { serialNumberId: record.id, ...movement } });
      return record;
    });
    return res.status(201).json({ serial: created });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error && error.message.includes('Unique') ? 'This serial is already registered for this item.' : 'Unable to register serial.' });
  }
});

router.get('/items/:itemId/serials', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const serials = await prisma.serialNumber.findMany({
    where: { itemId: req.params.itemId, ...(status ? { status } : {}) },
    orderBy: { receivedAt: 'desc' },
  });
  return res.json({ serials });
});

router.get('/serials/:serial', async (req, res) => {
  const record = await prisma.serialNumber.findFirst({ where: { serial: req.params.serial } });
  if (!record) return res.status(404).json({ message: 'Serial was not found.' });
  const movements = await prisma.serialMovement.findMany({ where: { serialNumberId: record.id }, orderBy: { createdAt: 'asc' } });
  return res.json({ serial: record, trace: buildRecallTrace(movements) });
});

router.post('/serials/:serial/move', async (req, res) => {
  const record = await prisma.serialNumber.findFirst({ where: { serial: req.params.serial } });
  if (!record) return res.status(404).json({ message: 'Serial was not found.' });
  const toLocationId = typeof req.body.toLocationId === 'string' ? req.body.toLocationId : null;
  if (toLocationId && !canAccessLocation(req, toLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  let movement;
  try {
    movement = planSerialMovement({
      currentStatus: record.status as SerialStatus,
      toStatus: req.body.toStatus,
      movementType: req.body.movementType,
      fromLocationId: record.currentLocationId,
      toLocationId,
      reference: typeof req.body.reference === 'string' ? req.body.reference : null,
      actorId: req.user!.id,
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid serial transition.' });
  }
  const [, updated] = await prisma.$transaction([
    prisma.serialMovement.create({ data: { serialNumberId: record.id, ...movement } }),
    prisma.serialNumber.update({
      where: { id: record.id },
      data: {
        status: movement.toStatus,
        currentLocationId: toLocationId ?? record.currentLocationId,
        soldAt: movement.toStatus === 'SOLD' ? new Date() : record.soldAt,
        returnState: movement.toStatus === 'RETURNED' ? (req.body.returnState ?? record.returnState) : record.returnState,
      },
    }),
  ]);
  return res.json({ serial: updated });
});

// ============================================================================
// OMS ORDERS + ATP (blueprint Module G / section 13.3) - P7 starter
// ============================================================================

router.get('/orders', async (req, res) => {
  if (!databaseEnabled) {
    const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
    const orders = listMemoryOrders().filter((order) =>
      !locationId || order.fulfillmentLocationId === locationId || order.lines.some((line) => line.fulfillmentLocationId === locationId),
    );
    return res.json({ orders });
  }
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  await expireStaleReservations(companyId);
  await retryBackorderedOrders(companyId);
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (locationId && !canAccessLocation(req, locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const scope = locationId
    ? { fulfillmentLocationId: locationId }
    : ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role)
      ? {}
      : { fulfillmentLocationId: { in: req.user!.locationIds ?? [] } };
  const orders = await prisma.order.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, ...scope, ...(status ? { status } : {}) },
    include: {
      lines: { include: { item: { select: { id: true, code: true, name: true } }, lot: { select: { id: true, lotNo: true } } } },
      fulfillmentLocation: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => []);
  return res.json({ orders });
});

router.post('/orders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const channel = typeof req.body.channel === 'string' ? req.body.channel.trim() : '';
  const fulfillmentLocationId = typeof req.body.fulfillmentLocationId === 'string' && req.body.fulfillmentLocationId ? req.body.fulfillmentLocationId : null;
  const lines: Array<{ itemId: string; quantity: number; minRslPercent?: number }> = Array.isArray(req.body.lines)
    ? req.body.lines.map((line: any) => ({ itemId: String(line.itemId ?? ''), quantity: Number(line.quantity), ...(Number(line.minRslPercent) > 0 && Number(line.minRslPercent) <= 100 ? { minRslPercent: Number(line.minRslPercent) } : {}) })).filter((line: any) => line.itemId && Number.isFinite(line.quantity) && line.quantity > 0)
    : [];
  if (!channel || !lines.length) {
    return res.status(400).json({ message: 'channel and at least one positive-quantity line are required.' });
  }
  if (fulfillmentLocationId && !canAccessLocation(req, fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  try {
    // Blueprint §13.3 routing: no location was specified, so route across
    // every active location rather than requiring the caller to already
    // know which one can fulfil it.
    const candidateLocations = fulfillmentLocationId
      ? undefined
      : await (async () => {
          if (!databaseEnabled) {
            return listLocations().map((location) => ({
              locationId: location.id,
              locationName: location.name,
              locationType: location.type,
            }));
          }
          const locations = await prisma.location.findMany({
            where: { status: 'ACTIVE', companyId: req.companyId ?? DEFAULT_COMPANY_ID },
            select: { id: true, name: true, type: true, latitude: true, longitude: true, deliverySlaHours: true, shippingCostPerKm: true },
          });
          let openOrders: Array<{ fulfillmentLocationId: string; count: number }> = [];
          try {
            const grouped = await prisma.order.groupBy({
              by: ['fulfillmentLocationId'],
              where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, status: { in: ['RESERVED', 'BACKORDERED'] } },
              _count: { _all: true },
            });
            openOrders = grouped.map((row) => ({ fulfillmentLocationId: row.fulfillmentLocationId, count: row._count._all }));
          } catch {
            openOrders = [];
          }
          const workload = new Map(openOrders.map((row) => [row.fulfillmentLocationId, row.count] as const));
          return locations.map((location) => ({
            locationId: location.id,
            locationName: location.name,
            locationType: location.type,
            latitude: location.latitude,
            longitude: location.longitude,
            deliverySlaHours: location.deliverySlaHours,
            shippingCostPerKm: location.shippingCostPerKm,
            openOrderCount: workload.get(location.id) ?? 0,
          }));
        })();
    const reservationTtlMinutes = Number.isFinite(Number(req.body.reservationTtlMinutes)) && Number(req.body.reservationTtlMinutes) > 0
      ? Number(req.body.reservationTtlMinutes) : undefined;
    const order = await createOrderWithReservation({
      channel, fulfillmentLocationId, candidateLocations, lines,
      externalReference: req.body.externalReference || null,
      customerName: req.body.customerName || null,
      notes: req.body.notes || null,
      createdById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      reservationTtlMinutes,
      allowBackorder: Boolean(req.body.allowBackorder),
      allowSplit: req.body.allowSplit !== false,
      customerLatitude: Number.isFinite(Number(req.body.customerLatitude)) ? Number(req.body.customerLatitude) : null,
      customerLongitude: Number.isFinite(Number(req.body.customerLongitude)) ? Number(req.body.customerLongitude) : null,
    });
    return res.status(order.duplicate ? 200 : 201).json({ order, duplicate: Boolean(order.duplicate) });
  } catch (error) {
    if (error instanceof OrderShortageError) return res.status(409).json({ message: error.message, shortages: error.shortages });
    if (error instanceof OrderInsufficientStockError) return res.status(409).json({ message: error.message });
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to create order.' });
  }
});

router.post('/orders/:id/fulfill', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const order = await fulfillOrder(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id, req.user!.id);
    return res.json({ order });
  } catch (error) {
    if (error instanceof Error && error.message === 'Order was not found.') return res.status(404).json({ message: error.message });
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to fulfill order.' });
  }
});

router.post('/orders/:id/cancel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const order = await cancelOrder(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id, req.user!.id);
    return res.json({ order });
  } catch (error) {
    if (error instanceof Error && error.message === 'Order was not found.') return res.status(404).json({ message: error.message });
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to cancel order.' });
  }
});

function requirePacker(req: Request, res: Response): boolean {
  if (!['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin or Warehouse Picker access required.' });
    return false;
  }
  return true;
}

async function packVerificationFor(companyId: string, orderId: string, session: { id: string }) {
  const [order, packedLines] = await Promise.all([
    prisma.order.findFirst({ where: { id: orderId, companyId }, include: { lines: true } }),
    prisma.packedLine.findMany({ where: { packSessionId: session.id } }),
  ]);
  if (!order) return null;
  const expected = order.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.requestedQty }));
  const scanned = packedLines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: line.quantity }));
  return verifyPackScan(expected, scanned);
}

router.post('/orders/:id/pack/start', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  let session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'IN_PROGRESS' } });
  if (!session) {
    session = await prisma.packSession.create({ data: { orderId: order.id, packedById: req.user!.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  }
  const verification = await packVerificationFor(order.companyId, order.id, session);
  return res.status(201).json({ session, verification });
});

router.get('/orders/:id/pack', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
  if (!session) return res.json({ session: null, verification: null });
  const verification = await packVerificationFor(order.companyId, order.id, session);
  return res.json({ session, verification });
});

router.post('/orders/:id/pack/scan', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const itemId = typeof req.body.itemId === 'string' ? req.body.itemId : '';
  const quantity = Number(req.body.quantity ?? 1);
  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ message: 'itemId and a positive quantity are required.' });
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'IN_PROGRESS' } });
  if (!session) return res.status(409).json({ message: 'Start a pack session before scanning items.' });
  await prisma.packedLine.create({
    data: { packSessionId: session.id, itemId, lotId: typeof req.body.lotId === 'string' ? req.body.lotId : null, quantity, scannedById: req.user!.id },
  });
  const verification = await packVerificationFor(order.companyId, order.id, session);
  return res.status(201).json({ session, verification });
});

router.post('/orders/:id/pack/seal', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'IN_PROGRESS' } });
  if (!session) return res.status(409).json({ message: 'No pack session is in progress for this order.' });
  const verification = await packVerificationFor(order.companyId, order.id, session);
  if (!verification?.readyToSeal) {
    return res.status(409).json({ message: 'Every order line must be scanned exactly before sealing.', verification });
  }
  const sealed = await prisma.packSession.update({
    where: { id: session.id },
    data: {
      status: 'SEALED',
      sealedAt: new Date(),
      cartonCount: req.body.cartonCount !== undefined ? Number(req.body.cartonCount) : null,
      weightKg: req.body.weightKg !== undefined ? Number(req.body.weightKg) : null,
      lengthCm: req.body.lengthCm !== undefined ? Number(req.body.lengthCm) : null,
      widthCm: req.body.widthCm !== undefined ? Number(req.body.widthCm) : null,
      heightCm: req.body.heightCm !== undefined ? Number(req.body.heightCm) : null,
    },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'ORDER_PACK_SEALED',
    entityType: 'PackSession', entityId: sealed.id,
    metadata: { orderId: order.id, cartonCount: sealed.cartonCount, weightKg: sealed.weightKg },
  }));
  return res.json({ session: sealed, verification });
});

router.post('/orders/:id/ship', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const session = await prisma.packSession.findFirst({ where: { orderId: order.id, status: 'SEALED' }, orderBy: { sealedAt: 'desc' } });
  if (!session) return res.status(409).json({ message: 'Seal a pack session before shipping this order.' });

  const provider = typeof req.body.provider === 'string' && req.body.provider ? req.body.provider : 'local';
  let adapter;
  try {
    adapter = getCarrierAdapter(provider);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unknown carrier provider.' });
  }

  try {
    const result = await adapter.createShipment({
      orderReference: order.externalReference || order.id,
      originPincode: typeof req.body.originPincode === 'string' ? req.body.originPincode : '',
      destinationPincode: typeof req.body.destinationPincode === 'string' ? req.body.destinationPincode : '',
      weightKg: session.weightKg ?? 0,
      lengthCm: session.lengthCm, widthCm: session.widthCm, heightCm: session.heightCm,
    });
    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id, packSessionId: session.id, carrierProvider: adapter.provider,
        awbNumber: result.awbNumber, serviceCode: result.serviceCode, labelUrl: result.labelUrl, manifestId: result.manifestId,
        weightKg: session.weightKg, createdById: req.user!.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      },
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'ORDER_SHIPPED',
      entityType: 'Shipment', entityId: shipment.id,
      metadata: { orderId: order.id, awbNumber: shipment.awbNumber, carrierProvider: shipment.carrierProvider },
    }));
    return res.status(201).json({ shipment });
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Unable to book this shipment.' });
  }
});

router.get('/orders/:id/shipment', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const shipment = await prisma.shipment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
  if (!shipment) return res.json({ shipment: null, tracking: null });
  const adapter = getCarrierAdapter(shipment.carrierProvider);
  const tracking = await adapter.trackShipment(shipment.awbNumber).catch(() => null);
  return res.json({ shipment, tracking });
});

router.post('/shipments/:awb/cancel', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const shipment = await prisma.shipment.findFirst({ where: { awbNumber: req.params.awb, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!shipment) return res.status(404).json({ message: 'Shipment not found.' });
  if (!canAccessLocation(req, (await prisma.order.findFirst({ where: { id: shipment.orderId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } }))?.fulfillmentLocationId ?? '')) {
    return res.status(403).json({ message: 'Location access denied.' });
  }
  try {
    const adapter = getCarrierAdapter(shipment.carrierProvider);
    await adapter.cancelShipment(shipment.awbNumber);
    const updated = await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'CANCELLED' } });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'ORDER_SHIPMENT_CANCELLED',
      entityType: 'Shipment', entityId: shipment.id, metadata: { awbNumber: shipment.awbNumber },
    }));
    return res.json({ shipment: updated });
  } catch (error) {
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to cancel this shipment.' });
  }
});

// Blueprint "Returns/RMA: a formal customer-return/RMA/inspection flow" -
// additive on top of Order/OrderLine, same as pack/ship above. Status
// moves through lib/returns-rma.ts's state machine; only a RECEIVE action
// on a RESTOCK-disposition line ever posts stock back onto the ledger.
router.post('/orders/:id/returns', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });

  const requestedLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const existingReturns = await prisma.returnLine.findMany({
    where: { orderLine: { orderId: order.id } },
    select: { orderLineId: true, quantity: true },
  });
  const alreadyReturnedByLine = new Map<string, number>();
  for (const line of existingReturns) {
    alreadyReturnedByLine.set(line.orderLineId, (alreadyReturnedByLine.get(line.orderLineId) ?? 0) + line.quantity);
  }
  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const validationInput = requestedLines
    .map((line: { orderLineId?: string; quantity?: number }) => {
      const orderLine = orderLinesById.get(String(line.orderLineId));
      return {
        orderLineId: String(line.orderLineId || ''),
        quantity: Number(line.quantity),
        fulfilledQty: orderLine?.fulfilledQty ?? 0,
        alreadyReturnedQty: alreadyReturnedByLine.get(String(line.orderLineId)) ?? 0,
      };
    })
    .filter((line) => orderLinesById.has(line.orderLineId));
  const validation = validateReturnLines(validationInput);
  if (!validation.ok) return res.status(400).json({ message: 'Invalid return lines.', errors: validation.errors });

  const returnRequest = await prisma.returnRequest.create({
    data: {
      orderId: order.id,
      reason: typeof req.body.reason === 'string' ? req.body.reason : null,
      createdById: req.user!.id,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
      lines: {
        create: validationInput.map((line) => ({
          orderLineId: line.orderLineId,
          itemId: orderLinesById.get(line.orderLineId)!.itemId,
          quantity: line.quantity,
        })),
      },
    },
    include: { lines: true },
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'RETURN_REQUESTED',
    entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { orderId: order.id, lines: returnRequest.lines.length },
  }));
  return res.status(201).json({ returnRequest });
});

router.get('/orders/:id/returns', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!canAccessLocation(req, order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  const returnRequests = await prisma.returnRequest.findMany({ where: { orderId: order.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  return res.json({ returnRequests });
});

// Blueprint v4 §24: what QC says about a returned line, and whether QC applies.
async function returnQcContext(companyId: string, returnRequestId: string, itemIds: string[]) {
  const { listMemoryQcTemplates, listMemoryQcInspections } = await import('../lib/qc-inspection.js');
  const templates: Array<{ id: string; category: string | null; active: boolean }> = databaseEnabled
    ? await prisma.qcChecklistTemplate.findMany({ where: { active: true } }).catch(() => listMemoryQcTemplates().filter((row) => row.active))
    : listMemoryQcTemplates().filter((row) => row.active);
  const inspections: InspectionLike[] = databaseEnabled
    ? await prisma.qcInspection.findMany({ where: { sourceDocument: returnRequestId } }).catch(() => [])
    : listMemoryQcInspections().filter((row) => row.sourceDocument === returnRequestId);
  const categories = new Map<string, string | null>();
  if (databaseEnabled && itemIds.length) {
    for (const row of await prisma.item.findMany({ where: { id: { in: itemIds }, companyId }, select: { id: true, category: true } })) categories.set(row.id, row.category ?? null);
  } else {
    for (const item of listItems()) categories.set(item.id, item.category ?? null);
  }
  return {
    qcRequired: (itemId: string) => findTemplateForCategory(templates, categories.get(itemId) ?? null) !== null,
    verdict: (itemId: string, lineId: string) => verdictForLine(inspections, { itemId, lineId }),
  };
}

async function returnLot(returnRequestId: string, itemId: string) {
  const lotNo = `RMA-${returnRequestId}`;
  const lot = await prisma.lot.upsert({
    where: { itemId_lotNo: { itemId, lotNo } },
    update: {},
    create: { itemId, lotNo, attributes: { source: 'return', returnRequestId } },
  });
  try {
    ensureLotRecord(itemId, lotNo, null, { source: 'return' }, lot.id);
  } catch {
    // Item may not be in the in-memory catalogue during isolated tests.
  }
  return lot;
}

router.patch('/returns/:id/status', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const returnRequest = await prisma.returnRequest.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true, order: true } });
  if (!returnRequest) return res.status(404).json({ message: 'Return request not found.' });
  if (!canAccessLocation(req, returnRequest.order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });

  const action = String(req.body.action || '') as ReturnAction;
  const nextStatus = nextReturnStatus(returnRequest.status as never, action);
  if (!nextStatus) return res.status(409).json({ message: `Cannot apply action ${action} to a return in status ${returnRequest.status}.` });

  const locationId = returnRequest.order.fulfillmentLocationId;
  if (action === 'CLOSE') {
    const closable = canCloseReturn(returnRequest.lines);
    if ('message' in closable) return res.status(409).json({ message: closable.message });
  }

  if (action === 'RECEIVE') {
    const dispositions = req.body.dispositions && typeof req.body.dispositions === 'object' ? req.body.dispositions as Record<string, string> : {};
    const qc = await returnQcContext(returnRequest.companyId, returnRequest.id, returnRequest.lines.map((line) => line.itemId));
    // Decide every line before touching stock, so one bad line cannot leave the return half-received.
    const plans = [];
    for (const line of returnRequest.lines) {
      const plan = planReturnLine({ requested: dispositions[line.id], qcRequired: qc.qcRequired(line.itemId), verdict: qc.verdict(line.itemId, line.id) });
      if ('message' in plan) return res.status(400).json({ message: plan.message, lineId: line.id });
      plans.push({ line, plan });
    }
    for (const { line, plan } of plans) {
      await prisma.returnLine.update({ where: { id: line.id }, data: { disposition: plan.disposition } });
      const lot = await returnLot(returnRequest.id, line.itemId);
      if (plan.action === 'RESTOCK') {
        await prisma.$transaction((tx) => postInventoryMovementInTransaction(tx, {
          tenant: tenantContextOf(req), itemId: line.itemId, lotId: lot.id, locationId,
          movementType: 'SALES_RETURN', qtyDelta: line.quantity,
          idempotencyKey: `return-restock:${returnRequest.id}:${line.id}`,
          reason: 'Customer return restocked after inspection', sourceDocument: returnRequest.id, sourceLineId: line.id, correlationId: returnRequest.orderId,
        }));
        adjustStockLedger(line.itemId, lot.id, locationId, line.quantity);
      } else if (plan.action === 'HOLD') {
        // Physically back in the building but not sellable: quarantine until a disposition is decided.
        await prisma.stockLedger.upsert({
          where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: lot.id, locationId } },
          update: { quarantine: { increment: line.quantity }, version: { increment: 1 } },
          create: { itemId: line.itemId, lotId: lot.id, locationId, onHand: 0, quarantine: line.quantity, version: 1 },
        });
        adjustQuarantineLedger(line.itemId, lot.id, locationId, line.quantity);
        void createExceptionCase({
          type: plan.disposition === 'QC_FAILED' ? 'QC_FAIL' : 'QUARANTINE',
          title: plan.disposition === 'QC_FAILED' ? 'Returned goods failed QC' : 'Returned goods awaiting inspection',
          description: plan.note ?? null,
          itemId: line.itemId, lotId: lot.id, locationId, quantity: line.quantity,
          sourceDocument: returnRequest.id, sourceLineId: line.id, reportedById: req.user!.id,
          companyId: returnRequest.companyId,
        });
      }
      await persistAudit(recordAudit({
        actorId: req.user!.id, actorRole: req.user!.role, action: 'RETURN_LINE_RECEIVED',
        entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { lineId: line.id, quantity: line.quantity, disposition: plan.disposition },
      }));
    }
  }

  const updated = await transitionReturnStatus({
    entityId: returnRequest.id,
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    action,
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: `RETURN_${action}`,
    entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { orderId: returnRequest.orderId, status: nextStatus },
  }));
  return res.json({ returnRequest: updated });
});

// Decide a held line: restock (needs a passing QC where QC applies), scrap, or send back to the vendor.
router.post('/returns/:id/lines/:lineId/disposition', async (req, res) => {
  if (!requirePacker(req, res)) return;
  const returnRequest = await prisma.returnRequest.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true, order: true } });
  if (!returnRequest) return res.status(404).json({ message: 'Return request not found.' });
  if (!canAccessLocation(req, returnRequest.order.fulfillmentLocationId)) return res.status(403).json({ message: 'Location access denied.' });
  if (returnRequest.status !== 'RECEIVED') return res.status(409).json({ message: 'Only a received return can have its lines disposed.' });
  const line = returnRequest.lines.find((row) => row.id === req.params.lineId);
  if (!line) return res.status(404).json({ message: 'Return line was not found.' });
  if (!isPendingDisposition(line.disposition)) return res.status(409).json({ message: `This line was already dispositioned as ${line.disposition}.` });

  const qc = await returnQcContext(returnRequest.companyId, returnRequest.id, [line.itemId]);
  const plan = planReturnLine({ requested: String(req.body.disposition ?? ''), qcRequired: qc.qcRequired(line.itemId), verdict: qc.verdict(line.itemId, line.id) });
  if ('message' in plan) return res.status(400).json({ message: plan.message });
  if (plan.action === 'HOLD') return res.status(409).json({ message: plan.note ?? 'This line must stay in quarantine.' });

  const locationId = returnRequest.order.fulfillmentLocationId;
  const lot = await returnLot(returnRequest.id, line.itemId);
  const ledger = await prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: lot.id, locationId } } });
  if (!ledger || ledger.quarantine + 1e-8 < line.quantity) return res.status(409).json({ message: 'The quarantined quantity for this line was not found.' });
  const restock = plan.action === 'RESTOCK';
  await prisma.$transaction(async (tx) => {
    await tx.stockLedger.update({
      where: { id: ledger.id },
      data: {
        quarantine: { decrement: line.quantity },
        ...(plan.action === 'SCRAP' ? { damaged: { increment: line.quantity } } : {}),
        version: { increment: 1 },
      },
    });
    if (restock) {
      await postInventoryMovementInTransaction(tx, {
        tenant: tenantContextOf(req), itemId: line.itemId, lotId: lot.id, locationId,
        movementType: 'SALES_RETURN', qtyDelta: line.quantity,
        idempotencyKey: `return-disposition:${returnRequest.id}:${line.id}`,
        reason: `Return disposition: ${plan.disposition}`, sourceDocument: returnRequest.id, sourceLineId: line.id, correlationId: returnRequest.orderId,
      });
    } else {
      // Quarantine -> damaged/other is a bucket move, not an on-hand change: zero-delta journal row.
      await tx.stockMovement.create({
        data: {
          itemId: line.itemId, lotId: lot.id, locationId, movementType: plan.action === 'SCRAP' ? 'DAMAGE' : 'ADJUSTMENT',
          qtyDelta: 0, beforeBalance: ledger.onHand, afterBalance: ledger.onHand,
          sourceDocument: returnRequest.id, sourceLineId: line.id, actor: req.user!.id, timestamp: new Date(), correlationId: returnRequest.orderId,
          reason: `Return disposition: ${plan.disposition}`, metadata: { quarantineDelta: -line.quantity },
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        } as never,
      });
    }
  });
  adjustQuarantineLedger(line.itemId, lot.id, locationId, -line.quantity);
  if (restock) adjustStockLedger(line.itemId, lot.id, locationId, line.quantity);
  await prisma.returnLine.update({ where: { id: line.id }, data: { disposition: plan.disposition } });
  // The quarantine case opened at receipt is decided by this action.
  await prisma.exceptionCase.updateMany({
    where: { companyId: returnRequest.companyId, sourceDocument: returnRequest.id, sourceLineId: line.id, status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  }).catch(() => undefined);
  await persistAudit(recordAudit({
    actorId: req.user!.id, actorRole: req.user!.role, action: 'RETURN_LINE_DISPOSED',
    entityType: 'ReturnRequest', entityId: returnRequest.id, metadata: { lineId: line.id, disposition: plan.disposition, quantity: line.quantity },
  }));
  const refreshed = await prisma.returnRequest.findFirst({ where: { id: returnRequest.id, companyId: returnRequest.companyId }, include: { lines: true } });
  return res.json({ returnRequest: refreshed });
});

// Blueprint v4 §24 "Refund status": a finance decision, recorded separately from the stock disposition.
router.patch('/returns/:id/refund', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const decision = parseRefundDecision(req.body.status);
  if (!decision) return res.status(400).json({ message: 'Refund status must be REFUNDED or DENIED.' });
  const returnRequest = await prisma.returnRequest.findFirst({ where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID } });
  if (!returnRequest) return res.status(404).json({ message: 'Return request not found.' });
  if (!['RECEIVED', 'CLOSED'].includes(returnRequest.status)) return res.status(409).json({ message: 'A refund can be decided once the goods have been received.' });
  const updated = await prisma.returnRequest.update({
    where: { id: returnRequest.id, companyId: returnRequest.companyId },
    data: { refundStatus: decision, refundNote: typeof req.body.note === 'string' ? req.body.note.slice(0, 2000) : null, refundedAt: new Date(), refundedById: req.user!.id },
  });
  await persistAudit(recordAudit({ actorId: req.user!.id, actorRole: req.user!.role, action: `RETURN_REFUND_${decision}`, entityType: 'ReturnRequest', entityId: returnRequest.id }));
  return res.json({ returnRequest: updated });
});

// Manual trigger for visibility/testing - GET /orders and every order
// mutation already sweep expired reservations lazily, so this is never
// required for correctness, only for an admin to force it on demand.
router.post('/orders/expire-reservations', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const expiredCount = await expireStaleReservations(req.companyId ?? DEFAULT_COMPANY_ID);
  return res.json({ expiredCount });
});

// Manual trigger for visibility/testing - GET /orders already retries
// every BACKORDERED order lazily, so this is never required for
// correctness either, only for an admin to force it on demand (e.g. right
// after receiving new stock, before the next order list happens to run).
router.post('/orders/retry-backorders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const filledCount = await retryBackorderedOrders(req.companyId ?? DEFAULT_COMPANY_ID);
  return res.json({ filledCount });
});

router.post('/orders/:id/retry-backorder', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const order = await retryBackorderAllocation(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id);
  if (!order) return res.status(404).json({ message: 'Order was not found.' });
  return res.json({ order });
});

// ============================================================================
// APPROVAL RULES + REQUESTS (blueprint section 16.2)
// ============================================================================

router.get('/approval-rules', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const rules = await prisma.approvalRule.findMany({
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ rules });
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
  try {
    const rule = await prisma.approvalRule.create({
      data: { label, triggerType, valueThreshold, requiredApproverRole, branchId: req.body.branchId || null, createdById: req.user!.id },
      include: { branch: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ rule });
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
  const rule = await prisma.approvalRule.update({ where: { id: req.params.id }, data, include: { branch: { select: { id: true, name: true } } } }).catch(() => null);
  if (!rule) return res.status(404).json({ message: 'Approval rule not found.' });
  return res.json({ rule });
});

router.get('/approval-requests', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
  const requests = await prisma.approvalRequest.findMany({
    where: status === 'all' ? {} : { status },
    include: {
      rule: { select: { id: true, label: true, requiredApproverRole: true } },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => []);
  return res.json({ requests });
});

router.post('/approval-requests/:id/decide', async (req, res) => {
  const decision = req.body.decision === 'APPROVED' || req.body.decision === 'REJECTED' ? req.body.decision : null;
  if (!decision) return res.status(400).json({ message: 'decision must be APPROVED or REJECTED.' });
  try {
    const request = await decideApprovalRequest(req.params.id, req.user!.id, req.user!.role, decision, req.body.notes || null);
    return res.json({ request });
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
    include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ rules });
});

router.post('/tolerance-rules', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const valueThreshold = req.body.valueThreshold !== undefined && req.body.valueThreshold !== '' ? Number(req.body.valueThreshold) : null;
  const percentThreshold = req.body.percentThreshold !== undefined && req.body.percentThreshold !== '' ? Number(req.body.percentThreshold) : null;
  if (!label || (valueThreshold === null && percentThreshold === null)) {
    return res.status(400).json({ message: 'label and at least one of valueThreshold/percentThreshold are required.' });
  }
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
    return res.status(201).json({ rule });
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
  const rule = await prisma.toleranceRule.update({ where: { id: req.params.id }, data, include: { branch: { select: { id: true, name: true } } } }).catch(() => null);
  if (!rule) return res.status(404).json({ message: 'Tolerance rule not found.' });
  return res.json({ rule });
});

// ============================================================================
// EVIDENCE RULES (blueprint section 16.2, "damaged receipt > threshold ->
// photo mandatory")
// ============================================================================

router.get('/evidence-rules', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const rules = await prisma.evidenceRule.findMany({
    include: { branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return res.json({ rules });
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
    return res.status(201).json({ rule });
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
  const rule = await prisma.evidenceRule.update({ where: { id: req.params.id }, data, include: { branch: { select: { id: true, name: true } } } }).catch(() => null);
  if (!rule) return res.status(404).json({ message: 'Evidence rule not found.' });
  return res.json({ rule });
});

// ============================================================================
// QC CHECKLIST (blueprint §8.2 - seal/packaging/weight/moisture/expiry-
// window checks, replacing a free-text exception description)
// ============================================================================

router.get('/qc-templates', async (req, res) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(req.user!.role)) return res.status(403).json({ message: 'Admin or Branch Manager access required.' });
  const templates = await prisma.qcChecklistTemplate.findMany({
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
  const template = await prisma.qcChecklistTemplate.update({ where: { id: req.params.id }, data }).catch(() => null);
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
    where: { ...(sourceDocument ? { sourceDocument } : {}), ...(sourceLineId ? { sourceLineId } : {}) },
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
    cases,
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
    if (req.body.ownerId !== undefined) data.ownerId = req.body.ownerId || null;
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
  return res.json({ case: updated });
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
  return res.json({ case: updated });
});

router.get('/locations/:locationId/bin-stock', async (req, res) => {
  if (!canAccessLocation(req, req.params.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const items = listItems();
  const serializeMemory = () => {
    if (!memoryBinStock.list({ locationId: req.params.locationId }).some((row) => row.onHand > 0)) {
      for (const row of listStockLedgerForLocation(req.params.locationId)) {
        if (row.onHand > 0) {
          memoryBinStock.apply({ itemId: row.itemId, lotId: row.lotId, locationId: req.params.locationId, binId: STAGING_BIN_ID }, row.onHand);
        }
      }
    }
    return memoryBinStock.list({ locationId: req.params.locationId }).filter((row) => row.onHand > 0).map((row) => ({
      ...row,
      item: items.find((item) => item.id === row.itemId) ?? { id: row.itemId, code: row.itemId, name: row.itemId },
    }));
  };
  if (!databaseEnabled) return res.json({ bins: serializeMemory() });
  const rows = await prisma.binStock.findMany({
    where: { locationId: req.params.locationId, onHand: { gt: 0 } },
    include: { item: { select: { id: true, code: true, name: true } }, location: { select: { id: true, name: true } } },
    orderBy: [{ binId: 'asc' }, { itemId: 'asc' }],
    take: 500,
  }).catch(() => []);
  if (rows.length) return res.json({ bins: rows });
  return res.json({ bins: serializeMemory() });
});

router.post('/pick-waves/:id/scan', async (req, res) => {
  if (!databaseEnabled) {
    const walkOrder = Array.isArray(req.body.walkOrder) ? req.body.walkOrder.map(String) : [];
    const scannedIndex = Number.isFinite(Number(req.body.scannedIndex)) ? Number(req.body.scannedIndex) : 0;
    const decision = assertGuidedWalkScan({
      scannedBinCode: String(req.body.scannedBinCode ?? ''),
      walkOrder,
      scannedIndex,
    });
    if (decision.ok === false) return res.status(400).json({ message: decision.message, code: decision.code, expected: walkOrder[scannedIndex] ?? null, walkOrder });
    return res.json({ ok: true, nextBin: walkOrder[scannedIndex + 1] ?? null, walkOrder, scannedIndex: scannedIndex + 1 });
  }
  const wave = await prisma.pickWave.findFirst({ where: { id: req.params.id, location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } } });
  if (!wave) return res.status(404).json({ message: 'Pick wave not found.' });
  if (!canAccessLocation(req, wave.locationId)) return res.status(403).json({ message: 'Location access denied.' });
  const transferIds = Array.isArray(wave.transferIds) ? wave.transferIds.map(String) : [];
  const walkBins: string[] = [];
  for (const transferId of transferIds) {
    const transfer = await prisma.transfer.findFirst({ where: { id: transferId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { lines: true } }).catch(() => null);
    if (!transfer) continue;
    for (const line of transfer.lines) {
      const bin = await lastKnownBin(wave.locationId, line.itemId, line.lotId ?? '');
      if (bin?.code) walkBins.push(bin.code);
    }
  }
  const walkOrder = [...new Set(walkBins.map((code) => code.toUpperCase()))].sort((a, b) => {
    const binA = walkBins.find((code) => code.toUpperCase() === a);
    const binB = walkBins.find((code) => code.toUpperCase() === b);
    return sequenceKeyForBin({ code: binA ?? a }).localeCompare(sequenceKeyForBin({ code: binB ?? b }));
  });
  const scannedIndex = Number.isFinite(Number(req.body.scannedIndex)) ? Number(req.body.scannedIndex) : 0;
  const decision = assertGuidedWalkScan({
    scannedBinCode: String(req.body.scannedBinCode ?? ''),
    walkOrder,
    scannedIndex,
  });
  if (decision.ok === false) return res.status(400).json({ message: decision.message, code: decision.code, expected: walkOrder[scannedIndex] ?? null, walkOrder });
  return res.json({ ok: true, nextBin: walkOrder[scannedIndex + 1] ?? null, walkOrder, scannedIndex: scannedIndex + 1 });
});

router.get('/mobile/home', async (req, res) => {
  return res.json({ home: mobileHomeForRole(req.user!.role) });
});

router.get('/saas/plans', async (_req, res) => {
  return res.json({ plans: SAAS_PLANS });
});

router.get('/saas/tenants', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  return res.json({ tenants: listTenants(), entitlements: SAAS_PLANS });
});

router.post('/saas/onboard', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const companyName = String(req.body.companyName ?? '').trim();
    const adminName = String(req.body.adminName ?? '').trim();
    const adminEmail = String(req.body.adminEmail ?? '').trim().toLowerCase();
    const planCode = String(req.body.planCode ?? 'starter');
    const password = String(req.body.password ?? 'ChangeMe123!');
    const { tenant, subscription } = provisionTenant({ companyName, adminName, adminEmail, planCode });
    if (findUserByEmail(adminEmail)) {
      return res.status(409).json({ message: 'An account with that admin email already exists.', tenant, subscription });
    }
    const selectedPlan = findPlan(planCode);
    if (!selectedPlan) return res.status(400).json({ message: 'Unknown or inactive plan.' });
    const plan = planCode === 'enterprise' ? 'enterprise' : planCode === 'growth' ? 'pro' : 'free';
    const company = createCompany({
      name: companyName, email: adminEmail, plan, industry: 'retail',
    });
    const user = createEnhancedUser({
      companyId: tenant.id,
      email: adminEmail,
      name: adminName,
      role: 'ADMIN',
      branchIds: [],
      locationIds: [],
      passwordHash: hashPassword(password),
      status: 'active',
    });
    await persistAudit(recordAudit({
      actorId: req.user!.id, actorRole: req.user!.role, action: 'TENANT_PROVISIONED',
      entityType: 'Tenant', entityId: tenant.id,
      metadata: { planCode, adminEmail, companyId: company.id, userId: user.id },
    }));
    return res.status(201).json({ tenant, subscription, company, user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to provision tenant.' });
  }
});

router.get('/connectors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tenantId = req.user!.companyId ?? 'default-company';
  if (databaseEnabled) {
    const rows = await prisma.marketplaceConnector.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }).catch(() => []);
    return res.json({ connectors: rows.length ? rows : listConnectors(tenantId) });
  }
  return res.json({ connectors: listConnectors(tenantId) });
});

router.post('/connectors', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = String(req.body.name ?? '').trim();
  const platform = String(req.body.platform ?? '').toUpperCase() as ConnectorPlatform;
  if (!name || !['AMAZON', 'FLIPKART', 'WEBSITE', 'CUSTOM'].includes(platform)) {
    return res.status(400).json({ message: 'name and platform (AMAZON, FLIPKART, WEBSITE, CUSTOM) are required.' });
  }
  const tenantId = req.user!.companyId ?? 'default-company';
  const webhookSecret = String(req.body.webhookSecret ?? `whsec_${Math.random().toString(36).slice(2, 14)}`);
  const memory = createConnector({ name, platform, webhookSecret, tenantId, channel: req.body.channel });
  if (databaseEnabled) {
    const row = await prisma.marketplaceConnector.create({
      data: { id: memory.id, name, platform, channel: memory.channel, webhookSecret, tenantId, status: 'ACTIVE' },
    }).catch(() => memory);
    return res.status(201).json({ connector: { ...row, webhookSecret } });
  }
  return res.status(201).json({ connector: memory });
});

router.post('/connectors/:id/ingest', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const memoryConnector = findConnector(req.params.id);
  const connector = (memoryConnector && memoryConnector.tenantId === (req.companyId ?? DEFAULT_COMPANY_ID) ? memoryConnector : undefined)
    ?? (databaseEnabled ? await prisma.marketplaceConnector.findFirst({ where: { id: req.params.id, tenantId: req.companyId ?? DEFAULT_COMPANY_ID } }) : null);
  if (!connector) return res.status(404).json({ message: 'Connector not found.' });
  if (!tenantAllows(req.user!.companyId ?? 'default-company', 'connectors') && !tenantAllows('default-company', 'connectors')) {
    return res.status(403).json({ message: 'Marketplace connectors are not on the current plan.' });
  }
  const payloads = Array.isArray(req.body.orders) ? req.body.orders : [req.body];
  const created = [];
  const duplicates = [];
  const errors = [];
  for (const payload of payloads) {
    const mapped = mapMarketplaceOrder(connector.platform as ConnectorPlatform, payload && typeof payload === 'object' ? payload : {});
    const invalid = validateNormalizedOrder(mapped);
    if (invalid) { errors.push({ reference: mapped.externalReference, message: invalid }); continue; }
    const lines = [];
    for (const line of mapped.lines) {
      const memoryItem = listItems().find((entry) => entry.code === line.sku || entry.id === line.sku);
      const item = !databaseEnabled
        ? memoryItem
        : await prisma.item.findFirst({ where: { OR: [{ code: line.sku }, { id: line.sku }], companyId: req.companyId ?? DEFAULT_COMPANY_ID } }).catch(() => null) ?? memoryItem;
      if (!item) { errors.push({ reference: mapped.externalReference, message: `Unknown SKU ${line.sku}` }); continue; }
      lines.push({ itemId: item.id, quantity: line.quantity });
    }
    if (!lines.length) continue;
    try {
      const locations = databaseEnabled
        ? await prisma.location.findMany({ where: { status: 'ACTIVE', companyId: req.companyId ?? DEFAULT_COMPANY_ID }, select: { id: true, name: true, type: true } })
        : listLocations().map((location) => ({ id: location.id, name: location.name, type: location.type }));
      const order = await createOrderWithReservation({
        channel: mapped.channel,
        externalReference: mapped.externalReference,
        customerName: mapped.customerName,
        notes: mapped.notes,
        createdById: req.user!.id,
        companyId: req.companyId ?? DEFAULT_COMPANY_ID,
        allowSplit: true,
        candidateLocations: locations.map((location) => ({ locationId: location.id, locationName: location.name, locationType: location.type })),
        lines,
      });
      if (order.duplicate) duplicates.push(order); else created.push(order);
    } catch (error) {
      errors.push({ reference: mapped.externalReference, message: error instanceof Error ? error.message : 'Unable to reserve order.' });
    }
  }
  markConnectorIngested(connector.id);
  if (databaseEnabled) {
    await prisma.marketplaceConnector.update({ where: { id: connector.id }, data: { lastIngestedAt: new Date() } }).catch(() => undefined);
  }
  // A payload the platform already delivered is not an error: it is acknowledged with the order it produced.
  return res.status(created.length ? 201 : duplicates.length ? 200 : 409).json({ orders: created, duplicates, errors });
});

router.get('/webhook-deliveries', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const memory = listWebhookDeliveries();
  if (!databaseEnabled) return res.json({ deliveries: memory });
  const persisted = await prisma.webhookDeliveryLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const seen = new Set(memory.map((row) => row.id));
  return res.json({
    deliveries: [
      ...memory,
      ...persisted.filter((row) => !seen.has(row.id)).map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      })),
    ].slice(0, 100),
  });
});

router.post('/webhook-deliveries/:id/replay', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const delivery = await replayDelivery(req.params.id);
    return res.json({ delivery });
  } catch (error) {
    if (error instanceof WebhookReplayError) return res.status(409).json({ message: error.message });
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Unable to replay this delivery.' });
  }
});

// Manual trigger for visibility/testing, mirroring /orders/expire-reservations
// - the sweep also runs implicitly whenever this is called, but nothing
// currently schedules it automatically, so an operator (or a future cron)
// drives dead-letter recovery from here.
router.post('/webhook-deliveries/retry-due', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await retryDueDeliveries();
  return res.json(result);
});

export default router;
