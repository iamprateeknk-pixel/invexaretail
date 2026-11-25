import assert from 'node:assert/strict';
import test from 'node:test';
import { studioReportDefinition, studioReportRows } from './studio-report-data.js';
import { rowsToCsv } from './workspace-queues.js';

test('published column order and equality filters apply only to the selected location', () => {
  const report = { entity: 'inventory', columns: ['available', 'item_code'], filters: { category: 'Snacks' } };
  const definition = studioReportDefinition(report);
  const rows = studioReportRows(report, definition, {
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
    assert.deepEqual(studioReportRows(report, studioReportDefinition(report), { ...data, locationId }), [{ Status: status }]);
  }
});

test('spreadsheet exports treat formula-like text as data and retain numeric negatives', () => {
  assert.equal(rowsToCsv([{ Item: '=1+1', Quantity: -2 }]), '\"Item\",\"Quantity\"\n\"\'=1+1\",\"-2\"');
});
