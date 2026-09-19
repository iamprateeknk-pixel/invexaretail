import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function ReceivePurchaseOrderDialog() {
  const {
    modalOpen, purchaseOrderReceipts, receivePurchaseOrder, receivingPurchaseOrder,
    setModalOpen, setPurchaseOrderReceipts, setReceivingPurchaseOrder, submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'receivePurchaseOrder'} onOpenChange={(open) => { if (!open) { setModalOpen(null); setReceivingPurchaseOrder(null); setPurchaseOrderReceipts({}); } }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Receive purchase order</DialogTitle><DialogDescription>Record this delivery partially or in full. Quantities cannot exceed the remaining order quantity.</DialogDescription></DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto py-2">
            {receivingPurchaseOrder?.lines?.map((line) => {
              const remaining = Math.max(0, Number(line.quantity) - Number(line.receivedQty ?? 0));
              const entry = purchaseOrderReceipts[line.id] ?? { received: '', damaged: '', excess: '', lotNo: '', expiryDate: '' };
              const set = (key) => (event) => setPurchaseOrderReceipts({ ...purchaseOrderReceipts, [line.id]: { ...entry, [key]: event.target.value } });
              return <div key={line.id} className="space-y-2 rounded-lg border p-3">
                <div><p className="text-sm font-medium">{line.item?.name ?? line.itemId}</p><p className="text-xs text-muted-foreground">Ordered {line.quantity} · Already received {line.receivedQty ?? 0} · Open {remaining}</p></div>
                {remaining > 0 && <div className="grid gap-2 sm:grid-cols-3">
                  <div className="grid gap-1.5"><Label htmlFor={`po-good-${line.id}`}>Good</Label><Input id={`po-good-${line.id}`} inputMode="decimal" value={entry.received} onChange={set('received')} /></div>
                  <div className="grid gap-1.5"><Label htmlFor={`po-damaged-${line.id}`}>Damaged</Label><Input id={`po-damaged-${line.id}`} inputMode="decimal" value={entry.damaged} onChange={set('damaged')} /></div>
                  <div className="grid gap-1.5"><Label htmlFor={`po-excess-${line.id}`}>Excess</Label><Input id={`po-excess-${line.id}`} inputMode="decimal" value={entry.excess} onChange={set('excess')} /></div>
                  <div className="grid gap-1.5"><Label htmlFor={`po-lot-${line.id}`}>Lot no.</Label><Input id={`po-lot-${line.id}`} value={entry.lotNo} onChange={set('lotNo')} placeholder="Batch on the carton" /></div>
                  <div className="grid gap-1.5"><Label htmlFor={`po-expiry-${line.id}`}>Expiry</Label><Input id={`po-expiry-${line.id}`} type="date" value={entry.expiryDate} onChange={set('expiryDate')} /></div>
                </div>}
              </div>;
            })}
            <p className="text-xs text-muted-foreground">Damaged and excess goods are held in quarantine and open a case; only good stock becomes sellable. A failed QC check also quarantines it.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button><Button onClick={receivePurchaseOrder} disabled={submitLoading || !Object.values(purchaseOrderReceipts).some((entry) => Number(entry.received) > 0 || Number(entry.damaged) > 0 || Number(entry.excess) > 0)}>{submitLoading ? 'Saving…' : 'Save receipt'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
