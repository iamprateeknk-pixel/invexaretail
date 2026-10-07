// Money columns that moved from Float to Decimal (docs/decimal-migration-plan.md) come back from
// Prisma as Decimal objects, which JSON.stringify turns into strings. These helpers convert at the
// boundary so the API keeps returning JSON numbers and threshold comparisons stay plain numbers.

type WithThreshold = { valueThreshold?: unknown };

export function thresholdsAsNumbers<T extends WithThreshold>(rule: T): Omit<T, 'valueThreshold'> & { valueThreshold: number | null } {
  const raw = rule.valueThreshold;
  return { ...rule, valueThreshold: raw === null || raw === undefined ? null : Number(raw) };
}
