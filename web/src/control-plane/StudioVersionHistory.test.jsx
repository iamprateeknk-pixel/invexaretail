import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudioVersionHistory } from './StudioVersionHistory.jsx';

test('rollback reviews a selected version and requires confirmation and an audit reason', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = window.CustomEvent;
  t.after(() => { cleanup(); globalThis.fetch = originalFetch; globalThis.CustomEvent = originalCustomEvent; });
  const writes = [];
  const active = { id: 'v3', version: 3, author: 'Operator', publishedAt: '2026-11-27T07:15:00Z', canRestore: false };
  const target = { id: 'v2', version: 2, author: 'Operator', publishedAt: '2026-11-26T07:15:00Z', canRestore: true };
  globalThis.fetch = async (raw, options) => {
    const path = new URL(raw, 'https://example.test').pathname;
    const respond = (body) => ({ ok: true, json: async () => body });
    if (path === '/studio/v1/versions/v2/compare') return respond({ active, target, changes: ['Stock layout'] });
    if (path === '/studio/v1/rollback') {
      writes.push(JSON.parse(options.body));
      return respond({ published: { version: 4 } });
    }
    return respond({ active, versions: [active, target] });
  };
  render(<StudioVersionHistory controlToken="locked" />);
  const compare = await screen.findByRole('button', { name: 'Compare version 2' });
  fireEvent.click(compare);
  await screen.findByText('Stock layout');
  assert.equal(screen.getByRole('button', { name: 'Restore version 2' }).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => assert.equal(document.activeElement, compare));
  assert.deepEqual(writes, []);
  fireEvent.click(compare);
  await screen.findByText('Stock layout');
  fireEvent.change(screen.getByLabelText('Reason for restoring'), { target: { value: 'Restore the approved layout' } });
  fireEvent.click(screen.getByRole('button', { name: 'Restore version 2' }));
  await screen.findByText('Version 2 restored as version 4.');
  assert.deepEqual(writes, [{ version: 2, targetVersionId: 'v2', expectedActiveVersionId: 'v3', reason: 'Restore the approved layout' }]);
});
