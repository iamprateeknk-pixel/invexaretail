import { datasetOf } from '../control-plane/studio-catalog.js';
import { availableQuantity, stockRowValues } from './stock-table.js';

export const remoteReportPaths = {
  orders: '/api/v1/orders',
  purchase_orders: '/api/v1/purchase-orders',
};

export function studioReportDefinition(report) {
  const dataset = datasetOf(report?.entity);
  const columns = new Map(dataset?.columns.map(({ value, label }) => [value, label]));
  const selected = [...new Set(Array.isArray(report?.columns) ? report.columns : [])];
  const filters = Object.entries(report?.filters ?? {});
  if (!dataset || !selected.length || selected.some((key) => !columns.has(key)) ||
      filters.some(([key, value]) => !columns.has(key) || !['string', 'number', 'boolean'].includes(typeof value))) {
    return null;
  }
  return { columns: selected.map((key) => ({ key, label: columns.get(key) })), filters };
}

export function studioReportRows(report, definition, { locationId, stockRows = [], items = [], counts = [], transfers = [], locations = [], remote = [] }) {
  const itemLabel = ({ code, name } = {}) => [code, name].filter(Boolean).join(' · ');
  const catalog = new Map(items.map((item) => [item.id, item]));
  const places = new Map(locations.map(({ id, name }) => [id, name]));
  let rows;
  switch (report.entity) {
    case 'inventory':
      rows = stockRows.filter((row) => row.locationId === locationId).map((row) => {
        const item = catalog.get(row.itemId);
        return { item_code: itemLabel(item) || row.itemName || row.itemId, category: item?.category, company: item?.company,
          ...stockRowValues(row), available: availableQuantity(row) };
      });
      break;
    case 'counts':
      rows = counts.filter((row) => row.locationId === locationId).map((row) => ({
        item_code: itemLabel(catalog.get(row.itemId)) || row.item || row.itemId,
        counted: row.physicalQuantity, book: row.bookQuantity ?? row.bookQty,
        variance: row.variance, counted_by: row.submittedBy, status: row.status,
      }));
      break;
    case 'transfers':
      rows = transfers.filter((row) => row.sourceLocationId === locationId || row.destinationLocationId === locationId).map((row) => ({
        transfer_no: row.number ?? row.id, from: places.get(row.sourceLocationId), to: places.get(row.destinationLocationId),
        status: row.status, items: new Set((row.lines ?? []).map((line) => line.itemId)).size, created_at: row.createdAt,
      }));
      break;
    case 'orders':
      rows = remote.filter((row) => row.fulfillmentLocationId === locationId).map((row) => ({
        order_no: row.externalReference ?? row.id, channel: row.channel, status: row.status,
        lines: row.lines?.length, created_at: row.createdAt,
      }));
      break;
    case 'purchase_orders':
      rows = remote.filter((row) => row.locationId === locationId).map((row) => ({
        po_no: row.number, supplier: row.supplier?.name, status: row.status, expected_at: row.expectedAt, value: row.totalAmount,
      }));
      break;
    default: return [];
  }
  return rows.filter((row) => definition.filters.every(([key, value]) => row[key] === value))
    .map((row) => Object.fromEntries(definition.columns.map(({ key, label }) => [label, row[key] ?? ''])));
}
