import { useMemo, useState } from 'react';
import { canCreateTransfer, transferQueueActions } from '../../../lib/transfer-lifecycle';
import { logisticsLabel } from '../../../lib/transfer-packing';
import TransferPackingDialog from '../../transfers/TransferPackingDialog';
import AssignPickerDialog from '../../transfers/AssignPickerDialog';
import { statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { hiddenColumnCss, hiddenColumnIds } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { entityHref } from '../../../lib/entity-360';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Pencil, Trash2, UserCheck } from 'lucide-react';

const EDITABLE_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'REQUESTED']);

const COLUMNS = [{ id: 'transfer', label: 'Transfer' }, { id: 'route', label: 'Route' }, { id: 'quantity', label: 'Quantity' }, { id: 'cartons', label: 'Cartons' }, { id: 'status', label: 'Status' }];
const EXPORT_COLUMNS = [
  { label: 'Transfer', value: (r) => r.id },
  { label: 'Item', value: (r) => r.item },
  { label: 'From', value: (r) => r.fromName },
  { label: 'To', value: (r) => r.toName },
  { label: 'Quantity', value: (r) => r.qty },
  { label: 'Cartons', value: (r) => r.cartonCount },
  { label: 'Status', value: (r) => r.status },
];

export function TransfersPage() {
  const {
    role, session, locations, locationId, setTransferImportForm, setModalOpen, filteredTransfers,
    setEvidenceTransfer, confirmPickedTransfer, changeTransferStatus, exportTransferExcel,
    generateTransferPDF, openTransferReceipt, authToken, items, refreshTransfers,
    openTransferEditor, deleteTransfers, submitLoading,
  } = useWorkspace();
  const [packingTransfer, setPackingTransfer] = useState(null);
  const [pickerTransfer, setPickerTransfer] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pendingDelete, setPendingDelete] = useState([]);
  const itemsById = new Map((items ?? []).map((item) => [item.id, item]));
  const view = useTableView(filteredTransfers, (transfer) => [transfer.id, transfer.item, transfer.fromName, transfer.toName, transfer.status, ...(transfer.cartons ?? []).map((carton) => carton.packageId)]);

  const canModify = (transfer) => EDITABLE_STATUSES.has(transfer.status)
    && ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'].includes(role)
    && (role !== 'STORE_USER' || transfer.requestedBy === session?.user?.id);
  const selectableIds = useMemo(
    () => view.visible.filter(canModify).map((transfer) => transfer.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.visible, role, session?.user?.id],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleSelected(id, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked) {
    setSelectedIds(checked ? new Set(selectableIds) : new Set());
  }

  async function confirmDelete() {
    const result = await deleteTransfers(pendingDelete);
    if (result.deleted) {
      setSelectedIds((current) => new Set([...current].filter((id) => !pendingDelete.includes(id))));
    }
    setPendingDelete([]);
  }

  return (
    <>
      <TableToolbar tableId="transfers" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search transfers" columns={COLUMNS} exportCsv={{ filename: 'transfers', columns: EXPORT_COLUMNS, rows: view.visible }} />
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Transfer queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">Import → assign picker → FEFO pick slips → admin confirm → dispatch → receive</p></div>
          <div className="flex flex-wrap gap-2">
            {selectedIds.size > 0 && <Button variant="destructive" onClick={() => setPendingDelete([...selectedIds])}><Trash2 className="size-4" />Delete selected ({selectedIds.size})</Button>}
            {['ADMIN', 'ADMIN_USER'].includes(role) && <Button variant="outline" onClick={() => { setTransferImportForm((current) => ({ ...current, sourceLocationId: locations.find((entry) => entry.type === 'warehouse')?.id || locationId, destinationLocationId: locations.find((entry) => entry.type === 'store')?.id || locationId })); setModalOpen('transferImport'); }}>Import transfer</Button>}
            {canCreateTransfer(role) && <Button onClick={() => setModalOpen('transfer')}>{role === 'STORE_USER' ? 'Request transfer' : 'Create transfer'}</Button>}
          </div>
        </CardHeader>
        <CardContent className="p-0 tv-transfers">
          <style>{hiddenColumnCss('tv-transfers', COLUMNS.map((column) => column.id), hiddenColumnIds(view.state), 1)}</style>
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="Select all editable transfers" checked={allSelected} onCheckedChange={(checked) => toggleAll(checked === true)} disabled={!selectableIds.length} /></TableHead><TableHead>Transfer</TableHead><TableHead>Route</TableHead><TableHead>Quantity</TableHead><TableHead>Cartons</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {view.visible.map((transfer) => {
                const actions = transferQueueActions(role, transfer.status);
                const editable = canModify(transfer);
                return (
                  <TableRow key={transfer.id} data-state={selectedIds.has(transfer.id) ? 'selected' : undefined} className={view.compact ? '[&_td]:py-1' : ''}>
                    <TableCell><Checkbox aria-label={`Select transfer ${transfer.id}`} checked={selectedIds.has(transfer.id)} onCheckedChange={(checked) => toggleSelected(transfer.id, checked === true)} disabled={!editable} /></TableCell>
                    <TableCell><p className="font-medium">{transfer.item}</p><p className="text-xs text-muted-foreground"><a href={entityHref('transfer', transfer.id)} className="underline-offset-2 hover:underline" aria-label={`Open the full story of transfer ${transfer.id}`}>{transfer.id}</a></p></TableCell>
                    <TableCell>{transfer.fromName} <ArrowRight className="mx-1 inline size-3" /> {transfer.toName}</TableCell>
                    <TableCell>{transfer.qty} units</TableCell>
                    <TableCell>{transfer.cartonCount || '—'}{(transfer.cartons ?? []).length > 0 && <p className="text-xs text-muted-foreground">{transfer.cartons.map((carton) => carton.packageId).join(', ')}</p>}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status.replaceAll('_', ' ')}</Badge>{logisticsLabel(transfer) && <Badge className="ml-1" variant={transfer.delayed ? 'destructive' : 'outline'}>{logisticsLabel(transfer)}</Badge>}{transfer.assignedPickerId && <p className="mt-1 text-xs text-muted-foreground">Picker: {transfer.assignedPickerName ?? transfer.assignedPickerId}</p>}{transfer.dispatch && <p className="mt-1 text-xs text-muted-foreground">{[transfer.dispatch.carrier, transfer.dispatch.vehicleNo, transfer.dispatch.awb].filter(Boolean).join(' · ')}</p>}</TableCell>
                    <TableCell><div className="flex flex-wrap justify-end gap-1">
                      {editable && transfer.lines?.length === 1 && <Button variant="outline" size="sm" onClick={() => openTransferEditor(transfer)}><Pencil className="size-3.5" />Edit</Button>}
                      {editable && <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setPendingDelete([transfer.id])}><Trash2 className="size-3.5" />Delete</Button>}
                      <Button variant="outline" size="sm" onClick={() => setEvidenceTransfer(transfer)}>Photos</Button>
                      {actions.assignPicker && <Button variant="outline" size="sm" onClick={() => setPickerTransfer(transfer)}><UserCheck className="size-3.5" />{transfer.assignedPickerId ? 'Change picker' : 'Assign picker'}</Button>}
                      {actions.confirm && <Button size="sm" onClick={() => confirmPickedTransfer(transfer.id)}>Review & confirm</Button>}
                      {(actions.dispatch || (['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'].includes(role) && ['READY_FOR_ADMIN', 'PARTIAL', 'CONFIRMED'].includes(transfer.status))) && <Button variant="outline" size="sm" onClick={() => setPackingTransfer(transfer)}>Pack & dispatch</Button>}
                      {actions.inTransit && <Button variant="outline" size="sm" onClick={() => changeTransferStatus(transfer.id, 'IN_TRANSIT')}>In transit</Button>}
                      {['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(role) && <Button variant="outline" size="sm" onClick={() => exportTransferExcel(transfer.id)}>Excel</Button>}
                      {['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED'].includes(transfer.status) && <Button variant="outline" size="sm" onClick={() => generateTransferPDF(transfer)}>Print</Button>}
                      {actions.receive && <Button size="sm" onClick={() => openTransferReceipt(transfer)}>Receive</Button>}
                    </div></TableCell>
                  </TableRow>
                );
              })}
              {!filteredTransfers.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">No transfers found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={pendingDelete.length > 0} onOpenChange={(open) => !open && setPendingDelete([])}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete transfer{pendingDelete.length === 1 ? '' : 's'}?</DialogTitle><DialogDescription>This permanently removes {pendingDelete.length} request{pendingDelete.length === 1 ? '' : 's'} and releases the reserved stock. Transfers that have started picking, packing, dispatch or receiving cannot be deleted.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setPendingDelete([])}>Cancel</Button><Button variant="destructive" onClick={confirmDelete} disabled={submitLoading}>{submitLoading ? 'Deleting…' : `Delete ${pendingDelete.length}`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerTransfer && <AssignPickerDialog key={pickerTransfer.id} transfer={pickerTransfer} token={authToken} onAssigned={() => refreshTransfers()} onClose={() => setPickerTransfer(null)} />}
      {packingTransfer && <TransferPackingDialog key={packingTransfer.id} transfer={packingTransfer} token={authToken} itemsById={itemsById} canDispatch={['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(role)} onChanged={refreshTransfers} onClose={() => setPackingTransfer(null)} />}
    </>
  );
}