import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  JAIPUR_COMPANY_ID,
  DEFAULT_COMPANY_ID,
  companyOwnsItem,
  companyOwnsLocation,
  enforceOperationalCompanyScope,
  itemsForCompany,
  locationsForCompany,
  seedDefaultTenantOwnership,
  ensureJaipurOperationalWorkspace,
} from './tenant-scope.js';

test('seed grocery locations and items belong to default-company only', () => {
  seedDefaultTenantOwnership();
  assert.equal(companyOwnsLocation(DEFAULT_COMPANY_ID, 'loc-1'), true);
  assert.equal(companyOwnsLocation(JAIPUR_COMPANY_ID, 'loc-1'), false);
  assert.equal(companyOwnsItem(DEFAULT_COMPANY_ID, 'item-1001'), true);
  assert.equal(companyOwnsItem(JAIPUR_COMPANY_ID, 'item-1001'), false);
  assert.equal(locationsForCompany(JAIPUR_COMPANY_ID, [{ id: 'loc-1' }, { id: 'loc-2' }]).length, 0);
  assert.equal(itemsForCompany(DEFAULT_COMPANY_ID, [{ id: 'item-1001' }]).length, 1);
});

test('a newly created Jaipur location is invisible to grocery', () => {
  ensureJaipurOperationalWorkspace();
  assert.equal(companyOwnsLocation(JAIPUR_COMPANY_ID, 'loc-jaipur-1'), true);
  assert.equal(companyOwnsLocation(DEFAULT_COMPANY_ID, 'loc-jaipur-1'), false);
  assert.equal(companyOwnsItem(DEFAULT_COMPANY_ID, 'item-jaipur-1'), false);
  assert.equal(locationsForCompany(JAIPUR_COMPANY_ID, [{ id: 'loc-1' }, { id: 'loc-jaipur-1' }]).map((row) => row.id).join(','), 'loc-jaipur-1');
});

test('operational middleware returns 403 when a locked company asks for another company location', () => {
  seedDefaultTenantOwnership();
  let status = 200;
  let body: unknown;
  const req = {
    companyId: JAIPUR_COMPANY_ID,
    params: { locationId: 'loc-1' },
    query: {},
    body: {},
    path: '/stock/loc-1',
  } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as Response;
  let nextCalled = false;
  enforceOperationalCompanyScope(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(status, 403);
  assert.deepEqual(body, { error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
});
