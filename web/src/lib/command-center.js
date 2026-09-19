// Blueprint v4 §29: presentation helpers for the Command Center.

export const SEVERITY = {
  CRITICAL: { label: 'Critical', variant: 'destructive' },
  WARNING: { label: 'Warning', variant: 'warning' },
  INFO: { label: 'Info', variant: 'outline' },
};

export const HEALTH = {
  RED: { label: 'Behind', variant: 'destructive' },
  AMBER: { label: 'Watch', variant: 'warning' },
  GREEN: { label: 'On track', variant: 'success' },
};

/** "5 hours", "2 days", or "never" - how far behind an import is. */
export function ageLabel(hours) {
  if (hours === null || hours === undefined) return 'never';
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} days`;
}

/** Heatmap colour class for a day's completion ratio (null = no work planned). */
export function heatClass(ratio) {
  if (ratio === null || ratio === undefined) return 'bg-muted';
  if (ratio >= 1) return 'bg-emerald-500';
  if (ratio >= 0.5) return 'bg-emerald-300';
  if (ratio > 0) return 'bg-amber-300';
  return 'bg-red-300';
}

export function shortDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
}

/** Bar heights (0-100) for a pulse series, so a quiet week is not stretched to look busy. */
export function pulseBars(pulse, key) {
  const max = Math.max(1, ...pulse.map((row) => row[key] ?? 0));
  return pulse.map((row) => ({ day: row.day, value: row[key] ?? 0, height: Math.round(((row[key] ?? 0) / max) * 100) }));
}

/** Where an attention row should take the user. */
export function attentionTarget(section) {
  return `#/${section}`;
}

export function auditExportPath(filter = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  const query = params.toString();
  return `/api/v1/reports/audit-export${query ? `?${query}` : ''}`;
}
