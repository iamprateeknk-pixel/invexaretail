import { createHash } from 'node:crypto';
import readExcelFile from 'read-excel-file/node';

export type StockImportFormat = 'invexa-expiry-stock' | 'standard-items';

export type StockImportRow = {
  rowNumber: number;
  code: string;
  itemName: string;
  companyName?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  locationName?: string;
  lotNo?: string;
  batch?: string;
  expiryDate?: string | null;
  quantity?: number;
  purchaseValue?: number;
  saleValue?: number;
};

export type StockImportError = { rowNumber: number; message: string };

export type StockImportPreview = {
  format: StockImportFormat;
  sheetName: string;
  headerRow: number;
  snapshotAt: string;
  totalRows: number;
  validRows: StockImportRow[];
  errors: StockImportError[];
  duplicateRows: number;
  negativeQuantityRows: number;
  fractionalQuantityRows: number;
  branches: string[];
  mapping: Record<string, string>;
};

const HEADER_ALIASES: Record<string, string[]> = {
  code: ['code', 'itemcode', 'sku', 'barcode'],
  itemName: ['name', 'itemname', 'productname'],
  companyName: ['companyname', 'brand', 'manufacturer'],
  category: ['category'],
  subcategory: ['subcategory', 'subcat', 'subgroup'],
  unit: ['unit', 'packsize', 'pack', 'size'],
  locationName: ['branchname', 'branch', 'location', 'locationname', 'store'],
  batch: ['batch', 'batchno', 'batchnumber'],
  lotNo: ['lotcode', 'lot', 'lotno', 'lotnumber'],
  expiryDate: ['expirydate', 'expiry', 'expirationdate'],
  quantity: ['closingstock', 'openingqty', 'openingstock', 'quantity', 'qty', 'onhand'],
  purchaseValue: ['closingvaluepurrate', 'purchasevalue', 'costvalue'],
  saleValue: ['closingvaluesalerate', 'salevalue', 'retailvalue'],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const normalized = text(value).replaceAll(',', '');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stableCode(companyName: string, itemName: string): string {
  const key = `${companyName.trim().toLowerCase()}|${itemName.trim().toLowerCase()}`;
  return `ERP-${createHash('sha1').update(key).digest('hex').slice(0, 12).toUpperCase()}`;
}

function parseDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || text(value) === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const match = text(value).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function findHeader(rows: unknown[][]): { index: number; columns: Record<string, number>; mapping: Record<string, string> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const columns: Record<string, number> = {};
    const mapping: Record<string, string> = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      const columnIndex = normalized.findIndex((header) => aliases.includes(header));
      if (columnIndex >= 0) {
        columns[field] = columnIndex;
        mapping[field] = text(rows[rowIndex][columnIndex]);
      }
    }
    if (columns.itemName !== undefined && (columns.code !== undefined || (columns.locationName !== undefined && columns.quantity !== undefined))) {
      return { index: rowIndex, columns, mapping };
    }
  }
  return null;
}

function reportSnapshotAt(rows: unknown[][], headerIndex: number): string {
  const reportText = rows.slice(0, headerIndex).flat().map(text).join(' ');
  const match = reportText.match(/(?:to|as\s+of)\s+(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i)
    ?? reportText.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/);
  return (match && parseDate(match[1])) || new Date().toISOString();
}

function parseCsv(content: string): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}

export async function readTabularFile(buffer: Buffer, fileName: string): Promise<{ sheetName: string; rows: unknown[][] }> {
  let sheetName = 'CSV';
  let rows: unknown[][];
  if (/\.csv$/i.test(fileName)) {
    rows = parseCsv(buffer.toString('utf8'));
  } else {
    const sheets = await readExcelFile(buffer);
    const worksheet = sheets[0];
    if (!worksheet) throw new Error('Workbook does not contain a sheet.');
    sheetName = worksheet.sheet;
    rows = worksheet.data;
  }
  return { sheetName, rows };
}

