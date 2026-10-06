import assert from 'node:assert/strict';
import test from 'node:test';
import { NAVIGATION, ROLE_LANDING_PREFERENCES, ROLE_LABELS, defaultSectionForRole } from './workspace.js';
import { canAccessSection } from './permissions.js';

test('every role lands on a section it is actually allowed to open', () => {
  for (const role of Object.keys(ROLE_LABELS)) {
    const landing = defaultSectionForRole(role, { canAccess: (section) => canAccessSection(section, { role }) });
    assert.ok(canAccessSection(landing, { role }), `${role} would land on ${landing}, which it cannot open`);
  }
});

test('floor roles land on their task queue; managers and admins on the control tower', () => {
  const landing = (role) => defaultSectionForRole(role, { canAccess: (section) => canAccessSection(section, { role }) });
  assert.equal(landing('STORE_USER'), 'counts');
  assert.equal(landing('WAREHOUSE_PICKER'), 'picking');
  assert.equal(landing('AUDITOR'), 'reports');
  for (const role of ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER']) assert.equal(landing(role), 'dashboard');
});

test('if the preferred section is hidden or not permitted the next preference wins, and an unknown role gets the dashboard', () => {
  assert.equal(defaultSectionForRole('STORE_USER', { canAccess: (section) => section !== 'counts' }), 'dashboard');
  assert.equal(defaultSectionForRole('NOT_A_ROLE'), 'dashboard');
  assert.equal(defaultSectionForRole('STORE_USER', { canAccess: () => false }), 'dashboard', 'never an empty page');
});

test('landing preferences only name real navigation sections', () => {
  const ids = new Set(NAVIGATION.flatMap((group) => group.items.map((item) => item.id)));
  for (const [role, sections] of Object.entries(ROLE_LANDING_PREFERENCES)) {
    for (const section of sections) assert.ok(ids.has(section), `${role} prefers unknown section ${section}`);
  }
});

test('no navigation entry shows an internal priority label to operators', () => {
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      assert.ok(!item.badge || !/^P\d$/i.test(item.badge), `${item.id} shows the internal label "${item.badge}"`);
    }
  }
});
