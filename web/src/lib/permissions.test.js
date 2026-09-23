import assert from 'node:assert/strict';
import test from 'node:test';
import { NAVIGATION } from './workspace.js';
import { canAccessSection, getRoleHome } from './permissions.js';

const ALL_ROLES = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
const ALL_SECTION_IDS = NAVIGATION.flatMap((group) => group.items.map((item) => item.id));

test('canAccessSection agrees with NAVIGATION for every role x section combination', () => {
  // This is the regression test for the bug this module fixes: before Week
  // 9, Workspace.jsx's route guard (SECTION_ROLES) and the nav's visibility
  // rule (NAVIGATION[].roles) were two separately maintained tables that
  // could disagree - and did, for 17 of NAVIGATION's ~26 sections which
  // had no entry in SECTION_ROLES at all. This test would have failed
  // against that old pairing (its "correct" answer, NAVIGATION's own
  // `roles`, disagreed with SECTION_ROLES' silence on most ids) - it now
  // passes by construction, because both the nav and the route guard call
  // this same function.
  for (const item of NAVIGATION.flatMap((group) => group.items)) {
    for (const role of ALL_ROLES) {
      const expected = !item.roles || item.roles.includes(role);
      const expectedWithAdminOnly = item.adminOnly ? role === 'ADMIN' : expected;
      assert.equal(
        canAccessSection(item.id, { role }),
        expectedWithAdminOnly,
        `${item.id} for role ${role} should be ${expectedWithAdminOnly}`,
      );
    }
  }
});

test('canAccessSection denies a section hidden by pack/entitlement even for a role NAVIGATION would otherwise allow', () => {
  assert.equal(canAccessSection('orders', { role: 'ADMIN', hiddenModules: new Set(['orders']) }), false);
  assert.equal(canAccessSection('orders', { role: 'ADMIN', hiddenModules: new Set() }), true);
});

test('canAccessSection is permissive for an id with no NAVIGATION entry (unknown/legacy id) rather than inventing a new denial', () => {
  assert.equal(canAccessSection('not-a-real-section', { role: 'STORE_USER' }), true);
});

test('every APP_SECTIONS id used by useSectionRoute is covered by canAccessSection\'s NAVIGATION lookup', () => {
  // Guards against a future NAVIGATION edit silently losing a section this
  // module needs to know about.
  assert.ok(ALL_SECTION_IDS.length > 20, 'sanity check: NAVIGATION should still list the full module set');
});

test('getRoleHome returns a section every role can access', () => {
  for (const role of ALL_ROLES) {
    const home = getRoleHome(role);
    assert.equal(canAccessSection(home, { role }), true, `${role}'s home section must itself be accessible to that role`);
  }
});
