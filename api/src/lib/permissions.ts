// Universal Permission & Rights Engine (blueprint section 8): roles are
// templates, permissions are the actual source of access. A user's effective
// access is: role-template grants, plus explicit per-user Allow/Deny
// overrides layered on top — Deny always wins over Allow, at any scope.

export type PermissionAction = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'APPROVE' | 'EXPORT' | 'ARCHIVE' | 'REVERSE';

export type PermissionKey = { module: string; action: PermissionAction };

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

function keyOf(perm: PermissionKey): string {
  return `${perm.module}:${perm.action}`;
}

export class PermissionRegistry {
  private readonly roleTemplates = new Map<string, RoleTemplateDefinition>();

  registerRoleTemplate(role: RoleTemplateDefinition): void {
    this.roleTemplates.set(role.id, role);
  }

  getRoleTemplate(id: string): RoleTemplateDefinition | undefined {
    return this.roleTemplates.get(id);
  }

  /**
   * Server-side authorization check — this must run on every API call, not
   * only to decide whether to render a UI button. Deny wins over both role
   * grants and explicit Allow overrides.
   */
  can(perm: PermissionKey, ctx: PermissionCheckContext): boolean {
    const target = keyOf(perm);

    const scopedOverrides = ctx.overrides.filter(
      (o) => keyOf(o) === target && (o.scopeId === undefined || o.scopeId === ctx.scopeId),
    );
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
  assertCanGrant(
    grantorCtx: PermissionCheckContext,
    permissionToGrant: PermissionKey,
    grantorIsMainAdmin: boolean,
  ): void {
    if (grantorIsMainAdmin) return;
    if (!this.can(permissionToGrant, grantorCtx)) {
      throw new PermissionDeniedError(
        `Cannot grant ${keyOf(permissionToGrant)}: grantor does not hold this permission themselves.`,
      );
    }
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

/** Throws PermissionDeniedError when the check fails; use at the top of an API handler. */
export function requirePermission(
  registry: PermissionRegistry,
  perm: PermissionKey,
  ctx: PermissionCheckContext,
): void {
  if (!registry.can(perm, ctx)) {
    throw new PermissionDeniedError(`Access denied for ${keyOf(perm)} in scope ${ctx.scopeId ?? 'global'}.`);
  }
}
