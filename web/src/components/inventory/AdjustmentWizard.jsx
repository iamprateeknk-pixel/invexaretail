import { useState } from 'react'
import { useInventoryAdjustment } from '@/hooks/useInventoryAdjustment'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorState } from '@/components/ui/feedback-states'

// Week 10: guided opening-stock/adjustment wizard. Every post goes through
// InventoryPostingService (routes/items.ts's /adjust) with a client-
// generated idempotency key - see useInventoryAdjustment.js. The submit
// button is disabled for the whole in-flight window (`submitting`), the
// duplicate-submit guard the guide's "error retry does not duplicate"
// verification checks for on the client side (the server-side guarantee is
// the idempotency key itself, proven in items.postgres.test.ts).
export function AdjustmentWizard({ authToken, itemId, branches, lots, onPosted }) {
  const { adjust, submitting, error } = useInventoryAdjustment({ authToken });
  const [locationId, setLocationId] = useState(branches[0]?.locationId ?? '');
  const [lotId, setLotId] = useState(lots[0]?.lotId ?? '');
  const [qtyDelta, setQtyDelta] = useState('');
  const [reason, setReason] = useState('');

  const canSubmit = locationId && lotId && qtyDelta && Number(qtyDelta) !== 0 && reason.trim() && !submitting;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    const result = await adjust(itemId, { locationId, lotId, qtyDelta: Number(qtyDelta), reason: reason.trim() });
    if (result) {
      setQtyDelta('');
      setReason('');
      onPosted?.(result);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" aria-label="Manual stock adjustment">
      {error && <ErrorState description={error} />}

      <div className="flex flex-col gap-1">
        <Label htmlFor="adjust-location">Location</Label>
        <select
          id="adjust-location"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
        >
          {branches.map((branch) => <option key={branch.locationId} value={branch.locationId}>{branch.locationName}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="adjust-lot">Lot</Label>
        <select
          id="adjust-lot"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={lotId}
          onChange={(event) => setLotId(event.target.value)}
        >
          {lots.map((lot) => <option key={lot.lotId} value={lot.lotId}>{lot.lotNo}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="adjust-qty">Quantity change</Label>
        <Input id="adjust-qty" type="number" step="any" value={qtyDelta} onChange={(event) => setQtyDelta(event.target.value)} placeholder="e.g. -5 or 10" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="adjust-reason">Reason</Label>
        <Input id="adjust-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this adjustment needed?" />
      </div>

      <Button type="submit" disabled={!canSubmit}>
        {submitting ? 'Posting…' : 'Post adjustment'}
      </Button>
    </form>
  );
}
