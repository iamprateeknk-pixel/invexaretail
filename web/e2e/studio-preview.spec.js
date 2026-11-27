import { expect, test } from '@playwright/test';

const company = { id: 'company-1', name: 'Example Retail', planId: 'pro', status: 'active' };
const locations = [{ id: 'store-1', name: 'Main Store', type: 'store' }, { id: 'wh-1', name: 'Warehouse', type: 'warehouse' }];
const livePage = { columns: [{ key: 'item_code', label: 'Published item', source: 'core', visible: true }] };
const draftPage = { columns: [
  { key: 'item_code', label: 'Item', source: 'core', visible: true },
  { key: 'physical', label: 'Physical stock', source: 'core', visible: true },
  { key: 'calc_book', label: 'Double book stock', source: 'formula', visible: true, formula: 'book * 2' },
], actions: [{ key: 'export', enabled: true }, { key: 'scan', enabled: true }] };

test('Studio shows the draft stock screen without publishing and fits a phone viewport', async ({ page }) => {
  const requests = [];
  await page.addInitScript((activeCompany) => {
    sessionStorage.setItem('invexa_control_session', JSON.stringify({
      company: activeCompany, user: { name: 'Operator' }, platformToken: 'platform', controlToken: 'locked',
    }));
  }, company);
  await page.route(/\/(?:control|studio)\/v1\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/studio/v1/preview') {
      const selection = route.request().postDataJSON();
      requests.push(selection);
      const location = locations.find((entry) => entry.id === selection.locationId) ?? locations[0];
      return route.fulfill({ json: { preview: { ...selection, page: draftPage, locations, location, stockEnabled: true, version: 4 } } });
    }
    if (path === '/studio/v1/publish') throw new Error('Preview unexpectedly published the draft');
    if (path === '/studio/v1/draft') return route.fulfill({ json: { draft: { ...company, page: draftPage, version: 4 } } });
    if (path === '/studio/v1/runtime') return route.fulfill({ json: { runtime: { page: livePage, version: 3 } } });
    if (path === '/control/v1/users') return route.fulfill({ json: { users: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/#/control');
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Publish' }).click();
  await expect(page.getByRole('columnheader', { name: 'Double book stock' })).toBeVisible();
  await expect(page.getByText(/Published version 3/)).toBeVisible();
  await page.getByLabel('Role', { exact: true }).selectOption('STORE_USER');
  await page.getByLabel('Device', { exact: true }).selectOption('mobile');
  await page.getByLabel('Location', { exact: true }).selectOption('wh-1');
  await expect(page.getByText('Warehouse · Phone')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Double book stock' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Scan item' })).toBeDisabled();
  expect(requests.at(-1)).toEqual({ role: 'STORE_USER', device: 'mobile', locationId: 'wh-1' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('table', { name: 'Draft stock table' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
