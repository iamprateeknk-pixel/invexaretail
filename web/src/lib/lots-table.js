import { evaluateFormula, validateFormula } from './formula.js';

// Used until the company's runtime config has loaded (or if it cannot be fetched).
export const DEFAULT_LOT_COLUMNS = [
  { key: 'item_lot', label: 'Item / lot', source: 'core' },
  { key: 'quantity', label: 'Qty', source: 'core' },
  { key: 'expiry', label: 'Expiry', source: 'core' },
  { key: 'risk', label: 'Risk', source: 'core' },
  { key: 'recommended_action', label: 'Recommended action', source: 'core' },
  { key: 'open', label: 'Open', source: 'core' },
];

/** Numbers a Lots-table formula can use, with plain-language names for the builder. */
export const LOT_FORMULA_FIELD_OPTIONS = [
  { key: 'quantity', label: 'Quantity' },
  { key: 'days_to_expiry', label: 'Days to expiry' },
  { key: 'purchase_value', label: 'Purchase value (₹)' },
  { key: 'sale_value', label: 'Sale value (₹)' },
];
const LOT_FIELD_KEYS = LOT_FORMULA_FIELD_OPTIONS.map((field) => field.key);

const finite = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value));

/** A lot without an expiry date has no days_to_expiry, so formulas using it show "—" for that lot. */
export function lotRowValues(lot) {
  return {
    quantity: finite(lot?.quantity),
    days_to_expiry: finite(lot?.daysUntilExpiry),
    purchase_value: finite(lot?.purchaseValue),
    sale_value: finite(lot?.saleValue),
  };
}

const parsed = new Map();

export function checkLotFormula(formula, values) {
  try {
    let ast = parsed.get(formula);
    if (!ast) { ast = validateFormula(formula, LOT_FIELD_KEYS); parsed.set(formula, ast); if (parsed.size > 200) parsed.delete(parsed.keys().next().value); }
    return { ok: true, value: evaluateFormula(ast, values) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid formula' };
  }
}

export function lotFormulaValue(formula, lot) {
  const result = checkLotFormula(formula, lotRowValues(lot));
  return result.ok ? result.value : null;
}

function visible(columns, role) {
  return columns.filter((column) => column.visible !== false && (!Array.isArray(column.visibleRoles) || !role || column.visibleRoles.includes(role)));
}

/**
 * Columns of the Lots & expiry table in the order the company configured in Control Plane > Studio.
 * Falls back to the defaults if there is no config, or it lacks the item or action column.
 */
export function lotTableColumns(runtimePage, { role } = {}) {
  const configured = runtimePage?.tables?.lots;
  if (!Array.isArray(configured) || !configured.length) return visible(DEFAULT_LOT_COLUMNS, role);
  const columns = visible(configured, role);
  const keys = new Set(columns.map((column) => column.key));
  return keys.has('item_lot') && keys.has('open') ? columns : visible(DEFAULT_LOT_COLUMNS, role);
}
