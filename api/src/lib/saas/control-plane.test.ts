import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlane, ControlPlaneError } from './control-plane.js';

function locked(plane: ControlPlane, companyId = 'default-company') {
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const selected = plane.selectCompany(login.user.id, companyId);
  return plane.requireControlSession(selected.token).scope;
}

test('P0: ScopeContext rejects a locked session from touching another company', () => {
  const plane = new ControlPlane();
  const scope = locked(plane, 'default-company');
  assert.equal(scope.companyId, 'default-company');
  assert.throws(
    () => plane.assertCompanyScope(scope, 'company-jaipur'),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'COMPANY_SCOPE_MISMATCH' && error.status === 403,
  );
  assert.equal(plane.audit.some((event) => event.action === 'COMPANY_SCOPE_DENIED'), true);
});

test('P1: company switch closes the previous control session', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const first = plane.selectCompany(login.user.id, 'default-company');
  const second = plane.selectCompany(login.user.id, 'company-jaipur');
  assert.equal(first.session.status, 'closed');
  assert.equal(second.session.status, 'active');
  assert.throws(
    () => plane.requireControlSession(first.token),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'SESSION_CLOSED',
  );
  const live = plane.requireControlSession(second.token);
  assert.equal(live.scope.companyId, 'company-jaipur');
});

test('P2: plan limits and entitlements are server-enforced', () => {
  const plane = new ControlPlane();
  const jaipur = locked(plane, 'company-jaipur');
  assert.equal(plane.isFeatureEnabled('company-jaipur', 'OMS'), false);
    assert.throws(
      () => plane.assertFeature('company-jaipur', 'OMS'),
      (error: unknown) => error instanceof ControlPlaneError && error.code === 'FEATURE_NOT_ENTITLED',
    );
  for (let index = 0; index < 24; index += 1) {
    plane.createCompanyUser(jaipur, { email: `staff${index}@jaipur.local`, name: `Staff ${index}`, role: 'STORE_USER' });
  }
  assert.throws(
    () => plane.createCompanyUser(jaipur, { email: 'overflow@jaipur.local', name: 'Overflow', role: 'STORE_USER' }),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'PLAN_LIMIT_REACHED',
  );
  const platform = plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  plane.assignPlan(platform, 'company-jaipur', 'pro', 'raise seats');
  assert.equal(plane.isFeatureEnabled('company-jaipur', 'OMS'), true);
  const created = plane.createCompanyUser(jaipur, { email: 'overflow@jaipur.local', name: 'Overflow', role: 'STORE_USER' });
  assert.equal(created.email, 'overflow@jaipur.local');
  plane.assignPlan(platform, 'company-jaipur', 'starter', 'restore starter');
  assert.equal(plane.isFeatureEnabled('company-jaipur', 'OMS'), false);
});

test('P3: primary admin is protected and passwords are never retrieved', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const staff = plane.createCompanyUser(scope, { email: 'picker@retail.local', name: 'Picker', role: 'WAREHOUSE_PICKER' });
  const reset = plane.resetPassword(scope, staff.id);
  assert.match(reset.temporaryPassword, /Invexa/);
  assert.equal('passwordHash' in staff, false);
  assert.throws(
    () => plane.deleteCompanyUser(scope, 'user-admin-1'),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'PRIMARY_ADMIN_PROTECTED',
  );
    assert.throws(
      () => plane.createCompanyUser(scope, { email: 'root@x.local', name: 'Root', role: 'PLATFORM_SUPER_ADMIN' }),
      (error: unknown) => error instanceof ControlPlaneError && error.code === 'ROLE_NOT_ASSIGNABLE',
    );
});

test('P4-P6: Stock Studio draft, preview, publish and rollback stay company-scoped', () => {
  const plane = new ControlPlane();
  const grocery = locked(plane, 'default-company');
  plane.addStockColumn(grocery, {
    name: 'Minimum Stock',
    key: 'minimum_stock',
    type: 'number',
    defaultValue: 0,
    visibleRoles: ['ADMIN', 'BRANCH_MANAGER'],
    editableRoles: ['ADMIN'],
  });
  plane.setActionEnabled(grocery, 'export', false);
  plane.moveTab(grocery, 'lots', 1);
  const preview = plane.preview(grocery, { role: 'ADMIN', device: 'desktop' });
  assert.equal(preview.page.columns.some((column) => column.key === 'minimum_stock'), true);
  const storePreview = plane.preview(grocery, { role: 'STORE_USER', device: 'desktop' });
  assert.equal(storePreview.page.columns.some((column) => column.key === 'minimum_stock'), false);
  const published = plane.publish(grocery);
  assert.equal(published.status, 'published');
  const groceryRuntime = plane.runtimeConfig('default-company', 'ADMIN');
  const jaipurRuntime = plane.runtimeConfig('company-jaipur', 'ADMIN');
  assert.equal(groceryRuntime.page.columns.some((column) => column.key === 'minimum_stock'), true);
  assert.equal(jaipurRuntime.page.columns.some((column) => column.key === 'minimum_stock'), false);
  const restored = plane.rollback(grocery, 1);
  assert.equal(plane.runtimeConfig('default-company').page.columns.some((column) => column.key === 'minimum_stock'), false);
  assert.ok(restored.version > 1);
});

