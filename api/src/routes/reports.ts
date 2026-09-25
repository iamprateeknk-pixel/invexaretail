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
import { summarizeCountAccuracy, summarizeVarianceReasons } from '../lib/count-reason-codes.js';
import { DEFAULT_TOLERANCE } from '../lib/count-tolerance.js';
import { buildInventoryHealth, lotUnitCost, type HealthSales } from '../lib/inventory-health.js';

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

router.get('/reports/dashboard', async (req: Request, res: Response) => {
  const summary = await getDashboardSummary(tenantContextFor(req));
  return res.json(summary);
});

router.get('/reports/exceptions', async (req: Request, res: Response) => {
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

router.get('/reports/count-accuracy-breakdown', async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(req.user!.role)) return res.status(403).json({ message: 'Not permitted.' });
  const days = Number(req.query.days) > 0 ? Math.min(365, Number(req.query.days)) : 90;
  const counts = await prisma.stockCount.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID, reviewStatus: { in: ['APPROVED', 'REJECTED', 'RECOUNT'] }, countDate: { gte: new Date(Date.now() - days * 86_400_000) } },
    select: { physicalQty: true, bookQty: true, lot: { select: { attributes: true } } },
    take: 20_000,
  });
  const summary = summarizeCountAccuracy(
    counts.map((count) => ({ physicalQty: count.physicalQty, bookQty: count.bookQty, unitCost: lotUnitCost(count.lot?.attributes as Record<string, unknown> | null) })),
    DEFAULT_TOLERANCE,
  );
  return res.json({ days, tolerance: DEFAULT_TOLERANCE, ...summary });
});

router.get('/reports/count-variance-reasons', async (req: Request, res: Response) => {
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
  const sales = new Map<string, HealthSales>();
  for (const sold of soldRows) {
    const units = sold.units;
    const cost = costed.get(sold.itemId);
    sales.set(sold.itemId, { units, cogs: cost && cost.units > 0 ? units * (cost.value / cost.units) : 0 });
  }
  const health = buildInventoryHealth({ rows, sales, windowDays, hasSalesData: soldRows.length > 0 });
  return res.json({ ...health, locationId, truncated, note: soldRows.length === 0 ? 'No sales movements were recorded in this window (neither order/staged-import nor legacy daily imports): turns and cover are unknown and items are reported as NO_DATA rather than dead.' : undefined });
});

export default router;
