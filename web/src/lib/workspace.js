import { displayCountStatus } from './count-review.js';
import {
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  Activity,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  FileBarChart,
  LayoutDashboard,
  ListChecks,
  Octagon,
  PackageCheck,
  PackageSearch,
  ShoppingBag,
  PackageOpen,
  PackagePlus,
  FileUp,
  ClipboardList,
  Plug,
  Building2,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tags,
  Truck,
  Webhook,
} from 'lucide-react';

export const ROLE_LABELS = {
  ADMIN: 'Admin',
  ADMIN_USER: 'Admin User',
  BRANCH_MANAGER: 'Branch Manager',
  STORE_USER: 'Store User',
  WAREHOUSE_PICKER: 'Warehouse Picker',
  AUDITOR: 'Auditor',
};

export const REPORT_TYPE_LABELS = {
  inventory: 'Inventory summary',
  'low-stock': 'Low stock',
  moves: 'Move summary',
  variance: 'Count variance',
  expiry: 'Expiry exposure',
  activity: 'User activity',
};

export const DEFAULT_WORKSPACE_PROFILE = {
  name: 'Invexa Retail',
  industry: 'Grocery',
  industryKey: 'grocery',
  pack: {
    key: 'grocery',
    label: 'Grocery',
    description: 'Invexa grocery operations: lot/expiry stock, FEFO transfers, blind counts and branch replenishment.',
    hide: ['assets'],
    dashboardKpis: ['expiry_risk', 'low_stock', 'pending_counts', 'my_tasks', 'transfers', 'pending_putaway', 'discrepancy', 'open_exceptions', 'pending_approvals'],
    allocationStrategy: 'FEFO',
    expiryBlocking: false,
    modules: { expiry: true, assets: false, jobs: true, catalog: true, purchaseOrders: true },
    categories: ['Staples', 'Dairy', 'Household', 'Produce', 'Bakery', 'Frozen', 'Grocery'],
    units: ['bag', 'pack', 'box', 'KG', 'PCS'],
    variantFields: [],
    serialFieldNames: [],
  },
};

export const DASHBOARD_KPI_CATALOG = {
  pending_counts: { label: 'Pending counts', detail: (ctx) => `${ctx.overdueCounts} overdue at this location`, icon: ClipboardCheck, tone: 'amber', section: 'counts', filter: 'pending', value: (ctx) => ctx.pendingCountTasks },
  transfers: { label: 'Transfer requests', detail: () => 'Waiting for dispatch at this location', icon: Truck, tone: 'blue', section: 'transfers', value: (ctx) => ctx.transferRequests },
  low_stock: { label: 'Low stock', detail: () => 'Reorder attention needed', icon: PackageOpen, tone: 'rose', section: 'inventory', value: (ctx) => ctx.lowStockRows },
  expiry_risk: { label: 'Expiry risk', detail: () => 'Expired, 30-day and missing-date lots', icon: Clock3, tone: 'violet', section: 'expiry', value: (ctx) => ctx.expiringSoonCount },
  discrepancy: { label: 'Discrepancy risk', detail: () => 'Counts with recorded variance at this location', icon: AlertTriangle, tone: 'orange', section: 'reports', value: (ctx) => ctx.discrepancyCount },
  open_exceptions: { label: 'Open exceptions', detail: () => 'Damage, shortage and pick exceptions awaiting disposition', icon: Octagon, tone: 'rose', section: 'exceptions', value: (ctx) => ctx.openExceptionCount },
  pending_approvals: { label: 'Pending approvals', detail: () => 'Counts awaiting review', icon: ShieldCheck, tone: 'emerald', section: 'approvals', value: (ctx) => ctx.pendingApprovals },
  assets: { label: 'Open checkouts', detail: () => 'Controlled inventory still out', icon: RotateCcw, tone: 'blue', section: 'assets', value: (ctx) => ctx.openAssets },
  jobs: { label: 'Active jobs', detail: () => 'Projects consuming inventory', icon: BriefcaseBusiness, tone: 'violet', section: 'jobs', value: (ctx) => ctx.activeJobs },
  pending_putaway: { label: 'Pending putaway', detail: () => 'Received stock waiting to be shelved', icon: PackageSearch, tone: 'blue', section: 'putaway', value: (ctx) => ctx.pendingPutawayTasks },
  my_tasks: { label: 'My tasks', detail: () => 'Count assignments waiting on you', icon: ListChecks, tone: 'emerald', section: 'counts', value: (ctx) => ctx.myOpenTasks },
};

export const TOAST_PREFIXES = ['✅', '❌', '⚠️', '📄', '📥', '📤', 'ℹ️'];

