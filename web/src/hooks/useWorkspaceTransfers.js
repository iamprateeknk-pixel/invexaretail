import { API_BASE, apiRequest } from '../lib/api-client';
import { buildTransferSlipDocument } from '../lib/print-labels';
import { normalizeTransfers } from '../lib/workspace';
import { useState } from 'react';

export function useWorkspaceTransfers({
  authToken,
  role,
  locationId,
  items,
  locations,
  setSubmitLoading,
  setModalOpen,
  showToast,
  addNotification,
  loadAppData,
}) {
  const [transfers, setTransfers] = useState([]);
  const [transferForm, setTransferForm] = useState({ source: 'loc-1', destination: 'wh-1', itemId: 'sku-001', lotId: 'LOT-331', qty: 8, cartonCount: 1, photos: [] });
  const [evidenceTransfer, setEvidenceTransfer] = useState(null);
  const [editingTransfer, setEditingTransfer] = useState(null);
  const [receivingTransfer, setReceivingTransfer] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ requestId: '', lines: [], notes: '', photos: [] });
  const [pickerTasks, setPickerTasks] = useState([]);
  const [pickerDetail, setPickerDetail] = useState(null);
  const [pickDrafts, setPickDrafts] = useState({});
  const [transferImportFile, setTransferImportFile] = useState(null);
  const [transferImportPreview, setTransferImportPreview] = useState(null);
  const [transferImportForm, setTransferImportForm] = useState({ sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', mergeDuplicates: true });

  async function requestTransfer() {
    try {
      setSubmitLoading(true);
      const endpoint = editingTransfer ? `/api/v1/transfers/${editingTransfer.id}` : '/api/v1/transfers';
      const created = await apiRequest(endpoint, {
        method: editingTransfer ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          sourceLocationId: role === 'STORE_USER' ? (editingTransfer?.sourceLocationId ?? locationId) : transferForm.source,
          destinationLocationId: transferForm.destination,
          lines: [{ itemId: transferForm.itemId, lotId: transferForm.lotId, quantity: Number(transferForm.qty) }],
          cartonCount: transferForm.cartonCount || undefined,
        }),
      });
      for (const photo of transferForm.photos ?? []) {
        const data = new FormData();
        data.append('evidence', photo);
        const upload = await fetch(`${API_BASE}/api/v1/transfers/${created.transfer.id}/evidence`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: data,
        });
        if (!upload.ok) throw new Error('Transfer saved, but one evidence photo could not be uploaded.');
      }
      const refreshed = await apiRequest('/api/v1/transfers/list', { headers: { Authorization: `Bearer ${authToken}` } });
      setTransfers(normalizeTransfers(refreshed.transfers, items, locations));
      showToast(editingTransfer ? 'Transfer updated successfully.' : 'Transfer request created successfully!', 'success');
      addNotification('Transfer Request Created', `${transferForm.qty} units to ${transferForm.destination}`, 'success');
      setModalOpen(null);
      setEditingTransfer(null);
      setTransferForm((current) => ({ ...current, photos: [] }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to request transfer.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function refreshTransfers() {
    const refreshed = await apiRequest('/api/v1/transfers/list', { headers: { Authorization: `Bearer ${authToken}` } });
    setTransfers(normalizeTransfers(refreshed.transfers, items, locations));
  }

  function openTransferEditor(transfer) {
    const line = transfer.lines?.[0];
    if (!line || transfer.lines.length !== 1) {
      showToast('Multi-line imported transfers cannot be edited in the single-item form.', 'warning');
      return;
    }
    setEditingTransfer(transfer);
    setTransferForm({
      source: transfer.sourceLocationId,
      destination: transfer.destinationLocationId,
      itemId: line.itemId,
      lotId: line.lotId,
      qty: Number(line.quantity),
      cartonCount: transfer.cartonCount || 1,
      photos: [],
    });
    setModalOpen('transfer');
  }

  function closeTransferEditor() {
    setEditingTransfer(null);
    setModalOpen(null);
  }

  async function deleteTransfers(transferIds) {
    const uniqueIds = [...new Set(transferIds)].filter(Boolean);
    if (!uniqueIds.length) return { deleted: 0, failed: 0 };
    try {
      setSubmitLoading(true);
      const results = await Promise.allSettled(uniqueIds.map((transferId) => apiRequest(`/api/v1/transfers/${transferId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })));
      await refreshTransfers();
      const failed = results.filter((result) => result.status === 'rejected');
      const deleted = results.length - failed.length;
      if (deleted) showToast(`${deleted} transfer${deleted === 1 ? '' : 's'} deleted.`, 'success');
      if (failed.length) showToast(failed[0].reason instanceof Error ? failed[0].reason.message : `${failed.length} transfer(s) could not be deleted.`, 'error');
      return { deleted, failed: failed.length };
    } finally {
      setSubmitLoading(false);
    }
  }

  async function changeTransferStatus(transferId, status) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/transfers/${transferId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ status }),
      });
      const refreshed = await apiRequest('/api/v1/transfers/list', { headers: { Authorization: `Bearer ${authToken}` } });
      setTransfers(normalizeTransfers(refreshed.transfers, items, locations));
      showToast(`Transfer status updated to ${status}!`, 'success');
      addNotification('Transfer Status Updated', `Transfer ${transferId} → ${status}`, 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update transfer.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  function openTransferReceipt(transfer) {
    const lines = (transfer.lines || []).map((line) => {
      const accounted = Number(line.receivedQty || 0) + Number(line.damagedQty || 0) + Number(line.shortageQty || 0);
      return {
        lineId: line.id,
        itemId: line.itemId,
        lotId: line.lotId,
        expectedQty: Number(line.quantity),
        remainingQty: Math.max(0, Number(line.quantity) - accounted),
        receivedQty: Math.max(0, Number(line.quantity) - accounted),
        damagedQty: 0,
        shortageQty: 0,
        excessQty: 0,
      };
    }).filter((line) => line.remainingQty > 0);
    setReceivingTransfer(transfer);
    setReceiveForm({ requestId: crypto.randomUUID?.() ?? `receipt-${Date.now()}`, lines, notes: '', photos: [] });
    setModalOpen('receiveTransfer');
  }

  function updateReceiptLine(index, field, value) {
    setReceiveForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: Number(value) } : line),
    }));
  }

  async function submitTransferReceipt() {
    if (!receivingTransfer || !receiveForm.lines.length) return;
    const invalid = receiveForm.lines.some((line) => {
      // Excess is deliberately excluded from the requested-quantity cap -
      // it is quantity beyond what was asked for, held in quarantine
      // pending an explicit Exception Inbox accept/reject decision.
      const capped = line.receivedQty + line.damagedQty + line.shortageQty;
      const excess = Number(line.excessQty || 0);
      return capped + excess <= 0 || capped > line.remainingQty + 1e-8 || excess < 0;
    });
    if (invalid) {
      showToast('Each lot total must be positive, and received/damaged/shortage cannot exceed the remaining quantity.', 'error');
      return;
    }
    try {
      setSubmitLoading(true);
      for (const line of receiveForm.lines) {
        if (!(line.receivedQty > 0) || !line.qcResults || !Object.keys(line.qcResults).length) continue;
        await apiRequest('/api/v1/qc-inspections', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            itemId: line.itemId,
            lotId: line.lotId,
            locationId: receivingTransfer.destinationLocationId || receivingTransfer.to,
            sourceDocument: receivingTransfer.id,
            sourceLineId: line.lineId,
            results: line.qcResults,
          }),
        }).catch(() => undefined);
      }
      const response = await apiRequest(`/api/v1/transfers/${receivingTransfer.id}/receive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          requestId: receiveForm.requestId,
          notes: receiveForm.notes,
          lines: receiveForm.lines.map(({ expectedQty: _expectedQty, remainingQty: _remainingQty, qcResults: _qcResults, ...line }) => line),
          qcInspections: receiveForm.lines
            .filter((line) => line.receivedQty > 0 && line.qcResults && Object.keys(line.qcResults).length)
            .map((line) => ({ itemId: line.itemId, lineId: line.lineId, results: line.qcResults })),
        }),
      });
      for (const photo of receiveForm.photos) {
        const data = new FormData();
        data.append('evidence', photo);
        const upload = await fetch(`${API_BASE}/api/v1/transfers/${receivingTransfer.id}/evidence`, {
          method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: data,
        });
        if (!upload.ok) throw new Error('Receipt saved, but one evidence photo could not be uploaded.');
      }
      const refreshed = await apiRequest('/api/v1/transfers/list', { headers: { Authorization: `Bearer ${authToken}` } });
      setTransfers(normalizeTransfers(refreshed.transfers, items, locations));
      setModalOpen(null);
      setReceivingTransfer(null);
      showToast(response.duplicate ? 'Receipt was already saved; no stock was posted twice.' : 'Lot-wise receipt and destination stock saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to receive transfer.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function previewOrCommitTransferImport(commit = false) {
    if (!transferImportFile) return showToast('Select a transfer Excel/CSV file.', 'error');
    try {
      setSubmitLoading(true);
      const formData = new FormData();
      formData.append('file', transferImportFile);
      formData.append('sourceLocationId', transferImportForm.sourceLocationId);
      formData.append('destinationLocationId', transferImportForm.destinationLocationId);
      formData.append('mergeDuplicates', String(transferImportForm.mergeDuplicates));
      const response = await fetch(`${API_BASE}/api/v1/transfers/import/${commit ? 'commit' : 'preview'}`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.errors?.[0]?.message || 'Transfer import failed.');
      if (!commit) {
        setTransferImportPreview(result.preview);
        showToast(`Transfer preview: ${result.preview.validRows} mapped, ${result.preview.invalidRows} invalid.`, result.preview.invalidRows ? 'warning' : 'success');
      } else {
        showToast(result.message, 'success');
        setModalOpen(null); setTransferImportFile(null); setTransferImportPreview(null);
        await loadAppData(authToken, role);
      }
    } catch (error) { showToast(error instanceof Error ? error.message : 'Transfer import failed.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  async function openPickerTransfer(transferId) {
    try {
      const response = await apiRequest(`/api/v1/picker/transfers/${transferId}`, { headers: { Authorization: `Bearer ${authToken}` } });
      setPickerDetail(response);
      setPickDrafts(Object.fromEntries(response.transfer.lines.map((line) => [line.lineId, { quantity: line.unit?.toUpperCase() === 'PCS' ? 1 : '', scanCode: '', exceptionReason: '', exceptionQty: '', note: '' }])));
      setModalOpen('pickerDetail');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to open picker task.', 'error'); }
  }

  async function savePickSlip(finished = false) {
    const lines = []; const exceptions = [];
    for (const line of pickerDetail.transfer.lines) {
      const draft = pickDrafts[line.lineId] ?? {};
      const quantity = Number(draft.quantity);
      if (quantity > 0 && line.remainingQty > 0) lines.push({ itemId: line.itemId, lotId: line.lotId, quantity, inputMethod: line.unit?.toUpperCase() === 'PCS' ? 'SCAN' : 'MANUAL', scanCode: draft.scanCode });
      const exceptionQty = Number(draft.exceptionQty);
      if (draft.exceptionReason && exceptionQty > 0) exceptions.push({ itemId: line.itemId, lotId: line.lotId, quantity: exceptionQty, reason: draft.exceptionReason, note: draft.note });
    }
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/picker/transfers/${pickerDetail.transfer.id}/pick-slips`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ lines, exceptions, finished }) });
      showToast(response.message, 'success'); setModalOpen(null); setPickerDetail(null); await loadAppData(authToken, role);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to save pick slip.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  async function confirmPickedTransfer(transferId) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/transfers/${transferId}/confirm`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
      showToast(response.message, 'success'); await loadAppData(authToken, role);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to confirm transfer.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  async function exportTransferExcel(transferId) {
    try {
      const response = await fetch(`${API_BASE}/api/v1/transfers/${transferId}/export.xls`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) { const error = await response.json(); throw new Error(error.message); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${transferId}-pick-report.xls`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to export transfer.', 'error'); }
  }

  function startExpiryTransfer(lot) {
    const destination = locations.find((entry) => entry.id !== locationId && String(entry.type).toLowerCase() === 'store')
      || locations.find((entry) => entry.id !== locationId);
    setTransferForm((current) => ({
      ...current,
      source: locationId,
      destination: destination?.id || current.destination,
      itemId: lot.itemId,
      lotId: lot.lotId,
      qty: Number(lot.quantity) || 1,
    }));
    setModalOpen('transfer');
  }

  function generateTransferPDF(transfer) {
    const { html } = buildTransferSlipDocument(transfer, new Date().toLocaleString());
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
      showToast('Transfer label prepared for printing', 'success');
    }
  }

  return {
    transfers,
    setTransfers,
    transferForm,
    setTransferForm,
    evidenceTransfer,
    setEvidenceTransfer,
    editingTransfer,
    setEditingTransfer,
    refreshTransfers,
    receivingTransfer,
    setReceivingTransfer,
    receiveForm,
    setReceiveForm,
    pickerTasks,
    setPickerTasks,
    pickerDetail,
    setPickerDetail,
    pickDrafts,
    setPickDrafts,
    transferImportFile,
    setTransferImportFile,
    transferImportPreview,
    setTransferImportPreview,
    transferImportForm,
    setTransferImportForm,
    requestTransfer,
    openTransferEditor,
    closeTransferEditor,
    deleteTransfers,
    changeTransferStatus,
    openTransferReceipt,
    updateReceiptLine,
    submitTransferReceipt,
    previewOrCommitTransferImport,
    openPickerTransfer,
    savePickSlip,
    confirmPickedTransfer,
    exportTransferExcel,
    startExpiryTransfer,
    generateTransferPDF,
  };
}
