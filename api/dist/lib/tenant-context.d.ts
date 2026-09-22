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
    elevation?: {
        reason: string;
        actorId: string;
    };
};
export declare class MissingTenantContextError extends Error {
    constructor();
}
/** Fails closed: throws rather than returning a context with an empty companyId. */
export declare function requireTenantContext(input: {
    companyId?: string | null;
    tenantId?: string | null;
    userId?: string | null;
    role?: Role | null;
    elevation?: {
        reason: string;
        actorId: string;
    };
}): TenantContext;
