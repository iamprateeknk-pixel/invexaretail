import { useState } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import { useInventoryHealth } from '@/hooks/useInventoryHealth'
import { InventoryHealthPanel } from '@/components/inventory/InventoryHealthPanel'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/feedback-states'

const WINDOWS = [30, 60, 90];

// Audit O-5/C-3: valuation, turns, ageing, dead/slow stock, fill rate and count quality for one location.
// Per-screen query (useInventoryHealth), not part of the whole-workspace poll.
export function InventoryHealthPage() {
  const { authToken, locations = [], locationId: activeLocationId } = useWorkspace();
  const [locationId, setLocationId] = useState(activeLocationId || locations[0]?.id || '');
  const [windowDays, setWindowDays] = useState(30);
  const { data, loading, error, refetch } = useInventoryHealth({ authToken, locationId, windowDays });

  if (!locations.length) return <EmptyState title="No locations" description="Add a location to see inventory health." />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Location
          <select className="rounded-md border bg-background px-2 py-1.5" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sales window
          <select className="rounded-md border bg-background px-2 py-1.5" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            {WINDOWS.map((days) => <option key={days} value={days}>Last {days} days</option>)}
          </select>
        </label>
      </div>
      {loading && !data && <LoadingState label="Loading inventory health…" />}
      {error && <ErrorState description={error} onRetry={refetch} />}
      {data && <InventoryHealthPanel health={data.health} accuracy={data.accuracy} reasons={data.reasons} />}
    </div>
  );
}
