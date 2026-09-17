import { API_BASE, apiRequest } from '../lib/api-client';
import { rowsToCsv } from '../lib/workspace-queues';
import { REPORT_TYPE_LABELS } from '../lib/workspace';
import { useEffect, useState } from 'react';

export function useWorkspaceReports({
  authToken,
  role,
  activeSection,
  locationId,
  locations,
  setSubmitLoading,
  setModuleWarning,
  showToast,
  addNotification,
}) {
  const [intelligence, setIntelligence] = useState(null);
  const [reportType, setReportType] = useState('variance');
  const [savedReports, setSavedReports] = useState([]);

  useEffect(() => {
    if (!authToken || activeSection !== 'reports' || !['ADMIN', 'AUDITOR'].includes(role)) return;
    apiRequest('/api/v1/saved-reports', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setSavedReports(response.savedReports ?? []))
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load saved reports.'));
  }, [activeSection, authToken, role, setModuleWarning]);

  useEffect(() => {
    if (!authToken || activeSection !== 'intelligence') return;
    apiRequest(`/api/v1/intelligence/${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setIntelligence(response.intelligence ?? null))
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load advanced module.'));
  }, [activeSection, authToken, locationId, setModuleWarning]);

  async function dismissIntelligenceRecommendation({ type, itemId, countId, reason }) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/intelligence/${encodeURIComponent(locationId)}/dismiss`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ type, itemId, countId, reason }),
      });
      setIntelligence((current) => current ? {
        ...current,
        recommendations: type === 'REPLENISHMENT' ? current.recommendations.filter((entry) => entry.itemId !== itemId) : current.recommendations,
        anomalies: type === 'ANOMALY' ? current.anomalies.filter((entry) => entry.countId !== countId) : current.anomalies,
        lotBlocks: type === 'LOT_BLOCK' ? (current.lotBlocks ?? []).filter((entry) => entry.itemId !== itemId) : current.lotBlocks,
        expiryActions: type === 'EXPIRY' ? (current.expiryActions ?? []).filter((entry) => entry.itemId !== itemId) : current.expiryActions,
        overstock: type === 'OVERSTOCK' ? (current.overstock ?? []).filter((entry) => entry.itemId !== itemId) : current.overstock,
      } : current);
      showToast('Recommendation dismissed - it resurfaces in 24h if still valid.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to dismiss recommendation.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function exportData(type) {
    try {
      const response = await fetch(`${API_BASE}/api/v1/export/${type}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast(`${type} exported successfully`, 'success');
      addNotification('Data Exported', `${type} data exported to CSV`, 'success');
    } catch (error) {
      showToast(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  async function saveCurrentReport() {
    const locationName = locations.find((location) => location.id === locationId)?.name ?? 'All locations';
    const title = `${REPORT_TYPE_LABELS[reportType]} · ${locationName}`;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/saved-reports', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name: title, reportType, locationId, config: { version: 1 } }),
      });
      setSavedReports((current) => [response.savedReport, ...current]);
      showToast('Report view saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save report.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function deleteSavedReport(reportId) {
    try {
      await apiRequest(`/api/v1/saved-reports/${reportId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setSavedReports((current) => current.filter((report) => report.id !== reportId));
      showToast('Saved report removed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to remove saved report.', 'error');
    }
  }

  function downloadReportCsv(rows) {
    const csv = rowsToCsv(rows);
    if (!csv) {
      showToast('This report has no rows to export.', 'warning');
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${reportType}-${locationId}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('Report exported to CSV.', 'success');
  }

  return {
    intelligence,
    dismissIntelligenceRecommendation,
    reportType,
    setReportType,
    savedReports,
    exportData,
    saveCurrentReport,
    deleteSavedReport,
    downloadReportCsv,
  };
}
