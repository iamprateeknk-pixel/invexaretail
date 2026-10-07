import type { NextFunction, Request, Response } from 'express';
import { ControlPlaneError, controlPlane } from './control-plane.js';
import { listItems, listLocations, listUsers } from '../repository.js';
import { findUserById } from '../enterprise-repository.js';
import {
  DEFAULT_COMPANY_ID,
  itemsForCompany,
  locationsForCompany,
} from './tenant-scope.js';

function isAuthRoute(req: Request): boolean {
  return /\/auth\//.test(`${req.originalUrl ?? ''} ${req.path ?? ''}`);
}

function lastSegment(path: string): string {
  const segments = String(path ?? '').split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function isCompanySuspended(companyId: string | null | undefined): boolean {
  if (!companyId) return false;
  return controlPlane.companies.get(companyId)?.status === 'suspended';
}

export function rejectSuspendedCompany(companyId: string | null | undefined, res: Response): boolean {
  if (!isCompanySuspended(companyId)) return false;
  res.status(403).json({ error: 'Company is suspended', code: 'COMPANY_SUSPENDED' });
  return true;
}

export function enforceSuspendedCompany(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || isAuthRoute(req)) {
    next();
    return;
  }
  if (rejectSuspendedCompany(req.companyId, res)) return;
  next();
}

function sendLimitError(res: Response, error: unknown): boolean {
  if (error instanceof ControlPlaneError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export function enforcePlanLimits(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const companyId = req.companyId;
  if (!companyId || isAuthRoute(req)) {
    next();
    return;
  }
  const resource = lastSegment(req.path ?? '');
  try {
    if (resource === 'items') {
      controlPlane.assertLimit(companyId, 'max_items', itemsForCompany(companyId, listItems()).length + 1);
    } else if (resource === 'locations') {
      controlPlane.assertLimit(companyId, 'max_branches', locationsForCompany(companyId, listLocations()).length + 1);
    } else if (resource === 'users') {
      const users = listUsers().filter((user) => (findUserById(user.id)?.companyId ?? DEFAULT_COMPANY_ID) === companyId);
      controlPlane.assertLimit(companyId, 'max_users', users.length + 1);
    }
  } catch (error) {
    if (sendLimitError(res, error)) return;
    throw error;
  }
  next();
}

/** UTC calendar day as a number such as 20261007, the unit of the daily request meter. */
export function usageDayKey(now: Date): number {
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

/** Swappable in tests so a day rollover can be exercised without waiting for midnight. */
export const apiUsageClock = { now: (): Date => new Date() };

export function enforceApiUsage(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || req.method === 'HEAD' || isAuthRoute(req)) {
    next();
    return;
  }
  const companyId = req.companyId;
  if (!companyId) {
    next();
    return;
  }
  const usage = controlPlane.usage.get(companyId) ?? {};
  // "per day" has to mean per day: the counter restarts when the UTC date changes. Before this it only
  // ever grew, so a company on a 20,000/day plan was locked out for good after 20,000 lifetime requests.
  const today = usageDayKey(apiUsageClock.now());
  if (usage.api_requests_day !== today) {
    usage.api_requests = 0;
    usage.api_requests_day = today;
    controlPlane.usage.set(companyId, usage);
  }
  const nextCount = (usage.api_requests ?? 0) + 1;
  const max = controlPlane.effectiveLimits(companyId).api_requests_per_day;
  if (typeof max === 'number' && nextCount > max) {
    res.status(429).json({
      error: `Daily API request limit reached (${max})`,
      code: 'USAGE_LIMIT_REACHED',
    });
    return;
  }
  controlPlane.recordUsage(companyId, 'api_requests', 1);
  next();
}
