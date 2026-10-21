// Blueprint v4 §22 supplier master: lead time, MOQ, payment terms,
// brands/categories, contact, and a status that keeps blocked suppliers out of
// new purchase orders.

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export type SupplierFields = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  leadTimeDays?: number | null;
  moq?: number | null;
  paymentTerms?: string | null;
  categories?: string | null;
  status?: SupplierStatus;
};

const text = (value: unknown, max: number, label: string): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} is limited to ${max} characters.`);
  return trimmed || null;
};

/** Only the keys present in the body are returned, so a partial update never clears a field it did not mention. */
export function parseSupplierFields(body: Record<string, unknown>, requireName: boolean): SupplierFields {
  const fields: SupplierFields = {};
  if (body.name !== undefined || requireName) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) throw new Error('Supplier name must be at least 2 characters.');
    fields.name = name;
  }
  const email = text(body.email, 191, 'Email');
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid supplier email address.');
    fields.email = email;
  }
  for (const [key, max, label] of [['phone', 40, 'Phone'], ['contactName', 120, 'Contact name'], ['paymentTerms', 120, 'Payment terms']] as const) {
    const value = text(body[key], max, label);
    if (value !== undefined) fields[key] = value;
  }
  if (body.leadTimeDays !== undefined) {
    if (body.leadTimeDays === null || body.leadTimeDays === '') fields.leadTimeDays = null;
    else {
      const days = Number(body.leadTimeDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('Lead time must be a whole number of days between 0 and 365.');
      fields.leadTimeDays = days;
    }
  }
  if (body.moq !== undefined) {
    if (body.moq === null || body.moq === '') fields.moq = null;
    else {
      const moq = Number(body.moq);
      if (!Number.isFinite(moq) || moq < 0) throw new Error('Minimum order quantity must be zero or more.');
      fields.moq = moq;
    }
  }
  if (body.categories !== undefined) {
    const raw = Array.isArray(body.categories) ? body.categories.map(String) : typeof body.categories === 'string' ? body.categories.split(/[,\n]/) : null;
    if (body.categories !== null && raw === null) throw new Error('Categories must be a list or comma-separated text.');
    const list = [...new Set((raw ?? []).map((entry) => entry.trim()).filter(Boolean))];
    if (list.some((entry) => entry.length > 60) || list.length > 40) throw new Error('Supplier categories are limited to 40 entries of 60 characters.');
    fields.categories = list.length ? list.join('\n') : null;
  }
  if (body.status !== undefined) {
    if (!(SUPPLIER_STATUSES as readonly string[]).includes(String(body.status))) throw new Error('Supplier status must be ACTIVE, INACTIVE or BLOCKED.');
    fields.status = body.status as SupplierStatus;
  }
  return fields;
}

export function categoriesToList(stored: string | null | undefined): string[] {
  return (stored ?? '').split('\n').map((entry) => entry.trim()).filter(Boolean);
}

/** A supplier row as the API returns it: categories as a list. */
export function presentSupplier<T extends { categories?: string | null; moq?: unknown }>(row: T): Omit<T, 'categories' | 'moq'> & { categories: string[]; moq: number | null } {
  return { ...row, categories: categoriesToList(row.categories), moq: row.moq == null ? null : Number(row.moq) };
}

export function canOrderFrom(status: string | null | undefined): boolean {
  return !status || status === 'ACTIVE';
}
