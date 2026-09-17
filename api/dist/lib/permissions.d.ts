export type PermissionAction = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'APPROVE' | 'EXPORT' | 'ARCHIVE' | 'REVERSE';
export type PermissionKey = {
    module: string;
    action: PermissionAction;
};
export type RoleTemplateDefinition = {
    id: string;
    name: string;
    grants: PermissionKey[];
};
export type UserPermissionOverride = PermissionKey & {
    effect: 'ALLOW' | 'DENY';
    scopeId?: string;
};
export type PermissionCheckContext = {
    roleTemplateIds: string[];
    overrides: UserPermissionOverride[];
    scopeId?: string;
};
export declare class PermissionRegistry {
    private readonly roleTemplates;
    registerRoleTemplate(role: RoleTemplateDefinition): void;
    getRoleTemplate(id: string): RoleTemplateDefinition | undefined;
    /**
     * Server-side authorization check — this must run on every API call, not
     * only to decide whether to render a UI button. Deny wins over both role
     * grants and explicit Allow overrides.
     */
    can(perm: PermissionKey, ctx: PermissionCheckContext): boolean;
    /**
     * A role can only grant permissions it itself possesses, unless the
     * grantor is Main Admin — enforced here rather than trusted to the caller.
     */
    assertCanGrant(grantorCtx: PermissionCheckContext, permissionToGrant: PermissionKey, grantorIsMainAdmin: boolean): void;
}
export declare class PermissionDeniedError extends Error {
    constructor(message: string);
}
/** Throws PermissionDeniedError when the check fails; use at the top of an API handler. */
export declare function requirePermission(registry: PermissionRegistry, perm: PermissionKey, ctx: PermissionCheckContext): void;
