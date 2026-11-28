import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioReleaseReview } from './StudioReleaseReview.jsx';

test('the assigned administrator can inspect the change and approve the loaded revision', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { cleanup(); globalThis.fetch = originalFetch; });
  const writes = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/api/v1/studio-release-review'));
    assert.equal(options.headers.Authorization, 'Bearer workspace');
    if (options.method === 'POST') {
      writes.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ approvedAt: '2026-11-28T10:00:00Z' }) };
    }
    return { ok: true, json: async () => ({ review: {
      id: 'review-2', revision: 'revision-2', version: 2,
      changes: [{ area: 'Stock layout', before: { title: 'Stock' }, after: { title: 'Store stock' } }],
    } }) };
  };
  render(<StudioReleaseReview authToken="workspace" />);
  const check = screen.getByRole('button', { name: 'Check assigned review' });
  check.focus();
  assert.equal(document.activeElement, check);
  fireEvent.click(check);
  assert.ok(await screen.findByText('Draft version 2'));
  assert.ok(screen.getByText('Stock layout'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve this draft' }));
  await screen.findByText('Approved. A Studio operator can now publish this draft.');
  assert.deepEqual(writes, [{ reviewId: 'review-2', revision: 'revision-2' }]);
});
