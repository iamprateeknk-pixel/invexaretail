import { loadSalesEvents, signedSalesQty, totalsByItem } from '../lib/sales-demand.js';
import { decimalsToNumbers } from '../lib/decimal-json.js';
import { newDocumentNumber } from '../lib/document-number.js';
import { type Request, type Response, Router } from 'express';
import { prisma } from '../lib/db.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { recordAudit } from '../lib/audit.js';
import { planRuleReplenishment } from '../lib/replenishment.js';
import { sellableQuantity, totalSellable } from '../lib/sellable-stock.js';
import { ExpiryWriteOffError, setLotExpiryDate, setLotSaleStatus } from '../lib/expiry-lifecycle.js';
import { consumeJobLine, JobConsumeError } from '../lib/job-consumption-service.js';
import { getActiveWorkflow } from '../lib/industry-packs.js';
import { respondWhenMemoryUnavailable } from '../lib/memory-mode.js';
import { databaseEnabled, persistAudit } from '../lib/persistence.js';
import { buildReplenishmentIntelligence, listReorderRules } from '../lib/reorder-store.js';
import { adjustQuarantineLedger, adjustStockLedger, ensureLotRecord, listItems, listLocations, listStockLedger, updateLotExpiry, updateLotStatus } from '../lib/repository.js';
import { createExceptionCase } from '../lib/exceptions.js';
import { createOrderWithReservation, fulfillOrder, cancelOrder, expireStaleReservations, retryBackorderedOrders, retryBackorderAllocation, OrderShortageError, OrderInsufficientStockError, listMemoryOrders } from '../lib/orders.js';
import { listMemoryQcTemplates, listMemoryQcInspections, findTemplateForCategory } from '../lib/qc-inspection.js';
import { verifyPackScan } from '../lib/pack-verification.js';
import { getCarrierAdapter } from '../lib/carrier-adapter.js';
import { canCloseReturn, isPendingDisposition, nextReturnStatus, parseRefundDecision, planReturnLine, validateReturnLines, type ReturnAction } from '../lib/returns-rma.js';
import { transitionReturnStatus } from '../lib/domain-policies.js';
import { verdictForLine, type InspectionLike } from '../lib/qc-gate.js';
import { censorStockoutDays, classifyDemandPattern, computeDemandStats, openingBalancesByDay, crostonDailyDemand, suggestReplenishment, xyzClass } from '../lib/demand-forecast.js';
import { OPEN_PO_STATUSES } from '../lib/po-planning.js';
import { buildExpiryActionRecommendations, buildLotBlockRecommendations, buildOverstockRecommendations } from '../lib/intelligence-actions.js';
import { createConnector, findConnector, listConnectors, mapMarketplaceOrder, markConnectorIngested, validateNormalizedOrder, type ConnectorPlatform } from '../lib/connectors.js';
import { findPlan, listTenants, provisionTenant, SAAS_PLANS, tenantAllows } from '../lib/saas.js';
import { mobileHomeForRole } from '../lib/mobile-role.js';
import { createCompany, createEnhancedUser, findUserByEmail } from '../lib/enterprise-repository.js';
import { hashPassword, validatePassword } from '../lib/otp-auth.js';
import { isKnownDefaultPassword } from '../lib/production-guard.js';
import { DEFAULT_COMPANY_ID, ownerOfItem } from '../lib/saas/tenant-scope.js';
import { postInventoryMovementInTransaction, NegativeStockBlockedError } from '../lib/inventory-posting-service.js';
import { tenantContextOf, canAccessLocation, requireAdmin, requirePlatformOperator } from './opext-shared.js';
import collabRouter from './opext-collab.ts';
import serialsRouter from './opext-serials.ts';
import webhooksRouter from './opext-webhooks.ts';
import { webhookDeliveriesRouter } from './opext-webhooks.ts';
import rulesRouter from './opext-rules.ts';
import expiryRouter from './opext-expiry.ts';
import binsRouter from './opext-bins.ts';
import { binStockRouter } from './opext-bins.ts';
import qcExceptionsRouter from './opext-qc-exceptions.ts';
import { createPutawayTask } from '../lib/putaway.js';

const router = Router();

router.use(extractToken, requireAuth, enforcePermissionOverrides, respondWhenMemoryUnavailable);

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

router.use(collabRouter);

