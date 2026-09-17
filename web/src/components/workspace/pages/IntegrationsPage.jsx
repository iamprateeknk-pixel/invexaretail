import { WebhookIntegrations } from '../../integrations/WebhookIntegrations';
import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';

export function IntegrationsPage() {
  const {
        webhookForm, setWebhookForm, webhooks, webhookDeliveries, newSigningSecret, submitLoading,
    createWebhookSubscription, toggleWebhook,
  } = useWorkspace();
  return (
    <WebhookIntegrations
      webhookForm={webhookForm}
      setWebhookForm={setWebhookForm}
      webhooks={webhooks}
      deliveries={webhookDeliveries}
      newSigningSecret={newSigningSecret}
      submitLoading={submitLoading}
      onCreate={createWebhookSubscription}
      onToggle={toggleWebhook}
      formatDateTime={formatDateTime}
    />
  );
}
