// Per-company import profiles: which columns an Excel import expects, in what order, under which
// names, and which are required. Edited from the Control Plane Studio; read by the parsers
// (lib/stock-import.ts for opening stock, lib/daily-stock-sync.ts for sales/purchase) and by the
// template downloads. Built-in fields can be renamed, reordered, disabled or given extra header
// aliases. Companies can also add custom columns to the stock import (saved on items - see
// lib/import-custom-values.ts). Nothing here touches the stock ledger.

import { FormulaError, validateFormula } from './formula.js';

export type ImportFieldType = 'text' | 'number' | 'date';
export type ImportKind = 'OPENING_STOCK' | 'SALES' | 'PURCHASE';
export const IMPORT_KINDS: readonly ImportKind[] = ['OPENING_STOCK', 'SALES', 'PURCHASE'];

export type ImportFieldConfig = {
  key: string;
  label: string;
  custom: boolean;
  type: ImportFieldType;
  enabled: boolean;
  required: boolean;
  /** Extra header texts (besides the label and built-in names) that map to this field. */
  aliases: string[];
  /** Used when the cell is empty. */
  defaultValue?: string;
  /** Stock import, number columns only: calculated from the other number columns instead of read from the file. */
  formula?: string;
};

export type ImportProfile = {
  importType: ImportKind;
  fields: ImportFieldConfig[];
  updatedAt: string;
};

export class ImportProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportProfileError';
  }
}

type BuiltinField = {
  key: string;
  label: string;
  type: ImportFieldType;
  required: boolean;
  aliases: string[];
  sample: string;
  /** Always on and required: the import cannot work without it. */
  locked?: boolean;
  /** Part of the standard template; the rest start switched off. */
  standard: boolean;
};

const f = (key: string, label: string, type: ImportFieldType, aliases: string[], sample: string, extra: Partial<BuiltinField> = {}): BuiltinField =>
  ({ key, label, type, required: false, aliases, sample, standard: true, ...extra });

// Order and labels match the long-standing CSV templates (web/src/lib/import-templates.js).
const BUILTINS: Record<ImportKind, BuiltinField[]> = {
  OPENING_STOCK: [
    f('companyName', 'COMPANY NAME', 'text', ['companyname', 'brand', 'manufacturer'], 'Invexa'),
    f('locationName', 'BRANCH NAME', 'text', ['branchname', 'branch', 'location', 'locationname', 'store'], 'Main Store'),
    f('category', 'CATEGORY', 'text', ['category'], 'Staples'),
    f('subcategory', 'SUB CATEGORY', 'text', ['subcategory', 'subcat', 'subgroup'], 'Grains'),
    f('code', 'ITEM CODE', 'text', ['code', 'itemcode', 'sku', 'barcode'], 'SKU-1001'),
    f('itemName', 'ITEM NAME', 'text', ['name', 'itemname', 'productname'], 'Rice 5kg', { required: true, locked: true }),
    f('unit', 'PACK/SIZE', 'text', ['unit', 'packsize', 'pack', 'size'], 'KG'),
    f('batch', 'BATCH', 'text', ['batch', 'batchno', 'batchnumber'], 'B1'),
    f('lotNo', 'LOT CODE', 'text', ['lotcode', 'lot', 'lotno', 'lotnumber'], 'LOT-01'),
    f('expiryDate', 'EXPIRY DATE', 'date', ['expirydate', 'expiry', 'expirationdate'], '31/12/2027'),
    f('quantity', 'CLOSING STOCK', 'number', ['closingstock', 'openingqty', 'openingstock', 'quantity', 'qty', 'onhand'], '25'),
    f('purchaseValue', 'PURCHASE VALUE', 'number', ['closingvaluepurrate', 'purchasevalue', 'costvalue'], '', { standard: false }),
    f('saleValue', 'SALE VALUE', 'number', ['closingvaluesalerate', 'salevalue', 'retailvalue'], '', { standard: false }),
  ],
  SALES: [
    f('lineNo', 'S_No.', 'text', ['sno', 'serialno', 'lineno', 'line'], '1'),
    f('locationName', 'Branch Name', 'text', ['branchname', 'branch', 'store', 'storelocation', 'location', 'partyname', 'receivinglocation'], 'Main Store', { required: true, locked: true }),
    f('billDate', 'Bill Date', 'date', ['billdate', 'invoicedate', 'receiptdate', 'grndate', 'date'], '11/09/2026', { required: true, locked: true }),
    f('billTime', 'Bill Time', 'text', ['billtime', 'invoicetime', 'receipttime', 'time'], '10:18 AM'),
    f('reference', 'Bill No.', 'text', ['billno', 'invoiceno', 'invoicenumber', 'grnno', 'grnnumber', 'receiptno', 'transactionid'], 'DGR-1', { required: true, locked: true }),
    f('itemCode', 'Item Code', 'text', ['itemcode', 'code', 'sku', 'barcode'], 'SKU-1001'),
    f('itemName', 'Item Name', 'text', ['itemname', 'productname', 'name'], 'Rice 5kg', { required: true, locked: true }),
    f('lotNo', 'Lot No.', 'text', ['lotno', 'lotnumber', 'batch', 'batchno'], 'LOT-01'),
    f('unit', 'Unit', 'text', ['packsize', 'packgrade', 'packsizegrade', 'unit', 'pack'], 'KG'),
    f('quantity', 'Total Qty', 'number', ['totalqty', 'quantity', 'qty', 'qtyreceived', 'quantityreceived', 'returnqty'], '1', { required: true, locked: true }),
    f('rowSource', 'Row Source', 'text', ['rowsource', 'rowsourceref', 'datasource', 'sourcesystem'], 'ERP'),
    f('returnQty', 'Sales Return Qty', 'number', ['salesreturnqty', 'returnqty', 'returnedqty'], '', { standard: false }),
    f('rate', 'Rate', 'number', ['rate', 'rateunit', 'rateperunit'], '', { standard: false }),
    f('amount', 'Amount', 'number', ['grossamount', 'netamount', 'billamount', 'amount'], '', { standard: false }),
    f('transactionType', 'Transaction Type', 'text', ['transactiontype', 'type', 'salestype', 'returntype'], '', { standard: false }),
  ],
  PURCHASE: [
    f('lineNo', 'SNO.', 'text', ['sno', 'serialno', 'lineno', 'line'], '1'),
    f('billDate', 'Bill Date', 'date', ['billdate', 'invoicedate', 'receiptdate', 'grndate', 'date'], '11/09/2026', { required: true, locked: true }),
    f('reference', 'Bill No.', 'text', ['billno', 'invoiceno', 'invoicenumber', 'grnno', 'grnnumber', 'receiptno', 'transactionid'], 'HOST-1', { required: true, locked: true }),
    f('itemCode', 'Item Code', 'text', ['itemcode', 'code', 'sku', 'barcode'], 'SKU-1001'),
    f('itemName', 'Item Name', 'text', ['itemname', 'productname', 'name'], 'Rice 5kg', { required: true, locked: true }),
    f('unit', 'Pack/Grade', 'text', ['packsize', 'packgrade', 'packsizegrade', 'unit', 'pack'], 'KG'),
    f('lotNo', 'Lot No.', 'text', ['lotno', 'lotnumber', 'batch', 'batchno'], 'LOT-01'),
    f('quantity', 'Total Qty', 'number', ['totalqty', 'quantity', 'qty', 'qtyreceived', 'quantityreceived', 'returnqty'], '10', { required: true, locked: true }),
    f('rowSource', 'Row Source', 'text', ['rowsource', 'rowsourceref', 'datasource', 'sourcesystem'], 'ERP'),
    f('rate', 'Rate', 'number', ['rate', 'rateunit', 'rateperunit'], '', { standard: false }),
    f('amount', 'Amount', 'number', ['grossamount', 'netamount', 'billamount', 'amount'], '', { standard: false }),
  ],
};

