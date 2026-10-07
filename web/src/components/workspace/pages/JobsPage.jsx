import { statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ItemSearchSelect } from '../../ItemSearchSelect';

const EXPORT_COLUMNS = [
  { label: 'Number', value: (r) => r.number }, { label: 'Name', value: (r) => r.name }, { label: 'Status', value: (r) => r.status }, { label: 'Due', value: (r) => r.dueAt },
];

export function JobsPage() {
  const {
        role, jobForm, setJobForm, items, createJob, submitLoading, jobs, consumeJobLine, updateJobStatus,
  } = useWorkspace();
  const { session } = useWorkspace();
  const view = useTableView(jobs, (job) => [job.name, job.number, job.status, ...(job.lines ?? []).map((line) => items.find((item) => item.id === line.itemId)?.name)]);
  return <div className="space-y-6">
    {role === 'ADMIN' && <Card><CardHeader><CardTitle className="text-base">Create job / project</CardTitle><p className="text-xs text-muted-foreground">Start with a planned item; more lines can be added through the job API.</p></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><Input value={jobForm.name} onChange={(event) => setJobForm({ ...jobForm, name: event.target.value })} placeholder="Job name" /><ItemSearchSelect items={items} value={jobForm.itemId} onChange={(itemId) => setJobForm({ ...jobForm, itemId })} placeholder="Planned item" /><Input type="number" aria-label="Planned quantity" min="1" value={jobForm.plannedQty} onChange={(event) => setJobForm({ ...jobForm, plannedQty: Number(event.target.value) })} /><Input type="date" aria-label="Due date" value={jobForm.dueAt} onChange={(event) => setJobForm({ ...jobForm, dueAt: event.target.value })} /><Button onClick={createJob} disabled={submitLoading || !jobForm.name.trim()}>Create job</Button><Textarea className="md:col-span-2 xl:col-span-5" value={jobForm.notes} onChange={(event) => setJobForm({ ...jobForm, notes: event.target.value })} placeholder="Scope and instructions" /></CardContent></Card>}
    <TableToolbar tableId="jobs" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search jobs" showDensity={false} exportCsv={{ filename: 'jobs', columns: EXPORT_COLUMNS, rows: view.visible }} />
    <div className="grid gap-4 xl:grid-cols-2">{view.visible.length ? view.visible.map((job) => <Card key={job.id}><CardHeader className="flex-row items-start justify-between space-y-0"><div><CardTitle className="text-base">{job.name}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{job.number} · Due {job.dueAt ? new Date(job.dueAt).toLocaleDateString('en-IN') : 'not set'}</p></div><Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge></CardHeader><CardContent className="space-y-3"><div className="divide-y rounded-lg border">{job.lines?.length ? job.lines.map((line) => <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><div><p className="font-medium">{items.find((item) => item.id === line.itemId)?.name ?? line.itemId}</p><p className="text-xs text-muted-foreground">Planned {line.plannedQty}</p></div><div className="flex flex-wrap items-center gap-2"><p className="text-xs text-muted-foreground">Issued {line.issuedQty} · Used {line.usedQty} · Returned {line.returnedQty}</p>{job.status === 'ACTIVE' && role !== 'AUDITOR' && <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => consumeJobLine(job, line)}>Consume</Button>}</div></div>) : <p className="p-4 text-sm text-muted-foreground">No planned lines.</p>}</div>{role === 'ADMIN' && <div className="flex flex-wrap gap-2">{job.status === 'DRAFT' && <Button size="sm" onClick={() => updateJobStatus(job.id, 'ACTIVE')}>Start job</Button>}{job.status === 'ACTIVE' && <Button size="sm" variant="outline" onClick={() => updateJobStatus(job.id, 'RECONCILING')}>Reconcile</Button>}{job.status === 'RECONCILING' && <Button size="sm" onClick={() => updateJobStatus(job.id, 'CLOSED')}>Close job</Button>}</div>}</CardContent></Card>) : <Card className="xl:col-span-2"><CardContent className="py-16 text-center text-sm text-muted-foreground">No jobs created for this location.</CardContent></Card>}</div>
  </div>;
}
