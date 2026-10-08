// POST /stock-takes/preview-by-filters returns the category / sub-category / brand choices and a zero-stock count.
// They were computed from the process-wide item list, so one company saw the other companies' category and brand
// names. They must come from the caller's own items only. Memory mode: default-company admin vs company-jaipur admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { resetLockoutsForTests } from '../lib/login-lockout.js';
import { listItems } from '../lib/repository.js';
import { JAIPUR_LOCATION_ID, enforceOperationalCompanyScope, ownerOfItem } from '../lib/saas/tenant-scope.js';
import enterpriseAuthRouter, { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

test("a stock-take preview offers only the caller's own company's categories, sub-categories and brands", async () => {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(SEED_PASSWORD));
  resetLockoutsForTests();
  const other = findUserByEmail('admin@jaipur.local')!;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/api/v1', extractToken, requireAuth, coreRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/stock-takes/preview-by-filters`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${generateJWT(other.id, other.companyId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: JAIPUR_LOCATION_ID }),
    });
    assert.equal(response.status, 200);
    const { filters } = (await response.json()) as { filters: { categories: string[]; subcategories: string[]; companies: string[] } };
    const ownItems = listItems().filter((item) => ownerOfItem(item.id) === 'company-jaipur');
    const foreignItems = listItems().filter((item) => ownerOfItem(item.id) !== 'company-jaipur');
    const expected = (pick: (item: (typeof ownItems)[number]) => string | undefined) => [...new Set(ownItems.map(pick).filter(Boolean))].sort();
    assert.deepEqual([...filters.categories].sort(), expected((item) => item.category));
    assert.deepEqual([...filters.subcategories].sort(), expected((item) => item.subcategory));
    assert.deepEqual([...filters.companies].sort(), expected((item) => item.company));
    const foreignOnly = [...new Set(foreignItems.map((item) => item.category).filter((value) => value && !ownItems.some((own) => own.category === value)))];
    assert.ok(foreignOnly.length > 0, 'the seed must have a category only the other company uses, or this test proves nothing');
    for (const category of foreignOnly) assert.ok(!filters.categories.includes(category as string), `${category} belongs to another company`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
