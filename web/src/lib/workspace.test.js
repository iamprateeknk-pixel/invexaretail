import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_SECTIONS, LINK_ONLY_SECTIONS } from '../hooks/useSectionRoute.js';
import {
  DEFAULT_WORKSPACE_PROFILE,
  NAVIGATION,
  PAGE_META,
  formatDateTime,
  hiddenModulesForEntitlements,
  normalizeCounts,
  normalizeStockRows,
  normalizeTransfers,
  statusBadgeVariant,
  visibleNavigationGroups,
} from './workspace.js';

test('navigation ids stay inside the hash-route catalog', () => {
  const navIds = NAVIGATION.flatMap((group) => group.items.map((item) => item.id));
  assert.deepEqual([...new Set(navIds), ...LINK_ONLY_SECTIONS].sort(), [...APP_SECTIONS].sort());
  for (const id of [...navIds, ...LINK_ONLY_SECTIONS]) {
    assert.ok(PAGE_META[id], `missing page meta for ${id}`);
  }
});

test('status badges map operational states to semantic variants', () => {
  assert.equal(statusBadgeVariant('APPROVED'), 'success');
  assert.equal(statusBadgeVariant('Pending review'), 'warning');
  assert.equal(statusBadgeVariant('REJECTED'), 'destructive');
  assert.equal(statusBadgeVariant('unknown'), 'secondary');
});

test('normalize helpers keep location and item labels on operational rows', () => {
  const items = [{ id: 'item-1', name: 'Rice', lots: [{ id: 'lot-1', lotNo: 'LOT-01' }] }];
  const locations = [{ id: 'loc-1', name: 'Main Store' }];
  const stock = normalizeStockRows([{ itemId: 'item-1', locationId: 'loc-1', physicalQuantity: 4 }], items);
  assert.equal(stock[0].itemName, 'Rice');

  const counts = normalizeCounts([{
    id: 'count-1',
    itemId: 'item-1',
    lotId: 'lot-1',
    locationId: 'loc-1',
    physicalQuantity: 5,
    bookQty: 4,
    status: 'PENDING_REVIEW',
  }], items, locations);
  assert.equal(counts[0].item, 'Rice');
  assert.equal(counts[0].lot, 'LOT-01');
  assert.equal(counts[0].locationName, 'Main Store');
  assert.equal(counts[0].variance, 1);
  assert.equal(counts[0].status, 'Pending review');

  const transfers = normalizeTransfers([{
    id: 't-1',
    sourceLocationId: 'loc-1',
    destinationLocationId: 'loc-1',
    lines: [{ itemId: 'item-1', quantity: 2 }],
    status: 'PICKED',
  }], items, locations);
  assert.equal(transfers[0].from, 'loc-1');
  assert.equal(transfers[0].item, 'Rice');
  assert.equal(transfers[0].qty, 2);
});

test('workspace barcode, print and queue helpers live in libraries used by the app hook', () => {
  const composer = readFileSync(new URL('../hooks/useWorkspaceApp.js', import.meta.url), 'utf8');
  const stock = readFileSync(new URL('../hooks/useWorkspaceStock.js', import.meta.url), 'utf8');
  const hydration = readFileSync(new URL('../hooks/useWorkspaceHydration.js', import.meta.url), 'utf8');
  const derived = readFileSync(new URL('../hooks/useWorkspaceDerived.js', import.meta.url), 'utf8');
  assert.ok(stock.includes("from '../lib/barcode'"));
  assert.ok(stock.includes("from '../lib/print-labels'"));
  assert.ok(hydration.includes("from '../lib/workspace-queues'"));
  assert.ok(derived.includes("from '../lib/workspace-queues'"));
  assert.equal(composer.includes('function code39Svg'), false);
  assert.equal(composer.includes('STOCK TRANSFER'), false);
  assert.equal(composer.includes('async function completePickerTask'), false);
});

test('workspace dialogs live in WorkspaceDialogs, not App.jsx', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const dialogs = readFileSync(new URL('../components/workspace/WorkspaceDialogs.jsx', import.meta.url), 'utf8');
  assert.match(app, /WorkspaceDialogs/);
  assert.equal(app.includes('<Dialog'), false);
  assert.match(dialogs, /CountDialogs/);
  assert.match(dialogs, /CommandPaletteDialog/);
  assert.match(dialogs, /MovementDialogs/);
  assert.match(dialogs, /InventoryDialogs/);
  assert.match(dialogs, /AdminPortalDialog/);
});