test('P5: platform kill switch beats company and plan entitlements', () => {
  const plane = new ControlPlane();
  const platform = plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  assert.equal(plane.isFeatureEnabled('default-company', 'OMS'), true);
  plane.setKillSwitch(platform, 'OMS', false, 'incident');
  assert.equal(plane.isFeatureEnabled('default-company', 'OMS'), false);
  assert.throws(
    () => plane.assertFeature('default-company', 'OMS'),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'KILL_SWITCH' && error.status === 403,
  );
  const grocery = locked(plane, 'default-company');
  assert.throws(
    () => plane.setCompanyModule(grocery, 'OMS', true),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'SAFETY_FLOOR',
  );
  plane.setKillSwitch(platform, 'INVENTORY', false, 'inventory-incident');
  assert.throws(
    () => plane.enqueueMutation({
      mutationId: 'mut-kill',
      tenantId: plane.tenantId,
      companyId: 'default-company',
      userId: 'user-store-1',
      deviceId: 'device-1',
      entityType: 'inventory',
      actionType: 'STOCK_ADJUST',
      payload: { itemId: 'item-1', delta: -1 },
    }),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'KILL_SWITCH',
  );
});

test('P7-P8: workflow simulation pins in-flight version and rules fire', () => {
  const plane = new ControlPlane();
  const auto = plane.simulateWorkflow('default-company', 'transfer.approval', { value: 50000 });
  const manager = plane.simulateWorkflow('default-company', 'transfer.approval', { value: 150000 });
  assert.equal(auto.outcome, 'auto_approve');
  assert.equal(manager.outcome, 'manager_approval');
  const outcomes = plane.evaluateRule('default-company', { branchCity: 'Jaipur', adjustmentValue: 15000 });
  assert.deepEqual(outcomes, ['BRANCH_MANAGER']);
});

test('Rule Builder: a rule created through Studio fires the same generic engine as a seeded one', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.upsertRule(scope, {
    key: 'expiry_task',
    name: 'Near-expiry task',
    condition: { daysToExpiryLt: 30 },
    outcome: { action: 'CREATE_TASK:EXPIRY_ACTION' },
  });
  plane.publish(scope);

  assert.deepEqual(plane.evaluateRule('default-company', { daysToExpiry: 10 }), ['CREATE_TASK:EXPIRY_ACTION']);
  // Above threshold: the new rule should not fire, and the seeded high-value
  // rule should not fire either since branchCity/adjustmentValue are absent.
  assert.deepEqual(plane.evaluateRule('default-company', { daysToExpiry: 45 }), []);
  // Both rules can fire together off one context.
  assert.deepEqual(
    plane.evaluateRule('default-company', { daysToExpiry: 5, branchCity: 'Jaipur', adjustmentValue: 20000 }).sort(),
    ['BRANCH_MANAGER', 'CREATE_TASK:EXPIRY_ACTION'].sort(),
  );
});

test('Mobile Policy Builder: upsert updates an existing role in place and adds new roles', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  const seeded = plane.ensureDraft(scope).mobilePolicies.length;

  plane.upsertMobilePolicy(scope, {
    role: 'STORE_USER',
    offlineMaxHours: 6,
    syncScope: ['stock'],
    navigation: ['dashboard', 'stock'],
    encryptedLocalStore: true,
  });
  const afterUpdate = plane.ensureDraft(scope);
  assert.equal(afterUpdate.mobilePolicies.length, seeded);
  const storeUser = afterUpdate.mobilePolicies.find((policy) => policy.role === 'STORE_USER');
  assert.equal(storeUser?.offlineMaxHours, 6);
  assert.deepEqual(storeUser?.syncScope, ['stock']);

  plane.upsertMobilePolicy(scope, {
    role: 'AUDITOR',
    offlineMaxHours: 2,
    syncScope: ['counts'],
    navigation: ['counts'],
    encryptedLocalStore: true,
  });
  assert.equal(plane.ensureDraft(scope).mobilePolicies.length, seeded + 1);
});

