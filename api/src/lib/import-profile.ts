// Per-company import profile: which columns the opening-stock / stock-update
// import expects, in what order, under which names, and which are required.
// Edited from the Control Plane Studio; read by lib/stock-import.ts (parser)
// and the template download. Built-in fields can be renamed, reordered,
// disabled or given extra header aliases; companies can also add custom
// columns. Nothing here touches the stock ledger.

export type ImportFieldType = 'text' | 'number' | 'date';

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
};

export type ImportProfile = {
  importType: 'OPENING_STOCK';
  fields: ImportFieldConfig[];
  updatedAt: string;
};

export class ImportProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportProfileError';
  }
}

type BuiltinField = { key: string; label: string; type: ImportFieldType; required: boolean; aliases: string[]; sample: string };

// Order matches the long-standing OPENING_STOCK_TEMPLATE header row.
export const BUILTIN_STOCK_FIELDS: BuiltinField[] = [
  { key: 'companyName', label: 'COMPANY NAME', type: 'text', required: false, aliases: ['companyname', 'brand', 'manufacturer'], sample: 'Invexa' },
  { key: 'locationName', label: 'BRANCH NAME', type: 'text', required: false, aliases: ['branchname', 'branch', 'location', 'locationname', 'store'], sample: 'Main Store' },
  { key: 'category', label: 'CATEGORY', type: 'text', required: false, aliases: ['category'], sample: 'Staples' },
  { key: 'subcategory', label: 'SUB CATEGORY', type: 'text', required: false, aliases: ['subcategory', 'subcat', 'subgroup'], sample: 'Grains' },
  { key: 'code', label: 'ITEM CODE', type: 'text', required: false, aliases: ['code', 'itemcode', 'sku', 'barcode'], sample: 'SKU-1001' },
  { key: 'itemName', label: 'ITEM NAME', type: 'text', required: true, aliases: ['name', 'itemname', 'productname'], sample: 'Rice 5kg' },
  { key: 'unit', label: 'PACK/SIZE', type: 'text', required: false, aliases: ['unit', 'packsize', 'pack', 'size'], sample: 'KG' },
  { key: 'batch', label: 'BATCH', type: 'text', required: false, aliases: ['batch', 'batchno', 'batchnumber'], sample: 'B1' },
  { key: 'lotNo', label: 'LOT CODE', type: 'text', required: false, aliases: ['lotcode', 'lot', 'lotno', 'lotnumber'], sample: 'LOT-01' },
  { key: 'expiryDate', label: 'EXPIRY DATE', type: 'date', required: false, aliases: ['expirydate', 'expiry', 'expirationdate'], sample: '31/12/2027' },
  { key: 'quantity', label: 'CLOSING STOCK', type: 'number', required: false, aliases: ['closingstock', 'openingqty', 'openingstock', 'quantity', 'qty', 'onhand'], sample: '25' },
  { key: 'purchaseValue', label: 'PURCHASE VALUE', type: 'number', required: false, aliases: ['closingvaluepurrate', 'purchasevalue', 'costvalue'], sample: '' },
  { key: 'saleValue', label: 'SALE VALUE', type: 'number', required: false, aliases: ['closingvaluesalerate', 'salevalue', 'retailvalue'], sample: '' },
];

// Shown in the default template; the two value columns exist in the parser
// but are off until a company turns them on.
const DEFAULT_ENABLED = new Set(BUILTIN_STOCK_FIELDS.slice(0, 11).map((field) => field.key));

const MAX_FIELDS = 40;
const BUILTIN_BY_KEY = new Map(BUILTIN_STOCK_FIELDS.map((field) => [field.key, field]));

export function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function defaultImportProfile(): ImportProfile {
  return {
    importType: 'OPENING_STOCK',
    updatedAt: new Date(0).toISOString(),
    fields: BUILTIN_STOCK_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      custom: false,
      type: field.type,
      enabled: DEFAULT_ENABLED.has(field.key),
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
export function normalizeImportProfile(input: unknown): ImportProfile {
  const rawFields = (input as { fields?: unknown })?.fields;
  if (!Array.isArray(rawFields)) throw new ImportProfileError('Columns list is required.');
  if (rawFields.length > MAX_FIELDS) throw new ImportProfileError(`A maximum of ${MAX_FIELDS} columns is allowed.`);

  const fields: ImportFieldConfig[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const raw of rawFields as Array<Record<string, unknown>>) {
    const label = cleanText(raw?.label, 60);
    if (!label) throw new ImportProfileError('Every column needs a name.');
    const wantedKey = cleanText(raw?.key, 40);
    const builtin = BUILTIN_BY_KEY.get(wantedKey);
    const custom = !builtin;
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
    if (key === 'itemName' && !enabled) throw new ImportProfileError('ITEM NAME cannot be turned off.');
    fields.push({
      key,
      label,
      custom,
      type,
      enabled: key === 'itemName' ? true : enabled,
      required: key === 'itemName' ? true : Boolean(raw?.required) && enabled,
      aliases,
      defaultValue,
    });
  }

  // Built-in columns can be turned off but never lost: re-append any missing ones (off).
  for (const builtin of BUILTIN_STOCK_FIELDS) {
    if (keys.has(builtin.key)) continue;
    fields.push({ key: builtin.key, label: builtin.label, custom: false, type: builtin.type, enabled: false, required: false, aliases: [] });
  }
  return { importType: 'OPENING_STOCK', fields, updatedAt: new Date().toISOString() };
}

/** Header text -> field lookup used by the parser (all normalized, lower-case). */
export function aliasMapForProfile(profile: ImportProfile | undefined): Record<string, string[]> {
  const source = profile ?? defaultImportProfile();
  const map: Record<string, string[]> = {};
  for (const field of source.fields) {
    if (!field.enabled) continue;
    const builtin = BUILTIN_BY_KEY.get(field.key);
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
export function importTemplateCsv(profile: ImportProfile | undefined): string {
  const enabled = (profile ?? defaultImportProfile()).fields.filter((field) => field.enabled);
  const sample = enabled.map((field) => {
    if (field.defaultValue) return field.defaultValue;
    const builtin = BUILTIN_BY_KEY.get(field.key);
    if (builtin) return builtin.sample;
    return field.type === 'number' ? '0' : field.type === 'date' ? '31/12/2027' : '';
  });
  return [enabled.map((field) => csvCell(field.label)).join(','), sample.map(csvCell).join(',')].join('\n');
}
