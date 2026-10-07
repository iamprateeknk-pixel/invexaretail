// Money columns that moved from Float to Decimal (docs/decimal-migration-plan.md) come back from
// Prisma as Decimal objects, which JSON.stringify turns into strings. These helpers convert at the
// boundary so the API keeps returning JSON numbers and threshold comparisons stay plain numbers.

type WithThreshold = { valueThreshold?: unknown };

export function thresholdsAsNumbers<T extends WithThreshold>(rule: T): Omit<T, 'valueThreshold'> & { valueThreshold: number | null } {
  const raw = rule.valueThreshold;
  return { ...rule, valueThreshold: raw === null || raw === undefined ? null : Number(raw) };
}

// ---- whole-row conversion ------------------------------------------------------------------
// For rows that carry several Decimal money columns (purchase orders with their lines, invoices,
// locations), converting field by field is easy to get wrong. `decimalsToNumbers` walks a Prisma
// result and turns every Prisma.Decimal into a plain number - including Decimal columns of
// included relations such as Item.mrp - leaving dates, strings, null and everything else alone.

import { Prisma } from '@prisma/client';

export type DecimalsAsNumbers<T> =
  T extends Prisma.Decimal ? number
    : T extends Date ? T
      : T extends Array<infer U> ? Array<DecimalsAsNumbers<U>>
        : T extends object ? { [K in keyof T]: DecimalsAsNumbers<T[K]> }
          : T;

export function decimalsToNumbers<T>(value: T): DecimalsAsNumbers<T> {
  if (value === null || value === undefined) return value as DecimalsAsNumbers<T>;
  if (Prisma.Decimal.isDecimal(value)) return Number(value) as DecimalsAsNumbers<T>;
  if (Array.isArray(value)) return value.map((entry) => decimalsToNumbers(entry)) as DecimalsAsNumbers<T>;
  if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, decimalsToNumbers(entry)])) as DecimalsAsNumbers<T>;
  }
  return value as DecimalsAsNumbers<T>;
}
