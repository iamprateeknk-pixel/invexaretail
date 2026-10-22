// Dashboard, audit, export, sync-status, expiry-dashboard and report
// routes for core (Phase 4): extracted verbatim from core.ts; the
// composer mounts these routers at the clusters' original
// registration positions.
import { type Request, type Response, Router } from 'express';
import * as enterpriseRepo from '../lib/enterprise-repository.js';
import { DEFAULT_COMPANY_ID, companyOwnsLocation, itemsForCompany } from '../lib/saas/tenant-scope.js';
import { canAccessLocation } from '../lib/inventory.js';
import { findUserById, listCounts, listItems, listStockLedger, listStockLedgerForLocation, listTransfers, locations, type CountRecord } from '../lib/repository.js';
import { buildDashboardSummary, buildReportSummary } from '../lib/dashboard.js';
import { buildExpiryDashboard } from '../lib/expiry.js';
import { listAuditEvents } from '../lib/audit.js';
import { totalVariance } from '../lib/weight-allocation.js';
import { listLocationsForCompany } from '../lib/repositories/location-repository.js';
import { listSyncCheckpointsForCompany } from '../lib/repositories/sync-checkpoint-repository.js';
import { accessContext, tenantContext, csvEscape, firstParam, isOperationalAdmin } from './core-shared.js';

const router = Router();

// ============================================
// DASHBOARD & AUDIT
// ============================================

router.get('/dashboard', (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const companyId = context.companyId ?? DEFAULT_COMPANY_ID;
  const summary = buildDashboardSummary({
    counts: listCounts().filter((count) => canAccessLocation(context, count.locationId)),
    transfers: listTransfers().filter((transfer) =>
      canAccessLocation(context, transfer.sourceLocationId) && canAccessLocation(context, transfer.destinationLocationId),
    ),
    items: itemsForCompany(companyId, listItems()),
    // Expiry KPIs count only lots that still hold stock in a location this user can see.
    stock: listStockLedger().filter((row) => canAccessLocation(context, row.locationId)),
  });
  return res.json({ dashboard: summary });
});

router.get('/audit', (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Audit access denied.' });
  }
  // Audit events carry no company of their own; they belong to the company of the user who acted.
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const events = listAuditEvents().filter((event) => (enterpriseRepo.findUserById(event.actorId)?.companyId ?? DEFAULT_COMPANY_ID) === companyId);
  return res.json({ events });
});

// ============================================
// CSV EXPORT / IMPORT
// ============================================

