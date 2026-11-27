import { itemFieldCell } from '@/hooks/useItemFieldValues';
import { availableQuantity, formatStockFormulaValue, RIGHT_ALIGNED_STOCK_COLUMNS, stockFormulaValue } from '@/lib/stock-table';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function StockCell({ column, row, item, hasColor, itemFieldValues }) {
  if (column.source === 'itemField') return itemFieldCell(itemFieldValues, item?.id ?? row.itemId, column.itemField);
  if (column.formula) return formatStockFormulaValue(stockFormulaValue(column.formula, row), column.type);
  switch (column.key) {
    case 'item_code': return <><span className="block font-medium">{item?.code ?? row.itemId}</span><span className="block text-xs text-muted-foreground">{row.itemName ?? item?.name}</span></>;
    case 'company': return item?.company || '—';
    case 'category': return <><p>{item?.category || '—'}</p>{!hasColor && <p className="text-xs text-muted-foreground">{item?.subcategory || '—'}</p>}</>;
    case 'pack_size': return item?.unit || '—';
    case 'lot_coverage': {
      const count = new Set(row.lotIds).size;
      return <Badge variant="secondary">{count} {count === 1 ? 'lot' : 'lots'}</Badge>;
    }
    case 'physical': return <span className="font-semibold">{row.physicalQuantity}</span>;
    case 'book': return row.bookQuantity ?? 0;
    case 'variance': return <span className={Number(row.variance ?? 0) < 0 ? 'font-medium text-destructive' : 'text-success'}>{row.variance ?? 0}</span>;
    case 'quarantine': return row.quarantineQuantity > 0 ? <Badge variant="warning">{row.quarantineQuantity}</Badge> : <span className="text-muted-foreground">—</span>;
    case 'reserved': return row.reservedQuantity > 0 ? <Badge variant="secondary" title="Held by pending transfer requests, not yet dispatched">{row.reservedQuantity}</Badge> : <span className="text-muted-foreground">—</span>;
    case 'available': return availableQuantity(row);
    case 'value': return `₹${Number(row.stockValue ?? 0).toLocaleString('en-IN')}`;
    default: return row.fields?.[column.key] ?? row[column.key] ?? column.defaultValue ?? 0;
  }
}

export function StockItemsTable({ columns, rows, items, variantFields = [], itemFieldValues, onOpenItem, label = 'Stock by item' }) {
  const hasColor = variantFields.includes('Color');
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const headerLabel = (column) => column.key === 'pack_size' && column.label === 'Pack/Size' && variantFields.includes('Size') ? 'Size' : column.label;
  return (
    <Table aria-label={label}>
      <TableHeader><TableRow>{columns.flatMap((column) => {
        const head = <TableHead key={column.key} className={RIGHT_ALIGNED_STOCK_COLUMNS.has(column.key) ? 'text-right' : undefined}>{headerLabel(column)}</TableHead>;
        return column.key === 'pack_size' && hasColor ? [head, <TableHead key="color">Color</TableHead>] : [head];
      })}</TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => {
          const item = itemsById.get(row.itemId);
          return <TableRow key={`${row.itemId}-${row.locationId}`} className={onOpenItem ? 'cursor-pointer hover:bg-muted/50' : undefined}
            onClick={onOpenItem ? () => onOpenItem(row, item) : undefined}>
            {columns.flatMap((column) => {
              const content = <StockCell column={column} row={row} item={item} hasColor={hasColor} itemFieldValues={itemFieldValues} />;
              const cell = <TableCell key={column.key} className={RIGHT_ALIGNED_STOCK_COLUMNS.has(column.key) ? 'text-right' : undefined}>
                {column.key === 'item_code' && onOpenItem ? <button type="button" className="text-left focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`Open item ${item?.code ?? row.itemId} ${row.itemName ?? item?.name ?? ''}`.trim()}
                  onClick={(event) => { event.stopPropagation(); onOpenItem(row, item); }}>{content}</button> : content}
                {column.key === 'lot_coverage' && onOpenItem && <p className="mt-1 text-xs text-muted-foreground">Open for lot &amp; expiry detail</p>}
              </TableCell>;
              return column.key === 'pack_size' && hasColor ? [cell, <TableCell key="color">{item?.subcategory || '—'}</TableCell>] : [cell];
            })}
          </TableRow>;
        })}
      </TableBody>
    </Table>
  );
}
