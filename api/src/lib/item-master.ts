import type { ItemRecord } from './repository.js';

// Blueprint v4 §6: one canonical Item Master. Pure rules live here (fields,
// lifecycle, identity/alias resolution, delete guard); lib/item-master-
// service.ts wires them to storage.

export const ITEM_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const MIN_STATUS_REASON = 3;

export function itemStatusOf(item: Pick<ItemRecord, 'status'>): ItemStatus {
  return item.status ?? 'ACTIVE';
}

/** Only ACTIVE items may be offered to operational users or used in new transactions. */
export function isOperationalItem(item: Pick<ItemRecord, 'status'>): boolean {
  return itemStatusOf(item) === 'ACTIVE';
}

/** Admin/management see everything for maintenance; auditors keep read access to history. */
export function seesInactiveItems(role: string): boolean {
  return role === 'ADMIN' || role === 'ADMIN_USER' || role === 'AUDITOR';
}

export type ItemStatusFilter = ItemStatus | 'all' | 'default';

export function parseStatusFilter(value: unknown): ItemStatusFilter {
  if (value === undefined || value === null || value === '') return 'default';
  const raw = String(value).trim();
  if (raw.toLowerCase() === 'all') return 'all';
  const upper = raw.toUpperCase();
  if ((ITEM_STATUSES as readonly string[]).includes(upper)) return upper as ItemStatus;
  throw new Error('status must be ACTIVE, INACTIVE, ARCHIVED or all.');
}

/**
 * Operational users only ever get ACTIVE items. Privileged roles get every
 * item except archived ones by default (so day-to-day lists stay clean), and
 * can ask for ARCHIVED or all to maintain them.
 */
export function visibleItems<T extends Pick<ItemRecord, 'status'>>(role: string, items: T[], filter: ItemStatusFilter = 'default'): T[] {
  if (!seesInactiveItems(role)) return items.filter(isOperationalItem);
  if (filter === 'all') return items;
  if (filter === 'default') return items.filter((item) => itemStatusOf(item) !== 'ARCHIVED');
  return items.filter((item) => itemStatusOf(item) === filter);
}

export function parseStatusChange(body: Record<string, unknown>): { status: ItemStatus; reason?: string } {
  const status = String(body.status ?? '').trim().toUpperCase();
  if (!(ITEM_STATUSES as readonly string[]).includes(status)) throw new Error('status must be ACTIVE, INACTIVE or ARCHIVED.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (status !== 'ACTIVE' && reason.length < MIN_STATUS_REASON) {
    throw new Error(`A reason of at least ${MIN_STATUS_REASON} characters is required to ${status === 'ARCHIVED' ? 'archive' : 'deactivate'} an item.`);
  }
  return { status: status as ItemStatus, reason: status === 'ACTIVE' ? undefined : reason.slice(0, 190) };
}

// ---- identity -------------------------------------------------------------

export function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export type ItemMasterFields = Partial<Pick<ItemRecord, 'barcode' | 'hsn' | 'gstRate' | 'mrp' | 'leadTimeDays' | 'shelfLifeDays' | 'aliases'>>;

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} must be at most ${max} characters.`);
  return trimmed || undefined;
}

function optionalNumber(value: unknown, label: string, min: number, max: number, integer: boolean): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`);
  }
  return n;
}

/** Validates the Item Master commercial/planning/integration fields. Only keys present in the body are returned. */
export function parseItemMasterFields(body: Record<string, unknown>): ItemMasterFields {
  const out: ItemMasterFields = {};
  if (body.barcode !== undefined) out.barcode = optionalText(body.barcode, 'Barcode', 64);
  if (body.hsn !== undefined) {
    const hsn = optionalText(body.hsn, 'HSN', 16);
    if (hsn !== undefined && !/^[0-9A-Za-z]+$/.test(hsn)) throw new Error('HSN may only contain letters and digits.');
    out.hsn = hsn;
  }
  if (body.gstRate !== undefined) out.gstRate = optionalNumber(body.gstRate, 'GST rate', 0, 100, false);
  if (body.mrp !== undefined) out.mrp = optionalNumber(body.mrp, 'MRP', 0, 10_000_000, false);
  if (body.leadTimeDays !== undefined) out.leadTimeDays = optionalNumber(body.leadTimeDays, 'Lead time', 0, 3650, true);
  if (body.shelfLifeDays !== undefined) out.shelfLifeDays = optionalNumber(body.shelfLifeDays, 'Shelf life', 0, 36500, true);
  if (body.aliases !== undefined) {
    if (body.aliases !== null && !Array.isArray(body.aliases)) throw new Error('aliases must be a list.');
    const seen = new Set<string>();
    const aliases: string[] = [];
    for (const entry of (body.aliases as unknown[] | null) ?? []) {
      const alias = typeof entry === 'string' ? entry.trim().replace(/\s+/g, ' ') : '';
      if (!alias) continue;
      if (alias.length > 120) throw new Error('Each alias must be at most 120 characters.');
      if (seen.has(normalizeKey(alias))) continue;
      seen.add(normalizeKey(alias));
      aliases.push(alias);
    }
    if (aliases.length > 50) throw new Error('An item can have at most 50 aliases.');
    out.aliases = aliases.length ? aliases : undefined;
  }
  return out;
}

