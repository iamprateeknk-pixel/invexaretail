import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceOperations({
  authToken,
  activeSection,
  locationId,
  items,
  workspaceProfile,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [assetCheckouts, setAssetCheckouts] = useState([]);
  const [assetForm, setAssetForm] = useState({ itemId: '', assigneeName: '', quantity: 1, dueAt: '', conditionOut: '' });
  const [jobs, setJobs] = useState([]);
  const [jobForm, setJobForm] = useState({ name: '', itemId: '', plannedQty: 1, dueAt: '', notes: '' });
  const [exceptionCases, setExceptionCases] = useState([]);
  const [exceptionSummary, setExceptionSummary] = useState({ open: 0, overdue: 0, critical: 0 });
  const [exceptionStatusFilter, setExceptionStatusFilter] = useState('');

  useEffect(() => {
    if (!authToken || !['assets', 'jobs', 'exceptions', 'dashboard'].includes(activeSection)) return;
    const headers = { Authorization: `Bearer ${authToken}` };
    const hiddenModules = new Set(workspaceProfile.pack?.hide ?? []);
    const modules = workspaceProfile.pack?.modules ?? {};
    const assetsEnabled = !hiddenModules.has('assets') && modules.assets !== false;
    const jobsEnabled = !hiddenModules.has('jobs') && modules.jobs !== false;
    const loadExceptions = () => apiRequest(`/api/v1/exceptions?locationId=${encodeURIComponent(locationId)}`, { headers })
      .then((response) => { setExceptionCases(response.cases ?? []); setExceptionSummary(response.summary ?? { open: 0, overdue: 0, critical: 0 }); });
    if (activeSection === 'dashboard') {
      if (assetsEnabled) {
        apiRequest(`/api/v1/asset-checkouts?locationId=${encodeURIComponent(locationId)}`, { headers }).then((response) => setAssetCheckouts(response.checkouts ?? [])).catch(() => undefined);
      } else {
        setAssetCheckouts([]);
      }
      if (jobsEnabled) {
        apiRequest(`/api/v1/jobs?locationId=${encodeURIComponent(locationId)}`, { headers }).then((response) => setJobs(response.jobs ?? [])).catch(() => undefined);
      } else {
        setJobs([]);
      }
      loadExceptions().catch(() => undefined);
      return;
    }
    const request = activeSection === 'assets'
      ? apiRequest(`/api/v1/asset-checkouts?locationId=${encodeURIComponent(locationId)}`, { headers }).then((response) => setAssetCheckouts(response.checkouts ?? []))
      : activeSection === 'exceptions'
        ? loadExceptions()
        : apiRequest(`/api/v1/jobs?locationId=${encodeURIComponent(locationId)}`, { headers }).then((response) => setJobs(response.jobs ?? []));
    request.catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load operations module.'));
  }, [activeSection, authToken, locationId, workspaceProfile, setModuleWarning]);

  async function refreshExceptions() {
    if (!authToken) return;
    try {
      const response = await apiRequest(`/api/v1/exceptions?locationId=${encodeURIComponent(locationId)}${exceptionStatusFilter ? `&status=${exceptionStatusFilter}` : ''}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setExceptionCases(response.cases ?? []);
      setExceptionSummary(response.summary ?? { open: 0, overdue: 0, critical: 0 });
    } catch (error) {
      setModuleWarning(error instanceof Error ? error.message : 'Unable to load the Exception Inbox.');
    }
  }

  async function claimException(caseId) {
    try {
      const response = await apiRequest(`/api/v1/exceptions/${caseId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ status: 'IN_PROGRESS' }),
      });
      setExceptionCases((current) => current.map((entry) => entry.id === caseId ? { ...entry, ...response.case } : entry));
      showToast('Exception claimed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to claim exception.', 'error');
    }
  }

  async function resolveException(caseId, disposition, resolutionNotes) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/exceptions/${caseId}/resolve`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ disposition, resolutionNotes }),
      });
      setExceptionCases((current) => current.map((entry) => entry.id === caseId ? { ...entry, ...response.case } : entry));
      showToast('Exception resolved and closed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to resolve exception.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function createAssetCheckout() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/asset-checkouts', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ ...assetForm, locationId }),
      });
      setAssetCheckouts((current) => [response.checkout, ...current]);
      setAssetForm({ itemId: '', assigneeName: '', quantity: 1, dueAt: '', conditionOut: '' });
      showToast('Inventory checked out.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to check out inventory.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function returnAssetCheckout(checkoutId) {
    try {
      const conditionIn = window.prompt('Return condition (optional)', 'Good') ?? '';
      const response = await apiRequest(`/api/v1/asset-checkouts/${checkoutId}/return`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ conditionIn }),
      });
      setAssetCheckouts((current) => current.map((entry) => entry.id === checkoutId ? response.checkout : entry));
      showToast('Return recorded.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to record return.', 'error');
    }
  }

  async function createJob() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/jobs', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ name: jobForm.name, locationId, dueAt: jobForm.dueAt, notes: jobForm.notes }),
      });
      let job = response.job;
      if (jobForm.itemId) {
        const lineResponse = await apiRequest(`/api/v1/jobs/${job.id}/lines`, {
          method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ itemId: jobForm.itemId, plannedQty: Number(jobForm.plannedQty) }),
        });
        job = { ...job, lines: [lineResponse.line] };
      }
      setJobs((current) => [job, ...current]);
      setJobForm({ name: '', itemId: '', plannedQty: 1, dueAt: '', notes: '' });
      showToast('Job created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create job.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function consumeJobLine(job, line) {
    const quantityText = window.prompt(`Consume quantity for ${items.find((item) => item.id === line.itemId)?.name ?? line.itemId}`, String(Math.max(1, Number(line.plannedQty || 1) - Number(line.usedQty || 0))));
    if (quantityText === null) return;
    const quantity = Number(quantityText);
    if (!Number.isInteger(quantity) || quantity <= 0) { showToast('Enter a whole number greater than zero.', 'error'); return; }
    // One key per user action: a retry of this same action can never consume the stock twice.
    const requestId = `job-consume-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/jobs/${job.id}/consume`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ lineId: line.id, quantity, requestId }),
      });
      setJobs((current) => current.map((entry) => entry.id === job.id ? { ...entry, ...response.job } : entry));
      showToast(`Consumed ${quantityText} units into ${job.name}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to consume job inventory.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function updateJobStatus(jobId, status) {
    try {
      const response = await apiRequest(`/api/v1/jobs/${jobId}/status`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ status }),
      });
      setJobs((current) => current.map((job) => job.id === jobId ? { ...job, ...response.job } : job));
      showToast(`Job moved to ${status}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update job.', 'error');
    }
  }

  return {
    assetCheckouts,
    assetForm,
    setAssetForm,
    jobs,
    jobForm,
    setJobForm,
    createAssetCheckout,
    returnAssetCheckout,
    createJob,
    consumeJobLine,
    updateJobStatus,
    exceptionCases,
    exceptionSummary,
    exceptionStatusFilter,
    setExceptionStatusFilter,
    refreshExceptions,
    claimException,
    resolveException,
  };
}
