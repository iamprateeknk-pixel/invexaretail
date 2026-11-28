import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceProvider } from '../WorkspaceContext.jsx';
import { StudioReports } from './StudioReports.jsx';

test('published inventory reports render and export the server result instead of cached stock', async () => {
  const previous = globalThis.fetch;
  const downloads = [];
  const requests = [];
  let available = 8;
  globalThis.fetch = async (url) => {
    requests.push(url);
    return Response.json({
      version: 3, columns: [{ key: 'available', label: 'Available' }, { key: 'item_code', label: 'Item code & name' }],
      groupBy: null, chart: false, total: 1, truncated: false, rows: [{ Available: available, 'Item code & name': 'A1 · Nuts' }],
    });
  };
  const workspace = {
    runtimeConfig: { version: 3, reports: [{ key: 'snacks', name: 'Snack stock', entity: 'inventory', columns: ['available', 'item_code'], filters: { category: 'Snacks' } }] },
    authToken: 'test-token', locationId: 'warehouse',
    items: [{ id: 'a', name: 'Nuts', code: 'A1', category: 'Snacks' }],
    stockRows: [{ itemId: 'a', locationId: 'warehouse', physicalQuantity: 7 }, { itemId: 'a', locationId: 'store', physicalQuantity: 20 }],
    downloadReportCsv: (...args) => downloads.push(args),
  };
  try {
    const { rerender } = render(<WorkspaceProvider value={workspace}><StudioReports /></WorkspaceProvider>);
    await screen.findByText('8');
    assert.deepEqual(screen.getAllByRole('columnheader').map((header) => header.textContent), ['Available', 'Item code & name']);
    assert.equal(screen.queryByText('7'), null);
    assert.deepEqual(requests, ['/api/v1/reports/studio/stock?reportKey=snacks&locationId=warehouse']);
    fireEvent.click(screen.getByRole('button', { name: 'Export published report' }));
    assert.deepEqual(downloads, [[[ { Available: 8, 'Item code & name': 'A1 · Nuts' } ], 'studio-snacks']]);
    available = 9;
    rerender(<WorkspaceProvider value={{ ...workspace, stockRows: [...workspace.stockRows] }}><StudioReports /></WorkspaceProvider>);
    await screen.findByText('9');
    assert.equal(requests.length, 2, 'an operational stock refresh reruns the published report');
  } finally { cleanup(); globalThis.fetch = previous; }
});

test('a database-free demo displays exact grouped totals from the scoped workspace rows', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: 'Database required.' }, { status: 501 });
  const downloads = [];
  const workspace = {
    runtimeConfig: { reports: [{ key: 'by-status', name: 'Counts by status', entity: 'counts', columns: ['status'],
      groupBy: 'status', view: 'bar', filters: { counted: 7 } }] },
    authToken: 'test-token', locationId: 'warehouse',
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
    await screen.findByText('Approved');
    assert.deepEqual(screen.getAllByRole('columnheader').map((header) => header.textContent), ['Status', 'Records']);
    const [label, count] = screen.getAllByRole('cell');
    assert.equal(label.textContent, 'Approved');
    assert.equal(count.textContent, '2');
    assert.equal(count.querySelector('meter').getAttribute('value'), '2');
    fireEvent.click(screen.getByRole('button', { name: 'Export published report' }));
    assert.deepEqual(downloads, [[[ { Status: 'Approved', Records: 2 } ], 'studio-by-status']]);
  } finally { cleanup(); globalThis.fetch = previous; }
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
