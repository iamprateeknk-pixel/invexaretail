import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback-states'

const money = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const pct = (value) => (value === null || value === undefined ? '—' : `${value}%`);
const STATUS_TEXT = { DEAD: 'Dead (no sales)', SLOW: 'Slow (over 180 days of cover)', HEALTHY: 'Healthy', NO_DATA: 'No sales data', NO_STOCK: 'No stock' };

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Presentational: takes the three report payloads and renders them as text and tables, so status is
// never conveyed by colour alone (audit O-5/C-3). Data fetching lives in useInventoryHealth.
export function InventoryHealthPanel({ health, accuracy, reasons = [] }) {
  if (!health) return null;
  const { valuation, service } = health;
  const attention = health.items.filter((item) => item.status === 'DEAD' || item.status === 'SLOW').slice(0, 15);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Stock value and turns</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Stock value" value={money(valuation.totalValue)} hint={valuation.unvaluedUnits > 0 ? `${valuation.unvaluedUnits} units have no recorded cost and are not valued` : undefined} />
            <Stat label="Inventory turns (annualised)" value={health.turns ?? '—'} hint={health.turns === null ? 'Needs sales in the window' : undefined} />
            <Stat label="Days of inventory" value={health.daysOfInventory ?? '—'} />
            <Stat label="Order fill rate" value={pct(service?.orderFillRatePercent)} hint={service ? `${service.orders} decided orders, unit fill ${pct(service.unitFillRatePercent)}` : undefined} />
          </dl>
          {health.note && <p className="mt-3 text-sm text-muted-foreground">{health.note}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Stock ageing</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <caption className="sr-only">Stock value and units by how long the lot has been held</caption>
            <thead><tr className="text-left text-muted-foreground"><th scope="col">Held for</th><th scope="col">Units</th><th scope="col">Value</th></tr></thead>
            <tbody>{health.ageing.map((row) => <tr key={row.bucket}><th scope="row" className="font-normal">{row.bucket} days</th><td>{row.units}</td><td>{money(row.value)}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Dead and slow stock</CardTitle></CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <EmptyState title="No dead or slow stock" description="Every item with stock is selling within 180 days of cover, or there is no sales data yet." />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Items that are not selling</caption>
              <thead><tr className="text-left text-muted-foreground"><th scope="col">Item</th><th scope="col">On hand</th><th scope="col">Value</th><th scope="col">Days of cover</th><th scope="col">Status</th></tr></thead>
              <tbody>{attention.map((item) => (
                <tr key={item.itemId}><th scope="row" className="font-normal">{item.code} · {item.name}</th><td>{item.onHand}</td><td>{money(item.value)}</td><td>{item.daysOfCover ?? '—'}</td><td>{STATUS_TEXT[item.status]}</td></tr>
              ))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {accuracy && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Count accuracy</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat label="Counts within tolerance" value={pct(accuracy.accuracyPercent)} hint={`${accuracy.withinTolerance} of ${accuracy.counts} counts`} />
              <Stat label="Accuracy by value" value={pct(accuracy.valueAccuracyPercent)} />
              <Stat label="Variance value" value={money(accuracy.varianceValue)} />
            </dl>
            {accuracy.byClass && Object.keys(accuracy.byClass).length > 0 && (
              <ul className="mt-3 text-sm">
                {Object.entries(accuracy.byClass).map(([abcClass, row]) => <li key={abcClass}>Class {abcClass}: {pct(row.accuracyPercent)} within tolerance ({row.counts} counts)</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Variance root causes</CardTitle></CardHeader>
        <CardContent>
          {reasons.length === 0 ? (
            <EmptyState title="No variances in this period" />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Count variances grouped by root-cause code</caption>
              <thead><tr className="text-left text-muted-foreground"><th scope="col">Cause</th><th scope="col">Counts</th><th scope="col">Units off</th><th scope="col">Net units</th></tr></thead>
              <tbody>{reasons.map((row) => <tr key={row.reasonCode}><th scope="row" className="font-normal">{row.reasonCode === 'UNCODED' ? 'No cause recorded' : row.reasonCode.replaceAll('_', ' ').toLowerCase()}</th><td>{row.counts}</td><td>{row.absoluteUnits}</td><td>{row.netUnits}</td></tr>)}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
