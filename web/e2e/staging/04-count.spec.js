import { expect, test } from '@playwright/test';
import { currentSection } from '../support.js';
import { apiContext, apiLogin, discoverFixtures, guardStaging, signInViaUi } from './staging-support.js';

// Golden journey 4 — stock count flow (audit R10).
// An ADMIN can record an ad-hoc blind count (POST /api/v1/stock-counts);
// operational roles need an assignment first, which is why the staging
// user must be an admin (see README). The count is recorded for exactly
// the book quantity of a stocked lot, so the staging data stays
// variance-free. Re-submitting with the same requestId must NOT create a
// second count: the API answers 200 { duplicate: true } for a replayed
// requestId, or 409 when the lot is already waiting for review — either
// outcome proves the guard; a second fresh 201 would fail this test.

guardStaging(test);

test('record a blind count for a stocked lot; a replay does not double-record', async ({ page }) => {
  const { token, user } = await apiLogin();
  expect(user.role, 'staging user must be ADMIN for ad-hoc counts (operational roles need assignments)').toBe('ADMIN');
  const api = await apiContext(token);
  try {
    const { stocked, items } = await discoverFixtures(api);
    test.skip(!stocked, 'Staging has no stocked location — seed opening stock before running R10.');
    const item = items.find((entry) => entry.id === stocked.row.itemId);
    const lot = (item?.lots ?? []).find((entry) => entry.id === stocked.row.lotId);
    const requestId = `e2e-r10-${Date.now()}`;

    const payload = {
      itemId: stocked.row.itemId,
      locationId: stocked.location.id,
      lotNo: lot?.lotNo,
      physicalQuantity: Number(stocked.row.bookQuantity),
      requestId,
    };
    const first = await api.post('/api/v1/stock-counts', { data: payload });
    const firstBody = await first.json().catch(() => ({}));
    expect([200, 201], `count submit: ${JSON.stringify(firstBody)}`).toContain(first.status());
    expect(firstBody.count ?? firstBody.duplicate, 'count submit returns a count (or a duplicate marker)').toBeTruthy();

    const replay = await api.post('/api/v1/stock-counts', { data: payload });
    const replayBody = await replay.json().catch(() => ({}));
    const guarded =
      (replay.status() === 200 && replayBody.duplicate === true) || replay.status() === 409;
    expect(guarded, `replay must be deduped (200 duplicate) or refused (409); got ${replay.status()} ${JSON.stringify(replayBody)}`).toBe(true);

    const counts = await (await api.get('/api/v1/counts')).json();
    expect(Array.isArray(counts.counts ?? counts), 'counts list is readable').toBe(true);
  } finally {
    await api.dispose();
  }

  await signInViaUi(page);
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  await rail.getByRole('button', { name: 'Stock counts' }).click();
  await expect.poll(() => currentSection(page)).toBe('counts');
  await expect(rail.getByRole('button', { name: 'Stock counts' })).toHaveAttribute('aria-current', 'page');
});
