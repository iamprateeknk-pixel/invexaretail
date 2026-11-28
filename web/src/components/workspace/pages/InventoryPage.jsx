import { useItemFieldValues, usesItemFields } from '../../../hooks/useItemFieldValues';
import { paginateRows } from '../../../lib/pagination';
import { stockTableColumns } from '../../../lib/stock-table';
import { TablePagination } from '../../TablePagination';
import { useWorkspace } from '../WorkspaceContext';
import { StockItemsTable } from '@/components/inventory/StockItemsTable';
import { StockOverviewActions } from '@/components/inventory/StockOverviewActions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function InventoryPage() {
  const {
        searchedStockRows, items, workspaceProfile, canViewSystemStock, savedViews, applySavedView,
    saveCurrentView, setModalOpen, openScanner, role, setSelectedItem, setMasterDialog, inventoryPage, inventoryPageSize,
    setInventoryPage, setInventoryPageSize, deleteSavedView, runtimeConfig, authToken,
  } = useWorkspace();
  const runtimePage = runtimeConfig?.page;
  const tableColumns = stockTableColumns(runtimePage, { role, canViewSystemStock });
  const itemFieldValues = useItemFieldValues({ authToken, enabled: usesItemFields(tableColumns) });
  // The stock ledger is lot-level, but the operations view is deliberately
  // item-level. A product with three expiry lots is one item in the list;
  // opening it reveals all lot codes and their individual quantities.
  const inventorySummaryRows = Object.values(searchedStockRows.reduce((groups, row) => {
    const existing = groups[row.itemId] ?? {
      ...row,
      physicalQuantity: 0,
      bookQuantity: 0,
      variance: 0,
      stockValue: 0,
      quarantineQuantity: 0,
      reservedQuantity: 0,
      lotIds: [],
    };
    existing.physicalQuantity += Number(row.physicalQuantity ?? 0);
    existing.bookQuantity += Number(row.bookQuantity ?? 0);
    existing.variance += Number(row.variance ?? 0);
    existing.stockValue += Number(row.stockValue ?? 0);
    existing.quarantineQuantity += Number(row.quarantineQuantity ?? 0);
    existing.reservedQuantity += Number(row.reservedQuantity ?? 0);
    if (row.lotId) existing.lotIds.push(row.lotId);
    groups[row.itemId] = existing;
    return groups;
  }, {}));

  const inventoryPageModel = paginateRows(inventorySummaryRows, inventoryPage, inventoryPageSize);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Stock by item</CardTitle>
            {runtimeConfig?.version ? <Badge variant="outline">Studio v{runtimeConfig.version}</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{inventorySummaryRows.length} visible items · totals include all matching lots</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedViews.length > 0 && (
            <Select onValueChange={(viewId) => applySavedView(savedViews.find((view) => view.id === viewId))}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Saved views" /></SelectTrigger>
              <SelectContent>{savedViews.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <StockOverviewActions page={runtimePage} role={role} handlers={{
            saveView: saveCurrentView, export: () => setModalOpen('export'), dailyImport: () => setModalOpen('dailyImport'),
            openingStock: () => setModalOpen('import'), archived: () => setMasterDialog({ mode: 'archived' }), scan: openScanner,
          }} />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <StockItemsTable columns={tableColumns} rows={inventoryPageModel.rows} items={items} variantFields={workspaceProfile.pack?.variantFields}
          itemFieldValues={itemFieldValues} onOpenItem={(row, item) => {
            setSelectedItem({ ...row, lots: item?.lots ?? [] });
            setModalOpen('itemDetails');
          }} />
      </CardContent>
      <TablePagination
        model={inventoryPageModel}
        onPageChange={setInventoryPage}
        onPageSizeChange={(size) => { setInventoryPageSize(size); setInventoryPage(1); }}
      />
      {savedViews.length > 0 && <div className="flex flex-wrap gap-2 border-t px-5 py-3">{savedViews.map((view) => <div key={view.id} className="flex items-center rounded-md border bg-muted/25"><button type="button" className="px-2.5 py-1.5 text-xs font-medium" onClick={() => applySavedView(view)}>{view.name}</button><button type="button" className="border-l px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => deleteSavedView(view.id)} aria-label={'Delete ' + view.name}>×</button></div>)}</div>}
    </Card>
  );
}
