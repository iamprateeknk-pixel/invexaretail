import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceProcurement({
  authToken,
  activeSection,
  setLoading,
  setSubmitLoading,
  setModalOpen,
  setModuleWarning,
  showToast,
}) {
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receivingPurchaseOrder, setReceivingPurchaseOrder] = useState(null);
  const [purchaseOrderReceipts, setPurchaseOrderReceipts] = useState({});
  const [newSupplier, setNewSupplier] = useState({ name: '', email: '', phone: '' });
  const [purchaseOrderForm, setPurchaseOrderForm] = useState({ supplierId: '', locationId: '', itemId: '', quantity: 1, unitCost: 0, expectedAt: '', notes: '' });

  useEffect(() => {
    if (!authToken || activeSection !== 'purchase-orders') return;
    const headers = { Authorization: `Bearer ${authToken}` };
    setLoading(true);
    Promise.all([apiRequest('/api/v1/suppliers', { headers }), apiRequest('/api/v1/purchase-orders', { headers })])
      .then(([supplierResponse, orderResponse]) => {
        setSuppliers(supplierResponse.suppliers ?? []);
        setPurchaseOrders(orderResponse.purchaseOrders ?? []);
      })
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load module.'))
      .finally(() => setLoading(false));
  }, [activeSection, authToken, setLoading, setModuleWarning]);

  async function createSupplier() {
    if (!newSupplier.name.trim()) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/suppliers', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify(newSupplier),
      });
      setSuppliers((current) => [...current, response.supplier]);
      setNewSupplier({ name: '', email: '', phone: '' });
      showToast('Supplier created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create supplier.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function createPurchaseOrder() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/purchase-orders', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          supplierId: purchaseOrderForm.supplierId,
          locationId: purchaseOrderForm.locationId,
          expectedAt: purchaseOrderForm.expectedAt || undefined,
          notes: purchaseOrderForm.notes || undefined,
          lines: [{ itemId: purchaseOrderForm.itemId, quantity: Number(purchaseOrderForm.quantity), unitCost: Number(purchaseOrderForm.unitCost) }],
        }),
      });
      setPurchaseOrders((current) => [response.purchaseOrder, ...current]);
      setPurchaseOrderForm((current) => ({ ...current, quantity: 1, unitCost: 0, notes: '' }));
      showToast('Purchase order created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create purchase order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function receivePurchaseOrder() {
    if (!receivingPurchaseOrder) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/purchase-orders/${receivingPurchaseOrder.id}/receive`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ lines: receivingPurchaseOrder.lines.map((line) => ({ lineId: line.id, receivedQty: Number(purchaseOrderReceipts[line.id] ?? 0) })) }),
      });
      setPurchaseOrders((current) => current.map((order) => order.id === response.purchaseOrder.id ? response.purchaseOrder : order));
      setReceivingPurchaseOrder(null);
      setPurchaseOrderReceipts({});
      setModalOpen(null);
      showToast('Purchase order receipt saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to receive purchase order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  return {
    suppliers,
    purchaseOrders,
    receivingPurchaseOrder,
    setReceivingPurchaseOrder,
    purchaseOrderReceipts,
    setPurchaseOrderReceipts,
    newSupplier,
    setNewSupplier,
    purchaseOrderForm,
    setPurchaseOrderForm,
    createSupplier,
    createPurchaseOrder,
    receivePurchaseOrder,
  };
}
