import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function TransferRequestDialog() {
  const {
    items, locations, modalOpen, requestTransfer,
    role, setModalOpen, setTransferForm, submitLoading,
    transferForm,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'transfer'} onOpenChange={(open) => !open && setModalOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Transfer Request</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {role === 'ADMIN' && (
              <>
                <div className="grid gap-2">
                  <Label>Source Location</Label>
                  <Select value={transferForm.source} onValueChange={(value) => setTransferForm({ ...transferForm, source: value })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Destination Location</Label>
                  <Select value={transferForm.destination} onValueChange={(value) => setTransferForm({ ...transferForm, destination: value })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label>Item</Label>
              <Select value={transferForm.itemId} onValueChange={(value) => setTransferForm({ ...transferForm, itemId: value })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  {items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} ({item.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Lot</Label>
              <Select value={transferForm.lotId} onValueChange={(value) => setTransferForm({ ...transferForm, lotId: value })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select lot" /></SelectTrigger>
                <SelectContent>
                  {items.find((i) => i.id === transferForm.itemId)?.lots?.map((lot) => <SelectItem key={lot.id} value={lot.id}>{lot.lotNo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Quantity (units)</Label>
              <Input type="number" min="1" value={transferForm.qty} onChange={(e) => setTransferForm({ ...transferForm, qty: Number(e.target.value) })} />
            </div>
            <div className="grid gap-2">
              <Label>Carton Count</Label>
              <Input type="number" min="1" value={transferForm.cartonCount} onChange={(e) => setTransferForm({ ...transferForm, cartonCount: Number(e.target.value) })} placeholder="Number of cartons/boxes" />
            </div>
            <div className="grid gap-2">
              <Label>Evidence Photos (optional)</Label>
              <Input type="file" multiple accept="image/*" onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setTransferForm({ ...transferForm, photos: files });
              }} />
              <p className="text-xs text-muted-foreground">Attach packaging/seal photos for audit trail</p>
              {transferForm.photos?.length > 0 && (
                <p className="text-xs text-muted-foreground">{transferForm.photos.length} photo(s) selected</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(null)}>Cancel</Button>
            <Button type="button" onClick={requestTransfer} disabled={submitLoading}>{submitLoading ? 'Creating...' : 'Create Transfer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
