export const ABC_CLASSES = ['A', 'B', 'C'];

export const ABC_CADENCE = {
  A: { dueInDays: 7, priority: 'HIGH', label: 'Weekly' },
  B: { dueInDays: 30, priority: 'NORMAL', label: 'Monthly' },
  C: { dueInDays: 90, priority: 'LOW', label: 'Quarterly' },
};

export function displayAbcClass(value) {
  if (value === 'A') return 'Class A';
  if (value === 'B') return 'Class B';
  if (value === 'C') return 'Class C';
  return String(value ?? '');
}

export function displayAbcCadence(value) {
  return ABC_CADENCE[value]?.label ?? '—';
}

export function abcBadgeVariant(value) {
  if (value === 'A') return 'destructive';
  if (value === 'B') return 'warning';
  return 'secondary';
}

export function formatCycleCountValue(value, valueSource) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const formatted = amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (valueSource === 'qty_proxy') return `${formatted} qty`;
  if (valueSource === 'mixed') return `${formatted} mixed`;
  return formatted;
}

export function toggleAbcClass(selected, abcClass) {
  const current = Array.isArray(selected) ? selected.filter((entry) => ABC_CLASSES.includes(entry)) : [];
  if (current.includes(abcClass)) {
    const next = current.filter((entry) => entry !== abcClass);
    return next.length ? next : current;
  }
  return ABC_CLASSES.filter((entry) => current.includes(entry) || entry === abcClass);
}
