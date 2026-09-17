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
              return <div key={line.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_130px] sm:items-end"><div><p className="text-sm font-medium">{line.item?.name ?? line.itemId}</p><p className="text-xs text-muted-foreground">Ordered {line.quantity} · Already received {line.receivedQty ?? 0} · Remaining {remaining}</p></div><div className="grid gap-1.5"><Label htmlFor={`po-receive-${line.id}`}>Receive now</Label><Input id={`po-receive-${line.id}`} type="number" min="0" max={remaining} value={purchaseOrderReceipts[line.id] ?? 0} onChange={(event) => setPurchaseOrderReceipts({ ...purchaseOrderReceipts, [line.id]: Number(event.target.value) })} /></div></div>;
            })}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button><Button onClick={receivePurchaseOrder} disabled={submitLoading || !Object.values(purchaseOrderReceipts).some((quantity) => Number(quantity) > 0)}>{submitLoading ? 'Saving…' : 'Save receipt'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
