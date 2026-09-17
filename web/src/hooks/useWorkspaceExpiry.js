import { apiRequest } from '../lib/api-client';
import { normalizeStockRows, normalizeTransfers } from '../lib/workspace';

export function useWorkspaceExpiry({
  authToken,
  locationId,
  items,
  locations,
  setItems,
  setStockRows,
  setTransfers,
  setPurchaseOrderForm,
  navigateTo,
  setSubmitLoading,
  showToast,
}) {
  async function refreshStockAndItems() {
    const headers = { Authorization: `Bearer ${authToken}` };
    const [itemsResponse, stockResponse] = await Promise.all([
      apiRequest('/api/v1/items', { headers }),
      apiRequest(`/api/v1/stock/${locationId}`, { headers }),
    ]);
    if (itemsResponse.items) setItems(itemsResponse.items);
    setStockRows(normalizeStockRows(stockResponse.items ?? [], itemsResponse.items ?? items));
  }

  async function setLotExpiryDate(lot, expiryDate) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/lots/${lot.lotId}/expiry`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ expiryDate }),
      });
      await refreshStockAndItems();
      showToast(`Expiry date saved for lot ${lot.lotNo}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save expiry date.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function writeOffExpiryLot(lot, quantity, reason) {
    try {
      setSubmitLoading(true);
      await apiRequest('/api/v1/expiry-write-off', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          itemId: lot.itemId,
          lotId: lot.lotId,
          locationId: lot.locationId || locationId,
          quantity,
          reason,
        }),
      });
      await refreshStockAndItems();
      showToast(`Wrote off ${quantity} from lot ${lot.lotNo}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to write off expired stock.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function setExpiryLotStatus(lot, status) {
    try {
      setSubmitLoading(true);
      await apiRequest(`/api/v1/lots/${lot.lotId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ status }),
      });
      await refreshStockAndItems();
      showToast(status === 'AVAILABLE' ? `Lot ${lot.lotNo} is available again.` : `Lot ${lot.lotNo} marked ${status.toLowerCase()}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update lot status.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function executeReplenishment(entry) {
    if (entry.suggestedAction === 'PURCHASE') {
      const basni = locations.find((loc) => /basni/i.test(loc.name)) || locations.find((loc) => String(loc.type).toLowerCase() === 'warehouse');
      setPurchaseOrderForm((current) => ({
        ...current,
        locationId: basni?.id || current.locationId,
        itemId: entry.itemId,
        quantity: Math.max(1, Number(entry.suggestedOrderQty || 1)),
      }));
      navigateTo('purchase-orders');
      showToast('H.O. Basni purchase-order draft prepared; select supplier and unit cost.', 'success');
      return;
    }
    if (entry.suggestedAction !== 'TRANSFER') return;
    try {
      setSubmitLoading(true);
      const requestId = `replenishment:${locationId}:${entry.itemId}:${entry.targetQty}:${entry.available}`;
      const response = await apiRequest('/api/v1/replenishment-actions/transfer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          requestId,
          sourceLocationId: entry.sourceLocationId,
          destinationLocationId: locationId,
          itemId: entry.itemId,
          quantity: entry.suggestedTransferQty,
        }),
      });
      const refreshed = await apiRequest('/api/v1/transfers/list', { headers: { Authorization: `Bearer ${authToken}` } });
      setTransfers(normalizeTransfers(refreshed.transfers, items, locations));
      showToast(response.duplicate ? 'This replenishment transfer already exists.' : 'FEFO replenishment transfer request created.', 'success');
      navigateTo('transfers');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create replenishment action.', 'error');
    } finally { setSubmitLoading(false); }
  }

  return {
    setLotExpiryDate,
    writeOffExpiryLot,
    setExpiryLotStatus,
    executeReplenishment,
  };
}
