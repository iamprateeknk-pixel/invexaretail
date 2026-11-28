import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, render, screen } from '@testing-library/react';
import { StudioVersionHistory } from './StudioVersionHistory.jsx';

test('version history shows the active release and exposes comparison only for eligible versions', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { cleanup(); globalThis.fetch = originalFetch; });
  const active = { id: 'v3', version: 3, author: 'Operator', publishedAt: '2026-11-27T07:15:00Z', canRestore: false };
  const target = { id: 'v2', version: 2, author: 'Operator', publishedAt: '2026-11-26T07:15:00Z', canRestore: true };
  const incompatible = { id: 'v1', version: 1, author: 'Operator', canRestore: false, blockedReason: 'Unsupported workflow action' };
  globalThis.fetch = async (raw, options) => {
    assert.equal(new URL(raw, 'https://example.test').pathname, '/studio/v1/versions');
    assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ active, versions: [active, target, incompatible] }) };
  };
  render(<StudioVersionHistory controlToken="locked" />);
  const compare = await screen.findByRole('button', { name: 'Compare version 2' });
  compare.focus();
  assert.equal(document.activeElement, compare);
  assert.ok(screen.getByText('Active'));
  assert.ok(screen.getByText('Unsupported workflow action'));
  assert.equal(screen.queryByRole('button', { name: 'Compare version 1' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Compare version 3' }), null);
});
