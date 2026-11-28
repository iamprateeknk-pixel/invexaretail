import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceProvider } from '../WorkspaceContext.jsx';
import { QuickAddDialog } from './QuickAddDialog.jsx';

test('Quick Add waits for the published form and submits typed role-visible values', async (t) => {
  t.mock.property(globalThis, 'CustomEvent', window.CustomEvent);
  t.mock.property(globalThis, 'FormData', window.FormData);
  const previous = globalThis.fetch;
  let deliverForm;
  const received = [];
  globalThis.fetch = async (path) => {
    assert.equal(path, '/api/v1/items/studio-create-fields');
    return new Promise((resolve) => { deliverForm = resolve; });
  };
  try {
    render(
      <WorkspaceProvider value={{
        authToken: 'test', modalOpen: 'quickAdd', setModalOpen: () => {},
        quickAddForm: { code: 'SKU-1', name: 'Item' },
        createQuickItem: async (input) => {
          received.push(input);
          return received.length === 1 ? 'CONCURRENT_UPDATE_CONFLICT' : undefined;
        },
      }}>
        <QuickAddDialog />
      </WorkspaceProvider>,
    );
    assert.equal(screen.getByRole('button', { name: 'Save item' }).disabled, true);
    deliverForm(Response.json({
      versionId: 'live-2', fields: [
        { key: 'case_size', label: 'Case size', type: 'number', required: true, value: null },
        { key: 'fragile', label: 'Fragile', type: 'boolean', required: true, value: false },
      ],
    }));
    const size = await screen.findByRole('spinbutton', { name: 'Case size' });
    assert.equal(size.required, true);
    size.focus();
    assert.equal(document.activeElement, size);
    fireEvent.change(size, { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => assert.deepEqual(received, [{ versionId: 'live-2', values: { case_size: 12.5, fragile: false } }]));
    fireEvent.click(await screen.findByRole('button', { name: 'Reload item fields' }));
    deliverForm(Response.json({ versionId: 'live-3', fields: [
      { key: 'case_size', label: 'Pack size', type: 'number', required: true, value: 10 },
    ] }));
    await screen.findByRole('spinbutton', { name: 'Pack size' });
    assert.equal(screen.getByRole('textbox', { name: 'Item code' }).value, 'SKU-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => assert.deepEqual(received[1], { versionId: 'live-3', values: { case_size: 10 } }));
  } finally {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.fetch = previous;
  }
});
