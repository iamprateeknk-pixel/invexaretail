import { expect, test } from '@playwright/test';
import { apiContext, apiLogin, discoverFixtures, guardStaging, signInViaUi } from './staging-support.js';

// Golden journey 5 — order create → fulfil (audit R10).
// Channel orders are admin-only (POST /api/v1/orders, requireAdmin). The
// order is placed against the stocked location for one unit of the
// stocked item, then fulfilled (POST /api/v1/orders/:id/fulfill), which
// is the step that actually decrements stock through the canonical
// posting path. Afterwards the location's on-hand for that lot must be
// exactly one less than before — the end-to-end money/stock assertion of
// this pack.

guardStaging(test);

test('create a one-unit order at the stocked location and fulfil it', async ({ page }) => {
  const { token, user } = await apiLogin();
  expect(user.role, 'staging user must be ADMIN to create channel orders').toBe('ADMIN');
  const api = await apiContext(token);
  try {
    const { stocked } = await discoverFixtures(api);
    test.skip(!stocked, 'Staging has no stocked location — seed opening stock before running R10.');
    const before = Number(stocked.row.bookQuantity);
    test.skip(before < 2, 'Staging stocked row has < 2 units — fulfil leg needs a spare unit.');

    const create = await api.post('/api/v1/orders', {
      data: {
        channel: 'E2E-STAGING',
        fulfillmentLocationId: stocked.location.id,
        lines: [{ itemId: stocked.row.itemId, quantity: 1 }],
      },
    });
    const createBody = await create.json().catch(() => ({}));
    expect([200, 201], `order create: ${JSON.stringify(createBody)}`).toContain(create.status());
    const order = createBody.order ?? createBody;
    expect(order?.id, 'order create returns an order id').toBeTruthy();

    const fulfil = await api.post(`/api/v1/orders/${order.id}/fulfill`, { data: {} });
    const fulfilBody = await fulfil.json().catch(() => ({}));
    expect(fulfil.status(), `order fulfil: ${JSON.stringify(fulfilBody)}`).toBe(200);

    const stockBody = await (await api.get(`/api/v1/stock/${stocked.location.id}`)).json();
    const after = (stockBody.items ?? []).find(
      (entry) => entry.itemId === stocked.row.itemId && entry.lotId === stocked.row.lotId,
    );
    expect(after, 'the stocked row is still readable after fulfil').toBeTruthy();
    expect(Number(after.bookQuantity), 'fulfilment decremented on-hand by exactly one').toBe(before - 1);
  } finally {
    await api.dispose();
  }

  await signInViaUi(page);
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  await rail.getByRole('button', { name: 'Channel orders' }).click();
  await expect(rail.getByRole('button', { name: 'Channel orders' })).toHaveAttribute('aria-current', 'page');
});
