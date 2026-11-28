import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { StudioExpiryTasks } from './StudioExpiryTasks.jsx';

const tasks = [{ id: 'task-1', status: 'ACTIVE', recommendedAction: 'Check the shelf', item: { name: 'Milk' }, lot: { lotNo: 'L1' } }];

test('an admin can acknowledge and resolve an expiry task with a reason', async () => {
  const previousFetch = globalThis.fetch;
  const commands = [];
  globalThis.fetch = async (url, init) => {
    if (!init.method) {
      assert.match(url, /locationId=loc-1&source=studio/);
      return Response.json({ alerts: tasks });
    }
    assert.match(url, /\/expiry-alerts\/task-1\/status$/);
    commands.push(JSON.parse(init.body));
    return Response.json({ alert: {} });
  };
  try {
    render(React.createElement(StudioExpiryTasks, { role: 'ADMIN', locationId: 'loc-1', authToken: 'token' }));
    const acknowledge = await screen.findByLabelText('Acknowledge expiry task for lot L1');
    assert.equal(acknowledge.tagName, 'BUTTON');
    acknowledge.focus();
    assert.equal(document.activeElement, acknowledge);
    fireEvent.click(acknowledge);
    await screen.findByText('Acknowledged');
    fireEvent.click(screen.getByText('Resolve', { selector: 'button' }));
    const confirm = screen.getByText('Confirm resolution', { selector: 'button' });
    assert.equal(confirm.disabled, true);
    fireEvent.change(screen.getByLabelText('Resolution reason'), { target: { value: 'Moved to chilled display' } });
    fireEvent.click(confirm);
    await waitFor(() => assert.ok(!screen.queryByText('Milk · Lot L1')));
    assert.deepEqual(commands, [{ status: 'ACKNOWLEDGED' }, { status: 'RESOLVED', reason: 'Moved to chilled display' }]);
  } finally {
    cleanup();
    globalThis.fetch = previousFetch;
  }
});
