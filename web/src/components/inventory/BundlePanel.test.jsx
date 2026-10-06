import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { BundlePanel } from './BundlePanel.jsx';

test.afterEach(() => { cleanup(); delete globalThis.fetch; });

function stubBundle(payload) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    const body = String(url).includes('/bundle') ? payload : { items: [], nextCursor: null };
    return { ok: true, status: 200, json: async () => body };
  };
  return calls;
}

test('shows how many bundles can be built and which component limits it', async () => {
  stubBundle({
    itemId: 'b1', isBundle: true, buildable: 2, limitingItemId: 'c2',
    components: [{ itemId: 'c1', name: 'Rice', quantity: 2 }, { itemId: 'c2', name: 'Dal', quantity: 3 }],
  });
  render(React.createElement(BundlePanel, { authToken: 't', itemId: 'b1', canEdit: false }));
  await screen.findByText(/can be built/);
  assert.match(document.body.textContent, /2\s*can be built/);
  assert.match(document.body.textContent, /Limited by Dal/);
  assert.equal(screen.queryByRole('button', { name: 'Edit' }), null, 'a non-admin gets no edit control');
});

test('an admin can start editing and saving sends the component list', async () => {
  const calls = stubBundle({ itemId: 'b1', isBundle: true, buildable: 1, limitingItemId: 'c1', components: [{ itemId: 'c1', name: 'Rice', quantity: 2 }] });
  render(React.createElement(BundlePanel, { authToken: 't', itemId: 'b1', canEdit: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  const qty = screen.getByLabelText('Quantity of Rice');
  fireEvent.change(qty, { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save bundle' }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === 'PUT')));
  const put = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(JSON.parse(put.body), { components: [{ itemId: 'c1', quantity: 4 }] });
});
