import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

// Blueprint Module B / sections 6 & 8.3: bin directory + putaway tasks.
export function useWorkspacePutaway({
  authToken,
  activeSection,
  locationId,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [bins, setBins] = useState([]);
  const [putawayTasks, setPutawayTasks] = useState([]);
  const [binForm, setBinForm] = useState({ code: '', zone: '', aisle: '', rack: '', shelf: '', storageClass: '', capacity: '' });

  const [binStock, setBinStock] = useState([]);

  function loadBins() {
    if (!authToken || !locationId) return;
    apiRequest(`/api/v1/locations/${encodeURIComponent(locationId)}/bins`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setBins(response.bins ?? []))
      .catch(() => undefined);
  }

  function loadBinStock() {
    if (!authToken || !locationId) return;
    apiRequest(`/api/v1/locations/${encodeURIComponent(locationId)}/bin-stock`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setBinStock(response.bins ?? []))
      .catch(() => setBinStock([]));
  }

  function loadPutawayTasks() {
    if (!authToken) return;
    apiRequest(`/api/v1/putaway-tasks?locationId=${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setPutawayTasks(response.tasks ?? []))
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load putaway tasks.'));
  }

  useEffect(() => {
    if (!authToken) return;
    // The dashboard's "Pending putaway" KPI needs a live count too, so load
    // just the task list there - bins/bin-stock stay scoped to the putaway
    // page itself, nothing else needs them.
    if (activeSection === 'dashboard') { loadPutawayTasks(); return; }
    if (activeSection !== 'putaway') return;
    loadBins();
    loadPutawayTasks();
    loadBinStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken, locationId]);

  async function createBin() {
    if (!binForm.code.trim()) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/locations/${encodeURIComponent(locationId)}/bins`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ ...binForm, capacity: binForm.capacity ? Number(binForm.capacity) : undefined }),
      });
      setBins((current) => [...current, response.bin].sort((a, b) => a.code.localeCompare(b.code)));
      setBinForm({ code: '', zone: '', aisle: '', rack: '', shelf: '', storageClass: '', capacity: '' });
      showToast('Bin created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create bin.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function confirmPutaway(taskId, binId, scannedBinCode) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/putaway-tasks/${taskId}/confirm`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ binId, scannedBinCode, allowOverride: true }),
      });
      setPutawayTasks((current) => current.filter((task) => task.id !== response.task.id));
      showToast('Putaway confirmed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to confirm putaway.', 'error');
    } finally { setSubmitLoading(false); }
  }

  return { bins, binStock, putawayTasks, binForm, setBinForm, createBin, confirmPutaway, refreshPutaway: loadPutawayTasks };
}