/**
 * Codes, barcodes and aliases share one namespace: import rows resolve
 * through all three, so two items must never claim the same key.
 */
export function findIdentityConflict(
  items: ItemRecord[],
  itemId: string,
  claim: { code?: string; barcode?: string; aliases?: string[] },
): string | null {
  const owners = new Map<string, { item: ItemRecord; kind: string }>();
  for (const other of items) {
    if (other.id === itemId) continue;
    owners.set(normalizeKey(other.code), { item: other, kind: 'Item Code' });
    if (other.barcode) owners.set(normalizeKey(other.barcode), { item: other, kind: 'barcode' });
    for (const alias of other.aliases ?? []) owners.set(normalizeKey(alias), { item: other, kind: 'alias' });
  }
  const checks: Array<[string, string]> = [];
  if (claim.code) checks.push([claim.code, 'Item Code']);
  if (claim.barcode) checks.push([claim.barcode, 'Barcode']);
  for (const alias of claim.aliases ?? []) checks.push([alias, 'Alias']);
  for (const [value, label] of checks) {
    const clash = owners.get(normalizeKey(value));
    if (clash) return `${label} "${value}" is already used as the ${clash.kind} of ${clash.item.code} (${clash.item.name}).`;
  }
  return null;
}

export type ItemMatch = {
  item?: ItemRecord;
  via?: 'code' | 'barcode' | 'alias' | 'name';
  // Several items share the name and nothing more specific identified one.
  ambiguous?: boolean;
};

/**
 * One resolver for every import/scan path (blueprint §10 "Item code/name/ERP
 * alias mapping"): exact code, then barcode, then ERP alias, then a unique
 * name. An archived match is still returned so callers can say "archived"
 * instead of "unknown".
 */
export function resolveItemByIdentity(items: ItemRecord[], input: { code?: string; name?: string }): ItemMatch {
  const code = normalizeKey(input.code);
  if (code) {
    const byCode = items.find((item) => normalizeKey(item.code) === code);
    if (byCode) return { item: byCode, via: 'code' };
    const byBarcode = items.find((item) => item.barcode && normalizeKey(item.barcode) === code);
    if (byBarcode) return { item: byBarcode, via: 'barcode' };
    const byAlias = items.find((item) => (item.aliases ?? []).some((alias) => normalizeKey(alias) === code));
    if (byAlias) return { item: byAlias, via: 'alias' };
  }
  const name = normalizeKey(input.name);
  if (name) {
    const byName = items.filter((item) => normalizeKey(item.name) === name);
    if (byName.length === 1) return { item: byName[0], via: 'name' };
    if (byName.length > 1) return { ambiguous: true };
    const byAlias = items.filter((item) => (item.aliases ?? []).some((alias) => normalizeKey(alias) === name));
    if (byAlias.length === 1) return { item: byAlias[0], via: 'alias' };
    if (byAlias.length > 1) return { ambiguous: true };
  }
  return {};
}

// ---- delete guard ---------------------------------------------------------

export const REFERENCE_LABELS: Record<string, string> = {
  stock: 'stock on hand',
  movements: 'stock movements',
  counts: 'stock counts',
  assignments: 'count assignments',
  transfers: 'transfer lines',
  orders: 'order lines',
  purchaseOrders: 'purchase order lines',
  returns: 'return lines',
  inspections: 'QC inspections',
  exceptions: 'exception cases',
  campaigns: 'stock-take campaigns',
};

export type ItemReferenceCounts = Partial<Record<keyof typeof REFERENCE_LABELS, number>>;

/** Everything that stops a permanent delete. Empty = safe to delete. */
export function deleteBlockers(counts: ItemReferenceCounts): Array<{ key: string; label: string; count: number }> {
  return Object.entries(counts)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([key, count]) => ({ key, label: REFERENCE_LABELS[key] ?? key, count: count as number }));
}

export function describeBlockers(blockers: Array<{ label: string; count: number }>): string {
  return blockers.map((row) => `${row.count} ${row.label}`).join(', ');
}
