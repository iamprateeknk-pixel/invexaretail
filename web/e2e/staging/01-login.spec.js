import { expect, request, test } from '@playwright/test';
import { PASSWORD, apiLogin, guardStaging, signInViaUi } from './staging-support.js';

// Golden journey 1 — login (audit R10).
// Proves, against the REAL staging stack (no mocks):
//  - the API rejects a wrong password and issues a token + company-scoped
//    user for the right one;
//  - the browser login form completes the same journey a person takes;
//  - the stored browser session never contains a refresh credential
//    (same invariant the mocked item-stock-detail spec asserts).

guardStaging(test);

test('API: wrong password is rejected, right password returns a token and a company', async () => {
  const ctx = await request.newContext({ baseURL: process.env.E2E_API_URL });
  try {
    const bad = await ctx.post('/api/v1/auth/login', {
      data: { email: process.env.E2E_EMAIL, password: `${PASSWORD}-wrong` },
    });
    expect(bad.status(), 'wrong password must not authenticate').toBe(401);
  } finally {
    await ctx.dispose();
  }

  const body = await apiLogin();
  expect(body.user?.companyId, 'login user is scoped to a company').toBeTruthy();
  expect(body.user?.email).toBe(process.env.E2E_EMAIL);
});

test('browser: a person can sign in with the staging credentials', async ({ page }) => {
  await signInViaUi(page);

  // The refresh credential stays in an HttpOnly cookie, never in web storage.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('invexaretail_session');
    return raw ? JSON.parse(raw) : null;
  });
  expect(stored, 'a session is stored after sign-in').toBeTruthy();
  expect(stored.refreshToken).toBeUndefined();
});

test('browser: a wrong password keeps the person on the login form', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL);
  await page.getByLabel('Password').fill(`${PASSWORD}-wrong`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Still on the form: sign-in is offered again and no session chrome appears.
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
});
