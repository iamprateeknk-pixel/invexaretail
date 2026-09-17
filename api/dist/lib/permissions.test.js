"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const permissions_js_1 = require("./permissions.js");
function registryWithStoreUser() {
    const registry = new permissions_js_1.PermissionRegistry();
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
(0, node_test_1.default)('role template grants access to its listed module/actions', () => {
    const registry = registryWithStoreUser();
    const ctx = { roleTemplateIds: ['role-store-user'], overrides: [] };
    strict_1.default.equal(registry.can({ module: 'inventory', action: 'VIEW' }, ctx), true);
    strict_1.default.equal(registry.can({ module: 'counts', action: 'CREATE' }, ctx), true);
});
(0, node_test_1.default)('role template does not grant access to unlisted actions', () => {
    const registry = registryWithStoreUser();
    const ctx = { roleTemplateIds: ['role-store-user'], overrides: [] };
    strict_1.default.equal(registry.can({ module: 'inventory', action: 'DELETE' }, ctx), false);
});
(0, node_test_1.default)('explicit ALLOW override grants access beyond the role template', () => {
    const registry = registryWithStoreUser();
    const ctx = {
        roleTemplateIds: ['role-store-user'],
        overrides: [{ module: 'transfers', action: 'APPROVE', effect: 'ALLOW' }],
    };
    strict_1.default.equal(registry.can({ module: 'transfers', action: 'APPROVE' }, ctx), true);
});
(0, node_test_1.default)('DENY override wins over a role template grant', () => {
    const registry = registryWithStoreUser();
    const ctx = {
        roleTemplateIds: ['role-store-user'],
        overrides: [{ module: 'inventory', action: 'VIEW', effect: 'DENY' }],
    };
    strict_1.default.equal(registry.can({ module: 'inventory', action: 'VIEW' }, ctx), false);
});
(0, node_test_1.default)('DENY override wins even over an explicit ALLOW for the same permission', () => {
    const registry = registryWithStoreUser();
    const ctx = {
        roleTemplateIds: ['role-store-user'],
        overrides: [
            { module: 'transfers', action: 'APPROVE', effect: 'ALLOW' },
            { module: 'transfers', action: 'APPROVE', effect: 'DENY' },
        ],
    };
    strict_1.default.equal(registry.can({ module: 'transfers', action: 'APPROVE' }, ctx), false);
});
(0, node_test_1.default)('overrides are scoped: a branch-scoped DENY does not affect other branches', () => {
    const registry = registryWithStoreUser();
    const denyAtBranchA = {
        roleTemplateIds: ['role-store-user'],
        overrides: [{ module: 'inventory', action: 'VIEW', effect: 'DENY', scopeId: 'branch-A' }],
        scopeId: 'branch-A',
    };
    const noScopeCtx = {
        roleTemplateIds: ['role-store-user'],
        overrides: [{ module: 'inventory', action: 'VIEW', effect: 'DENY', scopeId: 'branch-A' }],
        scopeId: 'branch-B',
    };
    strict_1.default.equal(registry.can({ module: 'inventory', action: 'VIEW' }, denyAtBranchA), false);
    strict_1.default.equal(registry.can({ module: 'inventory', action: 'VIEW' }, noScopeCtx), true);
});
(0, node_test_1.default)('requirePermission throws PermissionDeniedError when access is missing', () => {
    const registry = registryWithStoreUser();
    const ctx = { roleTemplateIds: ['role-store-user'], overrides: [] };
    strict_1.default.throws(() => (0, permissions_js_1.requirePermission)(registry, { module: 'inventory', action: 'DELETE' }, ctx), permissions_js_1.PermissionDeniedError);
});
(0, node_test_1.default)('a non-admin cannot grant a permission they do not themselves possess', () => {
    const registry = registryWithStoreUser();
    const grantorCtx = { roleTemplateIds: ['role-store-user'], overrides: [] };
    strict_1.default.throws(() => registry.assertCanGrant(grantorCtx, { module: 'transfers', action: 'APPROVE' }, false));
    // A permission the grantor already holds can be re-granted.
    strict_1.default.doesNotThrow(() => registry.assertCanGrant(grantorCtx, { module: 'inventory', action: 'VIEW' }, false));
});
(0, node_test_1.default)('Main Admin can grant any permission regardless of their own grants', () => {
    const registry = registryWithStoreUser();
    const grantorCtx = { roleTemplateIds: ['role-store-user'], overrides: [] };
    strict_1.default.doesNotThrow(() => registry.assertCanGrant(grantorCtx, { module: 'transfers', action: 'APPROVE' }, true));
});
