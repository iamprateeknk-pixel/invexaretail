import { apiRequest } from '../lib/api-client';
import { mapPickerTasks } from '../lib/workspace-queues';
import {
  DEFAULT_WORKSPACE_PROFILE,
  normalizeCounts,
  normalizeStockRows,
  normalizeTransfers,
} from '../lib/workspace';
import { isCountManager } from '../lib/count-review';
import { useEffect } from 'react';

export function useWorkspaceHydration({
  activeSection,
  authToken,
  items,
  loadAppDataRef,
  locationId,
  locations,
  resetWorkspaceRef,
  role,
  session,
  setApiError,
  setAssignments,
  setAuditEvents,
  setCountForm,
  setCounts,
  setCycleCountStoreUserId,
  setDashboard,
  setItems,
  setLocationId,
  setLocations,
  setModuleWarning,
  setNotifications,
  setPickerTasks,
  setReorderRules,
  setReportSummary,
  setRuntimeConfig,
  setStockRows,
  setStoreUsers,
  setTransferForm,
  setTransfers,
  setVarianceReport,
  setWorkspaceProfile,
  showToast,
}) {
  async function hydrateWorkspace(token, currentRole) {
    const headers = { Authorization: `Bearer ${token}` };
    const locationsResponse = await apiRequest('/api/v1/locations', { headers });
    const visibleLocations = locationsResponse.locations ?? [];
    const [itemsResponse, countsResponse, transfersResponse, dashboardResponse, workspaceResponse, runtimeResponse] = await Promise.all([
      apiRequest('/api/v1/items', { headers }),
      apiRequest('/api/v1/counts', { headers }),
      apiRequest('/api/v1/transfers/list', { headers }),
      apiRequest('/api/v1/dashboard', { headers }),
      apiRequest('/api/v1/workspace/profile', { headers }).catch(() => DEFAULT_WORKSPACE_PROFILE),
      apiRequest('/api/v1/runtime/config', { headers }).catch(() => null),
    ]);
    const nextProfile = {
      ...DEFAULT_WORKSPACE_PROFILE,
      ...(workspaceResponse ?? {}),
      pack: { ...DEFAULT_WORKSPACE_PROFILE.pack, ...(workspaceResponse?.pack ?? {}) },
    };
    setWorkspaceProfile(nextProfile);
    setRuntimeConfig(runtimeResponse?.runtime ?? null);
    const countManager = isCountManager(currentRole);
    const [auditResponse, pickerResponse, assignmentsResponse, storeUsersResponse] = await Promise.all([
      ['ADMIN', 'AUDITOR'].includes(currentRole) ? apiRequest('/api/v1/audit', { headers }) : Promise.resolve({ events: [] }),
      ['ADMIN', 'WAREHOUSE_PICKER'].includes(currentRole) ? apiRequest('/api/v1/picker-tasks', { headers }) : Promise.resolve({ tasks: [] }),
      currentRole === 'STORE_USER'
        ? apiRequest('/api/v1/count-assignments/mine', { headers })
        : countManager
          ? apiRequest('/api/v1/count-assignments', { headers })
          : Promise.resolve({ assignments: [] }),
      countManager ? apiRequest('/api/v1/users?role=STORE_USER', { headers }) : Promise.resolve({ users: [] }),
    ]);
    const selectedLocation = visibleLocations.some((location) => location.id === locationId)
      ? locationId
      : visibleLocations[0]?.id;

    setLocations(visibleLocations);
    setItems(itemsResponse.items);
    setCounts(normalizeCounts(countsResponse.counts, itemsResponse.items, visibleLocations));
    setTransfers(normalizeTransfers(transfersResponse.transfers, itemsResponse.items, visibleLocations));
    setDashboard(dashboardResponse.dashboard);
    setAuditEvents(auditResponse.events ?? []);
    setPickerTasks(mapPickerTasks(pickerResponse.tasks ?? [], itemsResponse.items));
    setAssignments(assignmentsResponse.assignments ?? []);
    setStoreUsers(storeUsersResponse.users ?? []);
    const firstStoreUser = (storeUsersResponse.users ?? [])[0];
    if (firstStoreUser) setCycleCountStoreUserId(firstStoreUser.id);
    const firstItem = itemsResponse.items[0];
    const firstLot = firstItem?.lots?.[0];
    if (firstItem && firstLot) {
      setCountForm({ itemId: firstItem.id, lotNo: firstLot.lotNo, physicalQuantity: 0 });
      setTransferForm((current) => ({ ...current, itemId: firstItem.id, lotId: firstLot.id }));
    }
    setLocationId(selectedLocation ?? 'loc-1');
  }
  loadAppDataRef.current = hydrateWorkspace;
  resetWorkspaceRef.current = () => {
    setLocations([]);
    setItems([]);
    setStockRows([]);
    setCounts([]);
    setTransfers([]);
    setDashboard(null);
    setReportSummary(null);
    setVarianceReport(null);
    setAuditEvents([]);
    setPickerTasks([]);
    setApiError('');
    setWorkspaceProfile(DEFAULT_WORKSPACE_PROFILE);
    setRuntimeConfig(null);
  };

  useEffect(() => {
    if (!authToken || !locationId) return;

    const headers = { Authorization: `Bearer ${authToken}` };
    let cancelled = false;
    apiRequest(`/api/v1/stock/${locationId}`, { headers })
      .then((stockResponse) => { if (!cancelled) { setStockRows(normalizeStockRows(stockResponse.items ?? [], items)); setApiError(''); } })
      .catch((error) => { if (!cancelled) setApiError(error instanceof Error ? error.message : 'Unable to load stock data.'); });
    const optionalRequests = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(role)
      ? [apiRequest(`/api/v1/reports/${locationId}`, { headers }), apiRequest(`/api/v1/reports/variance/${locationId}`, { headers }), apiRequest(`/api/v1/reorder-rules?locationId=${encodeURIComponent(locationId)}`, { headers })]
      : [Promise.resolve({ report: null }), Promise.resolve({ report: null }), Promise.resolve({ rules: [] })];
    Promise.allSettled(optionalRequests).then((results) => {
      if (cancelled) return;
      if (results[0].status === 'fulfilled') setReportSummary(results[0].value.report ?? null);
      if (results[1].status === 'fulfilled') setVarianceReport(results[1].value.report ?? null);
      if (results[2].status === 'fulfilled') setReorderRules(results[2].value.rules ?? []);
      const failed = results.find((result) => result.status === 'rejected');
      setModuleWarning(failed?.status === 'rejected' ? (failed.reason instanceof Error ? failed.reason.message : 'Some optional data is unavailable.') : '');
    });
    return () => { cancelled = true; };
  }, [authToken, items, locationId, role, setApiError, setModuleWarning, setReorderRules, setReportSummary, setStockRows, setVarianceReport]);

  useEffect(() => {
    if (!authToken || activeSection !== 'alerts') return;
    const headers = { Authorization: `Bearer ${authToken}` };
    apiRequest('/api/v1/notification-inbox', { headers }).then((response) => setNotifications((current) => {
      const transient = current.filter((notice) => String(notice.id).startsWith('local-'));
      return [...(response.notifications ?? []).map((notice) => ({ ...notice, description: notice.body, timestamp: new Date(notice.createdAt), persisted: true })), ...transient];
    })).catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load operations module.'));
  }, [activeSection, authToken, setModuleWarning, setNotifications]);

  useEffect(() => {
    if (!session || !authToken) return;

    const pollInterval = setInterval(() => {
      const headers = { Authorization: `Bearer ${authToken}` };
      Promise.all([
        apiRequest('/api/v1/counts', { headers }),
      role === 'STORE_USER'
        ? apiRequest('/api/v1/count-assignments/mine', { headers })
        : isCountManager(role)
          ? apiRequest('/api/v1/count-assignments', { headers })
          : Promise.resolve({ assignments: [] }),
        authToken && locationId ? apiRequest(`/api/v1/stock/${locationId}`, { headers }) : Promise.resolve({ items: [] }),
      ])
        .then(([countsResponse, assignmentsResponse, stockResponse]) => {
          setCounts(normalizeCounts(countsResponse.counts, items, locations));
          if (role === 'STORE_USER' || isCountManager(role)) {
            setAssignments(assignmentsResponse.assignments ?? []);
          }
          if (stockResponse.items?.length) {
            setStockRows(normalizeStockRows(stockResponse.items, items));
          }
        })
        .catch(() => {});
    }, 12000);

    return () => clearInterval(pollInterval);
  }, [authToken, items, locationId, locations, role, session, setAssignments, setCounts, setStockRows]);

  async function markNotificationRead(notice) {
    if (!notice.persisted || notice.readAt) return;
    try {
      const response = await apiRequest(`/api/v1/notification-inbox/${notice.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } });
      setNotifications((current) => current.map((entry) => entry.id === notice.id ? { ...entry, readAt: response.notification.readAt } : entry));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update notification.', 'error');
    }
  }

  return { markNotificationRead };
}
