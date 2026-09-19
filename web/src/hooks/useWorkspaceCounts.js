import { API_BASE, apiRequest } from '../lib/api-client';
import { countReviewNoteIsValid, isCountManager } from '../lib/count-review';
import { normalizeCounts } from '../lib/workspace';
import { useEffect, useState } from 'react';

export function useWorkspaceCounts({
  authToken,
  role,
  locationId,
  items,
  locations,
  activeSection,
  setSubmitLoading,
  setModalOpen,
  setModuleWarning,
  showToast,
  addNotification,
  loadAppData,
}) {
  const [counts, setCounts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [storeUsers, setStoreUsers] = useState([]);
  const [assignForm, setAssignForm] = useState({ locationId: 'loc-1', storeUserId: '', itemId: '', instructions: '', dueDate: '', priority: 'NORMAL' });
  const [cycleCountPlan, setCycleCountPlan] = useState(null);
  const [cycleCountClasses, setCycleCountClasses] = useState(['A']);
  const [cycleCountStoreUserId, setCycleCountStoreUserId] = useState('');
  const [countForm, setCountForm] = useState({ itemId: 'sku-001', lotNo: 'LOT-331', physicalQuantity: 41 });
  const [countStatusFilter, setCountStatusFilter] = useState('all');
  const [selectedCountTask, setSelectedCountTask] = useState(null);
  const [reviewingCount, setReviewingCount] = useState(null);
  const [reviewReason, setReviewReason] = useState('');
  const [bulkCountForm, setBulkCountForm] = useState({ locationId: 'loc-1', storeUserId: '', category: 'all', subcategory: 'all', company: 'all', search: '', selectedItemIds: [], dueDate: '', priority: 'NORMAL' });
  const [bulkCountPreview, setBulkCountPreview] = useState(null);
  const [bulkCountFile, setBulkCountFile] = useState(null);

  useEffect(() => {
    if (!authToken || activeSection !== 'counts' || !isCountManager(role) || !locationId) {
      if (activeSection !== 'counts') setCycleCountPlan(null);
      return;
    }
    const headers = { Authorization: `Bearer ${authToken}` };
    apiRequest(`/api/v1/cycle-counts/${encodeURIComponent(locationId)}`, { headers })
      .then((response) => setCycleCountPlan(response.plan ?? null))
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load the cycle-count planner.'));
  }, [activeSection, authToken, locationId, role, assignments, setModuleWarning]);

  async function submitBlindCount() {
    try {
      setSubmitLoading(true);
      await apiRequest('/api/v1/stock-counts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ itemId: countForm.itemId, locationId, physicalQuantity: Number(countForm.physicalQuantity), lotNo: countForm.lotNo, mode: 'manual' }),
      });
      const refreshed = await apiRequest('/api/v1/counts', { headers: { Authorization: `Bearer ${authToken}` } });
      setCounts(normalizeCounts(refreshed.counts, items, locations));
      if (['STORE_USER', 'WAREHOUSE_PICKER'].includes(role)) {
        const assignmentsRefreshed = await apiRequest('/api/v1/count-assignments/mine', { headers: { Authorization: `Bearer ${authToken}` } });
        setAssignments(assignmentsRefreshed.assignments ?? []);
      }
      showToast('Stock count submitted successfully!', 'success');
      addNotification('Stock Count Submitted', `${countForm.itemId}: ${countForm.physicalQuantity} units`, 'success');
      setCountForm({ itemId: 'sku-001', lotNo: 'LOT-331', physicalQuantity: 0 });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to submit count.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  function pickAssignment(assignment) {
    const item = items.find((candidate) => candidate.id === assignment.itemId);
    const lotNo = item?.lots?.[0]?.lotNo ?? '';
    setCountForm({ itemId: assignment.itemId, lotNo, physicalQuantity: 0 });
  }

  async function submitCycleCountAssign() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/cycle-counts/${encodeURIComponent(locationId)}/assign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          storeUserId: cycleCountStoreUserId,
          classes: cycleCountClasses,
        }),
      });
      setAssignments((current) => [...current, ...(response.assignments ?? [])]);
      setCycleCountPlan(response.plan ?? null);
      showToast(`Assigned ${response.assignments?.length ?? 0} ABC cycle counts.`, 'success');
      addNotification('Cycle count assigned', `${response.assignments?.length ?? 0} items from classes ${cycleCountClasses.join(', ')}`, 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to assign cycle counts.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function submitAssignCount() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/count-assignments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          locationId: assignForm.locationId,
          storeUserId: assignForm.storeUserId,
          itemIds: [assignForm.itemId],
          instructions: assignForm.instructions || undefined,
          dueDate: assignForm.dueDate || undefined,
          priority: assignForm.priority || undefined,
        }),
      });
      setAssignments((current) => [...current, ...(response.assignments ?? [])]);
      showToast('Count assigned to store user.', 'success');
      addNotification('Count Assignment', `Item assigned to user for counting`, 'info');
      setModalOpen(null);
      setAssignForm((current) => ({ ...current, instructions: '', dueDate: '', priority: 'NORMAL' }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to assign count.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function updateCountAssignment(assignmentId, payload) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/count-assignments/${encodeURIComponent(assignmentId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload),
      });
      await loadAppData(authToken, role);
      showToast('Count task updated.', 'success');
      addNotification('Count task updated', 'Assignment details were changed by an admin.', 'info');
      setModalOpen(null);
      setSelectedCountTask(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update count task.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function deleteCountAssignment(assignmentId) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/count-assignments/${encodeURIComponent(assignmentId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await loadAppData(authToken, role);
      showToast('Count task deleted.', 'success');
      addNotification('Count task deleted', 'The assignment was removed; any submitted count history was preserved.', 'info');
      setSelectedCountTask(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to delete count task.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }
  async function deleteCountAssignments(assignmentIds) {
    const uniqueIds = [...new Set(assignmentIds)].filter(Boolean);
    if (!uniqueIds.length) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/count-assignments/bulk', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ assignmentIds: uniqueIds }),
      });
      await loadAppData(authToken, role);
      const deletedCount = response.deletedCount ?? uniqueIds.length;
      showToast(`${deletedCount} count task${deletedCount === 1 ? '' : 's'} deleted.`, 'success');
      addNotification('Count tasks deleted', `${deletedCount} assignments were removed; submitted count history was preserved.`, 'info');
      setSelectedCountTask(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to delete count tasks.', 'error');
      throw error;
    } finally {
      setSubmitLoading(false);
    }
  }

  async function reviewCount(countId, status) {
    if (!countReviewNoteIsValid(reviewReason)) {
      showToast('Enter a review note of at least 5 characters.', 'error');
      return;
    }

      setSubmitLoading(true);
    try {
      const response = await apiRequest(`/api/v1/stock-counts/${countId}/review`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ status, reviewReason: reviewReason.trim() }),
      });
      const refreshed = await apiRequest('/api/v1/counts', { headers: { Authorization: `Bearer ${authToken}` } });
      setCounts(normalizeCounts(refreshed.counts, items, locations));
      if (isCountManager(role) || ['STORE_USER', 'WAREHOUSE_PICKER'].includes(role)) {
        const assignmentsRefreshed = ['STORE_USER', 'WAREHOUSE_PICKER'].includes(role)
          ? await apiRequest('/api/v1/count-assignments/mine', { headers: { Authorization: `Bearer ${authToken}` } })
          : await apiRequest('/api/v1/count-assignments', { headers: { Authorization: `Bearer ${authToken}` } });
        setAssignments(assignmentsRefreshed.assignments ?? []);
      }
      const verb = status === 'APPROVED' ? 'approved' : status === 'RECOUNT' ? 'sent back for recount' : 'rejected';
      showToast(`Count ${verb} successfully.`, 'success');
      addNotification(`Count ${status === 'APPROVED' ? 'Approved' : status === 'RECOUNT' ? 'Recount requested' : 'Rejected'}`, response.count?.reviewReason ?? 'Count review completed', status === 'APPROVED' ? 'success' : 'error');
      setReviewReason('');
      setReviewingCount(null);
      setModalOpen(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to review count.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function previewBulkCount() {
    try {
      setSubmitLoading(true);
      let response;
      if (bulkCountFile) {
        const formData = new FormData(); formData.append('file', bulkCountFile); formData.append('locationId', bulkCountForm.locationId);
        const raw = await fetch(`${API_BASE}/api/v1/stock-takes/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: formData });
        const result = await raw.json(); if (!raw.ok) throw new Error(result.message); response = { ...result.preview, matchingCount: result.preview.validRows, excludedZeroStock: result.preview.errors?.filter((error) => error.message.includes('zero')).length ?? 0 };
      } else response = await apiRequest('/api/v1/stock-takes/preview-by-filters', { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify(bulkCountForm) });
      setBulkCountPreview(response);
      setBulkCountForm((current) => ({ ...current, selectedItemIds: response.items.map((item) => item.id) }));
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to preview stock take.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  async function assignBulkCount() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/stock-takes/bulk-assign', { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ locationId: bulkCountForm.locationId, storeUserId: bulkCountForm.storeUserId, itemIds: bulkCountForm.selectedItemIds, dueDate: bulkCountForm.dueDate || undefined, priority: bulkCountForm.priority || undefined, filterSnapshot: { category: bulkCountForm.category, subcategory: bulkCountForm.subcategory, company: bulkCountForm.company } }) });
      showToast(response.message, 'success'); setModalOpen(null); setBulkCountPreview(null); await loadAppData(authToken, role);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to assign stock take.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  return {
    counts,
    setCounts,
    assignments,
    setAssignments,
    storeUsers,
    setStoreUsers,
    assignForm,
    setAssignForm,
    cycleCountPlan,
    setCycleCountPlan,
    cycleCountClasses,
    setCycleCountClasses,
    cycleCountStoreUserId,
    setCycleCountStoreUserId,
    countForm,
    setCountForm,
    countStatusFilter,
    setCountStatusFilter,
    selectedCountTask,
    setSelectedCountTask,
    reviewingCount,
    setReviewingCount,
    reviewReason,
    setReviewReason,
    bulkCountForm,
    setBulkCountForm,
    bulkCountPreview,
    setBulkCountPreview,
    bulkCountFile,
    setBulkCountFile,
    submitBlindCount,
    pickAssignment,
    submitCycleCountAssign,
    submitAssignCount,
    updateCountAssignment,
    deleteCountAssignment,
    reviewCount,
    deleteCountAssignments,
    previewBulkCount,
    assignBulkCount,
  };
}
