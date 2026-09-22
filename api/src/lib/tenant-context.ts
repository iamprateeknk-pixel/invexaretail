// ADR-002: one tenant identifier (companyId) propagated explicitly from the
// authenticated session through every service call into every repository
// call - not re-derived from route params, not assumed from middleware
// having already run. A repository function that takes a TenantContext
// cannot forget to scope its query; one that does not take one is not a
// tenant-scoped repository, whatever it happens to do internally.
import type { Role } from './repository.js';

export type TenantContext = {
  companyId: string;
  tenantId: string;
  userId: string;
  role: Role;
  /**
   * Explicit, audited control-plane elevation (e.g. platform support
   * impersonating a tenant to resolve a ticket) - never a generic bypass
   * flag. Only lib/saas/control-plane.ts constructs one of these, always
   * with a reason and the acting operator's id.
   */
  elevation?: { reason: string; actorId: string };
};

export class MissingTenantContextError extends Error {
  constructor() {
    super('Tenant context is required and was not provided; refusing to run an unscoped query.');
    this.name = 'MissingTenantContextError';
  }
}

/** Fails closed: throws rather than returning a context with an empty companyId. */
export function requireTenantContext(input: {
  companyId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  role?: Role | null;
  elevation?: { reason: string; actorId: string };
}): TenantContext {
  if (!input.companyId || !input.userId || !input.role) {
    throw new MissingTenantContextError();
  }
  return {
    companyId: input.companyId,
    tenantId: input.tenantId || 'tenant-invexa',
    userId: input.userId,
    role: input.role,
    ...(input.elevation ? { elevation: input.elevation } : {}),
  };
}
