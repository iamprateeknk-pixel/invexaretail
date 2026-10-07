import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { controlPlane } from './control-plane.js';
import { itemsForCompany, locationsForCompany } from './tenant-scope.js';
import { listItems, listLocations } from '../repository.js';
import { apiUsageClock, enforceApiUsage, enforcePlanLimits, enforceSuspendedCompany, isCompanySuspended } from './company-access.js';

function mockRes() {
  const result: { statusCode?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, result };
}

test('suspended companies are detected from control-plane status', () => {
  const platform = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  try {
    assert.equal(isCompanySuspended('default-company'), false);
    controlPlane.setCompanyStatus(platform, 'default-company', 'suspended', 'unit');
    assert.equal(isCompanySuspended('default-company'), true);
    const { res, result } = mockRes();
    let nextCalled = false;
    enforceSuspendedCompany(
      { method: 'GET', path: '/locations', originalUrl: '/api/v1/locations', companyId: 'default-company' } as Request,
      res,
      (() => { nextCalled = true; }) as NextFunction,
    );
    assert.equal(nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body?.code, 'COMPANY_SUSPENDED');
  } finally {
    controlPlane.setCompanyStatus(platform, 'default-company', 'active', 'unit-restore');
  }
});

test('plan limits reject operational item creates at the current catalog size', () => {
  const previous = controlPlane.limitOverrides.get('default-company');
  const current = itemsForCompany('default-company', listItems()).length;
  controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), max_items: current });
  try {
    const { res, result } = mockRes();
    let nextCalled = false;
    enforcePlanLimits(
      { method: 'POST', path: '/items', originalUrl: '/api/v1/items', companyId: 'default-company' } as Request,
      res,
      (() => { nextCalled = true; }) as NextFunction,
    );
    assert.equal(nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body?.code, 'PLAN_LIMIT_REACHED');
    const locations = locationsForCompany('default-company', listLocations()).length;
    assert.ok(locations >= 1);
  } finally {
    if (previous) controlPlane.limitOverrides.set('default-company', previous);
    else controlPlane.limitOverrides.delete('default-company');
  }
});

test('daily API usage cap rejects the next operational request', () => {
  const previous = controlPlane.limitOverrides.get('default-company');
  const previousUsage = controlPlane.usage.get('default-company');
  controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), api_requests_per_day: 0 });
  try {
    const { res, result } = mockRes();
    let nextCalled = false;
    enforceApiUsage(
      { method: 'GET', path: '/locations', originalUrl: '/api/v1/locations', companyId: 'default-company' } as Request,
      res,
      (() => { nextCalled = true; }) as NextFunction,
    );
    assert.equal(nextCalled, false);
    assert.equal(result.statusCode, 429);
    assert.equal(result.body?.code, 'USAGE_LIMIT_REACHED');
  } finally {
    if (previous) controlPlane.limitOverrides.set('default-company', previous);
    else controlPlane.limitOverrides.delete('default-company');
    if (previousUsage) controlPlane.usage.set('default-company', previousUsage);
    else controlPlane.usage.delete('default-company');
  }
});

test('the daily API request cap resets when the UTC day changes (it is not a lifetime cap)', () => {
  const previous = controlPlane.limitOverrides.get('default-company');
  const previousUsage = controlPlane.usage.get('default-company');
  const realNow = apiUsageClock.now;
  controlPlane.limitOverrides.set('default-company', { ...(previous ?? {}), api_requests_per_day: 3 });
  controlPlane.usage.delete('default-company');
  const call = () => {
    const { res, result } = mockRes();
    let allowed = false;
    enforceApiUsage({ method: 'GET', path: '/locations', originalUrl: '/api/v1/locations', companyId: 'default-company' } as Request, res, (() => { allowed = true; }) as NextFunction);
    return { allowed, status: result.statusCode };
  };
  try {
    apiUsageClock.now = () => new Date('2026-10-07T10:00:00Z');
    assert.deepEqual([call().allowed, call().allowed, call().allowed], [true, true, true]);
    const blocked = call();
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.status, 429, 'the fourth request on the same day is refused');

    apiUsageClock.now = () => new Date('2026-10-07T23:59:59Z');
    assert.equal(call().allowed, false, 'still the same UTC day');

    apiUsageClock.now = () => new Date('2026-10-08T00:00:01Z');
    assert.equal(call().allowed, true, 'the next day starts a fresh count');
    assert.equal(controlPlane.usage.get('default-company')?.api_requests, 1);
  } finally {
    apiUsageClock.now = realNow;
    if (previous) controlPlane.limitOverrides.set('default-company', previous);
    else controlPlane.limitOverrides.delete('default-company');
    if (previousUsage) controlPlane.usage.set('default-company', previousUsage);
    else controlPlane.usage.delete('default-company');
  }
});
