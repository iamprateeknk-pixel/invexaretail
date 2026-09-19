import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';
import { emptyReceiptLine, receiptBody } from '../lib/procurement';

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
  const [newSupplier, setNewSupplier] = useState({ name: '', email: '', phone: '', contactName: '', leadTimeDays: '', moq: '', paymentTerms: '', categories: '' });
  // One request id per receiving dialog: every retry of the same receipt carries it.
  const [receiptRequestId, setReceiptRequestId] = useState('');
  const [purchasePlan, setPurchasePlan] = useState(null);
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
      const body = Object.fromEntries(Object.entries(newSupplier).filter(([, value]) => String(value).trim() !== ''));
      const response = await apiRequest('/api/v1/suppliers', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify(body),
      });
      setSuppliers((current) => [...current, response.supplier]);
      setNewSupplier({ name: '', email: '', phone: '', contactName: '', leadTimeDays: '', moq: '', paymentTerms: '', categories: '' });
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

  function openPurchaseReceipt(order) {
    setReceivingPurchaseOrder(order);
    setPurchaseOrderReceipts(Object.fromEntries(order.lines.map((line) => [line.id, emptyReceiptLine()])));
    setReceiptRequestId(`po-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    setModalOpen('receivePurchaseOrder');
  }

  async function receivePurchaseOrder() {
    if (!receivingPurchaseOrder) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/purchase-orders/${receivingPurchaseOrder.id}/receive`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(receiptBody(receivingPurchaseOrder, purchaseOrderReceipts, receiptRequestId)),
      });
      setPurchaseOrders((current) => current.map((order) => order.id === response.purchaseOrder.id ? response.purchaseOrder : order));
      setReceivingPurchaseOrder(null);
      setPurchaseOrderReceipts({});
      setModalOpen(null);
      showToast(response.duplicate ? 'This receipt was already saved; nothing was posted twice.' : 'Purchase order receipt saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to receive purchase order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function changePurchaseOrderStatus(order, status, note) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/purchase-orders/${order.id}/status`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ status, ...(note ? { note } : {}) }),
      });
      setPurchaseOrders((current) => current.map((row) => row.id === order.id ? { ...row, ...response.purchaseOrder } : row));
      showToast(`Purchase order ${status.replaceAll('_', ' ').toLowerCase()}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update the purchase order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function loadPurchasePlan(locationId) {
    try {
      setSubmitLoading(true);
      setPurchasePlan(await apiRequest(`/api/v1/purchase-orders/plan?locationId=${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${authToken}` } }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to build the purchase plan.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function draftFromPlan(group, locationId, supplierId) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/purchase-orders/plan/draft', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ locationId, groups: [{ supplierId: supplierId || group.supplierId, lines: group.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity, unitCost: line.estimatedCost && line.quantity ? line.estimatedCost / line.quantity : 0 })) }] }),
      });
      setPurchaseOrders((current) => [...response.purchaseOrders, ...current]);
      setPurchasePlan((current) => current && { ...current, groups: current.groups.filter((row) => row !== group) });
      showToast('Draft purchase order created from the plan.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create the draft.', 'error');
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
    openPurchaseReceipt,
    changePurchaseOrderStatus,
    purchasePlan,
    loadPurchasePlan,
    draftFromPlan,
  };
}
