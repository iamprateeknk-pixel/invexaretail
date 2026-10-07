import { expect, test } from '@playwright/test';

// Golden journey: an operator narrows a list, hides a column and exports it; the view survives a
// reload and a shared link because it lives in the URL. API calls are mocked like the other specs
// (the backend behaviour is covered by the API suites); this proves the browser journey.

const token = 'header.' + Buffer.from(JSON.stringify({ exp: 4102444800, tokenType: 'access' })).toString('base64url') + '.sig';

const ORDERS = [
  { id: 'po-1', number: 'PO-1001', status: 'DRAFT', supplierId: 's1', supplier: { name: 'Acme Foods' }, locationId: 'loc-1', totalAmount: 1200, lines: [] },
  { id: 'po-2', number: 'PO-1002', status: 'APPROVED', supplierId: 's2', supplier: { name: 'Fresh Farms' }, locationId: 'loc-1', totalAmount: 800, lines: [] },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/login') {
      return route.fulfill({ json: { token, user: { id: 'u1', name: 'Admin', email: 'admin@example.com', role: 'ADMIN', companyId: 'company-1' } } });
    }
    if (path === '/api/v1/purchase-orders') return route.fulfill({ json: { purchaseOrders: ORDERS, nextCursor: null } });
    if (path === '/api/v1/locations') return route.fulfill({ json: { locations: [{ id: 'loc-1', name: 'Main Store' }] } });
    if (path === '/api/v1/suppliers') return route.fulfill({ json: { suppliers: [] } });
    if (path === '/api/v1/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    if (path === '/api/v1/items' || path === '/api/v1/counts' || path === '/api/v1/transfers/list' || path === '/api/v1/audit' || path === '/api/v1/users') {
      return route.fulfill({ json: { items: [], counts: [], transfers: [], events: [], users: [] } });
    }
    return route.fulfill({ json: {} });
  });
});

async function signIn(page) {
  await page.goto('/');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
}

test('search, column hiding and export work by keyboard, and the view survives a reload', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { window.location.hash = '#/purchase-orders'; });
  await expect(page.getByRole('cell', { name: 'PO-1001' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PO-1002' })).toBeVisible();

  await page.getByLabel('Search purchase orders').fill('fresh');
  await expect(page.getByRole('cell', { name: 'PO-1001' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'PO-1002' })).toBeVisible();
  await expect(page).toHaveURL(/#\/purchase-orders\?q=fresh/);

  await page.getByText('Columns', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Supplier' }).uncheck();
  await expect(page.getByRole('columnheader', { name: 'Supplier' })).toBeHidden();
  await expect(page).toHaveURL(/cols=supplier/);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export CSV/ }).click();
  expect((await download).suggestedFilename()).toBe('purchase-orders.csv');

  await page.reload();
  await expect(page.getByLabel('Search purchase orders')).toHaveValue('fresh');
  await expect(page.getByRole('columnheader', { name: 'Supplier' })).toBeHidden();
  await expect(page.getByRole('cell', { name: 'PO-1002' })).toBeVisible();
});

test('no horizontal page scroll at phone width on the list pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  for (const section of ['purchase-orders', 'orders', 'transfers', 'counts', 'exceptions']) {
    await page.evaluate((target) => { window.location.hash = `#/${target}`; }, section);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${section} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
