// Location display order: an admin moves branches and warehouses up or down in the workspace location
// switcher (web and mobile both render GET /locations in the order it returns). Thin route ->
// lib/repositories/location-repository.ts. Mounted before coreRouter so "order" is never read as a
// location id by core's PUT /locations/:locationId.
import { type Request, type Response, Router } from 'express';
import { extractToken, requireAuth } from './enterprise-auth.js';
import { enforcePermissionOverrides } from '../lib/access-control.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { requireTenantContext } from '../lib/tenant-context.js';
import { LocationOrderError, saveLocationOrder } from '../lib/repositories/location-repository.js';
import type { Role } from '../lib/repository.js';

const router = Router();

router.put('/locations/order', extractToken, requireAuth, enforcePermissionOverrides, async (req: Request, res: Response) => {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) {
    return res.status(403).json({ message: 'Only admins can change the location order.' });
  }
  try {
    const ctx = requireTenantContext({
      companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
      userId: req.user!.id,
      role: req.user!.role as Role,
    });
    const locations = await saveLocationOrder(ctx, req.body?.locationIds);
    return res.json({ locations });
  } catch (error) {
    if (error instanceof LocationOrderError) return res.status(400).json({ message: error.message });
    console.error('Saving location order failed', error);
    return res.status(500).json({ message: 'Unable to save the location order.' });
  }
});

export default router;