test('Field Builder: addField works across entity types and rejects duplicate keys per entity', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);

  plane.addField(scope, { entityType: 'transfer', key: 'carrier_note', name: 'Carrier note', type: 'text' });
  plane.addField(scope, { entityType: 'order', key: 'carrier_note', name: 'Carrier note', type: 'text' });
  const draft = plane.ensureDraft(scope);
  assert.equal(draft.fields.filter((field) => field.fieldKey === 'carrier_note').length, 2);
  assert.equal(draft.fields.find((field) => field.entityType === 'transfer')?.label, 'Carrier note');

  assert.throws(
    () => plane.addField(scope, { entityType: 'transfer', key: 'carrier_note', name: 'Dup', type: 'text' }),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'RESERVED_FIELD',
  );
  // A field on a non-stock entity does not leak into the stock page's columns.
  assert.equal(draft.page.columns.some((column) => column.key === 'carrier_note'), false);
});

test('Workflow Builder: a workflow created through Studio simulates by its own key and threshold', () => {
  const plane = new ControlPlane();
  const scope = locked(plane);
  plane.upsertWorkflow(scope, {
    key: 'count.approval',
    name: 'Count variance approval',
    version: 1,
    graph: {
      nodes: [
        { id: 'start', type: 'trigger', config: { event: 'count.approval.created' } },
        { id: 'check', type: 'condition', config: { field: 'value', op: 'lte', amount: 5000 } },
        { id: 'auto', type: 'action', config: { action: 'AUTO_APPROVE' } },
        { id: 'manager', type: 'approval', config: { role: 'BRANCH_MANAGER' } },
      ],
    },
  });
  plane.publish(scope);

  assert.equal(plane.simulateWorkflow('default-company', 'count.approval', { value: 2000 }).outcome, 'auto_approve');
  assert.equal(plane.simulateWorkflow('default-company', 'count.approval', { value: 9000 }).outcome, 'manager_approval');
  // The pre-existing seeded workflow keeps its own, different threshold.
  assert.equal(plane.simulateWorkflow('default-company', 'transfer.approval', { value: 9000 }).outcome, 'auto_approve');
});

test('P9-P10: offline stock mutations are idempotent and never last-write-wins', () => {
  const plane = new ControlPlane();
  assert.equal(plane.stockOnHand('default-company', 'item-1'), 10);
  const first = plane.enqueueMutation({
    mutationId: 'mut-1',
    tenantId: plane.tenantId,
    companyId: 'default-company',
    userId: 'user-store-1',
    deviceId: 'device-1',
    entityType: 'inventory',
    actionType: 'STOCK_ADJUST',
    payload: { itemId: 'item-1', delta: -2 },
  });
  const retry = plane.enqueueMutation({
    mutationId: 'mut-1',
    tenantId: plane.tenantId,
    companyId: 'default-company',
    userId: 'user-store-1',
    deviceId: 'device-1',
    entityType: 'inventory',
    actionType: 'STOCK_ADJUST',
    payload: { itemId: 'item-1', delta: -2 },
  });
  plane.enqueueMutation({
    mutationId: 'mut-2',
    tenantId: plane.tenantId,
    companyId: 'default-company',
    userId: 'server',
    deviceId: 'api',
    entityType: 'inventory',
    actionType: 'STOCK_ADJUST',
    payload: { itemId: 'item-1', delta: -3 },
  });
  assert.equal(first.status, 'synced');
  assert.equal(retry.result, first.result);
  assert.equal(plane.stockOnHand('default-company', 'item-1'), 5);
  const overwrite = plane.enqueueMutation({
    mutationId: 'mut-3',
    tenantId: plane.tenantId,
    companyId: 'default-company',
    userId: 'user-store-1',
    deviceId: 'device-1',
    entityType: 'inventory',
    actionType: 'STOCK_ADJUST',
    payload: { itemId: 'item-1', quantity: 8 },
  });
  assert.equal(overwrite.status, 'rejected');
  const revoked = plane.enqueueMutation({
    mutationId: 'mut-4',
    tenantId: plane.tenantId,
    companyId: 'default-company',
    userId: 'user-store-1',
    deviceId: 'device-1',
    entityType: 'count',
    actionType: 'COUNT_SUBMIT',
    payload: { permissionRevoked: true },
  });
  assert.equal(revoked.status, 'rejected');
});

