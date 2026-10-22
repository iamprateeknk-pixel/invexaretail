import { expect, test } from '@playwright/test';
import { apiContext, apiLogin, discoverFixtures, guardStaging, itemById, signInViaUi } from './staging-support.js';

// Golden journey 2 — stock check (audit R10).
// API leg: the tenant-scoped stock read (GET /api/v1/stock/:locationId,
// DB-first since Phase 5) returns rows whose available quantity is
// onHand - reserved, for a location the user can actually see.
// Browser leg: the same item is findable through item search and its
// stock detail names the location — the affordances mirror the mocked
// item-stock-detail spec, now against real data.

guardStaging(test);

test('stock rows are internally consistent at the first stocked location', async () => {
  const { token } = await apiLogin();
  const api = await apiContext(token);
  try {
    const { stocked, items } = await discoverFixtures(api);
    test.skip(!stocked, 'Staging has no location with stock on hand — seed opening stock before running R10.');
    const { location, row } = stocked;
    expect(row.itemId).toBeTruthy();
    expect(row.lotId).toBeTruthy();
    expect(Number(row.bookQuantity)).toBeGreaterThan(0);
    expect(Number(row.availableQuantity)).toBe(
      Math.max(0, Number(row.bookQuantity) - Number(row.reservedQuantity ?? 0)),
    );
    const item = itemById(items, row.itemId);
    expect(item, 'the stocked row names a catalogue item').toBeTruthy();
    test.info().annotations.push({ type: 'fixture', description: `${item.code} @ ${location.name}: ${row.bookQuantity} on hand` });
  } finally {
    await api.dispose();
  }
});

test('browser: the stocked item is visible through item search', async ({ page }) => {
  const { token } = await apiLogin();
  const api = await apiContext(token);
  let stocked;
  let items;
  try {
    ({ stocked, items } = await discoverFixtures(api));
  } finally {
    await api.dispose();
  }
  test.skip(!stocked, 'Staging has no location with stock on hand — seed opening stock before running R10.');
  const item = itemById(items, stocked.row.itemId);

  await signInViaUi(page);
  await page.evaluate(() => { window.location.hash = '#/item-search'; });
  const search = page.getByRole('combobox', { name: 'Search items by name or code' });
  await search.fill(item.code);
  await expect(page.getByRole('option', { name: new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: item.name })).toBeVisible();
  await expect(page.getByRole('cell', { name: stocked.location.name })).toBeVisible();
});
