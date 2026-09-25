import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ImportWizard } from './ImportWizard.jsx';

test.afterEach(() => { cleanup(); delete globalThis.fetch; });

function stubApi(sequence) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    const next = sequence.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return { ok: true, status: 200, json: async () => next };
  };
  return calls;
}

const CSV = 'itemCode,lotNo,quantity,branchName\nA-1,L1,2,Basni\nA-2,L2,3,Basni\n';
const batch = (over = {}) => ({ id: 'b1', type: 'PURCHASE', fileName: 'pasted.csv', status: 'DRAFT', totalRows: 2, validRows: 0, invalidRows: 0, checkpointRowNumber: 0, ...over });

test('nothing can be previewed until the CSV has the required columns, and the problem is announced', () => {
  render(React.createElement(ImportWizard, { authToken: 't' }));
  const preview = screen.getByRole('button', { name: 'Preview and validate' });
  assert.equal(preview.disabled, true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo,bar\n1,2' } });
  assert.match(screen.getByRole('alert').textContent, /item code/i);
  assert.equal(preview.disabled, true);
});

test('preview -> validate shows counts and per-row problems, and commit is one keyboard-reachable button', async () => {
  const calls = stubApi([
    { batch: batch(), duplicate: false },                                            // create
    { validRows: 1, invalidRows: 1 },                                                 // validate
    { batch: batch({ status: 'VALIDATED', validRows: 1, invalidRows: 1 }) },          // refresh
    { rows: [{ rowNumber: 2, field: 'branchName', code: 'UNKNOWN_BRANCH', message: 'No such branch' }] }, // failures
    { queued: true },                                                                 // commit
    { batch: batch({ status: 'COMMITTING', validRows: 1, invalidRows: 1, checkpointRowNumber: 0 }) },
  ]);
  render(React.createElement(ImportWizard, { authToken: 't' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: CSV } });
  assert.match(screen.getByRole('status').textContent, /2 row\(s\) ready/);
  fireEvent.click(screen.getByRole('button', { name: 'Preview and validate' }));

  const commit = await screen.findByRole('button', { name: /Post 1 valid row/ });
  assert.equal(screen.getByTestId('batch-status').textContent, 'VALIDATED');
  assert.ok(screen.getByText('No such branch'), 'the row error is shown as text, not colour alone');
  assert.ok(screen.getByRole('button', { name: /Download failed rows/ }));
  commit.focus();
  assert.equal(document.activeElement, commit);
  fireEvent.click(commit);

  await waitFor(() => assert.equal(screen.getByTestId('batch-status').textContent, 'COMMITTING'));
  const bar = screen.getByRole('progressbar', { name: 'Posting progress' });
  assert.equal(bar.getAttribute('aria-valuenow'), '0');

  assert.match(calls[0].url, /\/imports\/staged\/batches$/);
  assert.deepEqual(JSON.parse(calls[0].body).rows[0], { itemCode: 'A-1', lotNo: 'L1', quantity: '2', branchName: 'Basni' });
  assert.match(calls[4].url, /\/batches\/b1\/commit$/);
});

test('opening stock with any invalid row cannot be committed (all-or-nothing) and says why', async () => {
  stubApi([
    { batch: batch({ type: 'OPENING_STOCK' }), duplicate: false },
    { validRows: 1, invalidRows: 1 },
    { batch: batch({ type: 'OPENING_STOCK', status: 'VALIDATED', validRows: 1, invalidRows: 1 }) },
    { rows: [{ rowNumber: 2, field: 'quantity', code: 'BAD_QTY', message: 'Malformed quantity' }] },
  ]);
  render(React.createElement(ImportWizard, { authToken: 't' }));
  fireEvent.change(screen.getByLabelText(/Import type/), { target: { value: 'OPENING_STOCK' } });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: CSV } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview and validate' }));
  const commit = await screen.findByRole('button', { name: /Post 1 valid row/ });
  assert.equal(commit.disabled, true);
  assert.match(screen.getAllByRole('alert').map((n) => n.textContent).join(' '), /all-or-nothing/i);
});

test('a committed batch offers reversal, and a duplicate upload is explained', async () => {
  stubApi([
    { batch: batch({ status: 'COMMITTED', validRows: 2 }), duplicate: true },
    { rows: [] },
  ]);
  render(React.createElement(ImportWizard, { authToken: 't' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: CSV } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview and validate' }));
  assert.ok(await screen.findByRole('button', { name: 'Reverse this import' }));
  assert.match(screen.getByText(/already uploaded/).textContent, /existing batch/);
});