export const NAVIGATION = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Inventory',
    items: [
      { id: 'inventory', label: 'Items & stock', icon: Boxes },
      { id: 'item-search', label: 'Item search & stock detail', icon: PackageSearch },
      { id: 'stock-update', label: 'Stock update', icon: PackagePlus, roles: ['ADMIN', 'ADMIN_USER'] },
      { id: 'import-wizard', label: 'ERP file import', icon: FileUp, roles: ['ADMIN', 'ADMIN_USER'] },
      { id: 'expiry', label: 'Lots & expiry', icon: Clock3 },
      { id: 'catalog', label: 'Tags & custom fields', icon: Tags },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'counts', label: 'Stock counts', icon: ClipboardCheck },
      { id: 'campaigns', label: 'Auto stock take', icon: CalendarClock, roles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'] },
      { id: 'transfers', label: 'Transfers', icon: Truck },
      { id: 'picking', label: 'Picking & receiving', icon: PackageCheck, roles: ['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'] },
      { id: 'putaway', label: 'Bins & putaway', icon: PackageSearch, roles: ['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'] },
      { id: 'purchase-orders', label: 'Purchase orders', icon: ShoppingCart, badge: 'P0' },
      { id: 'orders', label: 'Channel orders', icon: ShoppingBag, roles: ['ADMIN', 'ADMIN_USER'] },
      { id: 'qc', label: 'Quality control', icon: ClipboardList, roles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'] },
      { id: 'assets', label: 'Check-in / out', icon: RotateCcw },
      { id: 'jobs', label: 'Jobs & projects', icon: BriefcaseBusiness },
    ],
  },
  {
    label: 'Control',
    items: [
      { id: 'command-center', label: 'Command center', icon: Activity, roles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'] },
      { id: 'approvals', label: 'Approvals', icon: ShieldCheck, roles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'] },
      { id: 'reports', label: 'Reports', icon: FileBarChart, roles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'] },
      { id: 'intelligence', label: 'Intelligence', icon: Sparkles, roles: ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'], badge: 'New' },
      { id: 'exceptions', label: 'Exception inbox', icon: Octagon },
      { id: 'alerts', label: 'Alerts & activity', icon: Bell },
      { id: 'integrations', label: 'Integrations', icon: Webhook, adminOnly: true },
      { id: 'connectors', label: 'Marketplace connectors', icon: Plug, roles: ['ADMIN', 'ADMIN_USER'] },
      { id: 'saas', label: 'SaaS & tenants', icon: Building2, roles: ['ADMIN'] },
      { id: 'admin', label: 'Administration', icon: Settings, roles: ['ADMIN', 'ADMIN_USER'] },
    ],
  },
];

export function navigationItemIsVisible(item, { role, hiddenModules = new Set() } = {}) {
  const hidden = hiddenModules instanceof Set ? hiddenModules : new Set(hiddenModules ?? []);
  if (hidden.has(item.id)) return false;
  if (item.adminOnly && role !== 'ADMIN') return false;
  if (item.roles && !item.roles.includes(role)) return false;
  return true;
}

export const NAV_ENTITLEMENTS = {
  orders: 'OMS',
  intelligence: 'ANALYTICS',
  integrations: 'INTEGRATIONS',
  'purchase-orders': 'PURCHASING',
  transfers: 'WMS',
  picking: 'WMS',
  putaway: 'WMS',
  inventory: 'INVENTORY',
  counts: 'INVENTORY',
  campaigns: 'INVENTORY',
  expiry: 'INVENTORY',
  'stock-update': 'INVENTORY',
  'import-wizard': 'INVENTORY',
  catalog: 'INVENTORY',
};

// Week 9 note: not currently called from application code. The server
// already computes entitlement-driven hides and merges them into
// `GET /workspace/profile`'s `pack.hide` (api/src/routes/core.ts's
// `hiddenNavigationForCompany()`), so `workspaceProfile.pack.hide` alone is
// already the complete hidden-module set by the time it reaches
// useWorkspaceDerived's `hiddenModules`. Kept (not deleted) as a documented,
// tested pure function rather than silently removed, in case a future
// optimistic-UI path needs to compute this client-side before the profile
// fetch resolves - flagged in docs/route-ownership-matrix.md-equivalent
// backlog (docs/web/role-journeys.md) as a real candidate for deletion if
// nothing ends up calling it by the time the page-rebuild phase starts.
export function hiddenModulesForEntitlements(modules = {}) {
  return Object.entries(NAV_ENTITLEMENTS)
    .filter(([, feature]) => modules[feature] === false)
    .map(([id]) => id);
}

export function visibleNavigationGroups(navigation, { role, hiddenModules = new Set() } = {}) {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => navigationItemIsVisible(item, { role, hiddenModules })),
    }))
    .filter((group) => group.items.length > 0);
}

