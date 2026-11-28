type ReportColumn = { value: string; label: string; type?: 'number'; groupable?: boolean };
type ReportDataset = { value: string; label: string; columns: ReportColumn[] };

export const REPORT_DATASETS: ReportDataset[] = [
  {
    value: 'inventory', label: 'Stock',
    columns: [
      { value: 'item_code', label: 'Item code & name' },
      { value: 'category', label: 'Category', groupable: true },
      { value: 'company', label: 'Company', groupable: true },
      { value: 'physical', label: 'Total physical', type: 'number' },
      { value: 'book', label: 'Total book', type: 'number' },
      { value: 'variance', label: 'Variance', type: 'number' },
      { value: 'reserved', label: 'Reserved', type: 'number' },
      { value: 'quarantine', label: 'Quarantine', type: 'number' },
      { value: 'available', label: 'Available', type: 'number' },
      { value: 'value', label: 'Value', type: 'number' },
    ],
  },
  {
    value: 'transfers', label: 'Transfers',
    columns: [
      { value: 'transfer_no', label: 'Transfer no.' },
      { value: 'from', label: 'From', groupable: true },
      { value: 'to', label: 'To', groupable: true },
      { value: 'status', label: 'Status', groupable: true },
      { value: 'items', label: 'Items', type: 'number' },
      { value: 'created_at', label: 'Created' },
    ],
  },
  {
    value: 'counts', label: 'Stock counts',
    columns: [
      { value: 'item_code', label: 'Item' },
      { value: 'counted', label: 'Counted qty', type: 'number' },
      { value: 'book', label: 'Book qty', type: 'number' },
      { value: 'variance', label: 'Difference', type: 'number' },
      { value: 'counted_by', label: 'Counted by' },
      { value: 'status', label: 'Status', groupable: true },
    ],
  },
  {
    value: 'orders', label: 'Sales orders',
    columns: [
      { value: 'order_no', label: 'Order no.' },
      { value: 'channel', label: 'Channel', groupable: true },
      { value: 'status', label: 'Status', groupable: true },
      { value: 'lines', label: 'Lines', type: 'number' },
      { value: 'created_at', label: 'Created' },
    ],
  },
  {
    value: 'purchase_orders', label: 'Purchase orders',
    columns: [
      { value: 'po_no', label: 'PO no.' },
      { value: 'supplier', label: 'Supplier', groupable: true },
      { value: 'status', label: 'Status', groupable: true },
      { value: 'expected_at', label: 'Expected' },
      { value: 'value', label: 'Value', type: 'number' },
    ],
  },
];

export function datasetOf(entity: unknown) {
  return REPORT_DATASETS.find((dataset) => dataset.value === entity);
}

export const STUDIO_REPORT_ROW_LIMIT = 500;

// Preserve the source URL segments used by the API entitlement and permission gates.
export const STUDIO_REPORT_SOURCES = [
  ['stock', 'inventory'], ['counts', 'counts'], ['transfers', 'transfers'],
  ['orders', 'orders'], ['purchase-orders', 'purchase_orders'],
] as const;
export type StudioReportDataset = typeof STUDIO_REPORT_SOURCES[number][1];

export function canViewStudioReports(role: string) {
  return ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'AUDITOR'].includes(role);
}

type ReportOptions = { entity?: unknown; columns?: unknown; filters?: unknown; groupBy?: unknown; view?: unknown };

export function studioReportDefinition(report: ReportOptions | null | undefined) {
  const dataset = datasetOf(report?.entity);
  if (!dataset || !Array.isArray(report?.columns) || report.columns.length > dataset.columns.length) return null;
  const byKey = new Map(dataset.columns.map((column) => [column.value, column]));
  const selected = [...new Set(report.columns)].map((key) => byKey.get(key));
  if (selected.some((column) => !column)) return null;

  const suppliedFilters = report.filters === undefined ? {} : report.filters;
  if (!suppliedFilters || typeof suppliedFilters !== 'object' || Array.isArray(suppliedFilters)) return null;
  const filters = Object.entries(suppliedFilters);
  if (filters.some(([key, value]) => {
    const column = byKey.get(key);
    return !column || (column.type === 'number'
      ? typeof value !== 'number' || !Number.isFinite(value)
      : typeof value !== 'string' || value.length > 256);
  })) return null;

  const group = typeof report.groupBy === 'string' ? byKey.get(report.groupBy) : undefined;
  if (report.groupBy !== undefined && !group?.groupable) return null;
  if (!group && selected.length === 0) return null;
  if (report.view !== undefined && report.view !== 'table' && (report.view !== 'bar' || !group)) return null;
  const columns = group
    ? [{ key: group.value, label: group.label }, { key: 'records', label: 'Records' }]
    : selected.map(({ value, label }) => ({ key: value, label }));
  return { columns, filters, groupBy: group?.value, chart: report.view === 'bar' };
}
