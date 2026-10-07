import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ClipboardList } from 'lucide-react';

export function QcPage() {
  const {
    qcTemplates, qcInspections, qcForm, setQcForm, createQcTemplate, setQcTemplateActive, submitLoading,
  } = useWorkspace();
  const { session } = useWorkspace();
  const view = useTableView(qcInspections, (inspection) => [inspection.item?.name, inspection.itemId, inspection.sourceDocument, inspection.status, inspection.result]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publish a receiving checklist</CardTitle>
          <p className="text-xs text-muted-foreground">
            Once a template is active, matching receipts cannot post good stock until the inspection is recorded.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <Input placeholder="Template label" value={qcForm.label} onChange={(event) => setQcForm({ ...qcForm, label: event.target.value })} />
          <Input placeholder="Category (optional)" value={qcForm.category} onChange={(event) => setQcForm({ ...qcForm, category: event.target.value })} />
          <Button disabled={submitLoading || !qcForm.label.trim()} onClick={createQcTemplate}><ClipboardList className="size-4" />Publish</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {qcTemplates.length ? qcTemplates.map((template) => (
            <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{template.label}</p>
                <p className="text-xs text-muted-foreground">
                  {template.category || 'All categories'} · {(template.checks ?? []).map((check) => check.label).join(' · ') || 'Default seal/packaging/weight/moisture/expiry checks'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={template.active === false ? 'secondary' : 'success'}>{template.active === false ? 'Inactive' : 'Required on receive'}</Badge>
                <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => setQcTemplateActive(template.id, template.active === false)}>
                  {template.active === false ? 'Activate' : 'Deactivate'}
                </Button>
              </div>
            </div>
          )) : <p className="py-10 text-center text-sm text-muted-foreground">No templates yet. Receiving still posts without a checklist until you publish one.</p>}
        </CardContent>
      </Card>

      <TableToolbar tableId="qc-inspections" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search inspections" />

      <Card>
        <CardHeader><CardTitle className="text-base">Recent inspections</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {view.visible.length ? view.visible.map((inspection) => (
            <div key={inspection.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border ${view.rowPadding}`}>
              <div>
                <p className="text-sm font-medium">{inspection.item?.name || inspection.itemId || 'Inspection'}</p>
                <p className="text-xs text-muted-foreground">
                  {inspection.sourceDocument || 'Ad hoc'} · {formatDateTime(inspection.createdAt)}
                </p>
              </div>
              <Badge variant={inspection.overallResult === 'FAIL' ? 'destructive' : 'success'}>{inspection.overallResult || 'PASS'}</Badge>
            </div>
          )) : <p className="py-10 text-center text-sm text-muted-foreground">No inspections recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
