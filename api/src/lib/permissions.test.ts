import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionRegistry, requirePermission, PermissionDeniedError } from './permissions.js';

function registryWithStoreUser(): PermissionRegistry {
  const registry = new PermissionRegistry();
  registry.registerRoleTemplate({
    id: 'role-store-user',
    name: 'Store User',
    grants: [
      { module: 'inventory', action: 'VIEW' },
      { module: 'counts', action: 'CREATE' },
    ],
  });
  return registry;
}

test('role template grants access to its listed module/actions', () => {
  const registry = registryWithStoreUser();
  const ctx = { roleTemplateIds: ['role-store-user'], overrides: [] };

  assert.equal(registry.can({ module: 'inventory', action: 'VIEW' }, ctx), true);
  assert.equal(registry.can({ module: 'counts', action: 'CREATE' }, ctx), true);
});

test('role template does not grant access to unlisted actions', () => {
  const registry = registryWithStoreUser();
  const ctx = { roleTemplateIds: ['role-store-user'], overrides: [] };

  assert.equal(registry.can({ module: 'inventory', action: 'DELETE' }, ctx), false);
});

test('explicit ALLOW override grants access beyond the role template', () => {
  const registry = registryWithStoreUser();
  const ctx = {
    roleTemplateIds: ['role-store-user'],
    overrides: [{ module: 'transfers', action: 'APPROVE' as const, effect: 'ALLOW' as const }],
  };

  assert.equal(registry.can({ module: 'transfers', action: 'APPROVE' }, ctx), true);
});

test('DENY override wins over a role template grant', () => {
  const registry = registryWithStoreUser();
  const ctx = {
    roleTemplateIds: ['role-store-user'],
    overrides: [{ module: 'inventory', action: 'VIEW' as const, effect: 'DENY' as const }],
  };

  assert.equal(registry.can({ module: 'inventory', action: 'VIEW' }, ctx), false);
});

test('DENY override wins even over an explicit ALLOW for the same permission', () => {
  const registry = registryWithStoreUser();
  const ctx = {
    roleTemplateIds: ['role-store-user'],
    overrides: [
      { module: 'transfers', action: 'APPROVE' as const, effect: 'ALLOW' as const },
      { module: 'transfers', action: 'APPROVE' as const, effect: 'DENY' as const },
    ],
  };

  assert.equal(registry.can({ module: 'transfers', action: 'APPROVE' }, ctx), false);
});

test('overrides are scoped: a branch-scoped DENY does not affect other branches', () => {
  const registry = registryWithStoreUser();
  const denyAtBranchA = {
    roleTemplateIds: ['role-store-user'],
    overrides: [{ module: 'inventory', action: 'VIEW' as const, effect: 'DENY' as const, scopeId: 'branch-A' }],
    scopeId: 'branch-A',
  };
  const noScopeCtx = {
    roleTemplateIds: ['role-store-user'],
    overrides: [{ module: 'inventory', action: 'VIEW' as const, effect: 'DENY' as const, scopeId: 'branch-A' }],
    scopeId: 'branch-B',
  };

  assert.equal(registry.can({ module: 'inventory', action: 'VIEW' }, denyAtBranchA), false);
  assert.equal(registry.can({ module: 'inventory', action: 'VIEW' }, noScopeCtx), true);
});

test('requirePermission throws PermissionDeniedError when access is missing', () => {
  const registry = registryWithStoreUser();
  const ctx = { roleTemplateIds: ['role-store-user'], overrides: [] };

  assert.throws(
    () => requirePermission(registry, { module: 'inventory', action: 'DELETE' }, ctx),
    PermissionDeniedError,
  );
});

test('a non-admin cannot grant a permission they do not themselves possess', () => {
  const registry = registryWithStoreUser();
  const grantorCtx = { roleTemplateIds: ['role-store-user'], overrides: [] };

  assert.throws(() =>
    registry.assertCanGrant(grantorCtx, { module: 'transfers', action: 'APPROVE' }, false),
  );
  // A permission the grantor already holds can be re-granted.
  assert.doesNotThrow(() =>
    registry.assertCanGrant(grantorCtx, { module: 'inventory', action: 'VIEW' }, false),
  );
});

test('Main Admin can grant any permission regardless of their own grants', () => {
  const registry = registryWithStoreUser();
  const grantorCtx = { roleTemplateIds: ['role-store-user'], overrides: [] };

  assert.doesNotThrow(() =>
    registry.assertCanGrant(grantorCtx, { module: 'transfers', action: 'APPROVE' }, true),
  );
});
