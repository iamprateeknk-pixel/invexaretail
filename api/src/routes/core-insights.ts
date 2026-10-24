// Dashboard, audit, export, sync-status, expiry-dashboard and report
// routes for core (Phase 4): extracted verbatim from core.ts; the
// composer mounts these routers at the clusters' original
// registration positions.
import { type Request, type Response, Router } from 'express';
import * as enterpriseRepo from '../lib/enterprise-repository.js';
import { DEFAULT_COMPANY_ID, companyOwnsLocation, itemsForCompany } from '../lib/saas/tenant-scope.js';
import { canAccessLocation } from '../lib/inventory.js';
import { findUserById, listCounts, listItems, listTransfers, locations, type CountRecord } from '../lib/repository.js';
import { listStockForCompany, listStockForLocation } from '../lib/repositories/stock-repository.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { buildDashboardSummary, buildReportSummary } from '../lib/dashboard.js';
import { buildExpiryDashboard } from '../lib/expiry.js';
import { listAuditEvents } from '../lib/audit.js';
import { totalVariance } from '../lib/weight-allocation.js';
import { listLocationsForCompany } from '../lib/repositories/location-repository.js';
import { listSyncCheckpointsForCompany } from '../lib/repositories/sync-checkpoint-repository.js';
import { listCountsForCompany } from '../lib/repositories/count-repository.js';
import { listItemsForCompany } from '../lib/repositories/item-repository.js';
import { listTransfersForCompany } from '../lib/repositories/transfer-repository.js';
import { accessContext, tenantContext, csvEscape, firstParam, isOperationalAdmin } from './core-shared.js';

const router = Router();

// ============================================
// DASHBOARD & AUDIT
// ============================================

router.get('/dashboard', async (req: Request, res: Response) => {
  const context = accessContext(req.user!);
  const companyId = context.companyId ?? DEFAULT_COMPANY_ID;
  // Phase 5 step 4 made the stock input DB-first; ULTRA P1 (below) completed
  // the document inputs. The builder is unchanged; only provenance moved.
  const ctx: TenantContext = { ...tenantContext(req), companyId };
  // ULTRA P1: counts, transfers and items are database-first now too (count/transfer/item
  // repositories) — the dashboard no longer joins current stock with snapshot documents.
  const [companyCounts, companyTransfers, companyItems] = await Promise.all([
    listCountsForCompany(ctx),
    listTransfersForCompany(ctx),
    listItemsForCompany(ctx),
  ]);
  const summary = buildDashboardSummary({
    counts: companyCounts.filter((count) => canAccessLocation(context, count.locationId)),
    transfers: companyTransfers.filter((transfer) =>
      canAccessLocation(context, transfer.sourceLocationId) && canAccessLocation(context, transfer.destinationLocationId),
    ),
    items: companyItems,
    // Expiry KPIs count only lots that still hold stock in a location this user can see.
    stock: (await listStockForCompany(ctx)).filter((row) => canAccessLocation(context, row.locationId)),
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

router.get('/export/:type', async (req: Request, res: Response) => {
  if (!isOperationalAdmin(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can export data.' });
  }

  const today = new Date().toISOString().split('T')[0];
  const type = firstParam(req.params.type);
  // An export is the caller's company's data only. ULTRA P1: the lists come from the
  // company-scoped repositories (Postgres in database mode), whose scoping replaces the
  // process-wide snapshot lists plus ownership post-filters this handler used to apply —
  // for counts the old filter was "location owned by the company" and StockCount.companyId
  // was backfilled from exactly that location; for transfers it was source-or-destination
  // ownership, which is the transfer repository's scope verbatim.
  const exportCtx = tenantContext(req);

  if (type === 'stock') {
    const csv = [
      ['ID', 'Code', 'Name', 'Category', 'Unit', 'Lots'].join(','),
      ...(await listItemsForCompany(exportCtx)).map((item) => [
        item.id, item.code, item.name, item.category ?? '', item.unit ?? '',
        item.lots.map((lot) => `${lot.lotNo}(${lot.id})`).join(';'),
      ].map(csvEscape).join(',')),
    ].join('\n');
    return res.type('text/csv').attachment(`stock-export-${today}.csv`).send(csv);
  }

  if (type === 'counts') {
    const csv = [
      ['ID', 'Item', 'Lot', 'Location', 'Physical', 'Book', 'Variance', 'Status', 'Submitted By', 'Created'].join(','),
      ...(await listCountsForCompany(exportCtx)).map((count) => [
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
      ...(await listTransfersForCompany(exportCtx)).map((transfer) => [
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

router.get('/expiry-dashboard', async (req: Request, res: Response) => {
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
  // Phase 5 step 4: stock input via the tenant-scoped repository. NOTE the
  // 'all' case: the snapshot accessor it replaces exact-matched the
  // location id, so 'all' (and an omitted locationId) silently received
  // ZERO stock rows and the all-location expiry view was always empty.
  // The repository conversion feeds it the company's rows, which is what
  // the role gate above exists to protect — a deliberate, documented
  // behaviour fix inside this conversion, not a regression.
  const ctx: TenantContext = { ...tenantContext(req), companyId: expiryCompanyId };
  const stockRows = !locationId || locationId === 'all'
    ? await listStockForCompany(ctx)
    : await listStockForLocation(ctx, locationId);
  const dashboard = buildExpiryDashboard(
    await listItemsForCompany(ctx),
    stockRows.filter((row) => companyOwnsLocation(expiryCompanyId, row.locationId)),
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

router.get('/reports/variance/:locationId', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Variance reports require Admin or Auditor access.' });
  }
  const locationId = firstParam(req.params.locationId);
  if (!canAccessLocation(accessContext(req.user!), locationId)) {
    return res.status(403).json({ message: 'Access to this location is denied.' });
  }

  // ULTRA P1: items and counts are database-first (item/count repositories).
  const itemMap = new Map((await listItemsForCompany(tenantContext(req))).map((item) => [item.id, item]));

  // The ledger stores only on-hand, so book-vs-physical comes from the counts,
  // each of which captured the book quantity at the moment it was submitted.
  const latestCountPerLot = new Map<string, CountRecord>();
  for (const count of await listCountsForCompany(tenantContext(req))) {
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

router.get('/reports/:locationId', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Reports require Admin or Auditor access.' });
  }
  const locationId = firstParam(req.params.locationId);
  if (!canAccessLocation(accessContext(req.user!), locationId)) {
    return res.status(403).json({ message: 'Access to this location is denied.' });
  }
  // ULTRA P1: counts and transfers are database-first (count/transfer repositories);
  // the builder still applies its own location filter to both lists.
  const ctx = tenantContext(req);
  const [counts, transfers] = await Promise.all([listCountsForCompany(ctx), listTransfersForCompany(ctx)]);
  return res.json({
    report: buildReportSummary({ locationId, counts, transfers }),
  });
});
}
