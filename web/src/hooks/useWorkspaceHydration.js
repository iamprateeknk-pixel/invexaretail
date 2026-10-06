import { API_BASE, apiRequest } from '../lib/api-client';
import { nextPollDelayMs } from '../lib/poll-policy';
import { LIVE_STATUS, createLiveClient, invalidationsForTopics } from '../lib/live-events';
import { mapPickerTasks } from '../lib/workspace-queues';
import {
  DEFAULT_WORKSPACE_PROFILE,
  normalizeCounts,
  normalizeStockRows,
  normalizeTransfers,
} from '../lib/workspace';
import { isCountManager } from '../lib/count-review';
import { useEffect, useRef, useState } from 'react';

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
    // Independent resources load together so login does not pay an extra network round-trip.
    const [locationsResponse, itemsResponse, countsResponse, transfersResponse, dashboardResponse, workspaceResponse, runtimeResponse] = await Promise.all([
      apiRequest('/api/v1/locations', { headers }),
      apiRequest('/api/v1/items', { headers }),
      apiRequest('/api/v1/counts', { headers }),
      apiRequest('/api/v1/transfers/list', { headers }),
      apiRequest('/api/v1/dashboard', { headers }),
      apiRequest('/api/v1/workspace/profile', { headers }).catch(() => DEFAULT_WORKSPACE_PROFILE),
      apiRequest('/api/v1/runtime/config', { headers }).catch(() => null),
    ]);
    const visibleLocations = locationsResponse.locations ?? [];
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
      ['STORE_USER', 'WAREHOUSE_PICKER'].includes(currentRole)
        ? apiRequest('/api/v1/count-assignments/mine', { headers })
        : countManager
          ? apiRequest('/api/v1/count-assignments', { headers })
          : Promise.resolve({ assignments: [] }),
      countManager ? apiRequest('/api/v1/users', { headers }) : Promise.resolve({ users: [] }),
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
    const countWorkers = (storeUsersResponse.users ?? []).filter((user) => ['STORE_USER', 'WAREHOUSE_PICKER'].includes(user.role));
    setStoreUsers(countWorkers);
    const firstStoreUser = countWorkers[0];
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

  // Blueprint v4 §11: the authenticated live stream is the primary sync
  // mechanism. Each event names what changed; only those slices are
  // refetched (never the full hydrate, which also resets form defaults).
  const [liveStatus, setLiveStatus] = useState(LIVE_STATUS.connecting);
  // Bumped on campaign.changed so the campaign panel (which owns its own data) refetches.
  const [campaignRevision, setCampaignRevision] = useState(0);
  // Bumped on every batch of live events so panels that own their data (import control center) refetch.
  const [liveRevision, setLiveRevision] = useState(0);
  const latest = useRef({});
  latest.current = { authToken, items, locations, locationId, role };
  const pendingSlices = useRef(new Set());
  const flushTimer = useRef(null);

  async function refreshSlices(slices) {
    const { authToken: token, locationId: currentLocation, role: currentRole } = latest.current;
    if (!token) return;
    if (slices.has('full')) {
      await loadAppDataRef.current?.(token, currentRole);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    let currentItems = latest.current.items;
    const currentLocations = latest.current.locations;
    if (slices.has('items')) {
      const response = await apiRequest('/api/v1/items', { headers });
      currentItems = response.items ?? currentItems;
      setItems(currentItems);
    }
    if (slices.has('campaigns')) setCampaignRevision((value) => value + 1);
    const jobs = [];
    if (slices.has('counts')) {
      jobs.push(apiRequest('/api/v1/counts', { headers }).then((r) => setCounts(normalizeCounts(r.counts, currentItems, currentLocations))));
    }
    if (slices.has('assignments') && (['STORE_USER', 'WAREHOUSE_PICKER'].includes(currentRole) || isCountManager(currentRole))) {
      const path = ['STORE_USER', 'WAREHOUSE_PICKER'].includes(currentRole) ? '/api/v1/count-assignments/mine' : '/api/v1/count-assignments';
      jobs.push(apiRequest(path, { headers }).then((r) => setAssignments(r.assignments ?? [])));
    }
    if (slices.has('stock') && currentLocation) {
      jobs.push(apiRequest(`/api/v1/stock/${currentLocation}`, { headers }).then((r) => setStockRows(normalizeStockRows(r.items ?? [], currentItems))));
    }
    if (slices.has('transfers')) {
      jobs.push(apiRequest('/api/v1/transfers/list', { headers }).then((r) => setTransfers(normalizeTransfers(r.transfers, currentItems, currentLocations))));
    }
    if (slices.has('dashboard')) {
      jobs.push(apiRequest('/api/v1/dashboard', { headers }).then((r) => setDashboard(r.dashboard)));
    }
    if (slices.has('pickerTasks') && ['ADMIN', 'WAREHOUSE_PICKER'].includes(currentRole)) {
      jobs.push(apiRequest('/api/v1/picker-tasks', { headers }).then((r) => setPickerTasks(mapPickerTasks(r.tasks ?? [], currentItems))));
    }
    await Promise.allSettled(jobs);
  }

  useEffect(() => {
    if (!session || !authToken) return undefined;
    const client = createLiveClient({
      url: `${API_BASE}/api/v1/events`,
      getToken: () => latest.current.authToken,
      onStatus: setLiveStatus,
      onEvents: (topics) => {
        invalidationsForTopics(topics).forEach((slice) => pendingSlices.current.add(slice));
        // Coalesce bursts (a bulk import emits several topics at once).
        clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          const slices = pendingSlices.current;
          pendingSlices.current = new Set();
          setLiveRevision((value) => value + 1);
          refreshSlices(slices).catch(() => {});
        }, 250);
      },
    });
    const goOnline = () => client.reconnectNow();
    const goOffline = () => client.markOffline();
    const onVisible = () => { if (document.visibilityState === 'visible') client.reconnectNow(); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    client.start();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(flushTimer.current);
      client.stop();
    };
    // refreshSlices reads everything through refs, so it never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, session]);

  useEffect(() => {
    // Plan P1-PERF-001 (event-first): while the live stream is healthy, events drive targeted
    // refetches and this pass only reconciles slowly (every ~3 minutes) for writes made
    // directly in the database. While the stream is degraded it polls as a fallback, with
    // exponential backoff and jitter. A hidden tab does not poll; it catches up on return.
    if (!session || !authToken) return undefined;
    let timer = null;
    let cancelled = false;
    let failures = 0;
    const schedule = () => {
      const delay = nextPollDelayMs({ status: liveStatus, consecutiveFailures: failures });
      if (delay === null || cancelled) return;
      timer = setTimeout(async () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { schedule(); return; }
        try {
          await refreshSlices(new Set(['items', 'counts', 'assignments', 'stock', 'transfers', 'dashboard']));
          failures = 0;
        } catch {
          failures += 1;
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // refreshSlices reads the latest token, role, location and entities from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, liveStatus, session]);
  async function markNotificationRead(notice) {
    if (!notice.persisted || notice.readAt) return;
    try {
      const response = await apiRequest(`/api/v1/notification-inbox/${notice.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } });
      setNotifications((current) => current.map((entry) => entry.id === notice.id ? { ...entry, readAt: response.notification.readAt } : entry));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update notification.', 'error');
    }
  }

  return { markNotificationRead, liveStatus, campaignRevision, liveRevision };
}
