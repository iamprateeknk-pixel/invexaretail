import { expect } from '@playwright/test';

// Shared helpers for the browser journeys. The API is mocked the same way as in the other specs (the
// backend behaviour is covered by the API suites); these prove what a person sees and can do in a browser.

export const token = 'header.' + Buffer.from(JSON.stringify({ exp: 4102444800, tokenType: 'access' })).toString('base64url') + '.sig';

export const ROLES = ['STORE_USER', 'WAREHOUSE_PICKER', 'BRANCH_MANAGER', 'ADMIN', 'AUDITOR'];

const LOCATION = { id: 'loc-1', name: 'Main Store', code: 'MS', type: 'store' };
const ITEM = { id: 'item-1', code: 'SKU-1', name: 'Rice 5kg', unit: 'ea', lots: [{ id: 'lot-1', lotNo: 'LOT-01' }] };

export async function mockApi(page, role = 'ADMIN') {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/login') {
      return route.fulfill({ json: { token, user: { id: `u-${role}`, name: `Test ${role}`, email: 'user@example.com', role, companyId: 'company-1', locationIds: ['loc-1'] } } });
    }
    if (path === '/api/v1/locations') return route.fulfill({ json: { locations: [LOCATION] } });
    if (path === '/api/v1/items') return route.fulfill({ json: { items: [ITEM] } });
    if (path === '/api/v1/purchase-orders') return route.fulfill({ json: { purchaseOrders: [], nextCursor: null } });
    if (path === '/api/v1/suppliers') return route.fulfill({ json: { suppliers: [] } });
    if (path === '/api/v1/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    if (path === '/api/v1/counts' || path === '/api/v1/transfers/list' || path === '/api/v1/audit' || path === '/api/v1/users') {
      return route.fulfill({ json: { counts: [], transfers: [], events: [], users: [] } });
    }
    return route.fulfill({ json: {} });
  });
}

export async function signIn(page, role = 'ADMIN') {
  await mockApi(page, role);
  await page.goto('/');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
}

/** The section the app is currently showing, from the URL hash (`#/counts?q=x` -> `counts`). */
export async function currentSection(page) {
  return page.evaluate(() => window.location.hash.replace(/^#\/?/, '').split('?')[0] || '');
}
