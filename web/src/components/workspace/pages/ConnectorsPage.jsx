import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plug } from 'lucide-react';

const PLATFORMS = ['AMAZON', 'FLIPKART', 'WEBSITE', 'CUSTOM'];

export function ConnectorsPage() {
  const {
    connectors, connectorForm, setConnectorForm, ingestPayload, setIngestPayload,
    lastIngest, createConnector, ingestConnector, submitLoading,
  } = useWorkspace();
  const { session } = useWorkspace();
  const view = useTableView(connectors, (connector) => [connector.name, connector.platform, connector.id]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a marketplace connector</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each connector maps Amazon, Flipkart or website payloads onto Invexa&apos;s order schema and POSTs them through the same ATP reservation as a store order.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Connector name" value={connectorForm.name} onChange={(event) => setConnectorForm({ ...connectorForm, name: event.target.value })} />
          <Select value={connectorForm.platform} onValueChange={(platform) => setConnectorForm({ ...connectorForm, platform })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PLATFORMS.map((platform) => <SelectItem key={platform} value={platform}>{platform}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Webhook secret (optional)" value={connectorForm.webhookSecret} onChange={(event) => setConnectorForm({ ...connectorForm, webhookSecret: event.target.value })} />
          <Button disabled={submitLoading || !connectorForm.name.trim()} onClick={createConnector}><Plug className="size-4" />Create connector</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingest a sample order</CardTitle>
          <p className="text-xs text-muted-foreground">Paste a platform payload and push it through a connector. Signed marketplace webhooks also POST to `/api/v1/webhooks/marketplaces/:id` with `X-Invexa-Signature`.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={8} value={ingestPayload} onChange={(event) => setIngestPayload(event.target.value)} />
          {lastIngest?.errors?.length ? <p className="text-xs text-destructive">{lastIngest.errors.map((row) => row.message).join(' · ')}</p> : null}
        </CardContent>
      </Card>

      <TableToolbar tableId="connectors" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search connectors" />

      <Card>
        <CardHeader><CardTitle className="text-base">Connectors</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {view.visible.length ? view.visible.map((connector) => (
            <div key={connector.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border ${view.rowPadding}`}>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{connector.name}</p>
                  <Badge variant="outline">{connector.platform}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Webhook `/api/v1/webhooks/marketplaces/{connector.id}` · Last ingest {formatDateTime(connector.lastIngestedAt)}
                </p>
                {connector.webhookSecret ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">Secret {connector.webhookSecret}</p> : null}
              </div>
              <Button size="sm" disabled={submitLoading} onClick={() => ingestConnector(connector.id)}>Ingest sample</Button>
            </div>
          )) : <p className="py-12 text-center text-sm text-muted-foreground">No connectors yet. Create one to start posting marketplace orders into Invexa.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