router.get('/export/:type', (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can export data.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const type = firstParam(req.params.type);
  // Every list below is process-wide; an export is the caller's company's data only.
  const exportCompanyId = req.companyId ?? DEFAULT_COMPANY_ID;

  if (type === 'stock') {
    const csv = [
      ['ID', 'Code', 'Name', 'Category', 'Unit', 'Lots'].join(','),
      ...itemsForCompany(exportCompanyId, listItems()).map((item) => [
        item.id, item.code, item.name, item.category ?? '', item.unit ?? '',
        item.lots.map((lot) => `${lot.lotNo}(${lot.id})`).join(';'),
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`stock-export-${today}.csv`).send(csv);
  }

  if (type === 'counts') {
    const csv = [
      ['ID', 'Item', 'Lot', 'Location', 'Physical', 'Book', 'Variance', 'Status', 'Submitted By', 'Created'].join(','),
      ...listCounts().filter((count) => companyOwnsLocation(exportCompanyId, count.locationId)).map((count) => [
        count.id, count.itemId, count.lotId, count.locationId, count.physicalQuantity,
        count.bookQty ?? 0, count.physicalQuantity - (count.bookQty ?? 0),
        count.status ?? 'PENDING_REVIEW', count.submittedBy, count.createdAt,
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`counts-export-${today}.csv`).send(csv);
  }

  if (type === 'transfers') {
    const csv = [
      ['ID', 'From', 'To', 'Item', 'Qty', 'Status', 'Requested By', 'Created'].join(','),
      ...listTransfers().filter((transfer) => companyOwnsLocation(exportCompanyId, transfer.sourceLocationId) || companyOwnsLocation(exportCompanyId, transfer.destinationLocationId)).map((transfer) => [
        transfer.id, transfer.sourceLocationId, transfer.destinationLocationId,
        transfer.lines.map((line) => line.itemId).join(';'),
        transfer.lines.reduce((sum, line) => sum + line.quantity, 0),
        transfer.status, transfer.requestedBy, transfer.createdAt,
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`transfers-export-${today}.csv`).send(csv);
  }

  return res.status(400).json({ message: 'Export type must be stock, counts or transfers.' });
});

export default router;

export const syncStatusRouter = Router();
{
  const router = syncStatusRouter;
// Database-first slice 4: locations and checkpoints both come from the scoped repositories.
router.get('/sync-status', async (req: Request, res: Response) => {
  const ctx = tenantContext(req);
  const [checkpoints, companyLocations] = await Promise.all([listSyncCheckpointsForCompany(ctx), listLocationsForCompany(ctx)]);
  return res.json({ locations: companyLocations.map((location) => ({ locationId: location.id, locationName: location.name, salesSyncedThrough: checkpoints.find((entry) => entry.locationId === location.id && entry.sourceType === 'SALES')?.syncedThroughAt ?? null, purchaseSyncedThrough: checkpoints.find((entry) => entry.locationId === location.id && entry.sourceType === 'PURCHASE')?.syncedThroughAt ?? null })) });
});
}

export const insightsReportsRouter = Router();
{
  const router = insightsReportsRouter;
// ---------------------------------------------------------------------------
// Expiry dashboard and reports
// ---------------------------------------------------------------------------

router.get('/expiry-dashboard', (req: Request, res: Response) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : undefined;
  const context = accessContext(req.user!);
  if ((!locationId || locationId === 'all') && !['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(context.role)) {
    return res.status(403).json({ message: 'All-location expiry data requires Admin or Auditor access.' });
  }
  if (locationId && locationId !== 'all' && !canAccessLocation(context, locationId)) {
    return res.status(403).json({ message: 'Expiry location access denied.' });
  }
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';

  const expiryCompanyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const dashboard = buildExpiryDashboard(
    itemsForCompany(expiryCompanyId, listItems()),
    listStockLedgerForLocation(locationId ?? 'all').filter((row) => companyOwnsLocation(expiryCompanyId, row.locationId)),
  );

  if (filter === 'expired') dashboard.allExpiringItems = dashboard.expiredItems;
  else if (filter === 'this-month') dashboard.allExpiringItems = dashboard.expiringThisMonth;
  else if (filter === 'next-month') dashboard.allExpiringItems = dashboard.expiringNextMonth;

  if (locationId && locationId !== 'all') {
    const atLocation = <T extends { locationId: string }>(rows: T[]) => rows.filter((row) => row.locationId === locationId);
    dashboard.expiredItems = atLocation(dashboard.expiredItems);
    dashboard.expiringThisMonth = atLocation(dashboard.expiringThisMonth);
    dashboard.expiringNextMonth = atLocation(dashboard.expiringNextMonth);
    dashboard.allExpiringItems = atLocation(dashboard.allExpiringItems);
  }

  return res.json({ dashboard });
});

router.get('/reports/variance/:locationId', (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Variance reports require Admin or Auditor access.' });
  }
  const locationId = firstParam(req.params.locationId);
  if (!canAccessLocation(accessContext(req.user!), locationId)) {
    return res.status(403).json({ message: 'Access to this location is denied.' });
  }

  const itemMap = new Map(listItems().map((item) => [item.id, item]));

  // The ledger stores only on-hand, so book-vs-physical comes from the counts,
  // each of which captured the book quantity at the moment it was submitted.
  const latestCountPerLot = new Map<string, CountRecord>();
  for (const count of listCounts()) {
    if (count.locationId !== locationId) continue;
    const key = `${count.itemId}:${count.lotId}`;
    const existing = latestCountPerLot.get(key);
    if (!existing || count.createdAt > existing.createdAt) {
      latestCountPerLot.set(key, count);
    }
  }

  const details = [...latestCountPerLot.values()].map((count) => {
    const variance = count.physicalQuantity - count.bookQty;
    return {
      itemId: count.itemId,
      itemName: itemMap.get(count.itemId)?.name ?? count.itemId,
      bookQuantity: count.bookQty,
      physicalQuantity: count.physicalQuantity,
      variance,
      variancePercent: count.bookQty > 0 ? Number(((variance / count.bookQty) * 100).toFixed(2)) : 0,
      status: variance === 0 ? 'MATCH' : variance > 0 ? 'OVERAGE' : 'SHORTAGE',
    };
  });

  const totalBookQuantity = details.reduce((sum, row) => sum + row.bookQuantity, 0);
  const totalVariance = details.reduce((sum, row) => sum + row.variance, 0);

  return res.json({
    report: {
      locationId,
      totalItems: details.length,
      matchingItems: details.filter((row) => row.status === 'MATCH').length,
      overageItems: details.filter((row) => row.status === 'OVERAGE').length,
      shortageItems: details.filter((row) => row.status === 'SHORTAGE').length,
      totalBookQuantity,
      totalPhysicalQuantity: details.reduce((sum, row) => sum + row.physicalQuantity, 0),
      totalVariance,
      overallVariancePercent: totalBookQuantity > 0 ? Number(((totalVariance / totalBookQuantity) * 100).toFixed(2)) : 0,
      details,
    },
  });
});

router.get('/reports/:locationId', (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Reports require Admin or Auditor access.' });
  }
  const locationId = firstParam(req.params.locationId);
  if (!canAccessLocation(accessContext(req.user!), locationId)) {
    return res.status(403).json({ message: 'Access to this location is denied.' });
  }
  return res.json({
    report: buildReportSummary({ locationId, counts: listCounts(), transfers: listTransfers() }),
  });
});
}
