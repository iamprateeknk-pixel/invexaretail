"use strict";
// Universal Permission & Rights Engine (blueprint section 8): roles are
// templates, permissions are the actual source of access. A user's effective
// access is: role-template grants, plus explicit per-user Allow/Deny
// overrides layered on top — Deny always wins over Allow, at any scope.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionDeniedError = exports.PermissionRegistry = void 0;
exports.requirePermission = requirePermission;
function keyOf(perm) {
    return `${perm.module}:${perm.action}`;
}
class PermissionRegistry {
    roleTemplates = new Map();
    registerRoleTemplate(role) {
        this.roleTemplates.set(role.id, role);
    }
    getRoleTemplate(id) {
        return this.roleTemplates.get(id);
    }
    /**
     * Server-side authorization check — this must run on every API call, not
     * only to decide whether to render a UI button. Deny wins over both role
     * grants and explicit Allow overrides.
     */
    can(perm, ctx) {
        const target = keyOf(perm);
        const scopedOverrides = ctx.overrides.filter((o) => keyOf(o) === target && (o.scopeId === undefined || o.scopeId === ctx.scopeId));
        if (scopedOverrides.some((o) => o.effect === 'DENY')) {
            return false;
        }
        if (scopedOverrides.some((o) => o.effect === 'ALLOW')) {
            return true;
        }
        for (const roleId of ctx.roleTemplateIds) {
            const role = this.roleTemplates.get(roleId);
            if (role?.grants.some((g) => keyOf(g) === target)) {
                return true;
            }
        }
        return false;
    }
    /**
     * A role can only grant permissions it itself possesses, unless the
     * grantor is Main Admin — enforced here rather than trusted to the caller.
     */
    assertCanGrant(grantorCtx, permissionToGrant, grantorIsMainAdmin) {
        if (grantorIsMainAdmin)
            return;
        if (!this.can(permissionToGrant, grantorCtx)) {
            throw new PermissionDeniedError(`Cannot grant ${keyOf(permissionToGrant)}: grantor does not hold this permission themselves.`);
        }
    }
}
exports.PermissionRegistry = PermissionRegistry;
class PermissionDeniedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PermissionDeniedError';
    }
}
exports.PermissionDeniedError = PermissionDeniedError;
/** Throws PermissionDeniedError when the check fails; use at the top of an API handler. */
function requirePermission(registry, perm, ctx) {
    if (!registry.can(perm, ctx)) {
        throw new PermissionDeniedError(`Access denied for ${keyOf(perm)} in scope ${ctx.scopeId ?? 'global'}.`);
    }
}
