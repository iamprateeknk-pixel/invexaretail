import { buildExpiryBoardFromStock } from '../lib/expiry-board';
import {
  buildCountTaskQueues,
  buildLowStockRows,
  buildReportRows,
  filterCommandCatalog,
  sanitizeStockRowsForRole,
} from '../lib/workspace-queues';
import {
  DASHBOARD_KPI_CATALOG,
  DEFAULT_WORKSPACE_PROFILE,
  NAVIGATION,
  PAGE_META,
  visibleNavigationGroups,
} from '../lib/workspace';
import { isCountManager } from '../lib/count-review';
import { stockActionIsAvailable } from '../lib/stock-metadata';
import { useMemo } from 'react';
import {
  PackagePlus,
  ScanLine,
  ShoppingCart,
  Truck,
} from 'lucide-react';

export function useWorkspaceDerived({
  activeSection,
  assignments,
  assetCheckouts,
  auditEvents,
  clock,
  commandQuery,
  countStatusFilter,
  counts,
  exceptionSummary,
  globalSearch,
  items,
  jobs,
  locationId,
  locations,
  navigateTo,
  putawayTasks,
  reorderRules,
  reportType,
  role,
  runtimeConfig,
  setCommandPaletteOpen,
  setCommandQuery,
  setModalOpen,
  stock,
  stockRows,
  storeUsers,
  transfers,
  varianceReport,
  workspaceProfile,
}) {
  const currentLocationName = useMemo(
    () => locations.find((location) => location.id === locationId)?.name ?? 'All locations',
    [locationId, locations],
  );

  const visibleRows = useMemo(
    () => stockRows.filter((row) => row.locationId === locationId),
    [locationId, stockRows],
  );

  const expiryBoard = useMemo(
    () => buildExpiryBoardFromStock({ items, stockRows: visibleRows, locationId }),
    [items, locationId, visibleRows],
  );

  const filteredCounts = useMemo(
    () => counts.filter((count) => count.locationId === locationId),
    [locationId, counts],
  );

  const filteredTransfers = useMemo(
    () => transfers.filter((transfer) => transfer.from === locationId || transfer.to === locationId),
    [locationId, transfers],
  );

  const canViewSystemStock = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(role);
  const canManageCounts = isCountManager(role);

  const searchTerm = globalSearch.trim().toLowerCase();
  const sanitizedRows = sanitizeStockRowsForRole(visibleRows, role);
  const searchedStockRows = sanitizedRows.filter((row) =>
    [row.itemName, row.itemId].some((value) => String(value ?? '').toLowerCase().includes(searchTerm)),
  );
  const lowStockRows = buildLowStockRows(stockRows, reorderRules);
  const currentReportRows = buildReportRows({
    reportType,
    visibleRows,
    items,
    lowStockRows,
    locationId,
    reorderRules,
    filteredTransfers,
    varianceReport,
    expiryBoard,
    auditEvents,
  });
  const {
    allCountTaskRows,
    countTaskRows,
    pendingCountTasks,
    pendingApprovals,
  } = buildCountTaskQueues({
    filteredCounts,
    assignments,
    locationId,
    items,
    locations,
    storeUsers,
    clock,
    countStatusFilter,
    searchTerm,
  });
  const expiringSoonCount = expiryBoard.lots.filter((lot) => ['EXPIRED', 'CRITICAL', 'WARNING', 'MISSING'].includes(lot.horizon)).length;
  // "My tasks" (blueprint's pinned-shortcut example) - /count-assignments/mine
  // is already scoped to the signed-in user server-side, so this is every
  // assignment still ASSIGNED to me (not yet submitted), no client-side
  // user filtering needed.
  const myOpenAssignments = (assignments ?? []).filter((assignment) => assignment.status === 'ASSIGNED');
  const pendingPutawayCount = (putawayTasks ?? []).filter((task) => task.status === 'PENDING' && task.locationId === locationId).length;
  const overdueAssetCheckouts = (assetCheckouts ?? []).filter(
    (entry) => entry.status !== 'RETURNED' && entry.dueAt && new Date(entry.dueAt) < clock,
  );
  const pageMeta = PAGE_META[activeSection] ?? PAGE_META.dashboard;
  const commandResults = useMemo(() => {
    const hiddenModules = new Set(workspaceProfile.pack?.hide ?? []);
    const accessiblePages = visibleNavigationGroups(NAVIGATION, { role, hiddenModules })
      .flatMap((group) => group.items)
      .map((item) => ({ id: `page-${item.id}`, label: item.label, description: PAGE_META[item.id]?.[1] ?? 'Open workspace', icon: item.icon, action: () => navigateTo(item.id) }));
    const quickActions = [
      ...(stockActionIsAvailable(runtimeConfig?.page, 'scan', role)
        ? [{ id: 'scan', label: 'Scan an item or lot', description: 'Open camera and barcode lookup', icon: ScanLine, action: stock.openScanner }]
        : []),
      ...(['ADMIN', 'ADMIN_USER'].includes(role)
        ? [{ id: 'quick-add', label: 'Add item', description: 'Save a new item in seconds', icon: PackagePlus, action: () => stock.openQuickAdd() }]
        : []),
      { id: 'transfer', label: 'Create stock transfer', description: 'Request stock movement between locations', icon: Truck, action: () => setModalOpen('transfer') },
      ...(['ADMIN', 'ADMIN_USER'].includes(role) && stockActionIsAvailable(runtimeConfig?.page, 'daily_import', role)
        ? [{ id: 'daily-import', label: 'Daily sales / purchase import', description: 'Import purchase, sales and sales return sheets', icon: ShoppingCart, action: () => setModalOpen('dailyImport') }]
        : []),
    ];
    return filterCommandCatalog([...quickActions, ...accessiblePages], commandQuery);
  }, [activeSection, commandQuery, locations, role, runtimeConfig, stock.openScanner, stock.openQuickAdd]);

  const runCommand = (command) => {
    setCommandPaletteOpen(false);
    setCommandQuery('');
    command.action();
  };

  const kpiContext = {
    pendingCountTasks: pendingCountTasks.length,
    overdueCounts: allCountTaskRows.filter((task) => task.overdue).length,
    transferRequests: filteredTransfers.filter((item) => item.status === 'REQUESTED').length,
    lowStockRows: lowStockRows.length,
    expiringSoonCount,
    discrepancyCount: filteredCounts.filter((count) => Number(count.variance ?? 0) !== 0).length,
    pendingApprovals: pendingApprovals.length,
    openAssets: (assetCheckouts ?? []).filter((entry) => entry.status !== 'RETURNED').length,
    overdueAssets: overdueAssetCheckouts.length,
    activeJobs: (jobs ?? []).filter((job) => ['ACTIVE', 'DRAFT', 'RECONCILING'].includes(job.status)).length,
    openExceptionCount: exceptionSummary?.open ?? 0,
    myOpenTasks: myOpenAssignments.length,
    pendingPutawayTasks: pendingPutawayCount,
  };
  const kpiKeys = workspaceProfile.pack?.dashboardKpis?.length
    ? workspaceProfile.pack.dashboardKpis
    : DEFAULT_WORKSPACE_PROFILE.pack.dashboardKpis;
  const dashboardCards = kpiKeys
    .map((key) => DASHBOARD_KPI_CATALOG[key])
    .filter(Boolean)
    .map((metric) => ({
      label: metric.label,
      value: metric.value(kpiContext),
      detail: typeof metric.detail === 'function' ? metric.detail(kpiContext) : metric.detail,
      icon: metric.icon,
      tone: metric.tone,
      section: metric.section,
      filter: metric.filter,
    }));

  return {
    canManageCounts,
    canViewSystemStock,
    commandResults,
    countTaskRows,
    currentLocationName,
    currentReportRows,
    dashboardCards,
    expiryBoard,
    expiringSoonCount,
    filteredTransfers,
    lowStockRows,
    overdueAssetCheckouts,
    pageMeta,
    pendingCountTasks,
    runCommand,
    searchedStockRows,
  };
}