test('WorkspaceDialogs defers modals to workspace dialog modules', () => {
  const composer = readFileSync(new URL('../components/workspace/WorkspaceDialogs.jsx', import.meta.url), 'utf8');
  const counts = readFileSync(new URL('../components/workspace/dialogs/CountDialogs.jsx', import.meta.url), 'utf8');
  const commands = readFileSync(new URL('../components/workspace/dialogs/CommandPaletteDialog.jsx', import.meta.url), 'utf8');
  const movement = readFileSync(new URL('../components/workspace/dialogs/MovementDialogs.jsx', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../components/workspace/dialogs/InventoryDialogs.jsx', import.meta.url), 'utf8');
  const transfer = readFileSync(new URL('../components/workspace/dialogs/TransferRequestDialog.jsx', import.meta.url), 'utf8');
  const scanner = readFileSync(new URL('../components/workspace/dialogs/ScannerDialog.jsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../components/workspace/dialogs/AdminPortalDialog.jsx', import.meta.url), 'utf8');
  const assign = readFileSync(new URL('../components/workspace/dialogs/AssignCountDialog.jsx', import.meta.url), 'utf8');
  assert.equal(composer.includes('Create Transfer Request'), false);
  assert.equal(composer.includes('Admin Portal'), false);
  assert.equal(composer.includes('Scan inventory barcode'), false);
  assert.equal(composer.includes('Assign Stock Count'), false);
  assert.match(commands, /Quick command search/);
  assert.match(counts, /CountTaskSheet/);
  assert.match(counts, /AssignCountDialog/);
  assert.match(assign, /Assign Stock Count/);
  assert.match(movement, /TransferRequestDialog/);
  assert.match(transfer, /Create Transfer Request/);
  assert.match(inventory, /ScannerDialog/);
  assert.match(scanner, /Scan inventory barcode/);
  assert.match(admin, /Admin Portal/);
});

test('live entry does not keep the unused AdvancedApp prototype', () => {
  const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8');
  assert.ok(main.includes("from './App.jsx'"));
  assert.doesNotMatch(main, /AdvancedApp/);
  assert.equal(existsSync(fileURLToPath(new URL('../AdvancedApp.jsx', import.meta.url))), false);
});

test('formatDateTime keeps empty values operator-facing', () => {
  assert.equal(formatDateTime(''), 'Not recorded');
  assert.equal(formatDateTime('not-a-date'), 'Not recorded');
  assert.match(formatDateTime('2026-09-14T12:00:00.000Z'), /2026/);
});

test('grocery pack hides assets and store users cannot see admin-only integrations', () => {
  const groceryHide = DEFAULT_WORKSPACE_PROFILE.pack.hide;
  const storeIds = visibleNavigationGroups(NAVIGATION, { role: 'STORE_USER', hiddenModules: groceryHide })
    .flatMap((group) => group.items.map((item) => item.id));
  assert.equal(storeIds.includes('assets'), false);
  assert.equal(storeIds.includes('integrations'), false);
  assert.equal(storeIds.includes('admin'), false);
  assert.equal(storeIds.includes('stock-update'), false);
  assert.ok(storeIds.includes('dashboard'));
  assert.ok(storeIds.includes('counts'));
  assert.ok(storeIds.includes('alerts'));

  const adminIds = visibleNavigationGroups(NAVIGATION, { role: 'ADMIN', hiddenModules: groceryHide })
    .flatMap((group) => group.items.map((item) => item.id));
  assert.ok(adminIds.includes('integrations'));
  assert.ok(adminIds.includes('admin'));
  assert.equal(adminIds.includes('assets'), false);
});

test('starter entitlements hide channel orders, intelligence and integrations', () => {
  const hidden = hiddenModulesForEntitlements({
    OMS: false,
    ANALYTICS: false,
    INTEGRATIONS: false,
    PURCHASING: true,
    WMS: true,
    INVENTORY: true,
  });
  const adminIds = visibleNavigationGroups(NAVIGATION, {
    role: 'ADMIN',
    hiddenModules: [...DEFAULT_WORKSPACE_PROFILE.pack.hide, ...hidden],
  }).flatMap((group) => group.items.map((item) => item.id));
  assert.equal(adminIds.includes('orders'), false);
  assert.equal(adminIds.includes('intelligence'), false);
  assert.equal(adminIds.includes('integrations'), false);
  assert.ok(adminIds.includes('transfers'));
  assert.ok(adminIds.includes('inventory'));
  assert.ok(adminIds.includes('purchase-orders'));
});

test('App.jsx defers sidebar, header and location chrome to WorkspaceChrome', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../components/workspace/WorkspaceChrome.jsx', import.meta.url), 'utf8');
  assert.ok(app.includes("from './components/workspace/WorkspaceChrome'"));
  assert.ok(app.includes('<WorkspaceChrome'));
  assert.equal(app.includes('Collapse sidebar'), false);
  assert.equal(app.includes('Primary navigation'), false);
  assert.equal(app.includes('Open navigation'), false);
  assert.match(chrome, /Collapse sidebar/);
  assert.match(chrome, /Primary navigation/);
  assert.match(chrome, /Open navigation/);
  assert.match(chrome, /Search workspace/);
});

test('login card offers password and one-time code sign-in', () => {
  const card = readFileSync(new URL('../components/auth/LoginCard.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(card, /One-time code/);
  assert.match(card, /id="login-otp"/);
  assert.match(card, /onSendOtp/);
  assert.match(card, /onVerifyOtp/);
  assert.match(app, /handleSendOtp/);
  assert.match(app, /handleVerifyOtp/);
  assert.match(app, /onPasswordSubmit=\{handleLogin\}/);
});

test('App.jsx defers session and mutations to useWorkspaceApp', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../hooks/useWorkspaceApp.js', import.meta.url), 'utf8');
  assert.ok(app.includes("from './hooks/useWorkspaceApp'"));
  assert.ok(app.includes('useWorkspaceApp()'));
  assert.ok(app.includes('isControlPlaneRoute'));
  assert.ok(app.includes('<ControlPlaneApp'));
  assert.equal(app.includes('async function handleLogin'), false);
  assert.equal(app.includes('async function loadAppData'), false);
  assert.equal(app.includes('function handleLogout'), false);
  assert.match(hook, /export function useWorkspaceApp/);
  assert.match(hook, /useWorkspaceAuth/);
  assert.match(hook, /useWorkspaceCounts/);
  assert.match(hook, /useWorkspaceTransfers/);
  assert.match(hook, /useWorkspaceAdmin/);
  assert.match(hook, /useWorkspaceCatalog/);
  assert.match(hook, /useWorkspaceImports/);
  assert.match(hook, /useWorkspaceExpiry/);
  assert.match(hook, /useWorkspaceStock/);
  assert.match(hook, /useWorkspaceProcurement/);
  assert.match(hook, /useWorkspaceOperations/);
  assert.match(hook, /useWorkspaceReports/);
  assert.match(hook, /useWorkspaceIntegrations/);
});

test('workspace app splits auth, counts, transfers and admin into domain hooks', () => {
  const auth = readFileSync(new URL('../hooks/useWorkspaceAuth.js', import.meta.url), 'utf8');
  const counts = readFileSync(new URL('../hooks/useWorkspaceCounts.js', import.meta.url), 'utf8');
  const transfers = readFileSync(new URL('../hooks/useWorkspaceTransfers.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../hooks/useWorkspaceAdmin.js', import.meta.url), 'utf8');
  const composer = readFileSync(new URL('../hooks/useWorkspaceApp.js', import.meta.url), 'utf8');
  assert.match(auth, /async function handleLogin/);
  assert.match(auth, /async function handleSendOtp/);
  assert.match(auth, /async function handleVerifyOtp/);
  assert.match(auth, /async function handleLogout/);
  assert.match(auth, /refreshSessionAccessToken/);
  assert.equal(auth.includes('Session expired'), false);
  assert.match(counts, /async function submitBlindCount/);
  assert.match(counts, /async function reviewCount/);
  assert.match(transfers, /async function requestTransfer/);
  assert.match(transfers, /function generateTransferPDF/);
  assert.match(admin, /async function openAdminPortal/);
  assert.equal(composer.includes('async function handleLogin'), false);
  assert.equal(composer.includes('async function submitBlindCount'), false);
  assert.equal(composer.includes('async function requestTransfer'), false);
  assert.equal(composer.includes('async function openAdminPortal'), false);
  assert.ok(
    composer.indexOf('useWorkspaceCore(') < composer.indexOf('useWorkspaceAuth('),
    'core toast helpers must initialize before domain hooks to avoid a TDZ crash on login',
  );
});

test('workspace app splits inventory catalog, imports, expiry and stock into domain hooks', () => {
  const catalog = readFileSync(new URL('../hooks/useWorkspaceCatalog.js', import.meta.url), 'utf8');
  const imports = readFileSync(new URL('../hooks/useWorkspaceImports.js', import.meta.url), 'utf8');
  const expiry = readFileSync(new URL('../hooks/useWorkspaceExpiry.js', import.meta.url), 'utf8');
  const stock = readFileSync(new URL('../hooks/useWorkspaceStock.js', import.meta.url), 'utf8');
  const composer = readFileSync(new URL('../hooks/useWorkspaceApp.js', import.meta.url), 'utf8');
  assert.match(catalog, /async function createTag/);
  assert.match(catalog, /async function saveReorderRule/);
  assert.match(imports, /async function importItems/);
  assert.match(imports, /async function previewOrCommitDailyImport/);
  assert.match(expiry, /async function setLotExpiryDate/);
  assert.match(expiry, /async function executeReplenishment/);
  assert.match(stock, /function resolveScannedCode/);
  assert.match(stock, /async function submitManualStockUpdate/);
  assert.equal(composer.includes('async function createTag'), false);
  assert.equal(composer.includes('async function importItems'), false);
  assert.equal(composer.includes('async function setLotExpiryDate'), false);
  assert.equal(composer.includes('async function submitManualStockUpdate'), false);
  assert.ok(
    composer.indexOf('useWorkspaceCore(') < composer.indexOf('useWorkspaceExpiry('),
    'navigateTo from core must be initialized before the expiry hook',
  );
});

test('workspace app splits procurement, operations, reports and integrations into domain hooks', () => {
  const procurement = readFileSync(new URL('../hooks/useWorkspaceProcurement.js', import.meta.url), 'utf8');
  const operations = readFileSync(new URL('../hooks/useWorkspaceOperations.js', import.meta.url), 'utf8');
  const reports = readFileSync(new URL('../hooks/useWorkspaceReports.js', import.meta.url), 'utf8');
  const integrations = readFileSync(new URL('../hooks/useWorkspaceIntegrations.js', import.meta.url), 'utf8');
  const composer = readFileSync(new URL('../hooks/useWorkspaceApp.js', import.meta.url), 'utf8');
  assert.match(procurement, /async function createSupplier/);
  assert.match(procurement, /async function receivePurchaseOrder/);
  assert.match(operations, /async function createJob/);
  assert.match(operations, /async function createAssetCheckout/);
  assert.match(reports, /async function saveCurrentReport/);
  assert.match(reports, /function downloadReportCsv/);
  assert.match(integrations, /async function createWebhookSubscription/);
  assert.match(integrations, /async function toggleWebhook/);
  assert.equal(composer.includes('async function createSupplier'), false);
  assert.equal(composer.includes('async function createJob'), false);
  assert.equal(composer.includes('async function saveCurrentReport'), false);
  assert.equal(composer.includes('async function createWebhookSubscription'), false);
  assert.ok(
    composer.indexOf('useWorkspaceProcurement(') < composer.indexOf('useWorkspaceExpiry('),
    'procurement must initialize purchase-order setters before expiry replenishment',
  );
});

test('workspace app splits core chrome, hydration and derived view models', () => {
  const core = readFileSync(new URL('../hooks/useWorkspaceCore.js', import.meta.url), 'utf8');
  const hydration = readFileSync(new URL('../hooks/useWorkspaceHydration.js', import.meta.url), 'utf8');
  const derived = readFileSync(new URL('../hooks/useWorkspaceDerived.js', import.meta.url), 'utf8');
  const composer = readFileSync(new URL('../hooks/useWorkspaceApp.js', import.meta.url), 'utf8');
  assert.match(core, /const showToast/);
  assert.match(core, /const addNotification/);
  assert.match(core, /const navigateTo/);
  assert.match(hydration, /async function hydrateWorkspace/);
  assert.match(hydration, /\/api\/v1\/runtime\/config/);
  assert.match(hydration, /async function markNotificationRead/);
  assert.match(derived, /dashboardCards/);
  assert.match(derived, /commandResults/);
  assert.match(composer, /useWorkspaceCore/);
  assert.match(composer, /useWorkspaceHydration/);
  assert.match(composer, /useWorkspaceDerived/);
  assert.equal(composer.includes('async function hydrateWorkspace'), false);
  assert.equal(composer.includes('async function markNotificationRead'), false);
  assert.ok(
    composer.indexOf('useWorkspaceCore(') < composer.indexOf('useWorkspaceHydration('),
    'core state must exist before hydration assigns loadAppData',
  );
});

test('App.jsx provides workspace context instead of prop-drilling chrome, pages and dialogs', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../components/workspace/WorkspaceChrome.jsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../components/workspace/Workspace.jsx', import.meta.url), 'utf8');
  const dialogs = readFileSync(new URL('../components/workspace/WorkspaceDialogs.jsx', import.meta.url), 'utf8');
  const countDialogs = readFileSync(new URL('../components/workspace/dialogs/CountDialogs.jsx', import.meta.url), 'utf8');
  assert.ok(app.includes("from './components/workspace/WorkspaceContext'"));
  assert.match(app, /<WorkspaceProvider/);
  assert.match(app, /<WorkspaceChrome>/);
  assert.match(app, /<Workspace \/>/);
  assert.match(app, /<WorkspaceDialogs \/>/);
  assert.equal(app.includes('activeSection={'), false);
  assert.equal(app.includes('navigateTo={'), false);
  assert.match(chrome, /useWorkspace\(\)/);
  assert.match(workspace, /useWorkspace\(\)/);
  assert.match(dialogs, /CountDialogs/);
  assert.match(countDialogs, /CountTaskSheet/);
});

test('Workspace.jsx defers section pages to workspace page modules', () => {
  const workspace = readFileSync(new URL('../components/workspace/Workspace.jsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../components/workspace/pages/DashboardPage.jsx', import.meta.url), 'utf8');
  const stockUpdate = readFileSync(new URL('../components/workspace/pages/StockUpdatePage.jsx', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../components/workspace/pages/InventoryPage.jsx', import.meta.url), 'utf8');
  const transfers = readFileSync(new URL('../components/workspace/pages/TransfersPage.jsx', import.meta.url), 'utf8');
  const jobs = readFileSync(new URL('../components/workspace/pages/JobsPage.jsx', import.meta.url), 'utf8');
  const reports = readFileSync(new URL('../components/workspace/pages/ReportsPage.jsx', import.meta.url), 'utf8');
  const alerts = readFileSync(new URL('../components/workspace/pages/AlertsPage.jsx', import.meta.url), 'utf8');
  const integrations = readFileSync(new URL('../components/workspace/pages/IntegrationsPage.jsx', import.meta.url), 'utf8');
  assert.match(workspace, /SECTION_PAGES/);
  assert.match(workspace, /DashboardPage/);
  assert.match(workspace, /CountsPage/);
  assert.match(workspace, /ReportsPage/);
  assert.equal(workspace.includes('Manual lot stock update'), false);
  assert.equal(workspace.includes('Transfer queue'), false);
  assert.equal(workspace.includes('Report workspace'), false);
  assert.match(dashboard, /Today.s operations, ready for action/);
  assert.match(stockUpdate, /Manual lot stock update/);
  assert.match(inventory, /Stock by item/);
  assert.match(inventory, /stockActionIsAvailable/);
  assert.match(inventory, /Studio v/);
  assert.match(transfers, /Transfer queue/);
  assert.match(jobs, /Create job \/ project/);
  assert.match(reports, /Report workspace/);
  assert.match(alerts, /Notification inbox/);
  assert.match(integrations, /Create outbound webhook|WebhookIntegrations/);
});

test('every role gets at most 8 primary destinations and nothing it may open is lost', async () => {
  const { NAVIGATION, MAX_PRIMARY_NAV, PRIMARY_NAV_BY_ROLE, splitNavigation, visibleNavigationGroups } = await import('./workspace.js');
  const ids = (list) => list.flatMap((group) => group.items.map((item) => item.id));
  for (const role of ['STORE_USER', 'WAREHOUSE_PICKER', 'BRANCH_MANAGER', 'ADMIN', 'ADMIN_USER', 'AUDITOR']) {
    const groups = visibleNavigationGroups(NAVIGATION, { role });
    const { primary, more } = splitNavigation(groups, role);
    assert.ok(ids(primary).length >= 1 && ids(primary).length <= MAX_PRIMARY_NAV, `${role} primary count ${ids(primary).length}`);
    assert.deepEqual([...ids(primary), ...ids(more)].sort(), ids(groups).sort(), `${role}: primary + more is exactly what the role may open`);
    assert.equal(new Set([...ids(primary), ...ids(more)]).size, ids(groups).length, `${role}: no item appears twice`);
  }
  // A configured primary id the role cannot open (for example hidden by entitlements) is simply skipped.
  const hidden = visibleNavigationGroups(NAVIGATION, { role: 'STORE_USER', hiddenModules: new Set(['counts']) });
  assert.ok(!ids(splitNavigation(hidden, 'STORE_USER').primary).includes('counts'));
  assert.ok(Object.values(PRIMARY_NAV_BY_ROLE).every((list) => list.length <= MAX_PRIMARY_NAV));
  // An unknown role keeps the first MAX_PRIMARY_NAV items rather than the whole wall.
  const unknown = splitNavigation(visibleNavigationGroups(NAVIGATION, { role: 'ADMIN' }), 'SOMETHING_NEW');
  assert.equal(ids(unknown.primary).length, MAX_PRIMARY_NAV);
});
