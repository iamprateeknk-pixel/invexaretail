import { useWorkspaceAuth } from './useWorkspaceAuth';
import { useWorkspaceCounts } from './useWorkspaceCounts';
import { useWorkspaceTransfers } from './useWorkspaceTransfers';
import { useWorkspaceAdmin } from './useWorkspaceAdmin';
import { useWorkspaceCatalog } from './useWorkspaceCatalog';
import { useWorkspaceImports } from './useWorkspaceImports';
import { useWorkspaceExpiry } from './useWorkspaceExpiry';
import { useWorkspaceStock } from './useWorkspaceStock';
import { useWorkspaceProcurement } from './useWorkspaceProcurement';
import { useWorkspaceOperations } from './useWorkspaceOperations';
import { useWorkspaceReports } from './useWorkspaceReports';
import { useWorkspacePutaway } from './useWorkspacePutaway';
import { useWorkspacePickWaves } from './useWorkspacePickWaves';
import { useWorkspaceQc } from './useWorkspaceQc';
import { useWorkspaceConnectors } from './useWorkspaceConnectors';
import { useWorkspaceSaas } from './useWorkspaceSaas';
import { useWorkspaceOrders } from './useWorkspaceOrders';
import { useWorkspaceTolerance } from './useWorkspaceTolerance';
import { useWorkspaceApprovals } from './useWorkspaceApprovals';
import { useWorkspaceEvidence } from './useWorkspaceEvidence';
import { isCountManager } from '../lib/count-review';
import { useWorkspaceIntegrations } from './useWorkspaceIntegrations';
import { useWorkspaceCore } from './useWorkspaceCore';
import { useWorkspaceHydration } from './useWorkspaceHydration';
import { useWorkspaceDerived } from './useWorkspaceDerived';