test('P11-P12: integrations, billing usage and health are company scoped', () => {
  const plane = new ControlPlane();
  const grocery = locked(plane, 'default-company');
  const key = plane.createApiKey(grocery, 'POS', ['inventory.read']);
  assert.match(key.token, /^invx_/);
  assert.equal(plane.verifyApiKey(key.token)?.companyId, 'default-company');
  assert.equal(plane.verifyApiKey('invx_deadbeefdeadbeefdeadbeefdeadbeef'), null);
  plane.createWebhook(grocery, 'https://example.test/hooks', ['stock.low']);
  plane.upsertConnector(grocery, 'shopify');
  plane.recordUsage('default-company', 'api_requests', 9);
  const billing = plane.billingSnapshot('default-company');
  assert.equal(billing.usage.api_requests, 9);
  assert.equal(plane.health().ok, true);
  const invoice = plane.issueInvoice(grocery, 'default-company');
  assert.equal(invoice.status, 'open');
  plane.markInvoicePastDue(grocery, invoice.id);
  assert.equal(plane.billingSnapshot('default-company').billing.subscription, 'past_due');
  assert.throws(
    () => plane.publish(grocery),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'BILLING_HOLD' && error.status === 402,
  );
  plane.payInvoice(grocery, invoice.id);
  assert.equal(plane.billingSnapshot('default-company').billing.subscription, 'active');
  const firstOpen = plane.issueInvoice(grocery, 'default-company');
  const stillOpen = plane.issueInvoice(grocery, 'default-company');
  plane.markInvoicePastDue(grocery, firstOpen.id);
  plane.payInvoice(grocery, firstOpen.id);
  assert.equal(stillOpen.status, 'open');
  assert.equal(plane.billingSnapshot('default-company').billing.subscription, 'active');
  const firstDue = plane.issueInvoice(grocery, 'default-company');
  const secondDue = plane.issueInvoice(grocery, 'default-company');
  plane.markInvoicePastDue(grocery, firstDue.id);
  plane.markInvoicePastDue(grocery, secondDue.id);
  plane.payInvoice(grocery, firstDue.id);
  assert.equal(plane.billingSnapshot('default-company').billing.subscription, 'past_due');
  plane.payInvoice(grocery, secondDue.id);
  assert.equal(plane.billingSnapshot('default-company').billing.subscription, 'active');
  plane.revokeApiKey(grocery, key.id);
  assert.throws(
    () => plane.verifyApiKey(key.token),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'API_KEY_REVOKED',
  );
  const jaipur = locked(plane, 'company-jaipur');
  assert.throws(
    () => plane.createApiKey(jaipur, 'POS', ['inventory.read']),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'FEATURE_NOT_ENTITLED',
  );
});

test('suspended companies close locked sessions and cannot be selected', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const grocery = plane.selectCompany(login.user.id, 'default-company');
  const groceryScope = plane.requireControlSession(grocery.token).scope;
  assert.throws(
    () => plane.setCompanyStatus(groceryScope, 'company-jaipur', 'suspended', 'cross-tenant'),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'COMPANY_SCOPE_MISMATCH' && error.status === 403,
  );
  const platform = plane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  plane.setCompanyStatus(platform, 'default-company', 'suspended', 'unit-test');
  assert.equal(grocery.session.status, 'closed');
  assert.throws(
    () => plane.requireControlSession(grocery.token),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'SESSION_CLOSED',
  );
  assert.throws(
    () => plane.selectCompany(login.user.id, 'default-company'),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'COMPANY_SUSPENDED' && error.status === 403,
  );
  assert.deepEqual(plane.health().suspendedCompanies, ['default-company']);
  plane.setCompanyStatus(platform, 'default-company', 'active', 'unit-test-restore');
  const restored = plane.selectCompany(login.user.id, 'default-company');
  assert.equal(restored.session.status, 'active');
});

test('platform onboarding creates a company with a one-time admin password', () => {
  const plane = new ControlPlane();
  const login = plane.platformLogin('superadmin@invexa.local', plane.seedPassword);
  const grocery = plane.selectCompany(login.user.id, 'default-company');
  const groceryScope = plane.requireControlSession(grocery.token).scope;
  assert.throws(
    () => plane.createCompany(groceryScope, { name: 'Kota Fresh', planId: 'starter', adminEmail: 'admin@kota.local', adminName: 'Kota Admin' }),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'SESSION_REQUIRED' && error.status === 401,
  );
  const platform = plane.requireControlSession(login.token).scope;
  const created = plane.createCompany(platform, {
    name: 'Kota Fresh',
    planId: 'starter',
    adminEmail: 'admin@kota.local',
    adminName: 'Kota Admin',
  });
  assert.equal(created.company.name, 'Kota Fresh');
  assert.equal(created.company.status, 'active');
  assert.match(created.temporaryPassword, /^Invexa/);
  assert.throws(
    () => plane.createCompany(platform, { name: 'Kota Two', planId: 'starter', adminEmail: 'admin@kota.local', adminName: 'Dup' }),
    (error: unknown) => error instanceof ControlPlaneError && error.code === 'EMAIL_IN_USE' && error.status === 409,
  );
});