router.use(expiryRouter);

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
  const opening = openingBalancesByDay({ currentOnHand: currentLedger.reduce((sum, row) => sum + Number(row.onHand), 0), movements: allMovements.map((m) => ({ ...m, qtyDelta: Number(m.qtyDelta) })), windowStart: since, windowDays });
  const censored = censorStockoutDays(dailyDemand.map((value) => Math.max(0, value)), opening);
  const netDailyDemand = censored.demand.length ? censored.demand : dailyDemand.map((value) => Math.max(0, value));
  const plainDemand = computeDemandStats(netDailyDemand);
  const { pattern: demandPattern } = classifyDemandPattern(netDailyDemand);
  // Sparse items are forecast with Croston (SBA); averaging their zeros misstates the rate (audit O-2).
  const intermittent = demandPattern === 'INTERMITTENT' || demandPattern === 'LUMPY';
  const demand = intermittent ? { ...plainDemand, averageDailyDemand: crostonDailyDemand(netDailyDemand) } : plainDemand;

  const ledgerRows = await prisma.stockLedger.findMany({ where: { itemId: req.params.itemId, locationId }, include: { lot: { select: { status: true, expiryDate: true } } } });
  // Cover is sellable stock only: blocked, quarantined and expired lots do not count (audit O-6).
  const onHand = totalSellable(ledgerRows.map((row) => ({ ...row, onHand: Number(row.onHand), reserved: Number(row.reserved) })));
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
  const lotInputs = lots.flatMap((lot) => lot.stock.filter((row) => Number(row.onHand) > 0).map((row) => ({
    itemId: req.params.itemId,
    itemName: item?.name ?? req.params.itemId,
    lotId: lot.id,
    lotNo: lot.lotNo,
    locationId: row.locationId,
    onHand: Number(row.onHand),
    status: lot.status,
    expiryDate: lot.expiryDate?.toISOString() ?? null,
  })));
  const expiryActions = buildExpiryActionRecommendations(lotInputs, new Date(), {
    demandByItem: demand.sampleDays > 0 ? new Map([[req.params.itemId, demand.averageDailyDemand]]) : undefined,
    shelfLifeByItem: new Map([[req.params.itemId, item?.shelfLifeDays]]),
  });

  const rules = decimalsToNumbers(await prisma.reorderRule.findMany({ where: { itemId: req.params.itemId, companyId: req.companyId ?? DEFAULT_COMPANY_ID } }));
  const networkLedger = await prisma.stockLedger.findMany({
    where: { itemId: req.params.itemId },
    select: { locationId: true, onHand: true, location: { select: { name: true } } },
  });
  const overstockRows = rules.map((rule) => {
    const here = networkLedger.filter((row) => row.locationId === rule.locationId).reduce((sum, row) => sum + Number(row.onHand), 0);
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
    prisma.reorderRule.findMany({ where: { locationId: req.params.locationId, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { item: true } }).then((rows) => decimalsToNumbers(rows)),
    // Scoped to this company's locations (it used to read every tenant's whole ledger on each request)
    // and to the items that have rules, with the lot fields needed to judge what is sellable.
    prisma.stockLedger.findMany({
      where: { location: { companyId: req.companyId ?? DEFAULT_COMPANY_ID } },
      select: { itemId: true, locationId: true, onHand: true, reserved: true, inTransit: true, lot: { select: { status: true, expiryDate: true } }, location: { select: { name: true, type: true, latitude: true, longitude: true, shippingCostPerKm: true, deliverySlaHours: true } } },
    }),
    prisma.stockCount.findMany({ where: { locationId: req.params.locationId, countDate: { gte: since }, companyId: req.companyId ?? DEFAULT_COMPANY_ID }, include: { item: true }, orderBy: { countDate: 'desc' }, take: 250 }).then((rows) => decimalsToNumbers(rows)),
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
      const sellableHere = sellableQuantity({ onHand: Number(entry.onHand), reserved: 0, lot: entry.lot });
      current.onHand += sellableHere;
      current.reserved += sellableHere > 0 ? Number(entry.reserved) : 0;
      current.inTransit += Number(entry.inTransit);
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
      shippingCostPerKm: entry.location.shippingCostPerKm == null ? null : Number(entry.location.shippingCostPerKm),
      deliverySlaHours: entry.location.deliverySlaHours,
    };
    source.available += sellableQuantity({ onHand: Number(entry.onHand), reserved: Number(entry.reserved), lot: entry.lot });
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
      const qty = Math.max(0, Number(line.requestedQty) - Number(line.receivedQty) - Number(line.damagedQty) - Number(line.shortageQty));
      if (transfer.destinationLocationId === req.params.locationId) incoming.set(line.itemId, (incoming.get(line.itemId) ?? 0) + qty);
      const key = `${line.itemId}|${transfer.destinationLocationId}`;
      networkIncoming.set(key, (networkIncoming.get(key) ?? 0) + qty);
    }
  }
  // A donor keeps its own reorder minimum for the item.
  const donorRules = decimalsToNumbers(await prisma.reorderRule.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, itemId: { in: rules.map((rule) => rule.itemId) } },
    select: { itemId: true, locationId: true, minQty: true },
  }));
  const minimumAt = (itemId: string, donorLocationId: string) => donorRules.find((row) => row.itemId === itemId && row.locationId === donorLocationId)?.minQty ?? 0;

  const recommendations = rules.map((rule) => {
    const stock = quantities.get(rule.itemId) ?? { onHand: 0, reserved: 0, inTransit: 0 };
    const plan = planRuleReplenishment({
      destinationLocationId: req.params.locationId,
      availableHere: stock.onHand - stock.reserved,
      incoming: incoming.get(rule.itemId) ?? 0,
      minQty: rule.minQty, targetQty: rule.targetQty,
      network: [...(network.get(rule.itemId)?.values() ?? [])].map((row) => ({ ...row, protectedQty: minimumAt(rule.itemId, row.locationId) })),
      destination: destinationLocation ? decimalsToNumbers(destinationLocation) : undefined,
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
      // The purchase hub is per-company and chosen dynamically (each recommendation's own
      // `actionReason` already names it) - this summary line used to hard-code one customer's
      // site ("H.O. Basni") regardless of the actual configured warehouse (audit R-1 leftover).
      ? `${transfers} network transfer${transfers === 1 ? '' : 's'} and ${purchases} warehouse purchase action${purchases === 1 ? '' : 's'} recommended.`
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
    networkUnitsByKey.set(key, (networkUnitsByKey.get(key) ?? 0) + signedSalesQty(m.movementType, Number(m.qtyDelta)));
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
  const lotInputs = lots.flatMap((lot) => lot.stock.filter((row) => Number(row.onHand) > 0).map((row) => ({
    itemId: lot.itemId,
    itemName: lot.item.name,
    lotId: lot.id,
    lotNo: lot.lotNo,
    locationId: row.locationId,
    onHand: Number(row.onHand),
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

router.use(webhooksRouter);

router.use(binsRouter);

router.use(serialsRouter);

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
  return res.json({ orders: decimalsToNumbers(orders) });
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
            shippingCostPerKm: location.shippingCostPerKm == null ? null : Number(location.shippingCostPerKm),
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
    return res.json({ order: decimalsToNumbers(order) });
  } catch (error) {
    if (error instanceof Error && error.message === 'Order was not found.') return res.status(404).json({ message: error.message });
    return res.status(409).json({ message: error instanceof Error ? error.message : 'Unable to fulfill order.' });
  }
});

router.post('/orders/:id/cancel', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const order = await cancelOrder(req.companyId ?? DEFAULT_COMPANY_ID, req.params.id, req.user!.id);
    return res.json({ order: decimalsToNumbers(order) });
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
  const expected = order.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: Number(line.requestedQty) }));
  const scanned = packedLines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: Number(line.quantity) }));
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
    alreadyReturnedByLine.set(line.orderLineId, (alreadyReturnedByLine.get(line.orderLineId) ?? 0) + Number(line.quantity));
  }
  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const validationInput = requestedLines
    .map((line: { orderLineId?: string; quantity?: number }) => {
      const orderLine = orderLinesById.get(String(line.orderLineId));
      return {
        orderLineId: String(line.orderLineId || ''),
        quantity: Number(line.quantity),
        fulfilledQty: orderLine?.fulfilledQty == null ? 0 : Number(orderLine.fulfilledQty),
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
    ? await prisma.qcChecklistTemplate.findMany({ where: { active: true, createdBy: { companyId } } }).catch(() => listMemoryQcTemplates().filter((row) => row.active))
    : listMemoryQcTemplates().filter((row) => row.active);
  const inspections: InspectionLike[] = databaseEnabled
    ? await prisma.qcInspection.findMany({ where: { sourceDocument: returnRequestId, inspectedBy: { companyId } } }).catch(() => [])
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
  if (!ledger || Number(ledger.quarantine) + 1e-8 < line.quantity) return res.status(409).json({ message: 'The quarantined quantity for this line was not found.' });
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

router.use(rulesRouter);

router.use(qcExceptionsRouter);

router.use(binStockRouter);

router.get('/mobile/home', async (req, res) => {
  return res.json({ home: mobileHomeForRole(req.user!.role) });
});

router.get('/saas/plans', async (_req, res) => {
  return res.json({ plans: SAAS_PLANS });
});

router.get('/saas/tenants', async (req, res) => {
  if (!requirePlatformOperator(req, res)) return;
  return res.json({ tenants: listTenants(), entitlements: SAAS_PLANS });
});

router.post('/saas/onboard', async (req, res) => {
  if (!requirePlatformOperator(req, res)) return;
  try {
    const companyName = String(req.body.companyName ?? '').trim();
    const adminName = String(req.body.adminName ?? '').trim();
    const adminEmail = String(req.body.adminEmail ?? '').trim().toLowerCase();
    const planCode = String(req.body.planCode ?? 'starter');
    // No default password: a tenant admin created with a value that is public in the
    // repository can be taken over by anyone who knows the sign-in email.
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) return res.status(400).json({ message: passwordCheck.message ?? 'A strong temporary password is required.' });
    if (isKnownDefaultPassword(password)) return res.status(400).json({ message: 'That password is publicly known. Choose a different temporary password.' });
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

router.use(webhookDeliveriesRouter);

export default router;
