import { useState } from 'react';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { entityHref } from '../../../lib/entity-360';
import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, Octagon } from 'lucide-react';

const PRIORITY_TONE = { CRITICAL: 'destructive', HIGH: 'warning', MEDIUM: 'secondary', LOW: 'outline' };
const STATUS_TONE = { OPEN: 'secondary', IN_PROGRESS: 'warning', PENDING_APPROVAL: 'warning', RESOLVED: 'success', CLOSED: 'success', REJECTED: 'destructive' };
const TYPE_LABEL = {
  DAMAGE: 'Damage', SHORT_RECEIPT: 'Short receipt', EXCESS_RECEIPT: 'Excess receipt', WRONG_ITEM: 'Wrong item',
  EXPIRED: 'Expired', MISSING_STOCK: 'Missing stock', QC_FAIL: 'QC failure', TRANSFER_DISCREPANCY: 'Transfer discrepancy',
  COUNT_VARIANCE: 'Count variance', QUARANTINE: 'Quarantine',
};
const DISPOSITIONS = ['RESTOCK', 'VENDOR_RETURN', 'MARKDOWN', 'DESTROY', 'REWORK', 'WRITE_OFF', 'ACCEPT', 'RECOUNT', 'ESCALATE', 'NONE'];

const FILTERS = [
  { id: '', label: 'Open work' },
  { id: 'OPEN', label: 'Unclaimed' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'CLOSED', label: 'Closed' },
];

const EXPORT_COLUMNS = [
  { label: 'Title', value: (r) => r.title }, { label: 'Type', value: (r) => r.type }, { label: 'Priority', value: (r) => r.priority },
  { label: 'Status', value: (r) => r.status }, { label: 'Item', value: (r) => r.item?.code }, { label: 'Location', value: (r) => r.location?.name },
  { label: 'Owner', value: (r) => r.owner?.name }, { label: 'Due', value: (r) => r.dueAt }, { label: 'Value at risk', value: (r) => r.valueAtRisk },
];

export function ExceptionsPage() {
  const {
    role, session, exceptionCases, exceptionSummary, exceptionStatusFilter, setExceptionStatusFilter,
    refreshExceptions, claimException, resolveException, submitLoading,
  } = useWorkspace();
  const [resolvingCase, setResolvingCase] = useState(null);
  const [disposition, setDisposition] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const isManager = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(role);

  const view = useTableView(exceptionCases, (item) => [item.title, item.description, item.item?.code, item.item?.name, item.location?.name, item.owner?.name]);
  const visibleCases = view.visible;
  const rowPadding = view.rowPadding;

  function selectFilter(id) {
    setExceptionStatusFilter(id);
    setTimeout(refreshExceptions, 0);
  }

  function openResolve(exceptionCase) {
    setResolvingCase(exceptionCase);
    setDisposition('');
    setResolutionNotes('');
  }

  async function submitResolution() {
    if (!resolvingCase || !disposition) return;
    await resolveException(resolvingCase.id, disposition, resolutionNotes);
    setResolvingCase(null);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between py-5"><div><p className="text-xs text-muted-foreground">Open cases</p><p className="text-2xl font-semibold">{exceptionSummary.open}</p></div><Octagon className="size-6 text-rose-500" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between py-5"><div><p className="text-xs text-muted-foreground">Overdue SLA</p><p className="text-2xl font-semibold">{exceptionSummary.overdue}</p></div><Octagon className="size-6 text-amber-500" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between py-5"><div><p className="text-xs text-muted-foreground">Critical value</p><p className="text-2xl font-semibold">{exceptionSummary.critical}</p></div><Octagon className="size-6 text-destructive" /></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button key={filter.id || 'default'} size="sm" variant={exceptionStatusFilter === filter.id ? 'default' : 'outline'} onClick={() => selectFilter(filter.id)}>
            {filter.label}
          </Button>
        ))}
      </div>

      <TableToolbar tableId="exceptions" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search exceptions" exportCsv={{ filename: 'exceptions', columns: EXPORT_COLUMNS, rows: view.visible }} />

      <Card>
        <CardHeader><CardTitle className="text-base">Exception inbox</CardTitle><p className="text-xs text-muted-foreground">Every damage, shortage, wrong-item and pick exception, owned through to a closed disposition.</p></CardHeader>
        <CardContent className="space-y-2">
          {visibleCases.length ? visibleCases.map((item) => {
            const overdue = item.dueAt && new Date(item.dueAt) < new Date() && !['CLOSED', 'REJECTED', 'RESOLVED'].includes(item.status);
            return (
              <div key={item.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border ${rowPadding}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <Badge variant={PRIORITY_TONE[item.priority] ?? 'secondary'}>{item.priority}</Badge>
                    <Badge variant={STATUS_TONE[item.status] ?? 'secondary'}>{item.status.replace(/_/g, ' ')}</Badge>
                    <Badge variant="outline">{TYPE_LABEL[item.type] ?? item.type}</Badge>
                    {overdue && <Badge variant="destructive">SLA overdue</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  {(item.lotId || item.locationId) && (
                    <p className="mt-1 text-xs">
                      Investigate:{' '}
                      {item.lotId && <a href={entityHref('lot', item.lotId)} className="font-medium underline-offset-2 hover:underline">this lot</a>}
                      {item.lotId && item.locationId && ' · '}
                      {item.locationId && <a href={entityHref('location', item.locationId)} className="font-medium underline-offset-2 hover:underline">this location</a>}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.item ? `${item.item.code} - ${item.item.name}` : null}
                    {item.quantity ? ` · Qty ${item.quantity}` : ''}
                    {item.valueAtRisk ? ` · Value at risk ₹${Number(item.valueAtRisk).toFixed(0)}` : ''}
                    {item.location ? ` · ${item.location.name}` : ''}
                    {' · '}Due {formatDateTime(item.dueAt)}
                    {item.owner ? ` · Owner ${item.owner.name}` : ' · Unassigned'}
                  </p>
                  {item.disposition && <p className="mt-1 text-xs font-medium text-emerald-600">Closed as {item.disposition.replace(/_/g, ' ')}{item.resolutionNotes ? `: ${item.resolutionNotes}` : ''}</p>}
                </div>
                {!['CLOSED', 'REJECTED'].includes(item.status) && (
                  <div className="flex flex-wrap gap-2">
                    {(item.status === 'OPEN' && (!item.owner || item.owner.id === session?.user?.id)) && (
                      <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => claimException(item.id)}>Claim</Button>
                    )}
                    {(isManager || item.owner?.id === session?.user?.id) && (
                      <Button size="sm" disabled={submitLoading} onClick={() => openResolve(item)}>Resolve</Button>
                    )}
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-3 size-8 text-emerald-500" />
              No open exceptions. Damage, shortage and pick exceptions will land here automatically.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(resolvingCase)} onOpenChange={(open) => !open && setResolvingCase(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolve: {resolvingCase?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger><SelectValue placeholder="Disposition" /></SelectTrigger>
              <SelectContent>{DISPOSITIONS.map((option) => <SelectItem key={option} value={option}>{option.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} placeholder="Resolution notes (what happened and why)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolvingCase(null)}>Cancel</Button>
            <Button disabled={!disposition || submitLoading} onClick={submitResolution}>Close case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
