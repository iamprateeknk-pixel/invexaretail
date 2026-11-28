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
