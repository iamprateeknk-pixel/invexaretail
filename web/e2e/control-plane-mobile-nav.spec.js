import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('a locked Control Plane session can reach all sections on a phone-width screen', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path.endsWith('/studio/v1/draft') ? { draft: null }
      : path.endsWith('/control/v1/users') ? { users: [] }
        : path.endsWith('/studio/v1/runtime') ? { runtime: null }
          : path.endsWith('/control/v1/health') ? { ok: true, companies: 1, killSwitches: {} }
            : path.endsWith('/control/v1/audit') ? { events: [] }
              : {};
    await route.fulfill({ json: payload });
  });
  await page.addInitScript(() => {
    const company = { id: 'company-1', name: 'Acme Retail', planId: 'pro', status: 'active', entitlements: {} };
    sessionStorage.setItem('invexa_control_session', JSON.stringify({
      platformToken: 'platform-token',
      controlToken: 'company-token',
      user: { id: 'user-1', name: 'Root Admin' },
      company,
      companies: [company],
    }));
  });

  await page.goto('/#/control');

  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile Control Plane sections' });
  await expect(mobileNavigation).toBeVisible();
  await expect(page.locator('aside')).toBeHidden();
  for (const label of ['Company', 'Studio', 'Users', 'Approvals', 'Mobile & sync', 'Integrations', 'Billing', 'Health']) {
    await expect(mobileNavigation.getByRole('button', { name: label })).toBeVisible();
  }

  await mobileNavigation.getByRole('button', { name: 'Health' }).click();
  await expect(mobileNavigation.getByRole('button', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
});
