import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function ImportReversalDialog() {
  const {
    confirmImportReversal, reversalBatch, reversalReason, setReversalBatch,
    setReversalReason, submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={Boolean(reversalBatch)} onOpenChange={(open) => { if (!open) { setReversalBatch(null); setReversalReason(''); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reverse posted import</DialogTitle>
            <DialogDescription>
              {reversalBatch ? `This creates compensating stock movements for ${reversalBatch.fileName}. Ledger history is never deleted.` : 'Choose an import batch to reverse.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reversal-reason">Reason</Label>
            <Textarea id="reversal-reason" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Remove opening stock to re-import expiry lots" />
            <p className="text-xs text-muted-foreground">Write at least 5 characters. Only Main Admin can reverse a posted batch.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setReversalBatch(null); setReversalReason(''); }}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={submitLoading || reversalReason.trim().length < 5} onClick={confirmImportReversal}>
              {submitLoading ? 'Reversing…' : 'Reverse import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
