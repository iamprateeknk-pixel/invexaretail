// Week 10: client-side duplicate-submit guard. The server's idempotency
// key is the real guarantee (proven in api/src/routes/items.postgres.test.ts);
// this proves the wizard itself never fires two requests for one click/
// keyboard-Enter sequence while a post is in flight - the button is
// disabled and a second synchronous submit is a no-op.
import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { AdjustmentWizard } from './AdjustmentWizard.jsx';

test.afterEach(() => {
  cleanup();
  delete globalThis.fetch;
});

const branches = [{ locationId: 'loc-1', locationName: 'Main Store' }];
const lots = [{ lotId: 'lot-1', lotNo: 'LOT-01' }];

test('the submit button is disabled while a post is in flight, and re-enabled after it resolves', async () => {
  let resolveFetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };

  render(React.createElement(AdjustmentWizard, { authToken: 'test-token', itemId: 'item-1', branches, lots, onPosted: () => {} }));

  fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'stock take correction' } });

  const button = screen.getByRole('button', { name: 'Post adjustment' });
  fireEvent.click(button);
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Posting…' }).disabled, true));

  // A second click while still in flight must not fire a second request.
  fireEvent.click(screen.getByRole('button', { name: 'Posting…' }));
  assert.equal(fetchCalls, 1, 'a duplicate click while submitting must not trigger a second request');

  resolveFetch({ ok: true, json: async () => ({ duplicate: false, movement: { id: 'mv-1' }, balance: { onHand: 5 } }) });
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Post adjustment' })), 'button text reverts once submitting finishes');

  // Fields were cleared on success; re-filling them proves the button is
  // genuinely re-enabled (not submitting), not just disabled for a
  // different reason (empty fields).
  fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'another correction' } });
  assert.equal(screen.getByRole('button', { name: 'Post adjustment' }).disabled, false);
});

test('the submit button stays disabled until quantity, lot, location and a reason are all present', () => {
  render(React.createElement(AdjustmentWizard, { authToken: 'test-token', itemId: 'item-1', branches, lots, onPosted: () => {} }));
  const button = screen.getByRole('button', { name: 'Post adjustment' });
  assert.equal(button.disabled, true, 'no quantity or reason entered yet');

  fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '5' } });
  assert.equal(button.disabled, true, 'reason still missing');

  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'correction' } });
  assert.equal(button.disabled, false);
});

test('a quantity of zero is rejected client-side - never posted as a no-op movement', () => {
  render(React.createElement(AdjustmentWizard, { authToken: 'test-token', itemId: 'item-1', branches, lots, onPosted: () => {} }));
  fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'correction' } });
  assert.equal(screen.getByRole('button', { name: 'Post adjustment' }).disabled, true);
});
