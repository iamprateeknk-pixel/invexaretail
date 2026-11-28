import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioItemFieldsPanel } from './StudioItemFieldsPanel.jsx';

test('published fields expose editable and read-only values and save using the loaded version', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => { cleanup(); globalThis.fetch = fetch; });
  const writes = [];
  globalThis.fetch = async (url, options) => {
    if (options.method === 'PUT') {
      writes.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ key: 'case_size', value: 16 }) };
    }
    return { ok: true, json: async () => ({ versionId: 'published-2', fields: [
      { key: 'case_size', label: 'Case size', type: 'number', editable: true, value: 12, required: true },
      { key: 'rack', label: 'Rack', type: 'text', editable: false, value: 'R4' },
    ] }) };
  };
  render(<StudioItemFieldsPanel authToken="token" itemId="item-1" />);
  const input = await screen.findByRole('spinbutton', { name: 'Case size' });
  assert.equal(input.required, true);
  assert.equal(screen.queryByRole('textbox', { name: 'Rack' }), null);
  assert.ok(screen.getByText('R4'));
  input.focus();
  assert.equal(document.activeElement, input);
  fireEvent.change(input, { target: { value: '16' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Case size' }));
  assert.equal((await screen.findByRole('status')).textContent, 'Saved');
  assert.deepEqual(writes, [{ url: '/api/v1/items/item-1/studio-fields/case_size', body: { versionId: 'published-2', value: 16 } }]);
});
