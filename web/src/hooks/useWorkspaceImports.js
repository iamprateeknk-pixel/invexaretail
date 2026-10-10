import { mergeImportBatchProgress, interpretImportResponse, buildLocalImportErrorCsv } from '../lib/import-batch';
import { API_BASE, apiRequest } from '../lib/api-client';
import { normalizeStockRows } from '../lib/workspace';
import { useEffect, useState } from 'react';

export function useWorkspaceImports({
  authToken,
  role,
  activeSection,
  locationId,
  items,
  setItems,
  setStockRows,
  loadAppData,
  setSubmitLoading,
  setModalOpen,
  setModuleWarning,
  showToast,
  addNotification,
}) {
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [dailyImportForm, setDailyImportForm] = useState({ type: 'SALES', file: null, purchaseTime: '12:00', destinationLocationId: '' });
  const [dailyImportPreview, setDailyImportPreview] = useState(null);
  const [importBatches, setImportBatches] = useState([]);
  const [reversalBatch, setReversalBatch] = useState(null);
  const [reversalReason, setReversalReason] = useState('');
  const [stockUpdateFile, setStockUpdateFile] = useState(null);
  const [stockUpdatePreview, setStockUpdatePreview] = useState(null);
  const [stockUpdateImportMode, setStockUpdateImportMode] = useState('SET');

  useEffect(() => {
    if (!authToken || activeSection !== 'stock-update' || !['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(role)) return;
    apiRequest('/api/v1/imports/batches?limit=100', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setImportBatches(response.batches ?? []))
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load import history.'));
  }, [activeSection, authToken, role, setModuleWarning]);

  async function hydrateImportPreview(preview) {
    const token = preview?.batchToken;
    if (!token) return preview;
    try {
      const live = await apiRequest(`/api/v1/imports/${token}`, { headers: { Authorization: `Bearer ${authToken}` } });
      return mergeImportBatchProgress(preview, live);
    } catch {
      return preview;
    }
  }

  function downloadImportErrors(preview, importType = 'import') {
    const token = preview?.batchToken;
    if (token) {
      fetch(`${API_BASE}/api/v1/imports/${token}/errors?format=csv`, { headers: { Authorization: `Bearer ${authToken}` } })
        .then(async (response) => {
          if (!response.ok) throw new Error('Unable to download the server error report.');
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${importType}-invalid-rows-${new Date().toISOString().slice(0, 10)}.csv`;
          anchor.click();
          URL.revokeObjectURL(url);
        })
        .catch((error) => showToast(error instanceof Error ? error.message : 'Unable to download errors.', 'error'));
      return;
    }
    const errors = preview?.errors ?? [];
    if (!errors.length) return;
    const csv = buildLocalImportErrorCsv(errors);
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${importType}-invalid-rows-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readImportResponse(response) {
    const result = await response.json().catch(() => ({}));
    return interpretImportResponse(response.status, result);
  }

  async function reversePostedImport(batch) {
    setReversalBatch(batch);
    setReversalReason('');
  }

  async function confirmImportReversal() {
    if (!reversalBatch) return;
    if (reversalReason.trim().length < 5) {
      showToast('A reversal reason of at least 5 characters is required.', 'error');
      return;
    }
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/imports/${reversalBatch.id}/reverse`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ reason: reversalReason.trim() }),
      });
      const history = await apiRequest('/api/v1/imports/batches?limit=100', { headers: { Authorization: `Bearer ${authToken}` } });
      setImportBatches(history.batches ?? []);
      const [stock, itemsResponse] = await Promise.all([
        apiRequest(`/api/v1/stock/${locationId}`, { headers: { Authorization: `Bearer ${authToken}` } }),
        apiRequest('/api/v1/items', { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      if (itemsResponse.items) setItems(itemsResponse.items);
      setStockRows(normalizeStockRows(stock.items ?? [], itemsResponse.items ?? items));
      showToast(response.duplicate ? 'This import was already reversed.' : `Import reversed. ${response.reversedMovements ?? 0} lot rows removed.`, 'success');
      setReversalBatch(null);
      setReversalReason('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to reverse import.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function importItems() {
    if (!importPreview?.batchToken) {
      if (!importFile) {
        showToast('Please select a file to import', 'error');
        return;
      }
      try {
        setSubmitLoading(true);
        const formData = new FormData();
        formData.append('file', importFile);
        const response = await fetch(`${API_BASE}/api/v1/imports/opening-stock/preview`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData,
        });
        const { conflict, result } = await readImportResponse(response);
        const preview = result.preview ?? result;
        if (conflict && result.status === 'POSTED') throw new Error(result.message);
        setImportPreview(await hydrateImportPreview({ ...preview, batchToken: result.batchToken ?? preview.batchToken }));
        showToast(conflict ? result.message : `Preview ready: ${preview.validRows} valid, ${preview.invalidRows} invalid`, conflict ? 'warning' : 'success');
      } catch (error) {
        showToast(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      } finally {
        setSubmitLoading(false);
      }
      return;
    }

    try {
      setSubmitLoading(true);
      const response = await fetch(`${API_BASE}/api/v1/imports/${importPreview.batchToken}/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'replace-current' }),
      });
      const { conflict, result } = await readImportResponse(response);
      if (conflict && result.status === 'POSTED') {
        showToast(result.message, 'warning');
      } else {
        showToast(result.message, 'success');
      }
      addNotification('Stock Imported', result.message, 'success');
      setModalOpen(null);
      setImportFile(null);
      setImportPreview(null);
      await loadAppData(authToken, role);
    } catch (error) {
      showToast(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function previewOrCommitStockUpdate(commit = false) {
    if (commit) {
      const token = stockUpdatePreview?.batchToken;
      if (!token) return showToast('Preview this file before committing.', 'error');
      try {
        setSubmitLoading(true);
        const response = await fetch(`${API_BASE}/api/v1/imports/${token}/commit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const { conflict, result } = await readImportResponse(response);
        showToast(result.message, conflict ? 'warning' : 'success');
        setStockUpdateFile(null); setStockUpdatePreview(null);
        await loadAppData(authToken, role);
      } catch (error) { showToast(error instanceof Error ? error.message : 'Stock update import failed.', 'error'); }
      finally { setSubmitLoading(false); }
      return;
    }
    if (!stockUpdateFile) return showToast('Select a stock Excel or CSV file.', 'error');
    try {
      setSubmitLoading(true);
      const formData = new FormData();
      formData.append('file', stockUpdateFile);
      formData.append('mode', stockUpdateImportMode);
      const response = await fetch(`${API_BASE}/api/v1/stock-adjustments/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: formData });
      const { conflict, result } = await readImportResponse(response);
      const preview = { ...(result.preview ?? result), batchToken: result.batchToken ?? result.preview?.batchToken };
      if (conflict && result.status === 'POSTED') throw new Error(result.message);
      setStockUpdatePreview(await hydrateImportPreview(preview));
      showToast(conflict ? result.message : `Preview: ${preview.validRows} lot rows ready.`, preview.invalidRows || conflict ? 'warning' : 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Stock update import failed.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  async function previewOrCommitDailyImport(commit = false) {
    if (commit) {
      const token = dailyImportPreview?.batchToken;
      if (!token) return showToast('Preview this file before committing.', 'error');
      try {
        setSubmitLoading(true);
        const response = await fetch(`${API_BASE}/api/v1/imports/${token}/commit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const { conflict, result } = await readImportResponse(response);
        showToast(result.message, conflict ? 'warning' : 'success');
        setModalOpen(null); setDailyImportForm({ type: 'SALES', file: null, purchaseTime: '12:00', destinationLocationId: '' }); setDailyImportPreview(null);
        await loadAppData(authToken, role);
      } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to import daily stock movements.', 'error'); }
      finally { setSubmitLoading(false); }
      return;
    }
    if (!dailyImportForm.file) return showToast('Select a Sales or Purchase Excel file.', 'error');
    try {
      setSubmitLoading(true);
      const formData = new FormData(); formData.append('file', dailyImportForm.file); formData.append('purchaseTime', dailyImportForm.purchaseTime);
      if (dailyImportForm.type === 'PURCHASE' && dailyImportForm.destinationLocationId) formData.append('destinationLocationId', dailyImportForm.destinationLocationId);
      const kind = dailyImportForm.type === 'PURCHASE' ? 'purchases' : 'sales';
      const response = await fetch(`${API_BASE}/api/v1/imports/${kind}/preview`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: formData });
      const { conflict, result } = await readImportResponse(response);
      const preview = { ...(result.preview ?? result), batchToken: result.batchToken ?? result.preview?.batchToken };
      if (conflict && (result.status === 'POSTED' || result.status === 'VALIDATED')) throw new Error(result.message);
      setDailyImportPreview(await hydrateImportPreview(preview));
      showToast(conflict ? result.message : `Preview: ${preview.validRows} valid, ${preview.invalidRows} invalid.`, preview.invalidRows || conflict ? 'warning' : 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to import daily stock movements.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  return {
    importFile,
    setImportFile,
    importPreview,
    setImportPreview,
    dailyImportForm,
    setDailyImportForm,
    dailyImportPreview,
    setDailyImportPreview,
    importBatches,
    reversalBatch,
    setReversalBatch,
    reversalReason,
    setReversalReason,
    stockUpdateFile,
    setStockUpdateFile,
    stockUpdatePreview,
    setStockUpdatePreview,
    stockUpdateImportMode,
    setStockUpdateImportMode,
    downloadImportErrors,
    reversePostedImport,
    confirmImportReversal,
    importItems,
    previewOrCommitStockUpdate,
    previewOrCommitDailyImport,
  };
}
