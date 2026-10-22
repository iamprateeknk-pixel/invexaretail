import { expect, request } from '@playwright/test';

// Shared helpers for the staging golden journeys (audit R10).
//
// Everything is driven by environment variables — credentials are NEVER
// hardcoded:
//   E2E_WEB_URL   deployed web app origin   (Playwright baseURL)
//   E2E_API_URL   deployed API origin       (…/api/v1 lives under it)
//   E2E_EMAIL     staging user (ADMIN role; see README)
//   E2E_PASSWORD  staging user's password
//
// When any of them is missing, every staging spec skips with the message
// below instead of failing, so the mocked-API CI suite is unaffected.

export const WEB_URL = process.env.E2E_WEB_URL;
export const API_URL = process.env.E2E_API_URL;
export const EMAIL = process.env.E2E_EMAIL;
export const PASSWORD = process.env.E2E_PASSWORD;

export const SKIP_MESSAGE =
  'Staging E2E not configured — set E2E_WEB_URL, E2E_API_URL, E2E_EMAIL, E2E_PASSWORD (see web/e2e/staging/README.md).';

export function stagingConfigured() {
  return Boolean(WEB_URL && API_URL && EMAIL && PASSWORD);
}

/** Register a beforeEach guard that skips the whole file when unconfigured. */
export function guardStaging(test) {
  test.beforeEach(() => {
    test.skip(!stagingConfigured(), SKIP_MESSAGE);
  });
}

/** Real login against the staging API. Returns the parsed body ({ token, user, ... }). */
export async function apiLogin(email = EMAIL, password = PASSWORD) {
  const ctx = await request.newContext({ baseURL: API_URL });
  try {
    const res = await ctx.post('/api/v1/auth/login', { data: { email, password } });
    expect(res.status(), `staging login for ${email} should succeed`).toBe(200);
    const body = await res.json();
    expect(typeof body.token, 'login response carries a token').toBe('string');
    return body;
  } finally {
    await ctx.dispose();
  }
}

/** A Playwright request context pre-authenticated against the staging API. */
export async function apiContext(token) {
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

/** Sign in through the real login form (labels mirror e2e/support.js signIn). */
export async function signInViaUi(page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
}

/**
 * Discover fixtures from the live staging data instead of hardcoding ids:
 * the locations the user can see, the item catalogue, and the first stock
 * row with quantity on hand at a location.
 * Returns { locations, items, stocked: { location, row } | null }.
 */
export async function discoverFixtures(api) {
  const locationsBody = await (await api.get('/api/v1/locations')).json();
  const locations = locationsBody.locations ?? [];
  const itemsBody = await (await api.get('/api/v1/items')).json();
  const items = itemsBody.items ?? [];
  let stocked = null;
  for (const location of locations) {
    const stockBody = await (await api.get(`/api/v1/stock/${location.id}`)).json();
    const row = (stockBody.items ?? []).find((entry) => Number(entry.bookQuantity) > 0);
    if (row) {
      stocked = { location, row };
      break;
    }
  }
  return { locations, items, stocked };
}

/** Item (with its lots) for a catalogue item id, from GET /api/v1/items. */
export function itemById(items, itemId) {
  return items.find((item) => item.id === itemId);
}
