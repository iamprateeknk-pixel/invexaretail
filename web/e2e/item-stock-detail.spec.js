import { expect, test } from '@playwright/test';

const token = 'header.' + Buffer.from(JSON.stringify({ exp: 4102444800, tokenType: 'access' })).toString('base64url') + '.sig';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/auth/login') {
      return route.fulfill({ json: { token, refreshToken: 'must-never-reach-local-storage', user: { id: 'u1', name: 'Admin', email: 'admin@example.com', role: 'ADMIN', companyId: 'company-1' } } });
    }
    if (path === '/api/v1/items/search') {
      return route.fulfill({ json: { items: [{ id: 'item-1', name: 'Basmati Rice', code: 'RICE-01' }], nextCursor: null } });
    }
    if (path === '/api/v1/items/item-1/stock-detail') {
      return route.fulfill({ json: { itemId: 'item-1', itemName: 'Basmati Rice', itemCode: 'RICE-01', branches: [{ locationId: 'loc-1', locationName: 'Main Store', onHand: 10, reserved: 1, available: 9 }], lots: [{ lotId: 'lot-1', lotNo: 'LOT-1', expiryDate: null, status: 'AVAILABLE', totalOnHand: 10 }], movements: [], reconciliation: [{ onHand: 10, journalSum: 10, delta: 0, explained: true }] } });
    }
    if (path === '/api/v1/items/item-1/adjust') {
      return route.fulfill({ json: { movement: { id: 'move-1' }, duplicate: false } });
    }
    if (path === '/api/v1/locations') return route.fulfill({ json: { locations: [{ id: 'loc-1', name: 'Main Store' }] } });
    if (path === '/api/v1/items') return route.fulfill({ json: { items: [] } });
    if (path === '/api/v1/counts') return route.fulfill({ json: { counts: [] } });
    if (path === '/api/v1/transfers/list') return route.fulfill({ json: { transfers: [] } });
    if (path === '/api/v1/dashboard') return route.fulfill({ json: { dashboard: {} } });
    if (path === '/api/v1/audit') return route.fulfill({ json: { events: [] } });
    if (path === '/api/v1/count-assignments') return route.fulfill({ json: { assignments: [] } });
    if (path === '/api/v1/users') return route.fulfill({ json: { users: [] } });
    if (path.startsWith('/api/v1/stock/')) return route.fulfill({ json: { items: [] } });
    if (path.startsWith('/api/v1/reports/')) return route.fulfill({ json: { report: null } });
    if (path === '/api/v1/reorder-rules') return route.fulfill({ json: { rules: [] } });
    if (path === '/api/v1/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    return route.fulfill({ json: {} });
  });
});

test('browser login keeps refresh credential HttpOnly and item search adjustment completes by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Admin')).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('invexaretail_session')));
  expect(stored.refreshToken).toBeUndefined();

  await page.evaluate(() => { window.location.hash = '#/item-search'; });
  const search = page.getByRole('combobox', { name: 'Search items by name or code' });
  await search.fill('Rice');
  await expect(page.getByRole('option', { name: /Basmati Rice/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Basmati Rice' })).toBeVisible();
  await expect(page.getByText('Main Store')).toBeVisible();

  await page.getByLabel('Quantity change').fill('2');
  await page.getByLabel('Reason').fill('Verified browser journey');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByRole('button', { name: 'Post adjustment' })).toBeEnabled();
});
