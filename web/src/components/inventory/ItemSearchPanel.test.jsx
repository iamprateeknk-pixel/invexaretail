// Week 10: keyboard flow + accessible roles for the item search panel -
// the guide's "keyboard/responsive/accessibility states" mandatory
// verification. Mocks fetch (no real server) since this is a component
// unit test, not an integration test - the real server-paginated search
// is proven against Postgres in api/src/lib/repositories/item-repository.postgres.test.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ItemSearchPanel } from './ItemSearchPanel.jsx';

test.afterEach(() => {
  cleanup();
  delete globalThis.fetch;
});

function mockSearchResponse(items, nextCursor = null) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ items, nextCursor }),
  });
}

test('typing a query renders results as an accessible listbox with option roles', async () => {
  mockSearchResponse([{ id: 'item-1', code: 'RICE-01', name: 'Basmati Rice' }, { id: 'item-2', code: 'OIL-01', name: 'Sunflower Oil' }]);
  render(React.createElement(ItemSearchPanel, { authToken: 'test-token', onSelectItem: () => {} }));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rice' } });

  await waitFor(() => assert.ok(screen.getByRole('listbox')));
  const options = screen.getAllByRole('option');
  assert.equal(options.length, 2);
});

test('ArrowDown highlights the first result and Enter selects it', async () => {
  mockSearchResponse([{ id: 'item-1', code: 'RICE-01', name: 'Basmati Rice' }, { id: 'item-2', code: 'OIL-01', name: 'Sunflower Oil' }]);
  let selected = null;
  render(React.createElement(ItemSearchPanel, { authToken: 'test-token', onSelectItem: (item) => { selected = item; } }));

  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'a' } });
  await waitFor(() => assert.equal(screen.getAllByRole('option').length, 2));

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const firstOption = screen.getAllByRole('option')[0];
  assert.equal(firstOption.getAttribute('aria-selected'), 'true');

  fireEvent.keyDown(input, { key: 'Enter' });
  assert.equal(selected?.id, 'item-1');
});

test('ArrowDown then ArrowDown again moves to the second result, not past the end', async () => {
  mockSearchResponse([{ id: 'item-1', code: 'A', name: 'A' }, { id: 'item-2', code: 'B', name: 'B' }]);
  render(React.createElement(ItemSearchPanel, { authToken: 'test-token', onSelectItem: () => {} }));

  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'x' } });
  await waitFor(() => assert.equal(screen.getAllByRole('option').length, 2));

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' }); // past the end - must clamp, not throw or wrap into an invalid index
  const options = screen.getAllByRole('option');
  assert.equal(options[1].getAttribute('aria-selected'), 'true');
});

test('an empty result set for a non-empty query shows the shared EmptyState, not a blank panel', async () => {
  mockSearchResponse([]);
  render(React.createElement(ItemSearchPanel, { authToken: 'test-token', onSelectItem: () => {} }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nonexistent' } });
  await waitFor(() => assert.ok(screen.getByText('No items match your search')));
});

test('a fetch failure shows the shared ErrorState with a working retry action', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('network down');
    return { ok: true, json: async () => ({ items: [{ id: 'item-1', code: 'A', name: 'A' }], nextCursor: null }) };
  };
  render(React.createElement(ItemSearchPanel, { authToken: 'test-token', onSelectItem: () => {} }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } });

  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Try again' })));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => assert.equal(screen.getAllByRole('option').length, 1));
});
