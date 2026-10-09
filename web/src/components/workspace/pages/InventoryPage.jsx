import { paginateRows } from '../../../lib/pagination';
import { stockActionIsAvailable } from '../../../lib/stock-metadata';
import { availableQuantity, RIGHT_ALIGNED_STOCK_COLUMNS, stockTableColumns } from '../../../lib/stock-table';
import { TablePagination } from '../../TablePagination';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, ScanLine } from 'lucide-react';

export function InventoryPage() {
  const {
        searchedStockRows, items, workspaceProfile, canViewSystemStock, savedViews, applySavedView,
    saveCurrentView, setModalOpen, openScanner, role, setSelectedItem, setMasterDialog, inventoryPage, inventoryPageSize,
    setInventoryPage, setInventoryPageSize, deleteSavedView, runtimeConfig,
  } = useWorkspace();
  const runtimePage = runtimeConfig?.page;
  const tableColumns = stockTableColumns(runtimePage, { role, canViewSystemStock });
  const hasColor = Boolean(workspaceProfile.pack?.variantFields?.includes('Color'));
  const headerLabel = (column) => (column.key === 'pack_size' && column.label === 'Pack/Size' && workspaceProfile.pack?.variantFields?.includes('Size') ? 'Size' : column.label);
  const renderCell = (column, { row, item, lotCount }) => {
    switch (column.key) {
      case 'item_code': return <><p className="font-medium">{item?.code ?? row.itemId}</p><p className="text-xs text-muted-foreground">{row.itemName ?? item?.name}</p></>;
      case 'company': return item?.company || '—';
      case 'category': return <><p>{item?.category || '—'}</p>{!hasColor && <p className="text-xs text-muted-foreground">{item?.subcategory || '—'}</p>}</>;
      case 'pack_size': return item?.unit || '—';
      case 'lot_coverage': return <><Badge variant="secondary">{lotCount} {lotCount === 1 ? 'lot' : 'lots'}</Badge><p className="mt-1 text-xs text-muted-foreground">Open for lot & expiry detail</p></>;
      case 'physical': return <span className="font-semibold">{row.physicalQuantity}</span>;
      case 'book': return row.bookQuantity ?? 0;
      case 'variance': return <span className={Number(row.variance ?? 0) < 0 ? 'font-medium text-destructive' : 'text-success'}>{row.variance ?? 0}</span>;
      case 'quarantine': return row.quarantineQuantity > 0 ? <Badge variant="warning">{row.quarantineQuantity}</Badge> : <span className="text-muted-foreground">—</span>;
      case 'reserved': return row.reservedQuantity > 0 ? <Badge variant="secondary" title="Held by pending transfer requests, not yet dispatched">{row.reservedQuantity}</Badge> : <span className="text-muted-foreground">—</span>;
      case 'available': return availableQuantity(row);
      case 'value': return `₹${Number(row.stockValue ?? 0).toLocaleString('en-IN')}`;
      default: return row.fields?.[column.key] ?? row[column.key] ?? column.defaultValue ?? 0;
    }
  };
  const canExport = stockActionIsAvailable(runtimePage, 'export', role);
  const canScan = stockActionIsAvailable(runtimePage, 'scan', role);
  const canDailyImport = ['ADMIN', 'ADMIN_USER'].includes(role) && stockActionIsAvailable(runtimePage, 'daily_import', role);
  const canOpeningStock = ['ADMIN', 'ADMIN_USER'].includes(role);
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
          <Button variant="outline" onClick={saveCurrentView}>Save view</Button>
          {canExport && (
            <Button variant="outline" onClick={() => setModalOpen('export')}>
              <Download className="size-4" />Export
            </Button>
          )}
          {canDailyImport && <Button variant="outline" onClick={() => setModalOpen('dailyImport')}>Daily sales / purchase</Button>}
          {canOpeningStock && <Button variant="outline" onClick={() => setModalOpen('import')}>Opening stock</Button>}
          {canOpeningStock && <Button variant="outline" onClick={() => setMasterDialog({ mode: 'archived' })}>Archived items</Button>}
          {canScan && <Button onClick={openScanner}><ScanLine className="size-4" />Scan item</Button>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow>{tableColumns.flatMap((column) => {
            const head = <TableHead key={column.key} className={RIGHT_ALIGNED_STOCK_COLUMNS.has(column.key) ? 'text-right' : undefined}>{headerLabel(column)}</TableHead>;
            return column.key === 'pack_size' && hasColor ? [head, <TableHead key="color">Color</TableHead>] : [head];
          })}</TableRow></TableHeader>
          <TableBody>
            {inventoryPageModel.rows.map((row) => { const item = items.find((entry) => entry.id === row.itemId); const lotCount = new Set(row.lotIds).size; return (
              <TableRow key={row.itemId + '-' + row.locationId} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => { setSelectedItem({ ...row, lots: item?.lots ?? [] }); setModalOpen('itemDetails'); }}>
                {tableColumns.flatMap((column) => {
                  const cell = <TableCell key={column.key} className={RIGHT_ALIGNED_STOCK_COLUMNS.has(column.key) ? 'text-right' : undefined}>{renderCell(column, { row, item, lotCount })}</TableCell>;
                  return column.key === 'pack_size' && hasColor ? [cell, <TableCell key="color">{item?.subcategory || '—'}</TableCell>] : [cell];
                })}
              </TableRow>
            ); })}
          </TableBody>
        </Table></div>
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
