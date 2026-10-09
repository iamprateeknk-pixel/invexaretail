import { evaluateFormula, formulaFields, parseFormula, validateFormula } from './formula.js';
import { visibleStockColumns } from './stock-metadata.js';

// Used until the company's runtime config has loaded (or if it cannot be fetched).
export const DEFAULT_STOCK_COLUMNS = [
  { key: 'item_code', label: 'Item code & name', source: 'core' },
  { key: 'company', label: 'Company', source: 'core' },
  { key: 'category', label: 'Category', source: 'core' },
  { key: 'pack_size', label: 'Pack/Size', source: 'core' },
  { key: 'lot_coverage', label: 'Lot coverage', source: 'core' },
  { key: 'physical', label: 'Total physical', source: 'core' },
  { key: 'book', label: 'Total book', source: 'core' },
  { key: 'variance', label: 'Variance', source: 'core' },
  { key: 'quarantine', label: 'Quarantine', source: 'core' },
  { key: 'reserved', label: 'Reserved', source: 'core' },
  { key: 'value', label: 'Value', source: 'core' },
];

/**
 * Columns of the stock table in the order the company configured in Control Plane > Studio.
 * Role and system-stock permissions still apply on top. Always keeps the item column first-class:
 * a config without it falls back to the defaults rather than rendering a table nobody can read.
 */
export function stockTableColumns(runtimePage, options = {}) {
  const configured = Array.isArray(runtimePage?.columns) && runtimePage.columns.length ? runtimePage : null;
  if (!configured) return visibleStockColumns({ columns: DEFAULT_STOCK_COLUMNS }, options);
  const columns = visibleStockColumns(configured, options).filter((column) => options.canViewSystemStock || !formulaUsesSystemStock(column.formula));
  return columns.some((column) => column.key === 'item_code') ? columns : visibleStockColumns({ columns: DEFAULT_STOCK_COLUMNS }, options);
}

const SYSTEM_FORMULA_FIELDS = ['book', 'variance', 'quarantine', 'reserved', 'value'];

/** A formula that reads system-only numbers must not reveal them to people who cannot see those columns. */
export function formulaUsesSystemStock(formula) {
  if (!formula) return false;
  try {
    const fields = formulaFields(parseFormula(formula));
    return SYSTEM_FORMULA_FIELDS.some((field) => fields.has(field));
  } catch {
    return true;
  }
}

export const RIGHT_ALIGNED_STOCK_COLUMNS = new Set(['value']);

/** Available = physical stock not held by reservations or quarantine. */
export function availableQuantity(row) {
  return Math.max(0, Number(row?.physicalQuantity ?? 0) - Number(row?.reservedQuantity ?? 0) - Number(row?.quarantineQuantity ?? 0));
}

/** Fields a stock formula can use, with plain-language names for the builder. */
export const STOCK_FORMULA_FIELD_OPTIONS = [
  { key: 'physical', label: 'Physical stock' },
  { key: 'book', label: 'Book stock' },
  { key: 'variance', label: 'Variance' },
  { key: 'quarantine', label: 'Quarantine' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'value', label: 'Stock value (₹)' },
];
const FORMULA_FIELD_KEYS = STOCK_FORMULA_FIELD_OPTIONS.map((field) => field.key);

export function stockRowValues(row) {
  return {
    physical: Number(row?.physicalQuantity ?? 0),
    book: Number(row?.bookQuantity ?? 0),
    variance: Number(row?.variance ?? 0),
    quarantine: Number(row?.quarantineQuantity ?? 0),
    reserved: Number(row?.reservedQuantity ?? 0),
    value: Number(row?.stockValue ?? 0),
  };
}

const parsed = new Map();

/** Checks a formula and returns { ok, error }. Used for the live preview in the builder. */
export function checkStockFormula(formula, values) {
  try {
    let ast = parsed.get(formula);
    if (!ast) { ast = validateFormula(formula, FORMULA_FIELD_KEYS); parsed.set(formula, ast); if (parsed.size > 200) parsed.delete(parsed.keys().next().value); }
    return { ok: true, value: evaluateFormula(ast, values) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid formula' };
  }
}

/** Value of a calculated column for one stock row, or null if the formula cannot be evaluated (e.g. divide by zero). */
export function stockFormulaValue(formula, row) {
  const result = checkStockFormula(formula, stockRowValues(row));
  return result.ok ? result.value : null;
}

export function formatStockFormulaValue(value, type) {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return type === 'currency' ? `₹${rounded.toLocaleString('en-IN')}` : rounded.toLocaleString('en-IN');
}
