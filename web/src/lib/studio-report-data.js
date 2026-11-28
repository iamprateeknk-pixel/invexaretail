import { STUDIO_REPORT_ROW_LIMIT } from './studio-report-config.js';
import { availableQuantity, stockRowValues } from './stock-table.js';

export const remoteReportPaths = {
  orders: '/api/v1/orders',
  purchase_orders: '/api/v1/purchase-orders',
};

export function studioReportResult(report, definition, { locationId, stockRows = [], items = [], counts = [], transfers = [], locations = [], remote = [] }) {
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
    default: rows = [];
  }
  rows = rows.filter((row) => definition.filters.every(([key, value]) => row[key] === value));
  if (definition.groupBy) {
    const groups = new Map();
    for (const row of rows) {
      const key = String(row[definition.groupBy] ?? '');
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    rows = Array.from(groups, ([key, records]) => ({ [definition.groupBy]: key, records }))
      .sort((left, right) => right.records - left.records || left[definition.groupBy].localeCompare(right[definition.groupBy], 'en-IN'));
  }
  return {
    total: rows.length,
    truncated: rows.length > STUDIO_REPORT_ROW_LIMIT,
    rows: rows.slice(0, STUDIO_REPORT_ROW_LIMIT)
      .map((row) => Object.fromEntries(definition.columns.map(({ key, label }) => [label, row[key] ?? '']))),
  };
}
