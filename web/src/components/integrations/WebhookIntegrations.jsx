import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  displayDeliveryStatus,
  displayWebhookEvent,
  formatWebhookEvents,
  WEBHOOK_EVENT_OPTIONS,
} from '../../lib/webhook-events';

export function WebhookIntegrations({
  webhookForm,
  setWebhookForm,
  webhooks,
  deliveries,
  newSigningSecret,
  submitLoading,
  onCreate,
  onToggle,
  formatDateTime,
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create outbound webhook</CardTitle>
          <p className="text-xs text-muted-foreground">
            Production endpoints must be public HTTPS. Memory mode also accepts a loopback HTTP receiver for signed delivery tests. Signing secrets are shown once and stored encrypted.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_2fr_1fr_auto]">
          <Input
            value={webhookForm.name}
            onChange={(event) => setWebhookForm({ ...webhookForm, name: event.target.value })}
            placeholder="Integration name"
          />
          <Input
            type="url"
            value={webhookForm.endpointUrl}
            onChange={(event) => setWebhookForm({ ...webhookForm, endpointUrl: event.target.value })}
            placeholder="https://example.com/invexa/events"
          />
          <Select
            value={webhookForm.events[0]}
            onValueChange={(eventName) => setWebhookForm({ ...webhookForm, events: [eventName] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {WEBHOOK_EVENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={onCreate} disabled={submitLoading || !webhookForm.name.trim() || !webhookForm.endpointUrl.trim()}>
            Create
          </Button>
        </CardContent>
      </Card>
      {newSigningSecret && (
        <Alert>
          <AlertDescription>
            <strong>Copy signing secret now:</strong>{' '}
            <code className="break-all select-all">{newSigningSecret}</code>
            <Button className="ml-2" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(newSigningSecret)}>Copy</Button>
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.length ? webhooks.map((subscription) => (
                <TableRow key={subscription.id}>
                  <TableCell className="font-medium">{subscription.name}</TableCell>
                  <TableCell className="max-w-xs truncate">{subscription.endpointUrl}</TableCell>
                  <TableCell>{formatWebhookEvents(subscription.events)}</TableCell>
                  <TableCell>
                    <Badge variant={subscription.status === 'ACTIVE' ? 'success' : 'secondary'}>{subscription.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => onToggle(subscription)}>
                      {subscription.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                    </Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">No outbound integrations configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery log</CardTitle>
          <p className="text-xs text-muted-foreground">Signed POSTs use X-Invexa-Signature (HMAC-SHA256 of the JSON body).</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.length ? deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="font-medium">{displayWebhookEvent(delivery.eventType)}</TableCell>
                  <TableCell>
                    <Badge variant={delivery.status === 'DELIVERED' ? 'success' : delivery.status === 'FAILED' ? 'destructive' : 'secondary'}>
                      {displayDeliveryStatus(delivery.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{delivery.responseCode ?? '—'}</TableCell>
                  <TableCell>{delivery.attemptCount ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(delivery.deliveredAt || delivery.createdAt)}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No deliveries yet. Create a subscription and review a count or update a transfer.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
