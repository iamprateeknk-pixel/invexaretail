import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

// Blueprint Module G / section 13.3 (OMS & Allocation) - P7 starter.
export function useWorkspaceOrders({
  authToken,
  activeSection,
  locationId,
  setSubmitLoading,
  showToast,
}) {
  const [orders, setOrders] = useState([]);
  const [orderForm, setOrderForm] = useState({ channel: 'WEBSTORE', customerName: '', itemId: '', quantity: 1, autoRoute: true, fulfillmentLocationId: '', allowBackorder: false, allowSplit: true, customerLatitude: '', customerLongitude: '' });

  function loadOrders() {
    if (!authToken) return;
    apiRequest(`/api/v1/orders?locationId=${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setOrders(response.orders ?? []))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!authToken || activeSection !== 'orders') return;
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken, locationId]);

  async function createOrder() {
    if (!orderForm.itemId || !Number(orderForm.quantity)) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/orders', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          channel: orderForm.channel,
          customerName: orderForm.customerName || undefined,
          // Omit fulfillmentLocationId to let the server route across every
          // active location (blueprint §13.3); only send it to override.
          fulfillmentLocationId: orderForm.autoRoute ? undefined : (orderForm.fulfillmentLocationId || locationId),
          // Backorder only applies to an explicit location - combining it
          // with auto-routing is the split-fulfilment question, still out
          // of scope (see orders.ts).
          allowBackorder: !orderForm.autoRoute && orderForm.allowBackorder,
          allowSplit: orderForm.autoRoute && orderForm.allowSplit !== false,
          customerLatitude: orderForm.customerLatitude ? Number(orderForm.customerLatitude) : undefined,
          customerLongitude: orderForm.customerLongitude ? Number(orderForm.customerLongitude) : undefined,
          lines: [{ itemId: orderForm.itemId, quantity: Number(orderForm.quantity) }],
        }),
      });
      setOrders((current) => [response.order, ...current]);
      setOrderForm((current) => ({ ...current, itemId: '', quantity: 1 }));
      const backordered = response.order?.status === 'BACKORDERED';
      showToast(
        backordered
          ? `Order partially reserved - remainder backordered${response.order?.fulfillmentLocation?.name ? ` at ${response.order.fulfillmentLocation.name}` : ''}.`
          : `Order reserved${response.order?.fulfillmentLocation?.name ? ` at ${response.order.fulfillmentLocation.name}` : ''}.`,
        backordered ? 'warning' : 'success',
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function fulfillOrder(orderId) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/orders/${orderId}/fulfill`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
      setOrders((current) => current.map((order) => order.id === orderId ? response.order : order));
      showToast('Order fulfilled and stock deducted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to fulfill order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function retryBackorder(orderId) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/orders/${orderId}/retry-backorder`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
      setOrders((current) => current.map((order) => order.id === orderId ? response.order : order));
      showToast(response.order?.status === 'RESERVED' ? 'Backorder fully filled - order is now reserved.' : 'No new stock available yet for this backorder.', response.order?.status === 'RESERVED' ? 'success' : 'warning');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to retry backorder.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function cancelOrder(orderId) {
    try {
      setSubmitLoading(true);
      const response = await apiRequest(`/api/v1/orders/${orderId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
      setOrders((current) => current.map((order) => order.id === orderId ? response.order : order));
      showToast('Order cancelled and reservation released.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to cancel order.', 'error');
    } finally { setSubmitLoading(false); }
  }

  return { orders, orderForm, setOrderForm, createOrder, fulfillOrder, cancelOrder, retryBackorder };
}
