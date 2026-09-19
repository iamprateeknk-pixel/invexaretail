import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import { dayStatusMeta, localDate, shiftDate, syncHeadline } from '../../lib/import-center';
import { formatDateTime } from '../../lib/workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const TIMEZONE = 'Asia/Kolkata';

function SourceTable({ title, source, emptyHint }) {
  const meta = dayStatusMeta(source.status);
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>
      {source.branches.length ? (
        <div className="divide-y">
          {source.branches.map((row) => {
            const rowMeta = dayStatusMeta(row.status);
            return (
              <div key={row.locationId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{row.locationName}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.movements ? `${row.movements} movement${row.movements === 1 ? '' : 's'} · last ${formatDateTime(row.lastTransactionAt)}` : 'No file for this day'}
                    {row.rejectedRows ? ` · ${row.rejectedRows} rejected row${row.rejectedRows === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <Badge variant={rowMeta.variant}>{rowMeta.label}</Badge>
              </div>
            );
          })}
        </div>
      ) : <p className="p-3 text-xs text-muted-foreground">{emptyHint}</p>}
      {source.unattributedRejectedRows > 0 && (
        <p className="border-t p-3 text-xs text-destructive">{source.unattributedRejectedRows} row(s) were rejected for an unknown branch or item - fix the file and upload again.</p>
      )}
    </div>
  );
}

export function ImportControlCenter({ token, itemsById, locationsById, refreshKey }) {
  const [date, setDate] = useState(() => localDate(new Date(), TIMEZONE));
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState({});
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    apiRequest(`/api/v1/imports/control-center?date=${date}&timezone=${encodeURIComponent(TIMEZONE)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) { setReport(response); setError(''); } })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Import status is unavailable.'); });
  }, [token, date, refreshKey, revision]);

  async function resolve(count) {
    const note = String(notes[count.id] ?? '').trim();
    if (note.length < 5) { setError('Add a resolution note of at least 5 characters.'); return; }
    setBusyId(count.id); setError('');
    try {
      await apiRequest(`/api/v1/stock-counts/${count.id}/reconciliation/ack`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ note }) });
      if (mounted.current) setRevision((value) => value + 1);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to resolve the flag.');
    } finally {
      if (mounted.current) setBusyId('');
    }
  }

  const today = localDate(new Date(), TIMEZONE);
  const reconciliation = report?.reconciliation;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Import control center</CardTitle>
          <p className="text-xs text-muted-foreground">Is each branch&apos;s sales and purchase file in? Check this before relying on stock accuracy.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">&lsaquo;</Button>
          <Input type="date" className="h-8 w-40" value={date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} aria-label="Day" />
          <Button size="sm" variant="outline" disabled={date >= today} onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">&rsaquo;</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
        {!report ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading import status…</p> : (
          <>
            <p className="text-sm font-medium">{syncHeadline(report)}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <SourceTable title="Sales" source={report.sales} emptyHint="No stores to report on." />
              <SourceTable title="Purchases" source={report.purchases} emptyHint="No purchase file uploaded for this day." />
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b p-3">
                <div>
                  <p className="text-sm font-medium">Counts needing reconciliation</p>
                  <p className="text-xs text-muted-foreground">A sales or purchase file arrived after a count but holds movements dated before it, so that count&apos;s book quantity was out of date.</p>
                </div>
                <Badge variant={reconciliation?.required ? 'warning' : 'success'}>{reconciliation?.required ?? 0}</Badge>
              </div>
              {reconciliation?.counts?.length ? (
                <div className="divide-y">
                  {reconciliation.counts.map((count) => (
                    <div key={count.id} className="grid gap-2 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {itemsById?.get(count.itemId)?.name ?? count.itemId}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{locationsById?.get(count.locationId)?.name ?? count.locationId} · {String(count.status ?? '').replace('_', ' ').toLowerCase()}</span>
                        </p>
                        <span className="text-xs text-muted-foreground">
                          late movements {count.lateDelta > 0 ? '+' : ''}{count.lateDelta}
                          {count.bookQtyOriginal !== undefined && count.bookQtyOriginal !== null ? ` · book ${count.bookQtyOriginal} → ${count.bookQty}` : ''}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{count.note}</p>
                      <div className="flex flex-wrap gap-2">
                        <Input className="h-8 max-w-sm" placeholder="Resolution note (required)" value={notes[count.id] ?? ''} onChange={(event) => setNotes({ ...notes, [count.id]: event.target.value })} aria-label="Resolution note" />
                        <Button size="sm" disabled={busyId === count.id} onClick={() => resolve(count)}>Mark resolved</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="p-3 text-xs text-muted-foreground">Nothing to reconcile - every count matches the movements imported so far.</p>}
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Synced through (latest checkpoint per branch)</summary>
              <div className="mt-2 divide-y rounded-lg border">
                {report.checkpoints.map((row) => (
                  <div key={row.locationId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-medium">{row.locationName}</span>
                    <span className="text-xs text-muted-foreground">Sales {row.salesSyncedThrough ? formatDateTime(row.salesSyncedThrough) : 'never'} · Purchases {row.purchaseSyncedThrough ? formatDateTime(row.purchaseSyncedThrough) : 'never'}</span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
