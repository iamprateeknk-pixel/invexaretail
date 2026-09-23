"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingTenantContextError = void 0;
exports.requireTenantContext = requireTenantContext;
class MissingTenantContextError extends Error {
    constructor() {
        super('Tenant context is required and was not provided; refusing to run an unscoped query.');
        this.name = 'MissingTenantContextError';
    }
}
exports.MissingTenantContextError = MissingTenantContextError;
/** Fails closed: throws rather than returning a context with an empty companyId. */
function requireTenantContext(input) {
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
