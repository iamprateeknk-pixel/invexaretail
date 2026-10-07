import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { useTableView } from './useTableView.js';

test.afterEach(() => { cleanup(); window.location.hash = ''; });

const ROWS = [{ name: 'Rice bag' }, { name: 'Milk' }];
const fields = (row) => [row.name];

function Harness() {
  const view = useTableView(ROWS, fields);
  return React.createElement('div', null,
    React.createElement('input', { 'aria-label': 'q', value: view.state.q, onChange: (e) => view.setState({ ...view.state, q: e.target.value }) }),
    React.createElement('ul', null, view.visible.map((row) => React.createElement('li', { key: row.name }, row.name))));
}

test('state is read from the hash query on load, so a refresh or shared link keeps the search', () => {
  window.location.hash = '#/orders?q=rice';
  render(React.createElement(Harness));
  assert.equal(screen.getByLabelText('q').value, 'rice');
  assert.deepEqual(screen.getAllByRole('listitem').map((li) => li.textContent), ['Rice bag']);
});

test('typing writes the query into the hash, keeps the section path, and does not add history entries', () => {
  window.location.hash = '#/orders';
  const before = window.history.length;
  render(React.createElement(Harness));
  fireEvent.change(screen.getByLabelText('q'), { target: { value: 'milk' } });
  assert.equal(window.location.hash, '#/orders?q=milk');
  assert.equal(window.history.length, before);
  fireEvent.change(screen.getByLabelText('q'), { target: { value: '' } });
  assert.equal(window.location.hash, '#/orders', 'clearing the search leaves a clean URL');
});

test('editing the hash by hand updates the table', () => {
  window.location.hash = '#/orders';
  render(React.createElement(Harness));
  act(() => { window.location.hash = '#/orders?q=milk'; window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
  assert.equal(screen.getByLabelText('q').value, 'milk');
  assert.deepEqual(screen.getAllByRole('listitem').map((li) => li.textContent), ['Milk']);
});
