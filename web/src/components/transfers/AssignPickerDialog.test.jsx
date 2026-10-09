import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { AssignPickerForm } from './AssignPickerDialog.jsx';

test.afterEach(() => { cleanup(); delete globalThis.fetch; });

function stubApi(sequence) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    const next = sequence.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return { ok: next.status ? next.status < 400 : true, status: next.status ?? 200, json: async () => next.body ?? next };
  };
  return calls;
}

const transfer = { id: 'tr-9', fromName: 'Warehouse', toName: 'Main Store' };
const pickers = [{ id: 'p-1', name: 'Asha', email: 'asha@x.local' }, { id: 'p-2', name: 'Ravi', email: 'ravi@x.local' }];

test('lists the eligible pickers in a labelled, keyboard-reachable select and saves the choice', async () => {
  const calls = stubApi([{ assignedPickerId: null, pickers }, { success: true, transfer: { ...transfer, assignedPickerId: 'p-2' } }]);
  let assigned = null;
  let closed = false;
  render(React.createElement(AssignPickerForm, { transfer, token: 't', onAssigned: (next) => { assigned = next; }, onClose: () => { closed = true; } }));

  const select = await screen.findByRole('combobox', { name: 'Picker' });
  await waitFor(() => assert.equal(select.disabled, false));
  assert.deepEqual([...select.options].map((option) => option.textContent), ['Any picker at Warehouse', 'Asha (asha@x.local)', 'Ravi (ravi@x.local)']);
  const save = screen.getByRole('button', { name: 'Save' });
  assert.equal(save.disabled, true, 'nothing to save until the choice changes');

  select.focus();
  assert.equal(document.activeElement, select);
  fireEvent.change(select, { target: { value: 'p-2' } });
  fireEvent.click(save);

  await waitFor(() => assert.equal(closed, true));
  assert.equal(assigned.assignedPickerId, 'p-2');
  assert.match(calls[0].url, /\/transfers\/tr-9\/eligible-pickers$/);
  assert.equal(calls[1].method, 'PATCH');
  assert.match(calls[1].url, /\/transfers\/tr-9\/picker$/);
  assert.deepEqual(JSON.parse(calls[1].body), { pickerId: 'p-2' });
});

test('choosing "any picker" unassigns with null, and a refusal is announced as text', async () => {
  stubApi([
    { assignedPickerId: 'p-1', pickers },
    { status: 409, body: { message: 'A picker can only be assigned before picking is finished; this transfer is CONFIRMED.' } },
  ]);
  render(React.createElement(AssignPickerForm, { transfer: { ...transfer, assignedPickerId: 'p-1' }, token: 't', onClose: () => {} }));
  const select = await screen.findByRole('combobox', { name: 'Picker' });
  await waitFor(() => assert.equal(select.value, 'p-1'));
  fireEvent.change(select, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent, /before picking is finished/);
});

test('a location with no picker says so instead of showing an empty list', async () => {
  stubApi([{ assignedPickerId: null, pickers: [] }]);
  render(React.createElement(AssignPickerForm, { transfer, token: 't', onClose: () => {} }));
  await waitFor(() => assert.match(screen.getByRole('status').textContent, /No warehouse picker is assigned to Warehouse/));
});
