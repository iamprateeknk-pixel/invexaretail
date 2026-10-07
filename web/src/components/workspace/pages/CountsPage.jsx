import { useMemo, useState } from 'react';
import { CycleCountPlanner } from '../../counts/CycleCountPlanner';
import { ItemSearchSelect } from '../../ItemSearchSelect';
import { StockTakeCampaigns } from '../../counts/StockTakeCampaigns';
import { formatDateTime, statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Clock3, ListChecks, Trash2, TriangleAlert } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OpsMetricCard, OpsPageHeader, OpsSyncStatus, OpsWorkflowStepper } from '../../ops/OpsKit';

export function CountsPage() {
  const {
        activeSection, countStatusFilter, setCountStatusFilter, countTaskRows, canManageCounts,
    setModalOpen, setBulkCountForm, locationId, storeUsers, cycleCountPlan, currentLocationName,
    cycleCountStoreUserId, setCycleCountStoreUserId, cycleCountClasses, setCycleCountClasses,
    submitCycleCountAssign, submitLoading, role, countForm, setCountForm, submitBlindCount,
    authToken, loading, setSelectedCountTask, assignments, items, locations, campaignRevision,
    toleranceRules, toleranceRuleForm, setToleranceRuleForm, createToleranceRule, toggleToleranceRule,
    approvalRequests, approvalRules, approvalRuleForm, setApprovalRuleForm, decideApprovalRequest, createApprovalRule, toggleApprovalRule,
    evidenceRules, evidenceRuleForm, setEvidenceRuleForm, createEvidenceRule, toggleEvidenceRule, deleteCountAssignments,
  } = useWorkspace();
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const { session } = useWorkspace();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // A store user may only submit a blind count against an item that was
  // actually assigned to them at this location - a free-text item field let
  // them type any item ID, so the field is locked to their assigned items.
  const assignedItemIds = useMemo(
    () => new Set(
      (assignments ?? [])
        .filter((assignment) => assignment.locationId === locationId && assignment.status === 'ASSIGNED')
        .map((assignment) => assignment.itemId),
    ),
    [assignments, locationId],
  );
  const assignedItems = useMemo(
    () => (items ?? []).filter((item) => assignedItemIds.has(item.id)),
    [items, assignedItemIds],
  );
  const queue = activeSection === 'approvals' && countStatusFilter === 'all'
    ? countTaskRows.filter((task) => String(task.status).toLowerCase().includes('pending'))
    : countTaskRows;
  const view = useTableView(queue, (task) => [task.item, task.itemId, task.id, task.lot, task.locationName, task.assignedToName, task.status, task.priority]);
  const canDeleteSelected = ['ADMIN', 'ADMIN_USER'].includes(role) && selectedTaskIds.length > 0;
  const allVisibleSelected = view.visible.length > 0 && view.visible.every((task) => selectedTaskIds.includes(task.id));
  const someVisibleSelected = view.visible.some((task) => selectedTaskIds.includes(task.id));

  function toggleTaskSelection(taskId, checked) {
    setSelectedTaskIds((current) => checked ? [...new Set([...current, taskId])] : current.filter((id) => id !== taskId));
  }
  function toggleAllVisible(checked) {
    const visibleIds = view.visible.map((task) => task.id);
    setSelectedTaskIds((current) => checked ? [...new Set([...current, ...visibleIds])] : current.filter((id) => !visibleIds.includes(id)));
  }
  async function confirmDeleteSelected() {
    await deleteCountAssignments(selectedTaskIds);
    setSelectedTaskIds([]);
    setDeleteDialogOpen(false);
  }
  const countMetrics = useMemo(() => {
    const rows = countTaskRows ?? [];
    const pending = rows.filter((task) => String(task.status).toLowerCase().includes('pending')).length;
    const approved = rows.filter((task) => String(task.status).toLowerCase().includes('approved')).length;
    const overdue = rows.filter((task) => task.overdue).length;
    const averageProgress = rows.length
      ? Math.round(rows.reduce((sum, task) => sum + (Number(task.progress) || 0), 0) / rows.length)
      : 0;
    return { total: rows.length, pending, approved, overdue, averageProgress };
  }, [countTaskRows]);
  return (
    <div className="space-y-4">
      {activeSection === 'counts' && (
        <>
          <OpsPageHeader
            eyebrow="Inventory control"
            title="Stock Taking Command Center"
            description={"Run branch counts, monitor workload, review exceptions and keep physical stock aligned with ERP movements at " + currentLocationName + "."}
            status={<OpsSyncStatus status={loading ? 'syncing' : 'synced'} label={loading ? 'Refreshing' : 'Live'} />}
            actions={canManageCounts ? <>
              <Button variant="outline" onClick={() => setModalOpen('assignCount')}>Assign one</Button>
              <Button onClick={() => { setBulkCountForm((current) => ({ ...current, locationId, storeUserId: current.storeUserId || storeUsers[0]?.id || '' })); setModalOpen('bulkCount'); }}>Start stock work</Button>
            </> : null}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <OpsMetricCard label="Count tasks" value={countMetrics.total} helper={currentLocationName} icon={ListChecks} tone="blue" />
            <OpsMetricCard label="Pending review" value={countMetrics.pending} helper="Needs action" icon={Clock3} tone="amber" onClick={() => setCountStatusFilter('pending')} />
            <OpsMetricCard label="Overdue" value={countMetrics.overdue} helper="Past due time" icon={TriangleAlert} tone={countMetrics.overdue ? 'rose' : 'neutral'} onClick={() => setCountStatusFilter('overdue')} />
            <OpsMetricCard label="Approved" value={countMetrics.approved} helper="Verified counts" icon={CheckCircle2} tone="emerald" onClick={() => setCountStatusFilter('approved')} />
            <OpsMetricCard label="Average progress" value={String(countMetrics.averageProgress) + '%'} helper="Across visible tasks" icon={ListChecks} tone="violet" />
          </div>

          <OpsWorkflowStepper steps={[
            { label: 'Plan', caption: 'Scope & users', state: countMetrics.total ? 'done' : 'active' },
            { label: 'Count', caption: 'Physical work', state: countMetrics.total ? 'active' : 'waiting' },
            { label: 'Review', caption: String(countMetrics.pending) + ' pending', state: countMetrics.pending ? 'active' : (countMetrics.approved ? 'done' : 'waiting') },
            { label: 'Verify', caption: String(countMetrics.approved) + ' approved', state: countMetrics.total > 0 && countMetrics.approved === countMetrics.total ? 'done' : 'waiting' },
          ]} />
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-2 shadow-sm">
        <Tabs value={countStatusFilter} onValueChange={setCountStatusFilter}>
          <TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="overdue">Overdue</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger></TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {selectedTaskIds.length > 0 && <span className="px-2 text-sm font-medium" aria-live="polite">{selectedTaskIds.length} selected</span>}
          {canDeleteSelected && <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}><Trash2 />Delete selected</Button>}
          {activeSection === 'approvals' && <div className="px-2 text-xs text-muted-foreground">Approval and evidence governance</div>}
        </div>
      </div>

      {canManageCounts && activeSection === 'counts' && (
        <CycleCountPlanner
          plan={cycleCountPlan}
          locationName={currentLocationName}
          storeUsers={storeUsers}
          storeUserId={cycleCountStoreUserId || storeUsers[0]?.id || ''}
          setStoreUserId={setCycleCountStoreUserId}
          selectedClasses={cycleCountClasses}
          setSelectedClasses={setCycleCountClasses}
          submitLoading={submitLoading}
          onAssign={submitCycleCountAssign}
          formatDateTime={formatDateTime}
        />
      )}

      {canManageCounts && activeSection === 'counts' && (
        <StockTakeCampaigns
          token={authToken}
          locations={locations}
          storeUsers={storeUsers}
          locationId={locationId}
          refreshKey={campaignRevision}
        />
      )}

      {['STORE_USER', 'WAREHOUSE_PICKER'].includes(role) && activeSection === 'counts' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Blind count entry</CardTitle><p className="text-xs text-muted-foreground">System quantity stays hidden until submission.</p></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <div className="grid gap-2">
              <Label>Item</Label>
              <ItemSearchSelect
                items={assignedItems}
                value={countForm.itemId}
                onChange={(itemId) => setCountForm({ ...countForm, itemId })}
                placeholder={assignedItems.length ? 'Select assigned item…' : 'No items assigned to you here'}
              />
            </div>
            <div className="grid gap-2"><Label>Lot number</Label><Input value={countForm.lotNo} onChange={(event) => setCountForm({ ...countForm, lotNo: event.target.value })} /></div>
            <div className="grid gap-2"><Label>Physical quantity</Label><Input type="number" value={countForm.physicalQuantity} onChange={(event) => setCountForm({ ...countForm, physicalQuantity: Number(event.target.value) })} /></div>
            <Button onClick={submitBlindCount} disabled={!authToken || loading}>Submit count</Button>
          </CardContent>
        </Card>
      )}

      <TableToolbar tableId="count-tasks" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search count tasks" />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>{canManageCounts && <TableHead className="w-12"><Checkbox checked={allVisibleSelected || (someVisibleSelected && 'indeterminate')} onCheckedChange={toggleAllVisible} aria-label="Select all visible tasks" /></TableHead>}<TableHead>Task</TableHead><TableHead>Location</TableHead><TableHead>Assigned to</TableHead><TableHead>Created</TableHead><TableHead>Due</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Progress</TableHead></TableRow></TableHeader>
            <TableBody>
              {view.visible.length ? view.visible.map((task) => (
                <TableRow key={task.id} className={`cursor-pointer ${view.compact ? '[&_td]:py-1' : ''}`} onClick={() => setSelectedCountTask(task)}>
                  <TableCell><p className="font-medium">{task.item ?? task.itemId}</p><p className="text-xs text-muted-foreground">{task.id} · {task.lot}</p></TableCell>
                  {canManageCounts && <TableCell onClick={(event) => event.stopPropagation()}><Checkbox checked={selectedTaskIds.includes(task.id)} onCheckedChange={(checked) => toggleTaskSelection(task.id, checked === true)} aria-label={`Select ${task.item ?? task.itemId}`} /></TableCell>}
                  <TableCell>{task.locationName}</TableCell><TableCell>{task.assignedToName}</TableCell>
                  <TableCell>{formatDateTime(task.createdAt)}</TableCell><TableCell className={task.overdue ? 'font-medium text-destructive' : ''}>{formatDateTime(task.dueAt)}</TableCell>
                  <TableCell><Badge variant={task.priority === 'Urgent' ? 'destructive' : 'outline'}>{task.priority}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={task.overdue ? 'destructive' : statusBadgeVariant(task.status)}>{task.overdue ? `${task.status} · Overdue` : task.status}</Badge>
                    {task.reconciliationRequired && (
                      <Badge variant="warning" className="ml-1.5" title={task.reconciliationNote}><AlertTriangle className="size-3" />Late movement</Badge>
                    )}
                    {task.toleranceRecommendation?.recommendRecount && (
                      <Badge variant="warning" className="ml-1.5" title={task.toleranceRecommendation.reason}><AlertTriangle className="size-3" />Recount</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{task.progress}%</TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={canManageCounts ? 9 : 8} className="h-40 text-center text-muted-foreground">No tasks match this view.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected count tasks?</DialogTitle>
            <DialogDescription>{selectedTaskIds.length} assignment{selectedTaskIds.length === 1 ? '' : 's'} will be removed. Submitted count history remains available for review and reporting. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={submitLoading} onClick={confirmDeleteSelected}>Delete {selectedTaskIds.length} selected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canManageCounts && activeSection === 'approvals' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Value approval requests</CardTitle><p className="text-xs text-muted-foreground">Blocked by a configured approval rule - the underlying action (e.g. transfer confirm) waits here until decided.</p></CardHeader>
          <CardContent className="space-y-2">
            {approvalRequests.length ? approvalRequests.map((request) => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{request.entityType} {request.entityId.slice(-6)} · ₹{Number(request.valueAtStake).toLocaleString('en-IN')}</p>
                  <p className="text-xs text-muted-foreground">{request.rule?.label} · requires {request.rule?.requiredApproverRole} · requested by {request.requestedBy?.name} · {formatDateTime(request.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={submitLoading} onClick={() => decideApprovalRequest(request.id, 'APPROVED')}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => decideApprovalRequest(request.id, 'REJECTED')}>Reject</Button>
                </div>
              </div>
            )) : <p className="text-sm text-muted-foreground">No value approvals are waiting.</p>}
          </CardContent>
        </Card>
      )}

      {canManageCounts && activeSection === 'approvals' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Approval rules</CardTitle><p className="text-xs text-muted-foreground">Unlike tolerance rules, these gate the action - it is blocked until a qualifying approver decides.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <Input placeholder="Rule label" value={approvalRuleForm.label} onChange={(event) => setApprovalRuleForm({ ...approvalRuleForm, label: event.target.value })} />
              <Select value={approvalRuleForm.triggerType} onValueChange={(value) => setApprovalRuleForm({ ...approvalRuleForm, triggerType: value })}>
                <SelectTrigger><SelectValue placeholder="Trigger" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TRANSFER_CONFIRM">Transfer confirm</SelectItem>
                  <SelectItem value="STOCK_ADJUSTMENT">Manual stock adjustment</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Category (blank = all)" value={approvalRuleForm.category} onChange={(event) => setApprovalRuleForm({ ...approvalRuleForm, category: event.target.value })} />
              <Input type="number" placeholder="Value threshold (₹)" value={approvalRuleForm.valueThreshold} onChange={(event) => setApprovalRuleForm({ ...approvalRuleForm, valueThreshold: event.target.value })} />
              <Select value={approvalRuleForm.requiredApproverRole} onValueChange={(value) => setApprovalRuleForm({ ...approvalRuleForm, requiredApproverRole: value })}>
                <SelectTrigger><SelectValue placeholder="Required approver" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRANCH_MANAGER">Branch Manager</SelectItem>
                  <SelectItem value="ADMIN_USER">Admin User</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button disabled={submitLoading || !approvalRuleForm.label.trim() || !approvalRuleForm.valueThreshold} onClick={createApprovalRule}>Add rule</Button>
            </div>
            <div className="space-y-2">
              {approvalRules.length ? approvalRules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{rule.label}</p>
                    <p className="text-xs text-muted-foreground">{rule.triggerType} · {rule.category ?? 'All categories'} · {rule.branch?.name ?? 'All branches'} · ≥ ₹{rule.valueThreshold} · requires {rule.requiredApproverRole}</p>
                  </div>
                  <Button size="sm" variant={rule.active ? 'outline' : 'secondary'} onClick={() => toggleApprovalRule(rule.id, !rule.active)}>{rule.active ? 'Active' : 'Inactive'}</Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No approval rules yet - every transfer confirms without a value gate.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {canManageCounts && activeSection === 'approvals' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Evidence rules</CardTitle><p className="text-xs text-muted-foreground">Gates on a fact that must already exist: a damaged receipt over the threshold cannot be posted until a photo is already attached to the transfer.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Input placeholder="Rule label" value={evidenceRuleForm.label} onChange={(event) => setEvidenceRuleForm({ ...evidenceRuleForm, label: event.target.value })} />
              <Input placeholder="Category (blank = all)" value={evidenceRuleForm.category} onChange={(event) => setEvidenceRuleForm({ ...evidenceRuleForm, category: event.target.value })} />
              <Input type="number" placeholder="Quantity threshold" value={evidenceRuleForm.quantityThreshold} onChange={(event) => setEvidenceRuleForm({ ...evidenceRuleForm, quantityThreshold: event.target.value })} />
              <Input type="number" placeholder="Value threshold (₹)" value={evidenceRuleForm.valueThreshold} onChange={(event) => setEvidenceRuleForm({ ...evidenceRuleForm, valueThreshold: event.target.value })} />
              <Button disabled={submitLoading || !evidenceRuleForm.label.trim() || (!evidenceRuleForm.quantityThreshold && !evidenceRuleForm.valueThreshold)} onClick={createEvidenceRule}>Add rule</Button>
            </div>
            <div className="space-y-2">
              {evidenceRules.length ? evidenceRules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{rule.label}</p>
                    <p className="text-xs text-muted-foreground">{rule.triggerType} · {rule.category ?? 'All categories'} · {rule.branch?.name ?? 'All branches'}{rule.quantityThreshold ? ` · ≥ ${rule.quantityThreshold} units` : ''}{rule.valueThreshold ? ` · ≥ ₹${rule.valueThreshold}` : ''}</p>
                  </div>
                  <Button size="sm" variant={rule.active ? 'outline' : 'secondary'} onClick={() => toggleEvidenceRule(rule.id, !rule.active)}>{rule.active ? 'Active' : 'Inactive'}</Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No evidence rules yet - damaged receipts never require a photo.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {canManageCounts && activeSection === 'counts' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Tolerance rules</CardTitle><p className="text-xs text-muted-foreground">Variance beyond a rule's threshold recommends a recount to the reviewer - it never decides one automatically.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Input placeholder="Rule label" value={toleranceRuleForm.label} onChange={(event) => setToleranceRuleForm({ ...toleranceRuleForm, label: event.target.value })} />
              <Input placeholder="Category (blank = all)" value={toleranceRuleForm.category} onChange={(event) => setToleranceRuleForm({ ...toleranceRuleForm, category: event.target.value })} />
              <Input type="number" placeholder="Value threshold (₹)" value={toleranceRuleForm.valueThreshold} onChange={(event) => setToleranceRuleForm({ ...toleranceRuleForm, valueThreshold: event.target.value })} />
              <Input type="number" placeholder="Percent threshold (%)" value={toleranceRuleForm.percentThreshold} onChange={(event) => setToleranceRuleForm({ ...toleranceRuleForm, percentThreshold: event.target.value })} />
              <Button disabled={submitLoading || !toleranceRuleForm.label.trim()} onClick={createToleranceRule}>Add rule</Button>
            </div>
            <div className="space-y-2">
              {toleranceRules.length ? toleranceRules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{rule.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.category ?? 'All categories'} · {rule.branch?.name ?? 'All branches'}
                      {rule.valueThreshold ? ` · ≥ ₹${rule.valueThreshold}` : ''}{rule.percentThreshold ? ` · ≥ ${rule.percentThreshold}%` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant={rule.active ? 'outline' : 'secondary'} onClick={() => toggleToleranceRule(rule.id, !rule.active)}>{rule.active ? 'Active' : 'Inactive'}</Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">No tolerance rules yet - every variance is left to reviewer judgment.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
