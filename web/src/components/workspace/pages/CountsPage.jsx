import { useMemo } from 'react';
import { CycleCountPlanner } from '../../counts/CycleCountPlanner';
import { ItemSearchSelect } from '../../ItemSearchSelect';
import { StockTakeCampaigns } from '../../counts/StockTakeCampaigns';
import { formatDateTime, statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle } from 'lucide-react';

export function CountsPage() {
  const {
        activeSection, countStatusFilter, setCountStatusFilter, countTaskRows, canManageCounts,
    setModalOpen, setBulkCountForm, locationId, storeUsers, cycleCountPlan, currentLocationName,
    cycleCountStoreUserId, setCycleCountStoreUserId, cycleCountClasses, setCycleCountClasses,
    submitCycleCountAssign, submitLoading, role, countForm, setCountForm, submitBlindCount,
    authToken, loading, setSelectedCountTask, assignments, items, locations, campaignRevision,
    toleranceRules, toleranceRuleForm, setToleranceRuleForm, createToleranceRule, toggleToleranceRule,
    approvalRequests, approvalRules, approvalRuleForm, setApprovalRuleForm, decideApprovalRequest, createApprovalRule, toggleApprovalRule,
    evidenceRules, evidenceRuleForm, setEvidenceRuleForm, createEvidenceRule, toggleEvidenceRule,
  } = useWorkspace();
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={countStatusFilter} onValueChange={setCountStatusFilter}>
          <TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="overdue">Overdue</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger></TabsList>
        </Tabs>
        <div className="flex gap-2">{canManageCounts && <><Button variant="outline" onClick={() => setModalOpen('assignCount')}>Assign one</Button><Button onClick={() => { setBulkCountForm((current) => ({ ...current, locationId, storeUserId: current.storeUserId || storeUsers[0]?.id || '' })); setModalOpen('bulkCount'); }}>Bulk stock take</Button></>}</div>
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

      {role === 'STORE_USER' && activeSection === 'counts' && (
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Location</TableHead><TableHead>Assigned to</TableHead><TableHead>Created</TableHead><TableHead>Due</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Progress</TableHead></TableRow></TableHeader>
            <TableBody>
              {queue.length ? queue.map((task) => (
                <TableRow key={task.id} className="cursor-pointer" onClick={() => setSelectedCountTask(task)}>
                  <TableCell><p className="font-medium">{task.item ?? task.itemId}</p><p className="text-xs text-muted-foreground">{task.id} · {task.lot}</p></TableCell>
                  <TableCell>{task.locationName}</TableCell><TableCell>{task.assignedToName}</TableCell>
                  <TableCell>{formatDateTime(task.createdAt)}</TableCell><TableCell className={task.overdue ? 'font-medium text-destructive' : ''}>{formatDateTime(task.dueAt)}</TableCell>
                  <TableCell><Badge variant={task.priority === 'Urgent' ? 'destructive' : 'outline'}>{task.priority}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={task.overdue ? 'destructive' : statusBadgeVariant(task.status)}>{task.overdue ? `${task.status} · Overdue` : task.status}</Badge>
                    {task.toleranceRecommendation?.recommendRecount && (
                      <Badge variant="warning" className="ml-1.5" title={task.toleranceRecommendation.reason}><AlertTriangle className="size-3" />Recount</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{task.progress}%</TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={8} className="h-40 text-center text-muted-foreground">No tasks match this view.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
