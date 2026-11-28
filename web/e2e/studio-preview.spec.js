import { expect, test } from '@playwright/test';

const company = { id: 'company-1', name: 'Example Retail', planId: 'pro', status: 'active' };
const locations = [{ id: 'store-1', name: 'Main Store', type: 'store' }, { id: 'wh-1', name: 'Warehouse', type: 'warehouse' }];
const livePage = { columns: [{ key: 'item_code', label: 'Published item', source: 'core', visible: true }] };
const draftPage = { columns: [
  { key: 'item_code', label: 'Item', source: 'core', visible: true },
  { key: 'physical', label: 'Physical stock', source: 'core', visible: true },
  { key: 'calc_book', label: 'Double book stock', source: 'formula', visible: true, formula: 'book * 2' },
], actions: [{ key: 'export', enabled: true }, { key: 'scan', enabled: true }] };

test('Studio previews a draft and confirms a selected historical restore at phone width', async ({ page }) => {
  const requests = [];
  const restores = [];
  const current = { id: 'v3', version: 3, author: 'Operator', canRestore: false };
  const previous = { id: 'v2', version: 2, author: 'Operator', canRestore: true };
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
    if (path === '/studio/v1/versions') return route.fulfill({ json: { active: current, versions: [current, previous] } });
    if (path === '/studio/v1/versions/v2/compare') return route.fulfill({ json: { active: current, target: previous, changes: ['Stock layout'] } });
    if (path === '/studio/v1/rollback') {
      restores.push(route.request().postDataJSON());
      return route.fulfill({ json: { published: { version: 4 } } });
    }
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
  await page.getByRole('button', { name: 'Compare version 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore version 2' });
  await expect(dialog.getByText('Stock layout')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Restore version 2' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Compare version 2' })).toBeFocused();
  expect(restores).toEqual([]);
  await page.getByRole('button', { name: 'Compare version 2' }).click();
  await dialog.getByLabel('Reason for restoring').fill('Return to the documented stock layout');
  await dialog.getByRole('button', { name: 'Restore version 2' }).click();
  await expect(page.getByText('Version 2 restored as version 4.')).toBeVisible();
  expect(restores).toEqual([{ version: 2, targetVersionId: 'v2', expectedActiveVersionId: 'v3', reason: 'Return to the documented stock layout' }]);
});
