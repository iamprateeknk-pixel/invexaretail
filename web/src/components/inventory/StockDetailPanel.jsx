import { useStockDetail } from '@/hooks/useStockDetail'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/feedback-states'
import { formatDateTime } from '@/lib/workspace'

// Week 10: branch balance, lot/expiry, movement history and reconciliation
// status - all read from lib/stock-detail-service.ts's canonical
// journal/projection read model (ADR-001), not a client-side running total.
export function StockDetailPanel({ authToken, itemId, onReverse, reversing }) {
  const { detail, loading, error, refetch } = useStockDetail({ authToken, itemId });

  if (loading && !detail) return <LoadingState label="Loading stock detail…" />;
  if (error) return <ErrorState description={error} onRetry={refetch} />;
  if (!detail) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{detail.itemName}</h2>
        <p className="text-sm text-muted-foreground">{detail.itemCode}</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Branch balances</CardTitle></CardHeader>
        <CardContent>
          {detail.branches.length === 0 ? (
            <EmptyState title="No stock recorded at any location yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Location</th>
                  <th className="py-1 font-medium">On hand</th>
                  <th className="py-1 font-medium">Reserved</th>
                  <th className="py-1 font-medium">Available</th>
                </tr>
              </thead>
              <tbody>
                {detail.branches.map((branch) => (
                  <tr key={branch.locationId} className="border-t">
                    <td className="py-1">{branch.locationName}</td>
                    <td className="py-1">{branch.onHand}</td>
                    <td className="py-1">{branch.reserved}</td>
                    <td className="py-1">{branch.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Lots</CardTitle></CardHeader>
        <CardContent>
          {detail.lots.length === 0 ? (
            <EmptyState title="No lots recorded for this item" />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {detail.lots.map((lot) => (
                <li key={lot.lotId} className="flex items-center justify-between border-t py-1 first:border-t-0">
                  <span>{lot.lotNo}</span>
                  <span className="text-muted-foreground">{lot.expiryDate ? formatDateTime(lot.expiryDate) : 'No expiry'}</span>
                  <Badge variant={lot.status === 'AVAILABLE' ? 'success' : 'warning'}>{lot.status}</Badge>
                  <span>{lot.totalOnHand} on hand</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Movement journal</CardTitle></CardHeader>
        <CardContent>
          {detail.movements.length === 0 ? (
            <EmptyState title="No movements posted yet" description="Adjustments and other postings will appear here." />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {detail.movements.map((movement) => (
                <li key={movement.id} className="flex items-center justify-between border-t py-2 first:border-t-0">
                  <div>
                    <p className="font-medium">{movement.movementType} {movement.qtyDelta > 0 ? `+${movement.qtyDelta}` : movement.qtyDelta}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(movement.timestamp)} · {movement.reason ?? 'No reason recorded'}</p>
                  </div>
                  {movement.reversalOf ? (
                    <Badge variant="secondary">Reversal</Badge>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                      disabled={reversing}
                      onClick={() => onReverse?.(movement.id).then(() => refetch())}
                    >
                      Reverse
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Reconciliation status</CardTitle></CardHeader>
        <CardContent>
          {detail.reconciliation.length === 0 ? (
            <EmptyState title="Nothing to reconcile yet" />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {detail.reconciliation.map((row, index) => (
                <li key={index} className="flex items-center justify-between border-t py-1 first:border-t-0">
                  <span>On hand {row.onHand}, journal sum {row.journalSum}</span>
                  <Badge variant={row.explained ? 'success' : 'destructive'}>{row.explained ? 'Explained' : `Delta ${row.delta}`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
