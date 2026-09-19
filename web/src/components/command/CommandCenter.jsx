import { useEffect, useRef, useState } from 'react';
import { API_BASE, apiRequest } from '../../lib/api-client';
import { HEALTH, SEVERITY, ageLabel, attentionTarget, auditExportPath, heatClass, pulseBars, shortDay } from '../../lib/command-center';
import { formatDateTime } from '../../lib/workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function Bars({ pulse, field, label }) {
  const bars = pulseBars(pulse, field);
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`${label}: ${bars.map((bar) => bar.value).join(', ')}`}>
        {bars.map((bar) => <div key={bar.day} title={`${bar.day}: ${bar.value}`} className="flex-1 rounded-t bg-emerald-500/70" style={{ height: `${Math.max(bar.height, bar.value ? 8 : 2)}%` }} />)}
      </div>
    </div>
  );
}

// Blueprint v4 §29: what needs attention, is stock in sync, which branch is
// behind, what is moving, what is blocked, how the team is doing, what changed.
export default function CommandCenter({ token, liveRevision, locationsById }) {
  const [data, setData] = useState(null);
  const [reports, setReports] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Live events bump liveRevision, so the numbers follow the work without a refresh button.
  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      apiRequest('/api/v1/command-center', { headers }),
      apiRequest('/api/v1/reports/transfer-cycle', { headers }).catch(() => null),
      apiRequest('/api/v1/reports/count-accuracy?groupBy=branch', { headers }).catch(() => null),
      // Admin-only; everyone else simply does not get the panel.
      apiRequest('/api/v1/ops/metrics', { headers }).catch(() => null),
    ]).then(([center, cycle, accuracy, metrics]) => {
      if (!mounted.current) return;
      setData(center.commandCenter); setReports({ cycle: cycle?.report, accuracy: accuracy?.rows ?? [] }); setHealth(metrics); setError('');
    }).catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'The command center is unavailable.'); });
  }, [token, liveRevision]);

  async function exportAudit() {
    setExporting(true);
    try {
      const response = await fetch(`${API_BASE}${auditExportPath()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('The audit export could not be created.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = 'audit-export.csv'; link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'The audit export failed.');
    } finally { if (mounted.current) setExporting(false); }
  }

  if (error && !data) return <div role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</div>;
  if (!data) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading the command center…</p>;

  const nameOf = (id) => locationsById?.get(id)?.name ?? id;
  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Needs attention now</CardTitle>
          <span className="text-xs text-muted-foreground">{data.sync.liveClients} live connection{data.sync.liveClients === 1 ? '' : 's'} · {data.sync.staleBranches} of {data.sync.totalBranches} branches behind on sales</span>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.attention.length ? data.attention.map((row) => (
            <a key={row.key} href={attentionTarget(row.section)} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50">
              <span className="flex items-center gap-2"><Badge variant={SEVERITY[row.severity].variant}>{SEVERITY[row.severity].label}</Badge>{row.title}</span>
              <span className="text-lg font-semibold">{row.count}</span>
            </a>
          )) : <p className="text-sm text-muted-foreground">Nothing is blocked or overdue. </p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Branch health</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.branchHealth.map((branch) => (
            <div key={branch.locationId} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><p className="font-medium">{branch.name}</p><Badge variant={HEALTH[branch.status].variant}>{HEALTH[branch.status].label}</Badge></div>
              <p className="mt-1 text-xs text-muted-foreground">{branch.salesSyncedAgeHours === null ? 'No sales file yet' : `Sales ${ageLabel(branch.salesSyncedAgeHours)} old`} · {branch.purchaseSyncedAgeHours === null ? 'no purchase file yet' : `purchases ${ageLabel(branch.purchaseSyncedAgeHours)} old`}</p>
              <p className="text-xs text-muted-foreground">{branch.openAssignments} open counts · {branch.pendingReview} awaiting review{branch.countAccuracy7d !== null ? ` · ${branch.countAccuracy7d}% accurate (7d)` : ''}</p>
              {branch.reasons.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">{branch.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">What is moving (7 days)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Bars pulse={data.pulse} field="countsSubmitted" label="Counts submitted" />
            <Bars pulse={data.pulse} field="transfersCreated" label="Transfers requested" />
            <Bars pulse={data.pulse} field="transfersDispatched" label="Transfers dispatched" />
            <Bars pulse={data.pulse} field="receipts" label="Receipts posted" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">What is blocked</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Transfers stuck', data.blocked.stuckTransfers],
              ['Counts awaiting review', data.blocked.countsAwaitingReview],
              ['Needing reconciliation', data.blocked.reconciliation],
              ['Approvals waiting', data.blocked.approvals ?? '-'],
              ['Open exceptions', data.blocked.exceptions?.open ?? '-'],
              ['Past their SLA', data.blocked.exceptions?.overdue ?? '-'],
            ].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}
          </CardContent>
        </Card>
      </div>

      {data.stuckTransfers.rows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Stuck transfers</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {data.stuckTransfers.rows.map((row) => (
              <div key={row.transferId} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                <span><span className="font-medium">{row.transferId}</span> <span className="text-muted-foreground">{nameOf(row.from)} to {nameOf(row.to)}</span></span>
                <span className="flex items-center gap-2"><Badge variant="outline">{row.stage.replaceAll('_', ' ').toLowerCase()}</Badge><span className="text-xs text-muted-foreground">{row.pastPromise ? 'past its promised arrival' : `${Math.round(row.ageHours)}h, limit ${row.limitHours}h`}</span></span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.heatmap.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Count work by branch and day</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.heatmap.map((row) => (
              <div key={row.locationId} className="flex items-center gap-3">
                <p className="w-36 truncate text-sm">{row.name}</p>
                <div className="flex flex-1 gap-1">{row.days.map((cell) => <div key={cell.day} title={`${cell.day}: ${cell.total ? `${cell.done} of ${cell.total} counted` : 'no count work'}`} className={`flex h-8 flex-1 items-center justify-center rounded text-[10px] ${heatClass(cell.ratio)}`}>{shortDay(cell.day)}</div>)}</div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Green: finished. Amber: started. Red: nothing counted yet. Grey: no count planned.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Team (7 days)</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {data.team.length ? data.team.map((person) => (
              <div key={person.userId} className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm">
                <span className="font-medium">{person.name}</span>
                <span className="text-xs text-muted-foreground">{person.counts} counts · {person.recountRate}% recount · {person.receipts} receipts · {person.cartons} cartons</span>
              </div>
            )) : <p className="px-6 py-4 text-sm text-muted-foreground">No activity this week.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">What changed</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {data.recent.length ? data.recent.map((event, index) => (
              <div key={`${event.at}-${index}`} className="px-6 py-2 text-sm">
                <p><span className="font-medium">{event.actor}</span> <span className="text-muted-foreground">{event.action.replaceAll('_', ' ').toLowerCase()}</span></p>
                <p className="text-xs text-muted-foreground">{event.entityType} {event.entityId} · {formatDateTime(event.at)}</p>
              </div>
            )) : <p className="px-6 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>}
          </CardContent>
        </Card>
      </div>

      {health && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between space-y-0">
            <CardTitle className="text-base">System health</CardTitle>
            <span className="text-xs text-muted-foreground">up {Math.round(health.api.uptimeSeconds / 60)} min · {health.api.totalRequests} requests · {health.api.serverErrors} server errors · {health.process.rssMb} MB · {health.database.connected ? 'database connected' : 'memory mode'}</span>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">Slowest routes (95th percentile)</p>
              {health.api.slowest.slice(0, 5).map((row) => <div key={`${row.method} ${row.route}`} className="flex justify-between border-b py-1.5 text-xs last:border-0"><span className="truncate">{row.method} {row.route}</span><span className="text-muted-foreground">{row.p95Ms} ms · {row.count} calls</span></div>)}
              {!health.api.slowest.length && <p className="text-xs text-muted-foreground">No traffic recorded yet.</p>}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Routes failing with server errors</p>
              {health.api.failing.slice(0, 5).map((row) => <div key={`${row.method} ${row.route}`} className="flex justify-between border-b py-1.5 text-xs last:border-0"><span className="truncate">{row.method} {row.route}</span><span className="text-destructive">{row.serverErrors} ({row.errorRatePercent}%)</span></div>)}
              {!health.api.failing.length && <p className="text-xs text-muted-foreground">None.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {reports && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Reports</CardTitle>
            <Button size="sm" variant="outline" disabled={exporting} onClick={exportAudit}>Export audit trail (CSV)</Button>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">Transfer cycle time</p>
              {reports.cycle ? (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Request to dispatch</dt><dd className="text-lg font-semibold">{reports.cycle.summary.avgRequestToDispatchHours ?? '-'}{reports.cycle.summary.avgRequestToDispatchHours !== null ? ' h' : ''}</dd></div>
                  <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Median transit</dt><dd className="text-lg font-semibold">{reports.cycle.summary.medianTransitHours ?? '-'}{reports.cycle.summary.medianTransitHours !== null ? ' h' : ''}</dd></div>
                  <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Received</dt><dd className="text-lg font-semibold">{reports.cycle.summary.received} of {reports.cycle.summary.transfers}</dd></div>
                  <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">With a discrepancy</dt><dd className="text-lg font-semibold">{reports.cycle.summary.discrepancyRatePercent}%</dd></div>
                </dl>
              ) : <p className="text-sm text-muted-foreground">Not available.</p>}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Count accuracy by branch</p>
              {reports.accuracy.length ? reports.accuracy.map((row) => (
                <div key={row.key} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                  <span>{row.label}</span>
                  <span className="text-xs text-muted-foreground">{row.accuracyPercent === null ? 'nothing reviewed yet' : `${row.accuracyPercent}% of ${row.reviewed} reviewed`} · {row.recountRatePercent}% recount</span>
                </div>
              )) : <p className="text-sm text-muted-foreground">No counts yet.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
