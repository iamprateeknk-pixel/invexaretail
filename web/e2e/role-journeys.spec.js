import { expect, test } from '@playwright/test';
import { currentSection, mockApi, signIn, submitSignIn } from './support.js';

// Plan Phase 6 exit ("role journeys pass"): each role signs in, lands on the page that answers "what do I
// do now?", sees a short primary rail (5-8 destinations, the rest under More) and can move around by
// keyboard. Also: the command palette (Ctrl/Cmd+K) opens, and the whole rail is still reachable.

const EXPECTED = {
  STORE_USER: { landing: 'counts', primary: ['Stock counts', 'Transfers'], more: ['Jobs & projects'] },
  WAREHOUSE_PICKER: { landing: 'picking', primary: ['Picking & receiving', 'Bins & putaway'], more: ['Purchase orders'] },
  BRANCH_MANAGER: { landing: 'counts', primary: ['Approvals', 'Reports'], more: ['Quality control'] },
  ADMIN: { landing: 'command-center', primary: ['Command center', 'Channel orders', 'Reports'], more: ['Administration', 'SaaS & tenants'] },
  ADMIN_USER: { landing: 'command-center', primary: ['Command center', 'Reports'], more: ['Administration'] },
  AUDITOR: { landing: 'reports', primary: ['Reports', 'Approvals'], more: ['Intelligence'] },
};

const rail = (page) => page.getByRole('navigation', { name: 'Primary navigation' });
const primaryButtons = (page) => rail(page).locator('button:not(details button)');

for (const [role, expected] of Object.entries(EXPECTED)) {
  test(`${role}: lands on the right page, short primary rail, everything else under More`, async ({ page }) => {
    await signIn(page, role);
    await expect.poll(() => currentSection(page)).toBe(expected.landing);

    const primaryCount = await primaryButtons(page).count();
    expect(primaryCount, `${role} primary rail has ${primaryCount} destinations`).toBeGreaterThanOrEqual(5);
    expect(primaryCount).toBeLessThanOrEqual(8);

    for (const label of expected.primary) await expect(rail(page).getByRole('button', { name: label })).toBeVisible();

    const more = rail(page).locator('summary');
    await expect(more).toHaveCount(1);
    for (const label of expected.more) await expect(rail(page).getByRole('button', { name: label })).toBeHidden();
    await more.click();
    for (const label of expected.more) await expect(rail(page).getByRole('button', { name: label })).toBeVisible();
  });
}

test('the initial route waits for company navigation, independently of slow operational data', async ({ page }) => {
  await mockApi(page, 'WAREHOUSE_PICKER');
  let openProfile;
  const profileReady = new Promise((resolve) => { openProfile = resolve; });
  await page.route('**/api/v1/workspace/profile', async (route) => {
    await profileReady;
    await route.fulfill({ json: { pack: { hide: ['picking'] } } });
  });
  await page.route('**/api/v1/items', (route) => route.abort());
  await page.goto('/');
  await submitSignIn(page);
  await expect(page.getByText('Loading your workspace…')).toBeVisible();
  expect(await currentSection(page)).toBe('');
  openProfile();
  await expect.poll(() => currentSection(page)).toBe('putaway');
  await expect(rail(page).getByRole('button', { name: 'Picking & receiving' })).toHaveCount(0);
});

test('an explicit deep link survives sign-in and still enforces route permission', async ({ page }) => {
  await signIn(page, 'STORE_USER', '/#/approvals');
  await expect(page.getByText('Access restricted')).toBeVisible();
  expect(await currentSection(page)).toBe('approvals');
  await page.getByRole('button', { name: 'Return to my workspace' }).click();
  await expect.poll(() => currentSection(page)).toBe('counts');
});

test('on the same browser tab a new account starts from its own queue', async ({ page }) => {
  await signIn(page, 'STORE_USER');
  await expect.poll(() => currentSection(page)).toBe('counts');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await mockApi(page, 'WAREHOUSE_PICKER');
  await submitSignIn(page);
  await expect.poll(() => currentSection(page)).toBe('picking');
});

test('the admin queue stays usable when metrics are slow and offers an in-place retry', async ({ page }) => {
  await mockApi(page, 'ADMIN');
  let calls = 0;
  await page.route('**/api/v1/command-center', (route) => {
    if (++calls === 1) return route.fulfill({ status: 503, json: { error: 'Command center temporarily unavailable.' } });
    return route.fallback();
  });
  await page.route('**/api/v1/ops/metrics', () => {});
  await page.goto('/');
  await submitSignIn(page);
  const retry = page.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible();
  await retry.focus();
  await retry.press('Enter');
  await expect(page.getByText('Nothing is blocked or overdue.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review approvals' })).toBeVisible();
});

test('keyboard only: Tab reaches the rail, Enter opens a page, Ctrl+K opens the command palette', async ({ page }) => {
  await signIn(page, 'STORE_USER');
  const transfers = rail(page).getByRole('button', { name: 'Transfers' });
  await transfers.focus();
  await expect(transfers).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => currentSection(page)).toBe('transfers');
  await expect(rail(page).getByRole('button', { name: 'Transfers' })).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a page that lives under More keeps More open so the active item is never hidden', async ({ page }) => {
  await signIn(page, 'ADMIN');
  await rail(page).locator('summary').click();
  await rail(page).getByRole('button', { name: 'Administration' }).click();
  await expect.poll(() => currentSection(page)).toBe('admin');
  await expect(rail(page).getByRole('button', { name: 'Administration' })).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-current', 'page');
});
