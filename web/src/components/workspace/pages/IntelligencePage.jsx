import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, Sparkles } from 'lucide-react';

function ActionList({ title, empty, items, canAct, submitLoading, onDismiss }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.length ? items.map((entry) => (
          <div key={`${entry.type}-${entry.itemId}-${entry.lotId || entry.destinationLocationId || ''}`} className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{entry.itemName}</p>
              <p className="text-xs text-muted-foreground">{entry.reason}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={entry.risk === 'CRITICAL' ? 'destructive' : entry.risk === 'HIGH' ? 'warning' : 'secondary'}>{entry.suggestedAction}</Badge>
              {canAct && <Button size="sm" variant="ghost" disabled={submitLoading} onClick={() => onDismiss(entry)}>Dismiss</Button>}
            </div>
          </div>
        )) : <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}

export function IntelligencePage() {
  const {
    intelligence, role, submitLoading, executeReplenishment, dismissIntelligenceRecommendation,
  } = useWorkspace();
  const recommendations = intelligence?.recommendations ?? [];
  const anomalies = intelligence?.anomalies ?? [];
  const lotBlocks = intelligence?.lotBlocks ?? [];
  const expiryActions = intelligence?.expiryActions ?? [];
  const overstock = intelligence?.overstock ?? [];
  const canAct = ['ADMIN', 'ADMIN_USER'].includes(role);
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background">
        <CardContent className="flex gap-4 p-6">
          <div className="rounded-xl bg-primary p-3 text-primary-foreground"><Sparkles className="size-6" /></div>
          <div>
            <p className="text-sm font-semibold text-primary">Executive summary</p>
            <p className="mt-1 text-lg font-semibold leading-relaxed">{intelligence?.executiveSummary ?? 'Generating inventory summary…'}</p>
            <p className="mt-2 text-xs text-muted-foreground">Rule-based, explainable recommendations · Updated {formatDateTime(intelligence?.generatedAt)}</p>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Smart reorder queue</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Suggested</TableHead>
                  <TableHead>Action / source</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recommendations.length ? recommendations.map((entry) => (
                  <TableRow key={entry.itemId}>
                    <TableCell className="font-medium">{entry.itemName}</TableCell>
                    <TableCell>{entry.available}</TableCell>
                    <TableCell>{entry.targetQty}</TableCell>
                    <TableCell className="font-semibold">{entry.suggestedOrderQty}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={entry.suggestedAction === 'PURCHASE' ? 'warning' : entry.suggestedAction === 'TRANSFER' ? 'default' : 'secondary'}>{entry.suggestedAction}</Badge>
                        <p className="max-w-52 text-xs text-muted-foreground">{entry.suggestedAction === 'TRANSFER' ? `${entry.suggestedTransferQty} from ${entry.sourceLocationName || entry.sourceLocationId}` : entry.actionReason}</p>
                        {canAct && (
                          <div className="mt-2 flex gap-2">
                            {entry.suggestedAction !== 'NONE' && <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => executeReplenishment(entry)}>{entry.suggestedAction === 'TRANSFER' ? 'Create transfer' : 'Prepare PO'}</Button>}
                            <Button size="sm" variant="ghost" disabled={submitLoading} onClick={() => dismissIntelligenceRecommendation({ type: 'REPLENISHMENT', itemId: entry.itemId })}>Dismiss</Button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={entry.risk === 'CRITICAL' ? 'destructive' : entry.risk === 'HIGH' ? 'warning' : 'success'}>{entry.risk}</Badge></TableCell>
                    <TableCell>{entry.confidence}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">Configure reorder rules to generate recommendations.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Variance anomalies</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {anomalies.length ? anomalies.map((entry) => (
              <div key={entry.countId} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{entry.itemName}</p>
                  <p className="text-xs text-muted-foreground">Book {entry.bookQty} · Physical {entry.physicalQty}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={entry.variance < 0 ? 'destructive' : 'warning'}>{entry.variance > 0 ? '+' : ''}{entry.variance}</Badge>
                  {canAct && <Button size="sm" variant="ghost" disabled={submitLoading} onClick={() => dismissIntelligenceRecommendation({ type: 'ANOMALY', itemId: entry.itemId, countId: entry.countId })}>Dismiss</Button>}
                </div>
              </div>
            )) : (
              <div className="py-14 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="mx-auto mb-3 size-8 text-emerald-500" />No material count anomalies in the last 90 days.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <ActionList
          title="Lot blocking"
          empty="No lots need blocking."
          items={lotBlocks}
          canAct={canAct}
          submitLoading={submitLoading}
          onDismiss={(entry) => dismissIntelligenceRecommendation({ type: 'LOT_BLOCK', itemId: entry.itemId })}
        />
        <ActionList
          title="Expiry actions"
          empty="No near-expiry write-off or markdown actions."
          items={expiryActions}
          canAct={canAct}
          submitLoading={submitLoading}
          onDismiss={(entry) => dismissIntelligenceRecommendation({ type: 'EXPIRY', itemId: entry.itemId })}
        />
        <ActionList
          title="Overstock redistribution"
          empty="No surplus to move to a short location."
          items={overstock}
          canAct={canAct}
          submitLoading={submitLoading}
          onDismiss={(entry) => dismissIntelligenceRecommendation({ type: 'OVERSTOCK', itemId: entry.itemId })}
        />
      </div>
    </div>
  );
}
