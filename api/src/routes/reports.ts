// Week 12: thin route over lib/reporting-repository.ts, continuing the
// Week 8/10/11 extraction pattern. Additive - the pre-existing
// /reports/transfer-cycle, /reports/count-accuracy and /reports/audit-export
// routes in routes/command-center.ts, and /companies/:companyId/dashboard/summary
// in routes/enterprise-analytics.ts, are untouched by this module.
import { loadSalesEvents, totalsByItem } from '../lib/sales-demand.js';
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { getDashboardSummary, listOpenExceptions } from '../lib/reporting-repository.js';
import { prisma } from '../lib/db.js';
import { companyTimezone, currentTimezone } from '../lib/timezone-context.js';
import { saveCompanyTimezone } from '../lib/company-timezone.js';
import { cadenceForCompany, DEFAULT_CADENCE_DAYS } from '../lib/cycle-count-cadence-context.js';
import { saveCompanyCycleCountCadence } from '../lib/cycle-count-cadence.js';
import { databaseEnabled } from '../lib/persistence.js';
import { summarizeCountAccuracyByClass, summarizeVarianceReasons } from '../lib/count-reason-codes.js';
import { ABC_CLASSES, classifyAbcItems, type AbcClass } from '../lib/abc-cycle-count.js';
import { DEFAULT_TOLERANCE } from '../lib/count-tolerance.js';
import { buildInventoryHealth, lotUnitCost, summarizeServiceLevel, type HealthSales } from '../lib/inventory-health.js';
import { resolvePrice, type PriceCandidate } from '../lib/price-resolution.js';

const router = Router();
router.use(extractToken, requireAuth, enforcePermissionOverrides);

function tenantContextFor(req: Request): TenantContext {
  return {
    companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    tenantId: DEFAULT_TENANT_ID,
    userId: req.user!.id,
    role: req.user!.role as TenantContext['role'],
  };
}

// This whole module reads directly from Postgres (reporting-repository.ts / raw prisma queries), with
// no in-memory equivalent - a real gap in memory-mode support, not a bug in one route. Every route
// below returns a clean 501 off the database, matching the convention already used by routes/items.ts's
// forecast endpoint, instead of the raw "DATABASE_URL is required..." 500 Prisma throws unhandled.
// NOTE: this must be called explicitly inside each of THIS router's own handlers, never as
// `router.use(...)` with no path - every router in this API is mounted at the same '/api/v1' base
// (see index.ts), so a path-less `router.use` here would run as middleware for every request under
// /api/v1 handled by ANY router, not just this module's own routes.
function requireDatabaseForReport(res: Response): boolean {
  if (databaseEnabled) return true;
  res.status(501).json({ message: 'This report requires a connected database.' });
  return false;
}

router.get('/reports/dashboard', async (req: Request, res: Response) => {
  if (!requireDatabaseForReport(res)) return;
  const summary = await getDashboardSummary(tenantContextFor(req));
  return res.json(summary);
});

router.get('/reports/exceptions', async (req: Request, res: Response) => {
  if (!requireDatabaseForReport(res)) return;
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
  const page = await listOpenExceptions(tenantContextFor(req), { cursor, limit: Number.isFinite(limit) ? limit : undefined });
  return res.json(page);
});

// Inventory valuation and health (audit O-5): value on hand, turns, days of inventory, ageing, dead and
// slow stock. Read-only; company scoped; optionally one location. Cost comes from lot attributes (landed
// cost, else purchase rate) - stock with no recorded cost is reported as `unvaluedUnits`, never priced.
const HEALTH_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'];
const HEALTH_ROW_LIMIT = 20_000;

router.get('/company/timezone', (req: Request, res: Response) => {
  return res.json({ timezone: companyTimezone(req.companyId ?? DEFAULT_COMPANY_ID), effective: currentTimezone() });
});

router.put('/company/timezone', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Only admins can change the company timezone.' });
  if (req.body?.timezone === undefined) return res.status(400).json({ message: 'timezone is required (an IANA name, or null to use the default).' });
  const requested = req.body?.timezone === null || req.body?.timezone === '' ? null : String(req.body?.timezone ?? '');
  try {
    const timezone = await saveCompanyTimezone(req.companyId ?? DEFAULT_COMPANY_ID, requested);
    return res.json({ timezone });
  } catch (error) {
    if (error instanceof RangeError) return res.status(400).json({ message: error.message });
    return res.status(404).json({ message: 'Company profile not found.' });
  }
});

