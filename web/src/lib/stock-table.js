import { visibleStockColumns } from './stock-metadata.js';

// Used until the company's runtime config has loaded (or if it cannot be fetched).
export const DEFAULT_STOCK_COLUMNS = [
  { key: 'item_code', label: 'Item code & name', source: 'core' },
  { key: 'company', label: 'Company', source: 'core' },
  { key: 'category', label: 'Category', source: 'core' },
  { key: 'pack_size', label: 'Pack/Size', source: 'core' },
  { key: 'lot_coverage', label: 'Lot coverage', source: 'core' },
  { key: 'physical', label: 'Total physical', source: 'core' },
  { key: 'book', label: 'Total book', source: 'core' },
  { key: 'variance', label: 'Variance', source: 'core' },
  { key: 'quarantine', label: 'Quarantine', source: 'core' },
  { key: 'reserved', label: 'Reserved', source: 'core' },
  { key: 'value', label: 'Value', source: 'core' },
];

/**
 * Columns of the stock table in the order the company configured in Control Plane > Studio.
 * Role and system-stock permissions still apply on top. Always keeps the item column first-class:
 * a config without it falls back to the defaults rather than rendering a table nobody can read.
 */
export function stockTableColumns(runtimePage, options = {}) {
  const configured = Array.isArray(runtimePage?.columns) && runtimePage.columns.length ? runtimePage : null;
  if (!configured) return visibleStockColumns({ columns: DEFAULT_STOCK_COLUMNS }, options);
  const columns = visibleStockColumns(configured, options);
  return columns.some((column) => column.key === 'item_code') ? columns : visibleStockColumns({ columns: DEFAULT_STOCK_COLUMNS }, options);
}

export const RIGHT_ALIGNED_STOCK_COLUMNS = new Set(['value']);

/** Available = physical stock not held by reservations or quarantine. */
export function availableQuantity(row) {
  return Math.max(0, Number(row?.physicalQuantity ?? 0) - Number(row?.reservedQuantity ?? 0) - Number(row?.quarantineQuantity ?? 0));
}
