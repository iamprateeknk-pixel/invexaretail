import { DEFAULT_WORKSPACE_PROFILE, TOAST_PREFIXES } from '../lib/workspace';
import { useSectionRoute } from './useSectionRoute';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

export function useWorkspaceCore() {
  const isMobile = useIsMobile();
  const loadAppDataRef = useRef(async () => {});
  const resetWorkspaceRef = useRef(() => {});
  const loadAppData = (...args) => loadAppDataRef.current(...args);

  const [locationId, setLocationId] = useState('loc-1');
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [reportSummary, setReportSummary] = useState(null);
  const [varianceReport, setVarianceReport] = useState(null);
  const [reorderRules, setReorderRules] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [moduleWarning, setModuleWarning] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [workspaceProfile, setWorkspaceProfile] = useState(DEFAULT_WORKSPACE_PROFILE);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [activeSection, setActiveSection] = useSectionRoute();
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(25);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('invexa_theme') === 'dark');
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => setInventoryPage(1), [locationId, globalSearch]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('invexa_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (event.key === 'Escape') setCommandPaletteOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    let clean = String(message);
    for (const prefix of TOAST_PREFIXES) {
      if (clean.startsWith(prefix)) {
        clean = clean.slice(prefix.length).trimStart();
        break;
      }
    }
    if (type === 'error') toast.error(clean);
    else if (type === 'warning') toast.warning(clean);
    else toast.success(clean);
  }, []);

  const addNotification = useCallback((title, description, type = 'info') => {
    const id = `local-${Date.now()}`;
    setNotifications((prev) => [{ id, title, description, type, timestamp: new Date() }, ...prev].slice(0, 20));
  }, []);

  const navigateTo = (section) => {
    const hiddenModules = new Set(workspaceProfile.pack?.hide ?? []);
    const next = hiddenModules.has(section) ? 'dashboard' : section;
    setActiveSection(next);
    setMobileNavOpen(false);
  };

  return {
    activeSection,
    addNotification,
    apiError,
    auditEvents,
    clock,
    commandPaletteOpen,
    commandQuery,
    darkMode,
    dashboard,
    globalSearch,
    inventoryPage,
    inventoryPageSize,
    isMobile,
    items,
    loadAppData,
    loadAppDataRef,
    loading,
    locationId,
    locations,
    mobileNavOpen,
    modalOpen,
    moduleWarning,
    navigateTo,
    notifications,
    reorderRules,
    reportSummary,
    resetWorkspaceRef,
    runtimeConfig,
    selectedItem,
    setActiveSection,
    setApiError,
    setAuditEvents,
    setCommandPaletteOpen,
    setCommandQuery,
    setDarkMode,
    setDashboard,
    setGlobalSearch,
    setInventoryPage,
    setInventoryPageSize,
    setItems,
    setLoading,
    setLocationId,
    setLocations,
    setMobileNavOpen,
    setModalOpen,
    setModuleWarning,
    setNotifications,
    setReorderRules,
    setReportSummary,
    setRuntimeConfig,
    setSelectedItem,
    setSidebarCompact,
    setStockRows,
    setSubmitLoading,
    setVarianceReport,
    setWorkspaceProfile,
    showToast,
    sidebarCompact,
    stockRows,
    submitLoading,
    varianceReport,
    workspaceProfile,
  };
}
