import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { TableToolbar } from './table-toolbar.jsx';
import { DEFAULT_TABLE_STATE } from '../../lib/table-state.js';

test.afterEach(() => cleanup());

function memoryStorage() {
  const data = {};
  return { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
}

function Harness({ storage, onState }) {
  const [state, setState] = React.useState(DEFAULT_TABLE_STATE);
  onState(state);
  return React.createElement(TableToolbar, { tableId: 't', userId: 'u1', state, onChange: setState, defaults: DEFAULT_TABLE_STATE, storage });
}

test('search is a labelled field and typing updates state and resets the page', () => {
  let latest;
  render(React.createElement(Harness, { storage: memoryStorage(), onState: (s) => { latest = s; } }));
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'rice' } });
  assert.equal(latest.q, 'rice');
  assert.equal(latest.page, 1);
});

test('density buttons expose their state through aria-pressed, not colour alone', () => {
  render(React.createElement(Harness, { storage: memoryStorage(), onState: () => {} }));
  const compact = screen.getByRole('button', { name: 'compact' });
  assert.equal(compact.getAttribute('aria-pressed'), 'false');
  fireEvent.click(compact);
  assert.equal(screen.getByRole('button', { name: 'compact' }).getAttribute('aria-pressed'), 'true');
  assert.equal(screen.getByRole('button', { name: 'comfortable' }).getAttribute('aria-pressed'), 'false');
});

test('a saved view can be applied and deleted, and Save is disabled until it has a name', () => {
  let latest;
  render(React.createElement(Harness, { storage: memoryStorage(), onState: (s) => { latest = s; } }));
  assert.equal(screen.getByRole('button', { name: 'Save' }).disabled, true);
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'milk' } });
  fireEvent.change(screen.getByLabelText('Save view as'), { target: { value: 'Dairy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
  assert.equal(latest.q, '');
  fireEvent.click(screen.getByRole('button', { name: 'Dairy' }));
  assert.equal(latest.q, 'milk');
  fireEvent.click(screen.getByRole('button', { name: 'Delete view Dairy' }));
  assert.equal(screen.queryByRole('button', { name: 'Dairy' }), null);
});

test('density control can be hidden for card lists where it would do nothing', () => {
  render(React.createElement(TableToolbar, { tableId: 't', userId: 'u1', state: DEFAULT_TABLE_STATE, onChange: () => {}, defaults: DEFAULT_TABLE_STATE, storage: memoryStorage(), showDensity: false }));
  assert.equal(screen.queryByRole('group', { name: 'Row density' }), null);
  assert.ok(screen.getByLabelText('Search'));
});

test('the column manager lists columns as checkboxes, hides one, and never lets the last one go', () => {
  const columns = [{ id: 'item', label: 'Item' }, { id: 'qty', label: 'Quantity' }];
  function ColumnsHarness() {
    const [state, setState] = React.useState(DEFAULT_TABLE_STATE);
    return React.createElement('div', null,
      React.createElement(TableToolbar, { tableId: 't', userId: 'u1', state, onChange: setState, defaults: DEFAULT_TABLE_STATE, storage: memoryStorage(), columns }),
      React.createElement('output', { 'data-testid': 'cols' }, state.cols));
  }
  render(React.createElement(ColumnsHarness));
  const qty = screen.getByRole('checkbox', { name: 'Quantity' });
  assert.equal(qty.checked, true);
  fireEvent.click(qty);
  assert.equal(screen.getByTestId('cols').textContent, 'qty');
  assert.equal(screen.getByRole('checkbox', { name: 'Quantity' }).checked, false);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Item' }));
  assert.equal(screen.getByTestId('cols').textContent, 'qty', 'the last visible column stays');
});

test('Export CSV is a real button, disabled with no rows, and shows how many rows it will export', () => {
  const exportCsv = { filename: 'x', columns: [{ label: 'A', value: (r) => r.a }], rows: [{ a: 1 }, { a: 2 }] };
  const { rerender } = render(React.createElement(TableToolbar, { tableId: 't', userId: 'u1', state: DEFAULT_TABLE_STATE, onChange: () => {}, defaults: DEFAULT_TABLE_STATE, storage: memoryStorage(), exportCsv }));
  assert.equal(screen.getByRole('button', { name: 'Export CSV (2)' }).disabled, false);
  rerender(React.createElement(TableToolbar, { tableId: 't', userId: 'u1', state: DEFAULT_TABLE_STATE, onChange: () => {}, defaults: DEFAULT_TABLE_STATE, storage: memoryStorage(), exportCsv: { ...exportCsv, rows: [] } }));
  assert.equal(screen.getByRole('button', { name: 'Export CSV' }).disabled, true);
});
