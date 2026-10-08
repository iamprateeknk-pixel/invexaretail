import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockApi, signIn } from './support.js';

// Plan Phase 6 exit ("accessibility passes") and the release checklist line "no critical automated a11y
// violations": axe-core runs against the sign-in page and the main operational pages of the roles that
// use them. Serious and critical violations fail the build; moderate/minor are reported, not blocking.

const BLOCKING = ['critical', 'serious'];

async function scan(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = result.violations.filter((violation) => BLOCKING.includes(violation.impact));
  const summary = blocking.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} node(s), e.g. ${violation.nodes[0]?.target?.join(' ')}`);
  expect(summary, `${label} has blocking accessibility violations`).toEqual([]);
}

test('sign-in page has no serious or critical accessibility violations', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByLabel('Email')).toBeVisible();
  await scan(page, 'sign-in');
});

const SECTIONS = ['dashboard', 'inventory', 'counts', 'transfers', 'purchase-orders', 'orders', 'exceptions', 'reports'];

test('the main operational pages have no serious or critical accessibility violations (Admin)', async ({ page }) => {
  await signIn(page, 'ADMIN');
  for (const section of SECTIONS) {
    await page.evaluate((target) => { window.location.hash = `#/${target}`; }, section);
    await page.waitForTimeout(400);
    await scan(page, section);
  }
});

test('the Store user landing page has no serious or critical accessibility violations', async ({ page }) => {
  await signIn(page, 'STORE_USER');
  await page.waitForTimeout(400);
  await scan(page, 'store-user landing');
});
