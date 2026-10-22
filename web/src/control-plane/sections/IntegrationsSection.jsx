import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { WEBHOOK_EVENT_OPTIONS } from '../../lib/webhook-events';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function IntegrationsSection(props) {
  const { error, setError, integrations, setIntegrations, createdApiKey, setCreatedApiKey, webhookUrl, setWebhookUrl, webhookEvents, setWebhookEvents, createdWebhook, setCreatedWebhook, controlToken, company, refreshLocked } = props;
  return (
    <div className="grid gap-4">
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">API keys & connectors</CardTitle>
        <Button onClick={async () => {
          const key = await controlRequest('/control/v1/integrations/api-keys', { token: controlToken, method: 'POST', body: { name: 'POS', scopes: ['inventory.read'] } });
          setCreatedApiKey(key);
          toast.success(`Key ${key.prefix}… shown once`);
          await refreshLocked();
        }}>Create API key</Button>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {createdApiKey?.token && (
          <Alert>
            <AlertDescription className="grid gap-2">
              <span>Copy this key now. Invexa will not show it again.</span>
              <code className="break-all font-mono text-xs">{createdApiKey.token}</code>
              <Button size="sm" variant="outline" className="w-fit" onClick={async () => {
                try {
                  await globalThis.navigator?.clipboard?.writeText(createdApiKey.token);
                  toast.success('API key copied');
                } catch {
                  toast.message('Copy the key from the box above');
                }
              }}>Copy key</Button>
            </AlertDescription>
          </Alert>
        )}
        <p className="text-muted-foreground">
          Bearer invx_ keys authenticate `/api/v1`. Read keys list catalog; write scopes are required to mutate.
        </p>
        {(integrations?.apiKeys ?? []).map((key) => (
          <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <div className="grid gap-1">
              <span className="font-medium">{key.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{key.prefix}… · {(key.scopes ?? []).join(', ')} · {key.status}</span>
            </div>
            {key.status !== 'revoked' && (
              <Button size="sm" variant="ghost" onClick={async () => {
                await controlRequest(`/control/v1/integrations/api-keys/${key.id}/revoke`, { token: controlToken, method: 'POST' });
                if (createdApiKey?.id === key.id) setCreatedApiKey(null);
                toast.message('API key revoked');
                await refreshLocked().catch((caught) => setError(caught.message));
              }}>Revoke</Button>
            )}
          </div>
        ))}
        <p className="text-muted-foreground">Connectors: {(integrations?.connectors ?? []).length}</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Operational webhooks</CardTitle>
        <Button onClick={async () => {
          try {
            const created = await controlRequest('/control/v1/integrations/webhooks', {
              token: controlToken,
              method: 'POST',
              body: { name: 'Ops hook', url: webhookUrl, events: webhookEvents },
            });
            const webhook = created.webhook ?? created;
            setCreatedWebhook(webhook);
            setIntegrations((current) => ({
              ...(current ?? {}),
              webhooks: [
                ...(current?.webhooks ?? []).filter((hook) => hook.id !== webhook.id),
                {
                  id: webhook.id,
                  name: webhook.name,
                  url: webhook.url,
                  events: webhook.events,
                  status: webhook.status || 'active',
                  createdAt: webhook.createdAt,
                },
              ],
            }));
            toast.success('Webhook registered');
            await refreshLocked().catch((caught) => setError(caught.message));
          } catch (caught) {
            setError(caught.message);
            toast.error(caught.message);
          }
        }}>Create webhook</Button>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="grid gap-2">
          <Label>HTTPS endpoint</Label>
          <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_EVENT_OPTIONS.map((option) => {
            const active = webhookEvents.includes(option.value);
            return (
              <Button
                key={option.value}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => setWebhookEvents((current) => (
                  current.includes(option.value)
                    ? current.filter((event) => event !== option.value)
                    : [...current, option.value]
                ))}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        {createdWebhook?.signingSecret && (
          <Alert>
            <AlertDescription className="grid gap-2">
              <span>Copy this signing secret now. Invexa will not show it again.</span>
              <code className="break-all font-mono text-xs">{createdWebhook.signingSecret}</code>
              <Button size="sm" variant="outline" className="w-fit" onClick={async () => {
                try {
                  await globalThis.navigator?.clipboard?.writeText(createdWebhook.signingSecret);
                  toast.success('Signing secret copied');
                } catch {
                  toast.message('Copy the secret from the box above');
                }
              }}>Copy secret</Button>
            </AlertDescription>
          </Alert>
        )}
        <p className="text-muted-foreground">
          Stock, transfer, PO and count events for this company POST to the HTTPS URL with X-Invexa-Signature.
        </p>
        <p className="font-medium">Registered webhooks ({(integrations?.webhooks ?? []).length})</p>
        {(integrations?.webhooks ?? []).length === 0 && (
          <p className="text-muted-foreground">No operational webhooks for this company yet.</p>
        )}
        {(integrations?.webhooks ?? []).map((hook) => (
          <div key={hook.id} className="rounded-lg border px-3 py-2">
            <p className="font-medium">{hook.name || hook.url}</p>
            <p className="font-mono text-xs text-muted-foreground">{hook.url} · {(hook.events ?? []).join(', ')} · {hook.status}</p>
          </div>
        ))}
      </CardContent>
    </Card>
    </div>
  );
}
