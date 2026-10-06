import { formatDateTime, statusBadgeVariant } from '../../../lib/workspace';
import { transferQueueActions } from '../../../lib/transfer-lifecycle';
import { useState } from 'react';
import { attentionTarget, buildAttentionList, onboardingSteps, onboardingProgress } from '../../../lib/attention';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock3,
  PackageOpen,
  ShieldCheck,
  Truck,
} from 'lucide-react';

export function DashboardPage() {
  const {
        locations, locationId, role, workspaceProfile, clock, dashboardCards,
    pendingCountTasks, countTaskRows, setSelectedCountTask, dashboard, filteredTransfers,
    changeTransferStatus, openTransferReceipt, navigateTo, setCountStatusFilter, items, stockRows,
  } = useWorkspace();
  const attention = buildAttentionList(dashboardCards);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try { return localStorage.getItem('invexa.onboardingDismissed') === '1'; } catch { return false; }
  });
  const steps = onboardingSteps({ locationCount: locations?.length ?? 0, itemCount: items?.length ?? 0, hasStock: (stockRows?.length ?? 0) > 0, hasMovement: (filteredTransfers?.length ?? 0) > 0 });
  const progress = onboardingProgress(steps);
  const showOnboarding = ['ADMIN', 'ADMIN_USER'].includes(role) && !progress.complete && !onboardingDismissed;
  const dismissOnboarding = () => {
    setOnboardingDismissed(true);
    try { localStorage.setItem('invexa.onboardingDismissed', '1'); } catch { /* storage unavailable */ }
  };
  const selectedLocation = locations.find((location) => location.id === locationId);
  const operationsRole = role ? role.replaceAll('_', ' ').toLowerCase().replace(/\\b\\w/g, (letter) => letter.toUpperCase()) : 'Team member';
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-lg sm:p-6">
        <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-56 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-emerald-100">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1"><span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />Live operations</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{selectedLocation?.name ?? 'All locations'}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{operationsRole}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Today’s operations, ready for action.</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">Keep stock counts, transfers, expiry risk and branch replenishment moving from one {workspaceProfile.industry?.toLowerCase() || 'retail'} workspace.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button type="button" variant="secondary" className="border border-white/10 bg-white text-slate-950 hover:bg-slate-100" onClick={() => navigateTo('inventory')}><PackageOpen className="size-4" />View stock</Button>
            <Button type="button" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => navigateTo('counts')}><ClipboardCheck className="size-4" />Start count</Button>
            {pendingCountTasks.length > 0 && <Button type="button" variant="outline" className="border-amber-300/35 bg-amber-300/10 text-amber-50 hover:bg-amber-300/20 hover:text-white" onClick={() => setSelectedCountTask(pendingCountTasks[0])}><Clock3 className="size-4" />Open next task</Button>}
            <Button type="button" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => navigateTo('transfers')}><Truck className="size-4" />New transfer</Button>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-slate-300">
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-emerald-300" />Updated {new Date(clock).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="inline-flex items-center gap-1.5"><ClipboardCheck className="size-3.5 text-amber-300" />{pendingCountTasks.length} count tasks need attention</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-300" />Role-based access active</span>
        </div>
      </section>

      <section aria-labelledby="attention-heading" className="space-y-3">
        <h2 id="attention-heading" className="text-sm font-semibold text-muted-foreground">Needs your attention</h2>
        {attention.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {attention.map((card) => (
              <li key={card.label}>
                <button type="button" onClick={() => { if (card.filter) setCountStatusFilter(card.filter); navigateTo(attentionTarget(card, role)); }} className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <AlertTriangle className="size-5 shrink-0 text-amber-500" aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-2xl font-bold leading-none">{card.value}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{card.label}</span></span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" />All clear. Nothing needs attention right now.</p>
        )}
      </section>

      {showOnboarding && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle className="text-base">Get started</CardTitle><p className="mt-1 text-xs text-muted-foreground">{progress.done} of {progress.total} done</p></div>
            <Button type="button" variant="ghost" size="sm" onClick={dismissOnboarding}>Dismiss</Button>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 sm:grid-cols-2">
              {steps.map((step) => (
                <li key={step.id}>
                  <button type="button" disabled={step.done} onClick={() => navigateTo(step.section)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {step.done ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" /> : <Circle className="size-4 text-muted-foreground" aria-hidden="true" />}
                    <span className={step.done ? 'line-through' : 'font-medium'}>{step.label}</span>
                    <span className="sr-only">{step.done ? 'Completed' : 'Not done yet'}</span>
                  </button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {dashboardCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <button
              key={metric.label}
              type="button"
              onClick={() => {
                if (metric.filter) setCountStatusFilter(metric.filter);
                navigateTo(metric.section);
              }}
              className="group rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/35 group-hover:shadow-lg">
                <CardContent className="flex items-start justify-between gap-4 p-5">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
                    <p className="mt-2 text-3xl font-bold tracking-tight">{metric.value}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{metric.detail}</p>
                  </div>
                  <div className={`metric-icon metric-icon-${metric.tone}`}><Icon className="size-5" /></div>
                </CardContent>
                <div className="flex items-center gap-1 border-t bg-muted/25 px-5 py-2.5 text-xs font-semibold text-primary">
                  View details <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </Card>
            </button>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Priority work</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Tasks needing action now</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigateTo('counts')}>View queue<ArrowRight className="size-4" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Task</TableHead><TableHead>Location</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {countTaskRows.slice(0, 5).map((task) => (
                  <TableRow key={task.id} className="cursor-pointer" onClick={() => setSelectedCountTask(task)}>
                    <TableCell><p className="font-medium">{task.item ?? task.itemId}</p><p className="text-xs text-muted-foreground">{task.id}</p></TableCell>
                    <TableCell>{task.locationName}</TableCell>
                    <TableCell className={task.overdue ? 'font-medium text-destructive' : ''}>{formatDateTime(task.dueAt)}</TableCell>
                    <TableCell><Badge variant={task.overdue ? 'destructive' : statusBadgeVariant(task.status)}>{task.overdue ? `${task.status} · Overdue` : task.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Operational health</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {[
              ['Count completion', Number(dashboard?.countCompletionPercent ?? 0), 'bg-emerald-500'],
              ['Transfer SLA', Number(dashboard?.transferSlaPercent ?? 0), 'bg-blue-500'],
              ['Stock accuracy', Number(dashboard?.stockAccuracyPercent ?? 0), 'bg-violet-500'],
            ].map(([label, value, color]) => (
              <div key={label} className="space-y-2">
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><strong>{value}%</strong></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div>
              </div>
            ))}
            <Separator />
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium">Next recommended action</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Review overdue counts before today&apos;s receiving window closes.</p>
              <Button variant="link" className="mt-1 h-auto p-0" onClick={() => navigateTo('approvals')}>Open approvals</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Transfer status</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">In transit and receive only. Dispatch waits until pick is confirmed.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigateTo('transfers')}>Open queue<ArrowRight className="size-4" /></Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableBody>
              {filteredTransfers.length ? filteredTransfers.map((transfer) => {
                const actions = transferQueueActions(role, transfer.status);
                return (
                  <TableRow key={transfer.id}>
                    <TableCell>
                      <p className="font-medium">{transfer.item}</p>
                      <p className="text-xs text-muted-foreground">{transfer.id}{transfer.cartonCount ? ` · ${transfer.cartonCount} cartons` : ''}</p>
                    </TableCell>
                    <TableCell>{transfer.fromName} → {transfer.toName} ({transfer.qty} units)</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status.replaceAll('_', ' ')}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        {actions.inTransit && (
                          <Button type="button" variant="outline" size="sm" onClick={() => changeTransferStatus(transfer.id, 'IN_TRANSIT')}>In Transit</Button>
                        )}
                        {actions.receive && (
                          <Button type="button" variant="outline" size="sm" onClick={() => openTransferReceipt(transfer)}>Receive</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">No open transfers.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