export const PAGE_META = {
  dashboard: ['Operations overview', 'Live work, stock risk and performance across your locations.'],
  inventory: ['Items and stock', 'Search current stock, inspect lots and open item-level details.'],
  'stock-update': ['Stock update', 'Add, remove or set branch stock manually or from a 5,000+ row lot-wise Excel file.'],
  'import-wizard': ['ERP file import', 'Preview, validate and post purchase, sales, return or opening-stock files in safe batches - then reconcile or reverse.'],
  'item-search': ['Item search and stock detail', 'Search items, inspect branch balances, lots and movement history, and post guided adjustments/reversals.'],
  expiry: ['Lots and expiry', 'FEFO action queue for expired, near-expiry and missing-date lots, with write-off and date repair.'],
  catalog: ['Tags and custom fields', 'Create a flexible product catalogue without changing core retail fields.'],
  campaigns: ['Auto stock take', 'Set up a monthly stock take once - the daily counts are assigned to your team automatically.'],
  counts: ['Stock count tasks', 'Assign, complete and review blind counts without losing queue context.'],
  transfers: ['Stock transfers', 'Track every request from picking and dispatch through final receiving.'],
  picking: ['Picking and receiving', 'Action warehouse pick tasks and destination receiving checks.'],
  putaway: ['Bins and putaway', 'Define the zone/aisle/rack/bin directory and confirm where received stock was placed.'],
  'purchase-orders': ['Purchase orders', 'Plan supplier orders and convert low-stock risk into replenishment.'],
  orders: ['Channel orders', 'Webstore, marketplace and store orders reserved against the same available-to-promise pool as transfers.'],
  qc: ['Quality control', 'Publish receiving checklists and review inspections before stock is posted.'],
  assets: ['Check-in / out', 'Assign controlled inventory and track returns, due dates and condition.'],
  jobs: ['Jobs & projects', 'Plan, issue, consume and reconcile inventory against operational work.'],
  'command-center': ['Command center', 'What needs attention now, which branch is behind, what is moving and what is blocked - live.'],
  approvals: ['Pending approvals', 'Review count variances and other controlled stock decisions.'],
  reports: ['Reports', 'Monitor inventory accuracy, movement, expiry and team activity.'],
  intelligence: ['Inventory intelligence', 'Prioritise reorder actions and investigate count anomalies.'],
  exceptions: ['Exception inbox', 'Own every damage, shortage, wrong-item and pick exception through to a closed disposition.'],
  alerts: ['Alerts and activity', 'See operational exceptions and the audit events that need attention.'],
  integrations: ['Integrations', 'Manage credential-safe outbound automation and delivery visibility.'],
  connectors: ['Marketplace connectors', 'Amazon, Flipkart and website orders land in Invexa as reserved channel orders.'],
  saas: ['SaaS and tenants', 'Plan entitlements, tenant onboarding and commercial provisioning.'],
  admin: ['Administration', 'Manage company profile, locations, users and access.'],
};

export function statusBadgeVariant(status) {
  const value = String(status ?? '').toLowerCase();
  if (['approved', 'received', 'completed', 'closed', 'ready to pick'].includes(value)) return 'success';
  if (['rejected', 'error'].includes(value)) return 'destructive';
  if (['pending review', 'pending', 'assigned', 'requested', 'awaiting dispatch', 'expired', 'backordered'].includes(value)) return 'warning';
  return 'secondary';
}

export function formatDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function normalizeStockRows(stockItems, items) {
  const itemNames = new Map(items.map((item) => [item.id, item.name]));

  return stockItems.map((row) => ({
    ...row,
    itemName: itemNames.get(row.itemId) ?? row.itemId,
  }));
}

export function normalizeCounts(counts, items, locations) {
  const itemNames = new Map(items.map((item) => [item.id, item.name]));
  const lotNames = new Map(items.flatMap((item) => item.lots.map((lot) => [lot.id, lot.lotNo])));
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));

  return counts.map((count) => ({
    ...count,
    item: itemNames.get(count.itemId) ?? count.itemId,
    lot: lotNames.get(count.lotId) ?? count.lotId,
    locationName: locationNames.get(count.locationId) ?? count.locationId,
    qty: count.physicalQuantity,
    bookQuantity: count.bookQuantity ?? count.bookQty,
    variance: count.variance ?? ((Number(count.physicalQuantity) || 0) - (Number(count.bookQuantity ?? count.bookQty) || 0)),
    status: displayCountStatus(count.status),
    reviewReason: count.reviewReason,
    parentCountId: count.parentCountId,
  }));
}

export function normalizeTransfers(transfers, items, locations) {
  const itemNames = new Map(items.map((item) => [item.id, item.name]));
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));

  return transfers.map((transfer) => ({
    ...transfer,
    from: transfer.sourceLocationId,
    to: transfer.destinationLocationId,
    fromName: locationNames.get(transfer.sourceLocationId) ?? transfer.sourceLocationId,
    toName: locationNames.get(transfer.destinationLocationId) ?? transfer.destinationLocationId,
    item: itemNames.get(transfer.lines[0]?.itemId) ?? transfer.lines[0]?.itemId ?? 'Transfer lines',
    qty: transfer.lines.reduce((total, line) => total + line.quantity, 0),
    status: transfer.status,
  }));
}
