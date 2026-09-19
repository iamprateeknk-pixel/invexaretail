// Blueprint v4 §6: form <-> API mapping for the Item Master, kept free of
// React so it is unit-testable.

export const COUNT_METHODS = [
  { value: 'LOT_SCAN', label: 'Scan lot barcode' },
  { value: 'ITEM_WEIGHT', label: 'Enter weight / decimal quantity' },
];
export const PICK_METHODS = [
  { value: 'LOT_SCAN', label: 'Scan lot barcode' },
  { value: 'ITEM_QTY_FIFO', label: 'Item quantity (FIFO/FEFO allocated)' },
];
export const ALLOCATION_STRATEGIES = [
  { value: 'FEFO', label: 'FEFO - earliest expiry first' },
  { value: 'FIFO', label: 'FIFO - oldest first' },
];

const text = (value) => (value === undefined || value === null ? '' : String(value));

/** Turns a catalog item into editable form state (numbers as strings, aliases as one line). */
export function itemToForm(item) {
  return {
    code: text(item.code),
    name: text(item.name),
    company: text(item.company),
    category: text(item.category),
    subcategory: text(item.subcategory),
    unit: text(item.unit),
    decimalQuantity: Boolean(item.decimalQuantity),
    barcode: text(item.barcode),
    lotRequired: item.lotRequired !== false,
    expiryRequired: Boolean(item.expiryRequired),
    countMethod: item.countMethod ?? 'LOT_SCAN',
    pickMethod: item.pickMethod ?? 'LOT_SCAN',
    allocationStrategy: item.allocationStrategy ?? 'FEFO',
    hsn: text(item.hsn),
    gstRate: text(item.gstRate),
    mrp: text(item.mrp),
    leadTimeDays: text(item.leadTimeDays),
    shelfLifeDays: text(item.shelfLifeDays),
    aliases: (item.aliases ?? []).join(', '),
  };
}

export function parseAliases(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value ?? '').split(/[,\n]/)) {
    const alias = part.trim().replace(/\s+/g, ' ');
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** Returns the PUT payload, or the problems to fix before saving. */
export function formToPayload(form) {
  const errors = [];
  if (!form.code.trim()) errors.push('Item Code is required.');
  if (!form.name.trim()) errors.push('Item Name is required.');
  const number = (label, value, { min = 0, max, integer = false } = {}) => {
    if (String(value).trim() === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || (max !== undefined && n > max) || (integer && !Number.isInteger(n))) {
      errors.push(`${label} must be ${integer ? 'a whole number' : 'a number'}${max !== undefined ? ` from ${min} to ${max}` : ` of at least ${min}`}.`);
      return null;
    }
    return n;
  };
  const gstRate = number('GST rate', form.gstRate, { max: 100 });
  const mrp = number('MRP', form.mrp);
  const leadTimeDays = number('Lead time', form.leadTimeDays, { max: 3650, integer: true });
  const shelfLifeDays = number('Shelf life', form.shelfLifeDays, { max: 36500, integer: true });
  if (form.hsn.trim() && !/^[0-9A-Za-z]+$/.test(form.hsn.trim())) errors.push('HSN may only contain letters and digits.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    payload: {
      code: form.code.trim(),
      name: form.name.trim(),
      company: form.company.trim(),
      category: form.category.trim(),
      subcategory: form.subcategory.trim(),
      unit: form.unit.trim(),
      decimalQuantity: form.decimalQuantity,
      barcode: form.barcode.trim() || null,
      lotRequired: form.lotRequired,
      expiryRequired: form.expiryRequired,
      countMethod: form.countMethod,
      pickMethod: form.pickMethod,
      allocationStrategy: form.allocationStrategy,
      hsn: form.hsn.trim() || null,
      gstRate,
      mrp,
      leadTimeDays,
      shelfLifeDays,
      aliases: parseAliases(form.aliases),
    },
  };
}

export function itemStatusMeta(status) {
  switch (status) {
    case 'ARCHIVED': return { label: 'Archived', variant: 'outline' };
    case 'INACTIVE': return { label: 'Inactive', variant: 'secondary' };
    default: return { label: 'Active', variant: 'success' };
  }
}

/** Plain-language reason a permanent delete is blocked. */
export function describeDeleteBlockers(blockers) {
  if (!blockers?.length) return '';
  return blockers.map((row) => `${row.count} ${row.label}`).join(', ');
}
