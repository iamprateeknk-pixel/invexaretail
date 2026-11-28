import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceProvider } from '../WorkspaceContext.jsx';
import { StudioReports } from './StudioReports.jsx';

test('published reports render the configured columns and export only matching stock', () => {
  const downloads = [];
  const workspace = {
    runtimeConfig: { reports: [{ key: 'snacks', name: 'Snack stock', entity: 'inventory', columns: ['available', 'item_code'], filters: { category: 'Snacks' } }] },
    locationId: 'warehouse',
    items: [{ id: 'a', name: 'Nuts', code: 'A1', category: 'Snacks' }],
    stockRows: [{ itemId: 'a', locationId: 'warehouse', physicalQuantity: 7 }, { itemId: 'a', locationId: 'store', physicalQuantity: 20 }],
    downloadReportCsv: (...args) => downloads.push(args),
  };
  try {
    render(<WorkspaceProvider value={workspace}><StudioReports /></WorkspaceProvider>);
    assert.deepEqual(screen.getAllByRole('columnheader').map((header) => header.textContent), ['Available', 'Item code & name']);
    assert.ok(screen.getByText('7'));
    assert.equal(screen.queryByText('20'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Export published report' }));
    assert.deepEqual(downloads, [[[ { Available: 7, 'Item code & name': 'A1 · Nuts' } ], 'studio-snacks']]);
  } finally { cleanup(); }
});

test('a published chart displays exact totals in the table and exports the grouped result', () => {
  const downloads = [];
  const workspace = {
    runtimeConfig: { reports: [{ key: 'by-status', name: 'Counts by status', entity: 'counts', columns: ['status'],
      groupBy: 'status', view: 'bar', filters: { counted: 7 } }] },
    locationId: 'warehouse',
    counts: [
      { locationId: 'warehouse', status: 'Approved', physicalQuantity: 7 },
      { locationId: 'warehouse', status: 'Approved', physicalQuantity: 7 },
      { locationId: 'warehouse', status: 'Rejected', physicalQuantity: 8 },
      { locationId: 'other', status: 'Approved', physicalQuantity: 7 },
    ],
    downloadReportCsv: (...args) => downloads.push(args),
  };
  try {
    render(<WorkspaceProvider value={workspace}><StudioReports /></WorkspaceProvider>);
    assert.deepEqual(screen.getAllByRole('columnheader').map((header) => header.textContent), ['Status', 'Records']);
    const [label, count] = screen.getAllByRole('cell');
    assert.equal(label.textContent, 'Approved');
    assert.equal(count.textContent, '2');
    assert.equal(count.querySelector('meter').getAttribute('value'), '2');
    fireEvent.click(screen.getByRole('button', { name: 'Export published report' }));
    assert.deepEqual(downloads, [[[ { Status: 'Approved', Records: 2 } ], 'studio-by-status']]);
  } finally { cleanup(); }
});

test('order reports fetch a published report key and location and use the API result for CSV', async () => {
  const previous = globalThis.fetch;
  const downloads = [];
  const paths = [];
  globalThis.fetch = async (url, init) => {
    paths.push(url);
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    return Response.json({
      version: 3, columns: [{ key: 'status', label: 'Status' }, { key: 'records', label: 'Records' }],
      groupBy: 'status', chart: true, total: 505, truncated: true, rows: [{ Status: 'PACKED', Records: 73 }],
    });
  };
  const workspace = {
    runtimeConfig: { version: 3, reports: [{ key: 'shipments', name: 'Orders ready', entity: 'orders', columns: ['status'], groupBy: 'status' }] },
    authToken: 'test-token', locationId: 'store-1', downloadReportCsv: (...args) => downloads.push(args),
  };
  try {
    render(<WorkspaceProvider value={workspace}><StudioReports /></WorkspaceProvider>);
    const packed = await screen.findByText('PACKED');
    assert.ok(packed);
    assert.deepEqual(paths, ['/api/v1/reports/studio/orders?reportKey=shipments&locationId=store-1']);
    assert.match(screen.getByRole('status').textContent, /1 of 505 matching groups/);
    fireEvent.click(screen.getByRole('button', { name: 'Export published report' }));
    assert.deepEqual(downloads, [[[ { Status: 'PACKED', Records: 73 } ], 'studio-shipments']]);
  } finally { cleanup(); globalThis.fetch = previous; }
});

test('a denied order report does not fetch the underlying order list', async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return Response.json({ error: 'Location access denied.' }, { status: 403 });
  };
  const workspace = {
    runtimeConfig: { version: 3, reports: [{ key: 'orders', name: 'Orders', entity: 'orders', columns: ['status'] }] },
    authToken: 'test-token', locationId: 'other-location', downloadReportCsv: () => assert.fail('cannot export a denied report'),
  };
  try {
    render(<WorkspaceProvider value={workspace}><StudioReports /></WorkspaceProvider>);
    await screen.findByText('Location access denied.');
    assert.equal(screen.getByRole('button', { name: 'Export published report' }).disabled, true);
    assert.deepEqual(requests, ['/api/v1/reports/studio/orders?reportKey=orders&locationId=other-location']);
  } finally { cleanup(); globalThis.fetch = previous; }
});
