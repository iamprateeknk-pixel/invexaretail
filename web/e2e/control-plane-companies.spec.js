import { expect, test } from '@playwright/test';

// The Control Plane company picker used to show whatever the login response carried, saved in the tab's
// session and never refreshed. A platform session that was already signed in therefore kept showing a stale
// list (a company registered since then was missing) until the operator signed out and back in.

const SEEDED = [
  { id: 'default-company', name: 'Invexa Demo Grocery', planId: 'pro', status: 'active' },
  { id: 'company-jaipur', name: 'Jaipur Mart', planId: 'starter', status: 'active' },
];
const FRESH = [...SEEDED, { id: 'company-kota', name: 'Kota Fresh Mart', planId: 'pro', status: 'active' }];

test('an already signed-in platform session shows companies registered after it was created', async ({ page }) => {
  let listCalls = 0;
  await page.route('**/control/v1/companies?*', async (route) => {
    listCalls += 1;
    await route.fulfill({ json: { success: true, companies: FRESH } });
  });
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.addInitScript((companies) => {
    sessionStorage.setItem('invexa_control_session', JSON.stringify({
      platformToken: 'platform-token',
      user: { id: 'platform-super-1', email: 'superadmin@invexa.local', name: 'Platform Super Admin' },
      companies,
    }));
  }, SEEDED);

  await page.goto('/#/control');
  await expect(page.getByText('Select one company')).toBeVisible();
  await expect(page.getByText('Kota Fresh Mart')).toBeVisible();
  expect(listCalls).toBeGreaterThan(0);

  // The refreshed list is kept for the rest of the tab session.
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('invexa_control_session')).companies.map((company) => company.id));
  expect(stored).toContain('company-kota');
});

test('if the refresh fails the picker keeps the list it already had', async ({ page }) => {
  await page.route('**/control/v1/companies?*', (route) => route.fulfill({ status: 500, json: { success: false } }));
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.addInitScript((companies) => {
    sessionStorage.setItem('invexa_control_session', JSON.stringify({ platformToken: 'platform-token', user: { id: 'p', email: 'a@b.c', name: 'P' }, companies }));
  }, SEEDED);
  await page.goto('/#/control');
  await expect(page.getByText('Jaipur Mart')).toBeVisible();
  await expect(page.getByText('Invexa Demo Grocery')).toBeVisible();
});