// Audit C-4: cycle-count cadence (days between required counts, per ABC class) used to be the
// fixed ABC_CADENCE constant (7/30/90) for every tenant. Same shape as /company/timezone: null
// for a class clears its override back to the default.
router.get('/company/cycle-count-cadence', (req: Request, res: Response) => {
  return res.json({ cadenceDays: cadenceForCompany(req.companyId ?? DEFAULT_COMPANY_ID), defaultCadenceDays: DEFAULT_CADENCE_DAYS });
});

router.put('/company/cycle-count-cadence', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) return res.status(403).json({ message: 'Only admins can change the cycle-count cadence.' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const requested: Partial<Record<AbcClass, number | null>> = {};
  for (const cls of ABC_CLASSES) {
    if (!(cls in body)) continue;
    requested[cls] = body[cls] === null ? null : Number(body[cls]);
  }
  if (Object.keys(requested).length === 0) return res.status(400).json({ message: 'At least one of A, B, C is required (a day count, or null to clear it).' });
  try {
    const cadenceDays = await saveCompanyCycleCountCadence(req.companyId ?? DEFAULT_COMPANY_ID, requested);
    return res.json({ cadenceDays });
  } catch (error) {
    if (error instanceof RangeError) return res.status(400).json({ message: error.message });
    return res.status(404).json({ message: 'Company profile not found.' });
  }
});

router.get('/reports/count-accuracy-breakdown', async (req: Request, res: Response) => {
  if (!requireDatabaseForReport(res)) return;
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Not permitted.' });
  const days = Number(req.query.days) > 0 ? Math.min(365, Number(req.query.days)) : 90;
  const counts = await prisma.stockCount.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, reviewStatus: { in: ['APPROVED', 'REJECTED', 'RECOUNT'] }, countDate: { gte: new Date(Date.now() - days * 86_400_000) } },
    select: { itemId: true, physicalQty: true, bookQty: true, lot: { select: { attributes: true } } },
    take: 20_000,
  });
  // ABC class per item from the company's stock value (same ranking the cycle-count planner uses).
  const ledger = await prisma.stockLedger.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, onHand: { gt: 0 }, itemId: { in: [...new Set(counts.map((count) => count.itemId))] } },
    select: { itemId: true, onHand: true, lot: { select: { attributes: true } } },
    take: 50_000,
  });
  const value = new Map<string, { value: number; costed: boolean }>();
  for (const row of ledger) {
    const cost = lotUnitCost(row.lot.attributes as Record<string, unknown> | null);
    const entry = value.get(row.itemId) ?? { value: 0, costed: false };
    entry.value += cost !== null ? row.onHand * cost : row.onHand;
    entry.costed = entry.costed || cost !== null;
    value.set(row.itemId, entry);
  }
  const classes = classifyAbcItems([...value.entries()].map(([itemId, entry]) => ({ itemId, extendedValue: entry.value, valueSource: entry.costed ? 'purchase' as const : 'qty_proxy' as const })));
  const summary = summarizeCountAccuracyByClass(
    counts.map((count) => ({ physicalQty: count.physicalQty, bookQty: count.bookQty, unitCost: lotUnitCost(count.lot?.attributes as Record<string, unknown> | null), abcClass: classes.get(count.itemId)?.abcClass ?? null })),
    DEFAULT_TOLERANCE,
  );
  return res.json({ days, tolerance: DEFAULT_TOLERANCE, ...summary });
});

router.get('/reports/count-variance-reasons', async (req: Request, res: Response) => {
  if (!requireDatabaseForReport(res)) return;
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Not permitted.' });
  const days = Number(req.query.days) > 0 ? Math.min(365, Number(req.query.days)) : 90;
  const rows = await prisma.stockCount.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, reviewStatus: 'APPROVED', countDate: { gte: new Date(Date.now() - days * 86_400_000) } },
    select: { physicalQty: true, bookQty: true, reasonCode: true },
    take: 20_000,
  });
  return res.json({ days, reasons: summarizeVarianceReasons(rows) });
});

