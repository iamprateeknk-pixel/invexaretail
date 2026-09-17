import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceConnectors({
  authToken,
  activeSection,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [connectors, setConnectors] = useState([]);
  const [connectorForm, setConnectorForm] = useState({ name: '', platform: 'AMAZON', webhookSecret: '' });
  const [ingestPayload, setIngestPayload] = useState('{\n  "AmazonOrderId": "111-222",\n  "OrderItems": [{ "SellerSKU": "SKU-1001", "QuantityOrdered": 1 }]\n}');
  const [lastIngest, setLastIngest] = useState(null);

  function loadConnectors() {
    if (!authToken) return;
    apiRequest('/api/v1/connectors', { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setConnectors(response.connectors ?? []))
      .catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load connectors.'));
  }

  useEffect(() => {
    if (!authToken || activeSection !== 'connectors') return;
    loadConnectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken]);

  async function createConnector() {
    if (!connectorForm.name.trim()) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/connectors', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          name: connectorForm.name.trim(),
          platform: connectorForm.platform,
          webhookSecret: connectorForm.webhookSecret.trim() || undefined,
        }),
      });
      setConnectors((current) => [response.connector, ...current]);
      setConnectorForm({ name: '', platform: 'AMAZON', webhookSecret: '' });
      showToast('Connector created. Point Amazon/Flipkart/website webhooks at the ingest URL.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create connector.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  async function ingestConnector(connectorId) {
    try {
      setSubmitLoading(true);
      const payload = JSON.parse(ingestPayload);
      const response = await apiRequest(`/api/v1/connectors/${connectorId}/ingest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(payload),
      });
      setLastIngest(response);
      loadConnectors();
      const created = response.orders?.length ?? 0;
      showToast(created ? `Ingested ${created} marketplace order(s) into Invexa OMS.` : 'No orders were reserved.', created ? 'success' : 'warning');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to ingest marketplace order.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  return {
    connectors, connectorForm, setConnectorForm, ingestPayload, setIngestPayload,
    lastIngest, createConnector, ingestConnector, refreshConnectors: loadConnectors,
  };
}
