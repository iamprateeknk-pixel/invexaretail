import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

export function useWorkspaceIntegrations({
  authToken,
  activeSection,
  setSubmitLoading,
  setModuleWarning,
  showToast,
}) {
  const [webhooks, setWebhooks] = useState([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState([]);
  const [webhookForm, setWebhookForm] = useState({ name: '', endpointUrl: '', events: ['stock.low'] });
  const [newSigningSecret, setNewSigningSecret] = useState('');

  useEffect(() => {
    if (!authToken || activeSection !== 'integrations') return;
    const headers = { Authorization: `Bearer ${authToken}` };
    Promise.all([
      apiRequest('/api/v1/webhook-subscriptions', { headers }),
      apiRequest('/api/v1/webhook-deliveries', { headers }),
    ]).then(([subscriptionResponse, deliveryResponse]) => {
      setWebhooks(subscriptionResponse.subscriptions ?? []);
      setWebhookDeliveries(deliveryResponse.deliveries ?? []);
    }).catch((error) => setModuleWarning(error instanceof Error ? error.message : 'Unable to load advanced module.'));
  }, [activeSection, authToken, setModuleWarning]);

  async function createWebhookSubscription() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/webhook-subscriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify(webhookForm),
      });
      setWebhooks((current) => [response.subscription, ...current]);
      setNewSigningSecret(response.signingSecret);
      setWebhookForm({ name: '', endpointUrl: '', events: ['stock.low'] });
      showToast('Webhook subscription created.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create webhook.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function toggleWebhook(subscription) {
    try {
      const response = await apiRequest(`/api/v1/webhook-subscriptions/${subscription.id}/status`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ status: subscription.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
      });
      setWebhooks((current) => current.map((entry) => entry.id === subscription.id ? response.subscription : entry));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update webhook.', 'error');
    }
  }

  return {
    webhooks,
    webhookDeliveries,
    webhookForm,
    setWebhookForm,
    newSigningSecret,
    createWebhookSubscription,
    toggleWebhook,
  };
}