router.get('/reports/inventory-health', async (req: Request, res: Response) => {
  if (!requireDatabaseForReport(res)) return;
  if (!HEALTH_ROLES.includes(req.user!.role)) return res.status(403).json({ message: 'Inventory health reports require Admin, Branch Manager or Auditor access.' });
  const companyId = req.companyId ?? DEFAULT_COMPANY_ID;
  const locationId = typeof req.query.locationId === 'string' && req.query.locationId ? req.query.locationId : null;
  if (locationId && !(await prisma.location.findFirst({ where: { id: locationId, companyId }, select: { id: true } }))) return res.status(404).json({ message: 'Location not found.' });
  if (!locationId && req.user!.role === 'BRANCH_MANAGER') return res.status(400).json({ message: 'Choose a locationId.' });
  const requested = Number(req.query.windowDays);
  const windowDays = Number.isFinite(requested) && requested >= 7 && requested <= 365 ? Math.floor(requested) : 90;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const ledger = await prisma.stockLedger.findMany({
    where: { onHand: { gt: 0 }, location: { companyId }, ...(locationId ? { locationId } : {}) },
    include: { item: { select: { code: true, name: true, category: true } }, lot: { select: { attributes: true, createdAt: true } } },
    take: HEALTH_ROW_LIMIT + 1,
  });
  const truncated = ledger.length > HEALTH_ROW_LIMIT;
  const rows = ledger.slice(0, HEALTH_ROW_LIMIT).map((row) => ({
    itemId: row.itemId, code: row.item.code, name: row.item.name, category: row.item.category, onHand: row.onHand,
    unitCost: lotUnitCost(row.lot.attributes as Record<string, unknown> | null), lotCreatedAt: row.lot.createdAt,
  }));

  const soldRows = [...totalsByItem(await loadSalesEvents({ since, companyId, ...(locationId ? { locationId } : {}) })).entries()].map(([itemId, units]) => ({ itemId, units: Math.max(0, units) }));
  // Cost of goods sold = units sold x the item's weighted-average unit cost among its costed stock here.
  const costed = new Map<string, { units: number; value: number }>();
  for (const row of rows) {
    if (row.unitCost === null) continue;
    const entry = costed.get(row.itemId) ?? { units: 0, value: 0 };
    entry.units += row.onHand;
    entry.value += row.onHand * row.unitCost;
    costed.set(row.itemId, entry);
  }
  // Revenue for GMROI (audit O-5) comes from PriceList/resolvePrice - the same "most specific,
  // currently effective" RETAIL price GET /items/:itemId/price resolves for a real sale - never
  // a guessed or list (MRP) price. Resolved at "now" (the report is a live valuation, not a
  // historical reconstruction, same approximation turns/daysOfInventory already make by using
  // current cost against a trailing window's units).
  const soldItemIds = soldRows.map((row) => row.itemId);
  const priceCandidatesByItem = new Map<string, PriceCandidate[]>();
  if (soldItemIds.length) {
    const priceRows = await prisma.priceList.findMany({ where: { itemId: { in: soldItemIds }, priceType: 'RETAIL', companyId } });
    for (const row of priceRows) {
      const list = priceCandidatesByItem.get(row.itemId) ?? [];
      list.push({ id: row.id, price: row.price, branchId: row.branchId, customerGroup: row.customerGroup, effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() ?? null, status: row.status });
      priceCandidatesByItem.set(row.itemId, list);
    }
  }
  const sales = new Map<string, HealthSales>();
  for (const sold of soldRows) {
    const units = sold.units;
    const cost = costed.get(sold.itemId);
    const cogs = cost && cost.units > 0 ? units * (cost.value / cost.units) : 0;
    const resolved = resolvePrice(priceCandidatesByItem.get(sold.itemId) ?? [], { branchId: locationId ?? undefined });
    sales.set(sold.itemId, { units, cogs, revenue: resolved ? units * resolved.price : null });
  }
  const health = buildInventoryHealth({ rows, sales, windowDays, hasSalesData: soldRows.length > 0 });
  const orders = await prisma.order.findMany({
    where: { companyId, createdAt: { gte: since }, ...(locationId ? { fulfillmentLocationId: locationId } : {}) },
    select: { status: true, lines: { select: { requestedQty: true, fulfilledQty: true } } },
    take: 20_000,
  });
  return res.json({ ...health, service: summarizeServiceLevel(orders), locationId, truncated, note: soldRows.length === 0 ? 'No sales movements were recorded in this window (neither order/staged-import nor legacy daily imports): turns and cover are unknown and items are reported as NO_DATA rather than dead.' : undefined });
});

export default router;
