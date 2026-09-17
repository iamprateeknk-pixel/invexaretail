import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceCatalog({
  authToken,
  role,
  activeSection,
  locationId,
  locations,
  globalSearch,
  setGlobalSearch,
  setLocationId,
  selectedItem,
  modalOpen,
  reorderRules,
  setReorderRules,
  setLoading,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [tags, setTags] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [newTagName, setNewTagName] = useState('');
  const [newField, setNewField] = useState({ name: '', type: 'text' });
  const [itemCatalogMeta, setItemCatalogMeta] = useState({ tags: [], customFields: [] });
  const [itemFieldDrafts, setItemFieldDrafts] = useState({});
  const [itemComments, setItemComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [photoItem, setPhotoItem] = useState(null);
  const [serialItem, setSerialItem] = useState(null);
  const [forecastItem, setForecastItem] = useState(null);
  const [pricingItem, setPricingItem] = useState(null);
  const [reorderDraft, setReorderDraft] = useState({ minQty: 0, targetQty: 0 });
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem('invexa_saved_views') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    if (!authToken || activeSection !== 'catalog') return;
    const headers = { Authorization: `Bearer ${authToken}` };
    setLoading(true);
    Promise.all([apiRequest('/api/v1/catalog/tags', { headers }), apiRequest('/api/v1/catalog/custom-fields', { headers })])
      .then(([tagResponse, fieldResponse]) => {
        setTags(tagResponse.tags ?? []);
        setCustomFields(fieldResponse.fields ?? []);
      })
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load module.'))
      .finally(() => setLoading(false));
  }, [activeSection, authToken, setLoading, setModuleWarning]);

  useEffect(() => {
    if (!authToken || modalOpen !== 'itemDetails' || !selectedItem?.itemId) return;
    const headers = { Authorization: `Bearer ${authToken}` };
    Promise.all([
      apiRequest(`/api/v1/catalog/items/${selectedItem.itemId}`, { headers }),
      apiRequest('/api/v1/catalog/tags', { headers }),
      apiRequest('/api/v1/catalog/custom-fields', { headers }),
      apiRequest(`/api/v1/comments/item/${selectedItem.itemId}`, { headers }),
    ]).then(([metaResponse, tagResponse, fieldResponse, commentResponse]) => {
      setItemCatalogMeta({ tags: metaResponse.tags ?? [], customFields: metaResponse.customFields ?? [] });
      setTags(tagResponse.tags ?? []);
      setCustomFields(fieldResponse.fields ?? []);
      setItemFieldDrafts(Object.fromEntries((metaResponse.customFields ?? []).map((entry) => [entry.fieldId, entry.value])));
      setItemComments(commentResponse.comments ?? []);
    }).catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load catalogue metadata.'));
  }, [authToken, modalOpen, selectedItem?.itemId, setModuleWarning]);

  useEffect(() => {
    if (modalOpen !== 'itemDetails' || !selectedItem?.itemId) return;
    const rule = reorderRules.find((entry) => entry.itemId === selectedItem.itemId);
    setReorderDraft({ minQty: rule?.minQty ?? 0, targetQty: rule?.targetQty ?? 0 });
  }, [modalOpen, reorderRules, selectedItem?.itemId]);

  async function createTag() {
    if (!newTagName.trim()) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/catalog/tags', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ name: newTagName.trim() }),
      });
      setTags((current) => [...current, { ...response.tag, _count: { items: 0 } }]);
      setNewTagName('');
      showToast('Tag created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create tag.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function createCustomField() {
    if (!newField.name.trim()) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/catalog/custom-fields', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify(newField),
      });
      setCustomFields((current) => [...current, response.field]);
      setNewField({ name: '', type: 'text' });
      showToast('Custom field created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create custom field.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function toggleItemTag(tagId) {
    if (!selectedItem || role !== 'ADMIN') return;
    const selectedIds = new Set(itemCatalogMeta.tags.map((tag) => tag.id));
    if (selectedIds.has(tagId)) selectedIds.delete(tagId); else selectedIds.add(tagId);
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/catalog/items/${selectedItem.itemId}/tags`, {
        method: 'PUT', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ tagIds: [...selectedIds] }),
      });
      setItemCatalogMeta((current) => ({ ...current, tags: tags.filter((tag) => selectedIds.has(tag.id)) }));
      showToast('Item tags updated.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update item tags.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function saveItemCustomField(fieldId) {
    if (!selectedItem || role !== 'ADMIN') return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/catalog/items/${selectedItem.itemId}/custom-fields/${fieldId}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ value: itemFieldDrafts[fieldId] ?? '' }),
      });
      setItemCatalogMeta((current) => ({ ...current, customFields: [...current.customFields.filter((entry) => entry.fieldId !== fieldId), response.customField] }));
      showToast('Custom field saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save custom field.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function saveReorderRule() {
    if (!selectedItem || role !== 'ADMIN') return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/reorder-rules/${selectedItem.itemId}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ locationId, minQty: Number(reorderDraft.minQty), targetQty: Number(reorderDraft.targetQty) }),
      });
      setReorderRules((current) => [...current.filter((rule) => rule.itemId !== selectedItem.itemId), response.rule]);
      showToast('Reorder rule saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save reorder rule.', 'error');
    } finally { setSubmitLoading(false); }
  }

  function saveCurrentView() {
    const locationName = locations.find((location) => location.id === locationId)?.name ?? locationId;
    const view = { id: `view-${Date.now()}`, name: `${locationName} · ${globalSearch.trim() || 'All items'}`, locationId, search: globalSearch };
    const next = [...savedViews, view];
    setSavedViews(next);
    localStorage.setItem('invexa_saved_views', JSON.stringify(next));
    showToast('Inventory view saved.', 'success');
  }

  function applySavedView(view) {
    if (!view) return;
    setLocationId(view.locationId);
    setGlobalSearch(view.search ?? '');
  }

  function deleteSavedView(viewId) {
    const next = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(next);
    localStorage.setItem('invexa_saved_views', JSON.stringify(next));
  }

  async function postItemComment() {
    if (!selectedItem || !commentDraft.trim()) return;
    try {
      const response = await apiRequest(`/api/v1/comments/item/${selectedItem.itemId}`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ body: commentDraft }),
      });
      setItemComments((current) => [...current, response.comment]);
      setCommentDraft('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to post comment.', 'error');
    }
  }

  return {
    tags,
    setTags,
    customFields,
    setCustomFields,
    newTagName,
    setNewTagName,
    newField,
    setNewField,
    itemCatalogMeta,
    itemFieldDrafts,
    setItemFieldDrafts,
    itemComments,
    commentDraft,
    setCommentDraft,
    photoItem,
    setPhotoItem,
    serialItem,
    setSerialItem,
    forecastItem,
    setForecastItem,
    pricingItem,
    setPricingItem,
    reorderDraft,
    setReorderDraft,
    savedViews,
    createTag,
    createCustomField,
    toggleItemTag,
    saveItemCustomField,
    saveReorderRule,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
    postItemComment,
  };
}
