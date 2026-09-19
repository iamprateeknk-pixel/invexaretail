import { useState } from 'react';
import { canCreateTransfer, transferQueueActions } from '../../../lib/transfer-lifecycle';
import { logisticsLabel } from '../../../lib/transfer-packing';
import TransferPackingDialog from '../../transfers/TransferPackingDialog';
import { statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight } from 'lucide-react';

export function TransfersPage() {
  const {
        role, locations, locationId, setTransferImportForm, setModalOpen, filteredTransfers,
    setEvidenceTransfer, confirmPickedTransfer, changeTransferStatus, exportTransferExcel,
    generateTransferPDF, openTransferReceipt, authToken, items, refreshTransfers,
  } = useWorkspace();
  const [packingTransfer, setPackingTransfer] = useState(null);
  const itemsById = new Map((items ?? []).map((item) => [item.id, item]));
  return (
    <>
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Transfer queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">Import → FEFO pick slips → admin confirm → dispatch → receive</p></div><div className="flex gap-2">{['ADMIN', 'ADMIN_USER'].includes(role) && <Button variant="outline" onClick={() => { setTransferImportForm((current) => ({ ...current, sourceLocationId: locations.find((entry) => entry.type === 'warehouse')?.id || locationId, destinationLocationId: locations.find((entry) => entry.type === 'store')?.id || locationId })); setModalOpen('transferImport'); }}>Import transfer</Button>}{canCreateTransfer(role) && <Button onClick={() => setModalOpen('transfer')}>{role === 'STORE_USER' ? 'Request transfer' : 'Create transfer'}</Button>}</div></CardHeader>
      <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Transfer</TableHead><TableHead>Route</TableHead><TableHead>Quantity</TableHead><TableHead>Cartons</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
        {filteredTransfers.map((transfer) => {
          const actions = transferQueueActions(role, transfer.status);
          return <TableRow key={transfer.id}><TableCell><p className="font-medium">{transfer.item}</p><p className="text-xs text-muted-foreground">{transfer.id}</p></TableCell><TableCell>{transfer.fromName} <ArrowRight className="mx-1 inline size-3" /> {transfer.toName}</TableCell><TableCell>{transfer.qty} units</TableCell><TableCell>{transfer.cartonCount || '—'}{(transfer.cartons ?? []).length > 0 && <p className="text-xs text-muted-foreground">{transfer.cartons.map((carton) => carton.packageId).join(', ')}</p>}</TableCell><TableCell><Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status.replaceAll('_', ' ')}</Badge>{logisticsLabel(transfer) && <Badge className="ml-1" variant={transfer.delayed ? 'destructive' : 'outline'}>{logisticsLabel(transfer)}</Badge>}{transfer.dispatch && <p className="mt-1 text-xs text-muted-foreground">{[transfer.dispatch.carrier, transfer.dispatch.vehicleNo, transfer.dispatch.awb].filter(Boolean).join(' · ')}</p>}</TableCell><TableCell><div className="flex justify-end gap-1 flex-wrap"><Button variant="outline" size="sm" onClick={() => setEvidenceTransfer(transfer)}>Photos</Button>{actions.confirm && <Button size="sm" onClick={() => confirmPickedTransfer(transfer.id)}>Review & confirm</Button>}{(actions.dispatch || (['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'WAREHOUSE_PICKER'].includes(role) && ['READY_FOR_ADMIN', 'PARTIAL', 'CONFIRMED'].includes(transfer.status))) && <Button variant="outline" size="sm" onClick={() => setPackingTransfer(transfer)}>Pack & dispatch</Button>}{actions.inTransit && <Button variant="outline" size="sm" onClick={() => changeTransferStatus(transfer.id, 'IN_TRANSIT')}>In transit</Button>}{['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(role) && <Button variant="outline" size="sm" onClick={() => exportTransferExcel(transfer.id)}>Excel</Button>}{['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED'].includes(transfer.status) && <Button variant="outline" size="sm" onClick={() => generateTransferPDF(transfer)}>Print</Button>}{actions.receive && <Button size="sm" onClick={() => { openTransferReceipt(transfer); }}>Receive</Button>}</div></TableCell></TableRow>;
        })}
      </TableBody></Table></CardContent>
    </Card>
    {packingTransfer && <TransferPackingDialog key={packingTransfer.id} transfer={packingTransfer} token={authToken} itemsById={itemsById} canDispatch={['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER'].includes(role)} onChanged={refreshTransfers} onClose={() => setPackingTransfer(null)} />}
    </>
  );
}
