// Shared scaffolding for the core routers (Phase 4): inventory roles,
// access/tenant context, CSV/XML escaping and role gates used by nearly
// every cluster, plus the single shared multer upload instance and the
// operational-admin check. Extracted verbatim from core.ts.
import { type Request, type Response } from 'express';
import multer from 'multer';
import { type EnhancedUserRecord } from '../lib/enterprise-repository.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from '../lib/saas/tenant-scope.js';
import { controlPlane } from '../lib/saas/control-plane.js';
import { type AccessContext, type Role } from '../lib/inventory.js';
import { findCompanyProfile, listItems } from '../lib/repository.js';
import { isOperationalItem } from '../lib/item-master.js';
import { type TenantContext } from '../lib/tenant-context.js';

export const INVENTORY_ROLES: readonly string[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];

// EnhancedUserRecord carries a wider role union than the inventory rules know
// about. An unmapped role falls back to the least privileged one rather than
// silently inheriting admin access.
export function accessContext(user: EnhancedUserRecord): AccessContext {
  const role = INVENTORY_ROLES.includes(user.role) ? (user.role as Role) : 'STORE_USER';
  return { role, assignedLocationIds: user.locationIds ?? [], companyId: user.companyId };
}

export function tenantContext(req: Request): TenantContext {
  return {
    companyId: req.companyId ?? req.user!.companyId ?? DEFAULT_COMPANY_ID,
    tenantId: DEFAULT_TENANT_ID,
    userId: req.user!.id,
    role: req.user!.role as TenantContext['role'],
  };
}

export function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function xmlEscape(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? '');
}

// Blueprint v4 §6: an inactive or archived item stays in history but cannot
// take part in any new transaction.
export function inactiveItemMessage(itemIds: string[]): string | null {
  const catalog = listItems();
  for (const id of itemIds) {
    const item = catalog.find((entry) => entry.id === id);
    if (item && !isOperationalItem(item)) {
      return `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be used in new transactions.`;
    }
  }
  return null;
}

export const VALID_ROLES: readonly Role[] = ['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'];
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function requireAdmin(req: Request, res: Response): boolean {
  if (!isOperationalAdmin(req.user!.role)) {
    res.status(403).json({ message: 'Admin access required.' });
    return false;
  }
  return true;
}

// The caller's own company profile. A company that has none yet gets a neutral one named after it - never the
// default company's (the old single global profile leaked the platform company's name and industry to every tenant).
export function companyProfileFor(companyId: string) {
  return findCompanyProfile(companyId) ?? { name: controlPlane.companies.get(companyId)?.name ?? companyId, industry: 'Grocery', industryKey: 'grocery' };
}

export const isOperationalAdmin = (role: string) => role === 'ADMIN' || role === 'ADMIN_USER';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
