// Saves the values of company-defined import columns (Control Plane > Studio > Import columns)
// onto the items they belong to, using the existing item custom-field tables
// (CustomFieldDefinition per company, CustomFieldValue per item). A blank cell never
// overwrites an existing value. Items are matched by item code within the company only.

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, resolveDatabaseUrl } from './db.js';
import type { ImportFieldConfig } from './import-profile.js';
import { controlPlane } from './saas/control-plane.js';

export type ImportedCustomValuesResult = {
  fields: number;
  values: number;
  unmatchedItems: number;
};

type RowWithExtra = { code: string; extra?: Record<string, string | number | null> };

const EMPTY: ImportedCustomValuesResult = { fields: 0, values: 0, unmatchedItems: 0 };
const CHUNK = 500;

function definitionType(field: ImportFieldConfig): string {
  return field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
}

function storedValue(field: ImportFieldConfig, raw: string | number): string {
  if (field.type === 'date') return String(raw).slice(0, 10);
  return String(raw);
}

/** Last non-blank value per (item code, column) wins - the same rule the lot aggregation uses. */
export function collectCustomValues(
  rows: RowWithExtra[],
  customFields: ImportFieldConfig[],
): Map<string, Map<string, string>> {
  const byKey = new Map(customFields.map((field) => [field.key, field]));
  const perItem = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!row.extra || !row.code) continue;
    for (const [key, raw] of Object.entries(row.extra)) {
      const field = byKey.get(key);
      if (!field || raw === null || raw === undefined || String(raw).trim() === '') continue;
      const values = perItem.get(row.code) ?? new Map<string, string>();
      values.set(key, storedValue(field, raw));
      perItem.set(row.code, values);
    }
  }
  return perItem;
}

export async function saveImportedCustomValues(companyId: string, rows: RowWithExtra[]): Promise<ImportedCustomValuesResult> {
  if (!resolveDatabaseUrl()) return EMPTY;
  const profile = controlPlane.getImportProfile(companyId, 'OPENING_STOCK');
  const customFields = (profile?.fields ?? []).filter((field) => field.custom && field.enabled);
  if (!customFields.length) return EMPTY;
  const perItem = collectCustomValues(rows, customFields);
  if (!perItem.size) return EMPTY;

  const usedKeys = new Set([...perItem.values()].flatMap((values) => [...values.keys()]));
  const fields = customFields.filter((field) => usedKeys.has(field.key));

  // One definition per column name per company; reuse an existing one (any type) instead of duplicating it.
  const existing = await prisma.customFieldDefinition.findMany({ where: { companyId, name: { in: fields.map((field) => field.label) } } });
  const definitionByName = new Map(existing.map((definition) => [definition.name, definition.id]));
  for (const field of fields) {
    if (definitionByName.has(field.label)) continue;
    const created = await prisma.customFieldDefinition.create({
      data: { name: field.label, companyId, type: definitionType(field), required: false },
    });
    definitionByName.set(field.label, created.id);
  }

  const codes = [...perItem.keys()];
  const itemIdByCode = new Map<string, string>();
  for (let offset = 0; offset < codes.length; offset += CHUNK) {
    const found = await prisma.item.findMany({
      where: { companyId, code: { in: codes.slice(offset, offset + CHUNK) } },
      select: { id: true, code: true },
    });
    for (const item of found) itemIdByCode.set(item.code, item.id);
  }

  const labelByKey = new Map(fields.map((field) => [field.key, field.label]));
  const writes: Array<{ itemId: string; fieldId: string; value: string }> = [];
  let unmatchedItems = 0;
  for (const [code, values] of perItem) {
    const itemId = itemIdByCode.get(code);
    if (!itemId) { unmatchedItems += 1; continue; }
    for (const [key, value] of values) {
      const fieldId = definitionByName.get(labelByKey.get(key) ?? '');
      if (fieldId) writes.push({ itemId, fieldId, value });
    }
  }

  for (let offset = 0; offset < writes.length; offset += CHUNK) {
    const chunk = writes.slice(offset, offset + CHUNK);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "CustomFieldValue" (id, "itemId", "fieldId", value, "updatedAt")
      VALUES ${Prisma.join(chunk.map((write) => Prisma.sql`(${randomUUID()}, ${write.itemId}, ${write.fieldId}, ${write.value}, NOW())`))}
      ON CONFLICT ("itemId", "fieldId") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
    `);
  }
  return { fields: fields.length, values: writes.length, unmatchedItems };
}

/** Every item's custom field values for one company: { [itemId]: { [fieldName]: value } }. */
export async function loadCustomFieldValues(companyId: string): Promise<Record<string, Record<string, string>>> {
  const rows = await prisma.customFieldValue.findMany({
    where: { field: { companyId }, item: { companyId } },
    select: { itemId: true, value: true, field: { select: { name: true } } },
  });
  const values: Record<string, Record<string, string>> = {};
  for (const row of rows) (values[row.itemId] ??= {})[row.field.name] = row.value;
  return values;
}
