// Shared scaffolding for the operations-extension routers (Phase 4):
// tenant context, location access and role gates used by nearly
// every cluster. Extracted verbatim from operations-extension.ts.
import { type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID, ownerOfLocation, companyOwnsLocation } from '../lib/saas/tenant-scope.js';
import { type TenantContext } from '../lib/tenant-context.js';

export function tenantContextOf(req: Request): TenantContext {
  return { companyId: req.companyId ?? DEFAULT_COMPANY_ID, tenantId: DEFAULT_TENANT_ID, userId: req.user!.id, role: req.user!.role as TenantContext['role'] };
}

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
export function canAccessLocation(req: Request, locationId: string): boolean {
  if (req.companyId && ownerOfLocation(locationId) && !companyOwnsLocation(req.companyId, locationId)) {
    return false;
  }
  return ['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(req.user!.role) || (req.user!.locationIds ?? []).includes(locationId);
}

export function requireAdmin(req: Request, res: Response): boolean {
  if (!['ADMIN', 'ADMIN_USER'].includes(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

// Listing every tenant and provisioning a new one (with its first Admin) are platform-operator actions, not
// something any company's admin may do: an admin of company B could otherwise read the whole tenant list and
// mint companies and Admin accounts. The operator is the Admin of the platform's own (default) company; the
// separate Control Plane is where super admins work.
export function requirePlatformOperator(req: Request, res: Response): boolean {
  const isOperator = req.user!.role === 'ADMIN' && (req.companyId ?? DEFAULT_COMPANY_ID) === DEFAULT_COMPANY_ID;
  if (!isOperator) {
    res.status(403).json({ message: 'Only the platform operator can manage tenants.' });
    return false;
  }
  return true;
}

export function expiryAlertId(itemId: string, lotId: string, locationId: string): string {
  return `expiry-${createHash('sha1').update(`${itemId}|${lotId}|${locationId}`).digest('hex').slice(0, 24)}`;
}
