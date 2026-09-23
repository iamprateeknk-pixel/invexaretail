import { useState } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import { ItemSearchPanel } from '@/components/inventory/ItemSearchPanel'
import { StockDetailPanel } from '@/components/inventory/StockDetailPanel'
import { AdjustmentWizard } from '@/components/inventory/AdjustmentWizard'
import { useInventoryAdjustment } from '@/hooks/useInventoryAdjustment'
import { useStockDetail } from '@/hooks/useStockDetail'
import { EmptyState } from '@/components/ui/feedback-states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ADJUST_ROLES = ['ADMIN', 'ADMIN_USER'];

// Week 10: the Item Search / Stock Detail vertical slice's page shell.
// Deliberately its own per-screen data flow (useItemSearch/useStockDetail/
// useInventoryAdjustment), not wired into useWorkspaceHydration's
// whole-workspace poll - the guide's "replace whole-workspace hydration/
// polling for these routes with per-screen queries and targeted
// invalidation" requirement.
export function ItemStockDetailPage() {
  const { authToken, role } = useWorkspace();
  const [selectedItem, setSelectedItem] = useState(null);
  const { detail, refetch } = useStockDetail({ authToken, itemId: selectedItem?.id });
  const { reverse, submitting } = useInventoryAdjustment({ authToken });

  const canAdjust = ADJUST_ROLES.includes(role);

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Search</h2>
        <ItemSearchPanel authToken={authToken} onSelectItem={setSelectedItem} />
      </div>

      <div>
        {!selectedItem ? (
          <EmptyState title="Select an item" description="Search for an item on the left to see its branch balances, lots and movement history." />
        ) : (
          <div className="flex flex-col gap-4">
            <StockDetailPanel
              authToken={authToken}
              itemId={selectedItem.id}
              reversing={submitting}
              onReverse={(movementId) => reverse(selectedItem.id, movementId, 'Manual reversal from stock detail')}
            />
            {canAdjust && detail && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Post an adjustment</CardTitle></CardHeader>
                <CardContent>
                  <AdjustmentWizard
                    authToken={authToken}
                    itemId={selectedItem.id}
                    branches={detail.branches}
                    lots={detail.lots}
                    onPosted={() => refetch()}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