export async function parseStockImport(buffer: Buffer, fileName: string): Promise<StockImportPreview> {
  const { sheetName, rows } = await readTabularFile(buffer, fileName);
  const header = findHeader(rows);
  if (!header) {
    throw new Error('Supported header row not found. Use Code + Name, or BRANCH NAME + ITEM NAME + CLOSING STOCK.');
  }

  const format: StockImportFormat = header.columns.locationName !== undefined && header.columns.quantity !== undefined
    ? 'invexa-expiry-stock'
    : 'standard-items';
  const validRows: StockImportRow[] = [];
  const errors: StockImportError[] = [];
  let duplicateRows = 0;
  let negativeQuantityRows = 0;
  let fractionalQuantityRows = 0;
  const branches = new Set<string>();
  const seen = new Set<string>();

  for (let index = header.index + 1; index < rows.length; index += 1) {
    const source = rows[index];
    if (!source.some((value) => text(value))) continue;
    if (source.some((value) => normalizeHeader(value) === 'grandtotals')) continue;

    const get = (field: string) => source[header.columns[field]];
    const itemName = text(get('itemName'));
    const companyName = text(get('companyName'));
    const suppliedCode = text(get('code'));
    const locationName = text(get('locationName'));
    const lotNo = text(get('lotNo')) || text(get('batch')) || 'LOT-DEFAULT';
    const quantity = finiteNumber(get('quantity'));
    const expiryDate = parseDate(get('expiryDate'));
    const rowNumber = index + 1;

    if (!itemName) {
      errors.push({ rowNumber, message: 'ITEM NAME / Name is required.' });
      continue;
    }
    if (format === 'standard-items' && !suppliedCode) {
      errors.push({ rowNumber, message: 'Code is required for the standard item format.' });
      continue;
    }
    if (format === 'invexa-expiry-stock' && !locationName) {
      errors.push({ rowNumber, message: 'BRANCH NAME is required.' });
      continue;
    }
    if (format === 'invexa-expiry-stock' && quantity === undefined) {
      errors.push({ rowNumber, message: 'CLOSING STOCK must be a valid number.' });
      continue;
    }
    if (expiryDate === undefined) {
      errors.push({ rowNumber, message: `EXPIRY DATE "${text(get('expiryDate'))}" is invalid; expected DD/MM/YYYY.` });
      continue;
    }

    const code = suppliedCode || stableCode(companyName, itemName);
    const duplicateKey = format === 'invexa-expiry-stock'
      ? `${locationName.toLowerCase()}|${code.toLowerCase()}|${lotNo.toLowerCase()}`
      : code.toLowerCase();
    if (seen.has(duplicateKey)) duplicateRows += 1;
    seen.add(duplicateKey);
    if (quantity !== undefined && quantity < 0) negativeQuantityRows += 1;
    if (quantity !== undefined && !Number.isInteger(quantity)) fractionalQuantityRows += 1;
    if (locationName) branches.add(locationName);

    validRows.push({
      rowNumber,
      code,
      itemName,
      companyName: companyName || undefined,
      category: text(get('category')) || companyName || undefined,
      subcategory: text(get('subcategory')) || undefined,
      unit: text(get('unit')) || undefined,
      locationName: locationName || undefined,
      lotNo: lotNo || undefined,
      batch: text(get('batch')) || undefined,
      expiryDate,
      quantity,
      purchaseValue: finiteNumber(get('purchaseValue')),
      saleValue: finiteNumber(get('saleValue')),
    });
  }

  return {
    format,
    sheetName,
    headerRow: header.index + 1,
    snapshotAt: format === 'invexa-expiry-stock' ? reportSnapshotAt(rows, header.index) : new Date().toISOString(),
    totalRows: validRows.length + errors.length,
    validRows,
    errors,
    duplicateRows,
    negativeQuantityRows,
    fractionalQuantityRows,
    branches: [...branches],
    mapping: header.mapping,
  };
}

export function aggregateOpeningStock(rows: StockImportRow[]): StockImportRow[] {
  const grouped = new Map<string, StockImportRow>();
  for (const row of rows) {
    const key = `${row.locationName?.toLowerCase()}|${row.code.toLowerCase()}|${row.lotNo?.toLowerCase()}`;
    const existing = grouped.get(key);
    if (!existing) grouped.set(key, { ...row });
    else {
      existing.quantity = (existing.quantity ?? 0) + (row.quantity ?? 0);
      existing.purchaseValue = (existing.purchaseValue ?? 0) + (row.purchaseValue ?? 0);
      existing.saleValue = (existing.saleValue ?? 0) + (row.saleValue ?? 0);
    }
  }
  return [...grouped.values()];
}

export function importPreviewResponse(preview: StockImportPreview) {
  return {
    format: preview.format,
    sheetName: preview.sheetName,
    headerRow: preview.headerRow,
    snapshotAt: preview.snapshotAt,
    totalRows: preview.totalRows,
    validRows: preview.validRows.length,
    invalidRows: preview.errors.length,
    duplicateRows: preview.duplicateRows,
    negativeQuantityRows: preview.negativeQuantityRows,
    fractionalQuantityRows: preview.fractionalQuantityRows,
    branches: preview.branches,
    mapping: preview.mapping,
    sample: preview.validRows.slice(0, 8),
    errors: preview.errors.slice(0, 100),
  };
}
