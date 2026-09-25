// Week 12: thin route over lib/reporting-repository.ts, continuing the
// Week 8/10/11 extraction pattern. Additive - the pre-existing
// /reports/transfer-cycle, /reports/count-accuracy and /reports/audit-export
// routes in routes/command-center.ts, and /companies/:companyId/dashboard/summary
// in routes/enterprise-analytics.ts, are untouched by this module.
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import type { TenantContext } from '../lib/tenant-context.js';
import { getDashboardSummary, listOpenExceptions } from '../lib/reporting-repository.js';
import { prisma } from '../lib/db.js';
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

  const soldRows = await prisma.stockMovement.groupBy({
    by: ['itemId'],
    where: { companyId, movementType: 'SALES_DEDUCTION', timestamp: { gte: since }, ...(locationId ? { locationId } : {}) },
    _sum: { qtyDelta: true },
  });
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
    const units = Math.abs(sold._sum.qtyDelta ?? 0);
    const cost = costed.get(sold.itemId);
    sales.set(sold.itemId, { units, cogs: cost && cost.units > 0 ? units * (cost.value / cost.units) : 0 });
  }
  const health = buildInventoryHealth({ rows, sales, windowDays, hasSalesData: soldRows.length > 0 });
  return res.json({ ...health, locationId, truncated, note: soldRows.length === 0 ? 'No sales movements were recorded in this window (sales imported through the legacy path are not in the stock journal): turns and cover are unknown and items are reported as NO_DATA rather than dead.' : undefined });
});

export default router;
