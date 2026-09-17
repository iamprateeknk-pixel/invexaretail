import { canCreateTransfer, transferQueueActions } from '../../../lib/transfer-lifecycle';
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
    generateTransferPDF, openTransferReceipt,
  } = useWorkspace();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Transfer queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">Import → FEFO pick slips → admin confirm → dispatch → receive</p></div><div className="flex gap-2">{['ADMIN', 'ADMIN_USER'].includes(role) && <Button variant="outline" onClick={() => { setTransferImportForm((current) => ({ ...current, sourceLocationId: locations.find((entry) => entry.type === 'warehouse')?.id || locationId, destinationLocationId: locations.find((entry) => entry.type === 'store')?.id || locationId })); setModalOpen('transferImport'); }}>Import transfer</Button>}{canCreateTransfer(role) && <Button onClick={() => setModalOpen('transfer')}>{role === 'STORE_USER' ? 'Request transfer' : 'Create transfer'}</Button>}</div></CardHeader>
      <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Transfer</TableHead><TableHead>Route</TableHead><TableHead>Quantity</TableHead><TableHead>Cartons</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
        {filteredTransfers.map((transfer) => {
          const actions = transferQueueActions(role, transfer.status);
          return <TableRow key={transfer.id}><TableCell><p className="font-medium">{transfer.item}</p><p className="text-xs text-muted-foreground">{transfer.id}</p></TableCell><TableCell>{transfer.fromName} <ArrowRight className="mx-1 inline size-3" /> {transfer.toName}</TableCell><TableCell>{transfer.qty} units</TableCell><TableCell>{transfer.cartonCount || '—'}</TableCell><TableCell><Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status.replaceAll('_', ' ')}</Badge></TableCell><TableCell><div className="flex justify-end gap-1 flex-wrap"><Button variant="outline" size="sm" onClick={() => setEvidenceTransfer(transfer)}>Photos</Button>{actions.confirm && <Button size="sm" onClick={() => confirmPickedTransfer(transfer.id)}>Review & confirm</Button>}{actions.dispatch && <Button variant="outline" size="sm" onClick={() => changeTransferStatus(transfer.id, 'DISPATCHED')}>Dispatch</Button>}{actions.inTransit && <Button variant="outline" size="sm" onClick={() => changeTransferStatus(transfer.id, 'IN_TRANSIT')}>In transit</Button>}{['ADMIN', 'ADMIN_USER', 'AUDITOR'].includes(role) && <Button variant="outline" size="sm" onClick={() => exportTransferExcel(transfer.id)}>Excel</Button>}{['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED'].includes(transfer.status) && <Button variant="outline" size="sm" onClick={() => generateTransferPDF(transfer)}>Print</Button>}{actions.receive && <Button size="sm" onClick={() => { openTransferReceipt(transfer); }}>Receive</Button>}</div></TableCell></TableRow>;
        })}
      </TableBody></Table></CardContent>
    </Card>
  );
}
