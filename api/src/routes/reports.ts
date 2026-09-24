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

export default router;