export const BUILTIN_STOCK_FIELDS = BUILTINS.OPENING_STOCK;

/** Standard header names per field for a kind - what the parser accepts when no profile is saved. */
export function builtinAliasMap(kind: ImportKind): Record<string, string[]> {
  return Object.fromEntries(BUILTINS[kind].map((field) => [field.key, field.aliases]));
}

const MAX_FIELDS = 40;

/** Columns the import cannot work without; the editor shows them as always on. */
export function lockedFieldKeys(kind: ImportKind): string[] {
  return BUILTINS[kind].filter((field) => field.locked).map((field) => field.key);
}

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === 'string' && (IMPORT_KINDS as readonly string[]).includes(value);
}

/** Storage key in the control plane map. Opening stock keeps the bare company id (older snapshots). */
export function profileKey(companyId: string, kind: ImportKind): string {
  return kind === 'OPENING_STOCK' ? companyId : `${companyId}|${kind}`;
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function defaultImportProfile(kind: ImportKind = 'OPENING_STOCK'): ImportProfile {
  return {
    importType: kind,
    updatedAt: new Date(0).toISOString(),
    fields: BUILTINS[kind].map((field) => ({
      key: field.key,
      label: field.label,
      custom: false,
      type: field.type,
      enabled: field.standard,
      required: field.required,
      aliases: [],
    })),
  };
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function customKeyFromLabel(label: string, taken: Set<string>): string {
  const base = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'column'}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** Validates and cleans an edited profile. Throws ImportProfileError with a plain-language message. */
export function normalizeImportProfile(input: unknown, kind: ImportKind = 'OPENING_STOCK'): ImportProfile {
  const rawFields = (input as { fields?: unknown })?.fields;
  if (!Array.isArray(rawFields)) throw new ImportProfileError('Columns list is required.');
  if (rawFields.length > MAX_FIELDS) throw new ImportProfileError(`A maximum of ${MAX_FIELDS} columns is allowed.`);

  const builtins = BUILTINS[kind];
  const builtinByKey = new Map(builtins.map((field) => [field.key, field]));
  const fields: ImportFieldConfig[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const raw of rawFields as Array<Record<string, unknown>>) {
    const label = cleanText(raw?.label, 60);
    if (!label) throw new ImportProfileError('Every column needs a name.');
    const wantedKey = cleanText(raw?.key, 40);
    const builtin = builtinByKey.get(wantedKey);
    const custom = !builtin;
    if (custom && kind !== 'OPENING_STOCK') {
      throw new ImportProfileError('Your own columns can only be added to the stock import.');
    }
    if (custom && wantedKey && !/^custom_[a-z0-9_]{1,34}$/.test(wantedKey)) {
      throw new ImportProfileError(`"${label}" has an invalid column key.`);
    }
    const key = builtin ? builtin.key : (wantedKey || customKeyFromLabel(label, keys));
    if (keys.has(key)) throw new ImportProfileError(`Column "${label}" is listed twice.`);
    keys.add(key);
    const normalizedLabel = normalizeHeader(label);
    if (labels.has(normalizedLabel)) throw new ImportProfileError(`Two columns are both called "${label}".`);
    labels.add(normalizedLabel);

    const type: ImportFieldType = builtin
      ? builtin.type
      : (['text', 'number', 'date'].includes(String(raw?.type)) ? (raw.type as ImportFieldType) : 'text');
    const aliases = Array.isArray(raw?.aliases)
      ? [...new Set((raw.aliases as unknown[]).map((alias) => cleanText(alias, 60)).filter(Boolean))].slice(0, 10)
      : [];
    const defaultValue = cleanText(raw?.defaultValue, 80) || undefined;
    if (defaultValue && type === 'number' && !Number.isFinite(Number(defaultValue))) {
      throw new ImportProfileError(`Default value for "${label}" must be a number.`);
    }
    const enabled = raw?.enabled !== false;
    if (builtin?.locked && !enabled) throw new ImportProfileError(`${builtin.label} cannot be turned off.`);
    fields.push({
      key,
      label,
      custom,
      type,
      enabled: builtin?.locked ? true : enabled,
      required: builtin?.locked ? true : Boolean(raw?.required) && enabled,
      aliases,
      defaultValue,
      ...(enabled && cleanText(raw?.formula, 300) ? { formula: cleanText(raw?.formula, 300) } : {}),
    });
  }

  validateColumnFormulas(fields, kind);

  // Built-in columns can be turned off but never lost: re-append any missing ones (off, unless essential).
  for (const builtin of builtins) {
    if (keys.has(builtin.key)) continue;
    fields.push({
      key: builtin.key, label: builtin.label, custom: false, type: builtin.type,
      enabled: Boolean(builtin.locked), required: Boolean(builtin.locked), aliases: [],
    });
  }
  return { importType: kind, fields, updatedAt: new Date().toISOString() };
}

/**
 * A column formula may only use the other enabled number columns that are themselves read from the file
 * (no formula chains), and only the stock import supports them.
 */
function validateColumnFormulas(fields: ImportFieldConfig[], kind: ImportKind): void {
  for (const field of fields) {
    if (!field.formula) continue;
    if (kind !== 'OPENING_STOCK') throw new ImportProfileError('Formulas are only available for the stock import.');
    if (field.type !== 'number') throw new ImportProfileError(`"${field.label}" is not a number column, so it cannot be calculated.`);
    const inputs = fields.filter((other) => other !== field && other.enabled && other.type === 'number' && !other.formula);
    try {
      validateFormula(field.formula, inputs.map((input) => input.key.toLowerCase()));
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      const names = inputs.map((input) => input.label).join(', ') || 'none yet - add a number column first';
      throw new ImportProfileError(`Formula for "${field.label}": ${error.message.replace(/You can use: .*$/, '').trim()} Columns you can use: ${names}.`);
    }
  }
}

/** Header text -> field lookup used by the parsers (all normalized, lower-case). */
export function aliasMapForProfile(profile: ImportProfile | undefined, kind: ImportKind = 'OPENING_STOCK'): Record<string, string[]> {
  const source = profile ?? defaultImportProfile(kind);
  const builtinByKey = new Map(BUILTINS[source.importType].map((field) => [field.key, field]));
  const map: Record<string, string[]> = {};
  for (const field of source.fields) {
    if (!field.enabled) continue;
    const builtin = builtinByKey.get(field.key);
    map[field.key] = [...new Set([
      ...(builtin?.aliases ?? []),
      normalizeHeader(field.label),
      ...field.aliases.map(normalizeHeader),
    ].filter(Boolean))];
  }
  return map;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV template (header + one sample row) in the profile's column order. */
export function importTemplateCsv(profile: ImportProfile | undefined, kind: ImportKind = profile?.importType ?? 'OPENING_STOCK'): string {
  const source = profile ?? defaultImportProfile(kind);
  const builtinByKey = new Map(BUILTINS[source.importType].map((field) => [field.key, field]));
  const enabled = source.fields.filter((field) => field.enabled);
  const sample = enabled.map((field) => {
    if (field.defaultValue) return field.defaultValue;
    const builtin = builtinByKey.get(field.key);
    if (builtin) return builtin.sample;
    return field.type === 'number' ? '0' : field.type === 'date' ? '31/12/2027' : '';
  });
  return [enabled.map((field) => csvCell(field.label)).join(','), sample.map(csvCell).join(',')].join('\n');
}
