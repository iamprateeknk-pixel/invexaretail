import assert from 'node:assert/strict';
import test from 'node:test';
import { studioReportResult } from './studio-report-data.js';
import { studioReportDefinition } from './studio-report-config.js';
import { rowsToCsv } from './workspace-queues.js';

test('published column order and equality filters apply only to the selected location', () => {
  const report = { entity: 'inventory', columns: ['available', 'item_code'], filters: { category: 'Snacks' } };
  const definition = studioReportDefinition(report);
  const { rows } = studioReportResult(report, definition, {
    locationId: 'warehouse',
    items: [{ id: '1', code: 'SKU-1', name: 'Nuts', category: 'Snacks' }, { id: '2', category: 'Drinks' }],
    stockRows: [
      { itemId: '1', locationId: 'store', physicalQuantity: 10 },
      { itemId: '1', locationId: 'warehouse', physicalQuantity: 10, reservedQuantity: 2, quarantineQuantity: 1 },
      { itemId: '2', locationId: 'warehouse', physicalQuantity: 10 },
    ],
  });
  assert.deepEqual(rows, [{ Available: 7, 'Item code & name': 'SKU-1 · Nuts' }]);
  assert.equal(rowsToCsv(rows), '"Available","Item code & name"\n"7","SKU-1 · Nuts"');
});

test('unsupported columns and filters cannot silently broaden a report', () => {
  assert.equal(studioReportDefinition({ entity: 'orders', columns: ['customer_email'] }), null);
  assert.equal(studioReportDefinition({ entity: 'orders', columns: ['status'], filters: { status: { ne: 'PENDING' } } }), null);
});

test('report grouping counts matching records by category and caps the projected detail', () => {
  const locationId = 'warehouse';
  const report = { entity: 'orders', columns: ['order_no'], groupBy: 'status', view: 'bar', filters: { channel: 'POS' } };
  const remote = [
    ...Array.from({ length: 501 }, () => ({ fulfillmentLocationId: locationId, channel: 'POS', status: 'PACKED' })),
    { fulfillmentLocationId: locationId, channel: 'POS', status: 'CANCELLED' },
    { fulfillmentLocationId: locationId, channel: 'WEB', status: 'PACKED' },
    { fulfillmentLocationId: 'other', channel: 'POS', status: 'PACKED' },
  ];
  const definition = studioReportDefinition(report);
  const result = studioReportResult(report, definition, { locationId, remote });
  assert.deepEqual(result.rows, [{ Status: 'PACKED', Records: 501 }, { Status: 'CANCELLED', Records: 1 }]);
  assert.equal(result.total, 2);
  assert.equal(result.truncated, false);
  const detail = { ...report, groupBy: undefined, view: 'table' };
  const detailResult = studioReportResult(detail, studioReportDefinition(detail), { locationId, remote });
  assert.equal(detailResult.rows.length, 500);
  assert.equal(detailResult.total, 502);
  assert.equal(detailResult.truncated, true);
  assert.equal(studioReportDefinition({ ...report, groupBy: 'lines' }), null);
});

test('counts, transfers, and both order datasets exclude other locations', () => {
  const locationId = 'warehouse';
  const cases = [
    ['counts', 'status', { counts: [{ locationId, status: 'Approved' }, { locationId: 'other', status: 'Rejected' }] }, 'Approved'],
    ['transfers', 'status', { transfers: [{ destinationLocationId: locationId, status: 'RECEIVED' }, { sourceLocationId: 'other', status: 'PENDING' }] }, 'RECEIVED'],
    ['orders', 'status', { remote: [{ fulfillmentLocationId: locationId, status: 'PACKED' }, { fulfillmentLocationId: 'other', status: 'PENDING' }] }, 'PACKED'],
    ['purchase_orders', 'status', { remote: [{ locationId, status: 'APPROVED' }, { locationId: 'other', status: 'DRAFT' }] }, 'APPROVED'],
  ];
  for (const [entity, column, data, status] of cases) {
    const report = { entity, columns: [column] };
    assert.deepEqual(studioReportResult(report, studioReportDefinition(report), { ...data, locationId }).rows, [{ Status: status }]);
  }
});

test('spreadsheet exports treat formula-like text as data and retain numeric negatives', () => {
  assert.equal(rowsToCsv([{ Item: '=1+1', Quantity: -2 }]), '\"Item\",\"Quantity\"\n\"\'=1+1\",\"-2\"');
});
