import { calendarDaysUntilExpiry } from './expiry-board.js';
import { evaluateFormula, validateFormula } from './formula.js';
import { itemFieldCell } from '../hooks/useItemFieldValues.js';
import { formatStockFormulaValue } from './stock-table.js';

// The "Lot Details" list in the item detail dialog. Used until the company's runtime config has
// loaded (or if it cannot be fetched).
export const DEFAULT_ITEM_LOT_COLUMNS = [
  { key: 'lot_no', label: 'Lot', source: 'core' },
  { key: 'expiry', label: 'Expires', source: 'core' },
  { key: 'batch', label: 'Batch', source: 'core' },
  { key: 'purchase_value', label: 'Purchase', source: 'core' },
  { key: 'sale_value', label: 'Sale', source: 'core' },
  { key: 'status', label: 'Status', source: 'core' },
  { key: 'print', label: 'Print label', source: 'core' },
];

/** Numbers an item-lot formula can use, with plain-language names for the builder. */
export const ITEM_LOT_FORMULA_FIELD_OPTIONS = [
  { key: 'days_to_expiry', label: 'Days to expiry' },
  { key: 'purchase_value', label: 'Purchase value (₹)' },
  { key: 'sale_value', label: 'Sale value (₹)' },
];
const FIELD_KEYS = ITEM_LOT_FORMULA_FIELD_OPTIONS.map((field) => field.key);

const finite = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value));

/** A lot without an expiry date has no days_to_expiry, so formulas using it show "—" for that lot. */
export function itemLotValues(lot, now = new Date()) {
  return {
    days_to_expiry: finite(calendarDaysUntilExpiry(lot?.expiryDate, now)),
    purchase_value: finite(lot?.attributes?.purchaseValue),
    sale_value: finite(lot?.attributes?.saleValue),
  };
}

const parsed = new Map();

export function checkItemLotFormula(formula, values) {
  try {
    let ast = parsed.get(formula);
    if (!ast) { ast = validateFormula(formula, FIELD_KEYS); parsed.set(formula, ast); if (parsed.size > 200) parsed.delete(parsed.keys().next().value); }
    return { ok: true, value: evaluateFormula(ast, values) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid formula' };
  }
}

export function itemLotFormulaValue(formula, lot, now) {
  const result = checkItemLotFormula(formula, itemLotValues(lot, now));
  return result.ok ? result.value : null;
}

function visible(columns, role) {
  return columns.filter((column) => column.visible !== false && (!Array.isArray(column.visibleRoles) || !role || column.visibleRoles.includes(role)));
}

/** Columns of the item detail lot list in the configured order; falls back to the defaults if the lot number or label button is missing. */
export function itemLotColumns(runtimePage, { role } = {}) {
  const configured = runtimePage?.tables?.itemLots;
  if (!Array.isArray(configured) || !configured.length) return visible(DEFAULT_ITEM_LOT_COLUMNS, role);
  const columns = visible(configured, role);
  const keys = new Set(columns.map((column) => column.key));
  return keys.has('lot_no') && keys.has('print') ? columns : visible(DEFAULT_ITEM_LOT_COLUMNS, role);
}

const rupees = (value) => `₹${Number(value ?? 0).toLocaleString('en-IN')}`;

/** Plain-text value of one lot field (status and the label button are rendered by the dialog itself). */
export function itemLotCellText(column, lot, { itemFieldValues, itemId, now } = {}) {
  if (column.source === 'itemField') return itemFieldCell(itemFieldValues, itemId, column.itemField);
  if (column.formula) return formatStockFormulaValue(itemLotFormulaValue(column.formula, lot, now), column.type);
  switch (column.key) {
    case 'lot_no': return lot?.lotNo ?? '—';
    case 'expiry': return lot?.expiryDate ? new Date(lot.expiryDate).toLocaleDateString() : 'No date';
    case 'batch': return lot?.attributes?.batch || '—';
    case 'purchase_value': return rupees(lot?.attributes?.purchaseValue);
    case 'sale_value': return rupees(lot?.attributes?.saleValue);
    default: return '—';
  }
}
