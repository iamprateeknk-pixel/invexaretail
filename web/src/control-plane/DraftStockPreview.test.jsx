import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DraftStockPreview } from './DraftStockPreview.jsx';
import { StockItemsTable } from '../components/inventory/StockItemsTable.jsx';

test('the draft stock preview renders sample rows and recalculates the view for role, device and location', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { cleanup(); globalThis.fetch = originalFetch; });
  const requests = [];
  const published = [];
  const locations = [{ id: 'loc-1', name: 'Main Store', type: 'store' }, { id: 'wh-1', name: 'Warehouse', type: 'warehouse' }];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/studio/v1/preview');
    const input = JSON.parse(options.body);
    requests.push(input);
    const page = {
      columns: [
        { key: 'item_code', label: 'Item', source: 'core', visible: true },
        { key: 'physical', label: 'Physical', source: 'core', visible: true },
        { key: 'book', label: 'Book stock', source: 'core', visible: true },
        { key: 'calc_book', label: 'Book doubled', source: 'formula', formula: 'book * 2', visible: true },
      ],
      actions: [{ key: 'scan', label: 'Scan item', enabled: true }],
    };
    const location = locations.find((entry) => entry.id === input.locationId) ?? locations[0];
    return { ok: true, json: async () => ({ preview: { ...input, location, locations, page, version: 2, draftRevision: 'reviewed-revision' } }) };
  };
  render(<DraftStockPreview controlToken="locked" onPublish={async (revision) => { published.push(revision); }} />);
  assert.equal(screen.getByRole('button', { name: 'Publish reviewed draft' }).disabled, true);
  await screen.findByRole('table', { name: 'Draft stock table' });
  assert.ok(screen.getByRole('columnheader', { name: 'Book doubled' }));
  assert.equal(screen.getByRole('button', { name: 'Scan item' }).disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'Export' }), null);
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'STORE_USER' } });
  await screen.findByRole('table', { name: 'Draft stock table' });
  assert.equal(screen.queryByRole('columnheader', { name: 'Book stock' }), null);
  assert.equal(screen.queryByRole('columnheader', { name: 'Book doubled' }), null);
  fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'mobile' } });
  await screen.findByRole('table', { name: 'Draft stock table' });
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'wh-1' } });
  await screen.findByRole('table', { name: 'Draft stock table' });
  assert.deepEqual(requests.at(-1), { role: 'STORE_USER', device: 'mobile', locationId: 'wh-1' });
  assert.ok(screen.getByText('Warehouse · Phone'));
  fireEvent.click(screen.getByRole('button', { name: 'Publish reviewed draft' }));
  assert.deepEqual(published, ['reviewed-revision']);
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Publish reviewed draft' }).disabled, false));
});

test('the shared stock table keeps the live item details action keyboard focusable', (t) => {
  t.after(cleanup);
  const opened = [];
  const item = { id: 'item-1', code: 'RICE-1', name: 'Rice' };
  const row = { itemId: item.id, locationId: 'loc-1' };
  render(<StockItemsTable columns={[{ key: 'item_code', label: 'Item', source: 'core' }]} rows={[row]} items={[item]}
    onOpenItem={(...args) => opened.push(args)} />);
  const entry = screen.getByRole('button', { name: 'Open item RICE-1 Rice' });
  entry.focus();
  assert.equal(document.activeElement, entry);
  fireEvent.click(entry);
  assert.deepEqual(opened, [[row, item]]);
});
