import { defineConfig } from '@playwright/test';

// Staging golden journeys (audit R10): these specs run against a REAL
// deployed API and web app — unlike playwright.config.js, whose specs mock
// the API with page.route (see e2e/support.js). Nothing here starts a local
// server, and every spec under e2e/staging skips itself with a clear message
// when the E2E_* env vars are absent, so the normal CI run (no staging
// secrets) stays green.
//
// Run (from web/):
//   E2E_WEB_URL=https://staging-web.example \
//   E2E_API_URL=https://staging-api.example \
//   E2E_EMAIL=<staging user email> E2E_PASSWORD=<staging user password> \
//   npx playwright test -c playwright.staging.config.js
//
// See e2e/staging/README.md for fixture requirements and what each
// journey proves. These specs have NOT been executed yet — the first
// staging run is part of the R10 evidence, not a formality.
export default defineConfig({
  testDir: './e2e/staging',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
