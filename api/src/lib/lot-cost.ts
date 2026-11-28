export const LOT_COST_FIELDS = ['landedUnitCost', 'purchaseRate'] as const;
export const LOT_COST_DECIMAL_PATTERN = '^[+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:[eE][+-]?[0-9]{1,3})?$';
export const LOT_COST_TEXT_LIMIT = 128;
export const LOT_COST_WHITESPACE = ' \t\n\v\f\r';
export const MAX_FINITE_DECIMAL = Number.MAX_VALUE.toString();

const decimal = new RegExp(LOT_COST_DECIMAL_PATTERN);
const edgeWhitespace = new RegExp(`^[${LOT_COST_WHITESPACE}]+|[${LOT_COST_WHITESPACE}]+$`, 'g');

/** Returns the recorded landed unit cost or purchase rate, in that order. */
export function lotUnitCost(attributes: Record<string, unknown> | null | undefined): number | null {
  for (const key of LOT_COST_FIELDS) {
    const entry = attributes?.[key];
    if (typeof entry !== 'string' && typeof entry !== 'number') continue;
    const text = String(entry).replace(edgeWhitespace, '');
    if (text.length > LOT_COST_TEXT_LIMIT || !decimal.test(text)) continue;
    const value = Number(text);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}