export function useWorkspaceApp() {
  const core = useWorkspaceCore();
  const {
    addNotification,
    loadAppData,
    loadAppDataRef,
    resetWorkspaceRef,
    setLoading,
    showToast,
  } = core;

  const auth = useWorkspaceAuth({
    loadAppData,
    onLogout: () => resetWorkspaceRef.current(),
    setLoading,
    addNotification,
  });
  const { session, authToken, role } = auth;

  const countDomain = useWorkspaceCounts({
    authToken,
    role,
    locationId: core.locationId,
    items: core.items,
    locations: core.locations,
    activeSection: core.activeSection,
    setSubmitLoading: core.setSubmitLoading,
    setModalOpen: core.setModalOpen,
    setModuleWarning: core.setModuleWarning,
    showToast,
    addNotification,
    loadAppData,
  });

  const transferDomain = useWorkspaceTransfers({
    authToken,
    role,
    locationId: core.locationId,
    items: core.items,
    locations: core.locations,
    setSubmitLoading: core.setSubmitLoading,
    setModalOpen: core.setModalOpen,
    showToast,
    addNotification,
    loadAppData,
  });

  const admin = useWorkspaceAdmin({
    authToken,
    setLocations: core.setLocations,
    setWorkspaceProfile: core.setWorkspaceProfile,
    showToast,
  });

  const {
    counts,
    setCounts,
    assignments,
    setAssignments,
    storeUsers,
    setStoreUsers,
    setCycleCountStoreUserId,
    setCountForm,
    countStatusFilter,
  } = countDomain;
  const {
    transfers,
    setTransfers,
    setPickerTasks,
    setTransferForm,
  } = transferDomain;

  const catalog = useWorkspaceCatalog({
    authToken,
    role,
    activeSection: core.activeSection,
    locationId: core.locationId,
    locations: core.locations,
    globalSearch: core.globalSearch,
    setGlobalSearch: core.setGlobalSearch,
    setLocationId: core.setLocationId,
    selectedItem: core.selectedItem,
    modalOpen: core.modalOpen,
    reorderRules: core.reorderRules,
    setReorderRules: core.setReorderRules,
    setLoading,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });

  const importDomain = useWorkspaceImports({
    authToken,
    role,
    activeSection: core.activeSection,
    locationId: core.locationId,
    items: core.items,
    setItems: core.setItems,
    setStockRows: core.setStockRows,
    loadAppData,
    setSubmitLoading: core.setSubmitLoading,
    setModalOpen: core.setModalOpen,
    setModuleWarning: core.setModuleWarning,
    showToast,
    addNotification,
  });

  const stock = useWorkspaceStock({
    authToken,
    role,
    locationId: core.locationId,
    locations: core.locations,
    items: core.items,
    stockRows: core.stockRows,
    setCountForm,
    setSelectedItem: core.setSelectedItem,
    setModalOpen: core.setModalOpen,
    setSubmitLoading: core.setSubmitLoading,
    showToast,
    loadAppData,
  });

  const procurement = useWorkspaceProcurement({
    authToken,
    activeSection: core.activeSection,
    setLoading,
    setSubmitLoading: core.setSubmitLoading,
    setModalOpen: core.setModalOpen,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });
  const { setPurchaseOrderForm } = procurement;

  const expiry = useWorkspaceExpiry({
    authToken,
    locationId: core.locationId,
    items: core.items,
    locations: core.locations,
    setItems: core.setItems,
    setStockRows: core.setStockRows,
    setTransfers,
    setPurchaseOrderForm,
    navigateTo: core.navigateTo,
    setSubmitLoading: core.setSubmitLoading,
    showToast,
  });

  const operations = useWorkspaceOperations({
    authToken,
    activeSection: core.activeSection,
    locationId: core.locationId,
    items: core.items,
    workspaceProfile: core.workspaceProfile,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });
  const { assetCheckouts, jobs, exceptionSummary } = operations;

  const reports = useWorkspaceReports({
    authToken,
    role,
    activeSection: core.activeSection,
    locationId: core.locationId,
    locations: core.locations,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
    addNotification,
  });
  const { reportType } = reports;

  const putaway = useWorkspacePutaway({
    authToken,
    activeSection: core.activeSection,
    locationId: core.locationId,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });

  const pickWaves = useWorkspacePickWaves({
    authToken,
    activeSection: core.activeSection,
    locationId: core.locationId,
    setSubmitLoading: core.setSubmitLoading,
    showToast,
  });

  const qc = useWorkspaceQc({
    authToken,
    activeSection: core.activeSection,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });

  const connectors = useWorkspaceConnectors({
    authToken,
    activeSection: core.activeSection,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });

  const saas = useWorkspaceSaas({
    authToken,
    role,
    activeSection: core.activeSection,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });

  const orders = useWorkspaceOrders({
    authToken,
    activeSection: core.activeSection,
    locationId: core.locationId,
    setSubmitLoading: core.setSubmitLoading,
    showToast,
  });

  const tolerance = useWorkspaceTolerance({
    authToken,
    activeSection: core.activeSection,
    canManageCounts: isCountManager(role),
    setSubmitLoading: core.setSubmitLoading,
    showToast,
  });

  const approvals = useWorkspaceApprovals({
    authToken,
    activeSection: core.activeSection,
    canManageCounts: isCountManager(role),
    setSubmitLoading: core.setSubmitLoading,
    showToast,
  });

  const evidence = useWorkspaceEvidence({
    authToken,
    activeSection: core.activeSection,
    canManageCounts: isCountManager(role),
    setSubmitLoading: core.setSubmitLoading,
    showToast,
  });

  const integrations = useWorkspaceIntegrations({
    authToken,
    activeSection: core.activeSection,
    setSubmitLoading: core.setSubmitLoading,
    setModuleWarning: core.setModuleWarning,
    showToast,
  });

  const { markNotificationRead } = useWorkspaceHydration({
    activeSection: core.activeSection,
    authToken,
    items: core.items,
    loadAppDataRef,
    locationId: core.locationId,
    locations: core.locations,
    resetWorkspaceRef,
    role,
    session,
    setApiError: core.setApiError,
    setAssignments,
    setAuditEvents: core.setAuditEvents,
    setCountForm,
    setCounts,
    setCycleCountStoreUserId,
    setDashboard: core.setDashboard,
    setItems: core.setItems,
    setLocationId: core.setLocationId,
    setLocations: core.setLocations,
    setModuleWarning: core.setModuleWarning,
    setNotifications: core.setNotifications,
    setPickerTasks,
    setReorderRules: core.setReorderRules,
    setReportSummary: core.setReportSummary,
    setRuntimeConfig: core.setRuntimeConfig,
    setStockRows: core.setStockRows,
    setStoreUsers,
    setTransferForm,
    setTransfers,
    setVarianceReport: core.setVarianceReport,
    setWorkspaceProfile: core.setWorkspaceProfile,
    showToast,
  });

  const derived = useWorkspaceDerived({
    activeSection: core.activeSection,
    assignments,
    assetCheckouts,
    auditEvents: core.auditEvents,
    clock: core.clock,
    commandQuery: core.commandQuery,
    countStatusFilter,
    counts,
    exceptionSummary,
    globalSearch: core.globalSearch,
    items: core.items,
    jobs,
    locationId: core.locationId,
    locations: core.locations,
    navigateTo: core.navigateTo,
    putawayTasks: putaway.putawayTasks,
    reorderRules: core.reorderRules,
    reportType,
    role,
    runtimeConfig: core.runtimeConfig,
    setCommandPaletteOpen: core.setCommandPaletteOpen,
    setCommandQuery: core.setCommandQuery,
    setModalOpen: core.setModalOpen,
    stock,
    stockRows: core.stockRows,
    storeUsers,
    transfers,
    varianceReport: core.varianceReport,
    workspaceProfile: core.workspaceProfile,
  });

  return {
    ...auth,
    ...countDomain,
    ...transferDomain,
    ...admin,
    ...catalog,
    ...importDomain,
    ...expiry,
    ...stock,
    ...procurement,
    ...operations,
    ...reports,
    ...putaway,
    ...pickWaves,
    ...orders,
    ...qc,
    ...connectors,
    ...saas,
    ...tolerance,
    ...approvals,
    ...evidence,
    ...integrations,
    ...derived,
    activeSection: core.activeSection,
    apiError: core.apiError,
    auditEvents: core.auditEvents,
    clock: core.clock,
    commandPaletteOpen: core.commandPaletteOpen,
    commandQuery: core.commandQuery,
    darkMode: core.darkMode,
    dashboard: core.dashboard,
    globalSearch: core.globalSearch,
    inventoryPage: core.inventoryPage,
    inventoryPageSize: core.inventoryPageSize,
    isMobile: core.isMobile,
    items: core.items,
    loading: core.loading,
    locationId: core.locationId,
    locations: core.locations,
    markNotificationRead,
    mobileNavOpen: core.mobileNavOpen,
    modalOpen: core.modalOpen,
    moduleWarning: core.moduleWarning,
    navigateTo: core.navigateTo,
    notifications: core.notifications,
    reportSummary: core.reportSummary,
    runtimeConfig: core.runtimeConfig,
    selectedItem: core.selectedItem,
    setCommandPaletteOpen: core.setCommandPaletteOpen,
    setCommandQuery: core.setCommandQuery,
    setDarkMode: core.setDarkMode,
    setGlobalSearch: core.setGlobalSearch,
    setInventoryPage: core.setInventoryPage,
    setInventoryPageSize: core.setInventoryPageSize,
    setLocationId: core.setLocationId,
    setMobileNavOpen: core.setMobileNavOpen,
    setModalOpen: core.setModalOpen,
    setSelectedItem: core.setSelectedItem,
    setSidebarCompact: core.setSidebarCompact,
    showToast: core.showToast,
    sidebarCompact: core.sidebarCompact,
    stockRows: core.stockRows,
    submitLoading: core.submitLoading,
    varianceReport: core.varianceReport,
    workspaceProfile: core.workspaceProfile,
  };
}
