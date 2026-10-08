import type { NextFunction, Request, Response } from 'express';
import { items, locations, stockLedger } from '../repository.js';
import { seedItems, seedLocations } from '../seed.js';

export const DEFAULT_COMPANY_ID = 'default-company';
export const DEFAULT_TENANT_ID = 'tenant-invexa';
export const PLAN_PRICES: Record<string, number> = { starter: 0, pro: 4999, enterprise: 19999 };
export const JAIPUR_COMPANY_ID = 'company-jaipur';
export const JAIPUR_LOCATION_ID = 'loc-jaipur-1';
export const JAIPUR_ITEM_ID = 'item-jaipur-1';

const locationOwners = new Map<string, string>();
const itemOwners = new Map<string, string>();

const LOCATION_KEYS = ['locationId', 'sourceLocationId', 'destinationLocationId', 'fromLocationId', 'toLocationId'];
const ITEM_KEYS = ['itemId'];

export function seedDefaultTenantOwnership(): void {
  for (const location of seedLocations) locationOwners.set(location.id, DEFAULT_COMPANY_ID);
  for (const item of seedItems) itemOwners.set(item.id, DEFAULT_COMPANY_ID);
}

export function ensureJaipurOperationalWorkspace(): void {
  registerLocationCompany(JAIPUR_LOCATION_ID, JAIPUR_COMPANY_ID);
  registerItemCompany(JAIPUR_ITEM_ID, JAIPUR_COMPANY_ID);
  if (process.env.DATABASE_URL) return;
  if (!locations.some((location) => location.id === JAIPUR_LOCATION_ID)) {
    locations.push({ id: JAIPUR_LOCATION_ID, name: 'Jaipur Store', type: 'store' });
  }
  if (!items.some((item) => item.id === JAIPUR_ITEM_ID)) {
    items.push({
      id: JAIPUR_ITEM_ID,
      code: 'SKU-JPR-1',
      name: 'Jaipur Namkeen 200g',
      category: 'Snacks',
      unit: 'pack',
      lots: [{
        id: 'lot-jaipur-1',
        itemId: JAIPUR_ITEM_ID,
        lotNo: 'JPR-01',
        expiryDate: '2027-06-30',
        attributes: { source: 'seed' },
      }],
    });
  }
  if (!stockLedger.some((row) => row.locationId === JAIPUR_LOCATION_ID && row.itemId === JAIPUR_ITEM_ID)) {
    stockLedger.push({
      itemId: JAIPUR_ITEM_ID,
      lotId: 'lot-jaipur-1',
      locationId: JAIPUR_LOCATION_ID,
      onHand: 18,
      quarantine: 0,
      version: 0,
    });
  }
}

seedDefaultTenantOwnership();
ensureJaipurOperationalWorkspace();

export function registerLocationCompany(locationId: string, companyId: string): void {
  if (!locationId) return;
  locationOwners.set(locationId, companyId || DEFAULT_COMPANY_ID);
}

export function registerItemCompany(itemId: string, companyId: string): void {
  if (!itemId) return;
  itemOwners.set(itemId, companyId || DEFAULT_COMPANY_ID);
}

export function adoptHydratedOwnership(input: {
  locations: Array<{ id: string; companyId?: string | null }>;
  items: Array<{ id: string; companyId?: string | null }>;
}): void {
  locationOwners.clear();
  itemOwners.clear();
  seedDefaultTenantOwnership();
  for (const location of input.locations) registerLocationCompany(location.id, location.companyId || DEFAULT_COMPANY_ID);
  for (const item of input.items) registerItemCompany(item.id, item.companyId || DEFAULT_COMPANY_ID);
  ensureJaipurOperationalWorkspace();
}

export function ownerOfLocation(locationId: string): string | undefined {
  return locationOwners.get(locationId);
}

export function ownerOfItem(itemId: string): string | undefined {
  return itemOwners.get(itemId);
}

export function companyOwnsLocation(companyId: string, locationId: string): boolean {
  const owner = ownerOfLocation(locationId);
  return Boolean(owner && owner === companyId);
}

export function companyOwnsItem(companyId: string, itemId: string): boolean {
  const owner = ownerOfItem(itemId);
  return Boolean(owner && owner === companyId);
}

export function locationsForCompany<T extends { id: string }>(companyId: string, rows: T[]): T[] {
  return rows.filter((row) => companyOwnsLocation(companyId, row.id));
}

export function itemsForCompany<T extends { id: string }>(companyId: string, rows: T[]): T[] {
  return rows.filter((row) => companyOwnsItem(companyId, row.id));
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' ? value : '';
}

function collectIds(req: Request, keys: string[]): string[] {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const found: string[] = [];
  for (const key of keys) {
    for (const value of [req.params[key], req.query[key], body[key]]) {
      const id = firstString(value);
      if (id) found.push(id);
    }
  }
  return found;
}

export function enforceOperationalCompanyScope(req: Request, res: Response, next: NextFunction): void {
  const companyId = req.companyId;
  if (!companyId) {
    next();
    return;
  }
  const ids = [
    ...collectIds(req, LOCATION_KEYS),
    ...collectIds(req, ITEM_KEYS),
    ...String(req.path ?? '').split('/').filter(Boolean),
  ];
  for (const locationId of ids) {
    if (ownerOfLocation(locationId) && !companyOwnsLocation(companyId, locationId)) {
      res.status(403).json({ error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
      return;
    }
  }
  for (const itemId of ids) {
    if (ownerOfItem(itemId) && !companyOwnsItem(companyId, itemId)) {
      res.status(403).json({ error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
      return;
    }
  }
  next();
}

/**
 * Bulk imports derive an id from a code or a name (a hash of it). That id used to be the same for every company, so two
 * companies importing the same item code or branch name addressed the SAME row. The default company keeps the plain
 * value (so ids already stored for it do not change); every other company's value is namespaced by its company id.
 */
export function scopedImportKey(companyId: string, value: string): string {
  return !companyId || companyId === DEFAULT_COMPANY_ID ? value : `${companyId}|${value}`;
}
