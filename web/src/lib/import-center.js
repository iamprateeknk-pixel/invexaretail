// Blueprint v4 §10.1 Import Control Center: presentation rules, kept free of
// React so they are unit-testable.

export const DAY_STATUS = {
  UPLOADED: { label: 'Uploaded', variant: 'success' },
  PARTIAL: { label: 'Partial', variant: 'warning' },
  MISSING: { label: 'Missing', variant: 'destructive' },
};

export function dayStatusMeta(status) {
  return DAY_STATUS[status] ?? { label: String(status ?? 'Unknown'), variant: 'outline' };
}

/** Local calendar date (YYYY-MM-DD) in the given timezone. */
export function localDate(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function shiftDate(date, days) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** One line telling a manager whether they can rely on today's stock figures. */
export function syncHeadline(report) {
  if (!report) return '';
  const { sales, purchases } = report;
  if (sales.status === 'UPLOADED' && purchases.status !== 'PARTIAL') return 'All branches have uploaded sales for this day.';
  const missing = sales.branches.filter((row) => row.status === 'MISSING').map((row) => row.locationName);
  const partial = sales.branches.filter((row) => row.status === 'PARTIAL').map((row) => row.locationName);
  const parts = [];
  if (missing.length) parts.push(`sales missing for ${missing.join(', ')}`);
  if (partial.length) parts.push(`rejected rows for ${partial.join(', ')}`);
  if (sales.unattributedRejectedRows) parts.push(`${sales.unattributedRejectedRows} sales row(s) rejected for an unknown branch`);
  if (purchases.status === 'MISSING') parts.push('no purchase file yet');
  if (purchases.status === 'PARTIAL') parts.push('some purchase rows were rejected');
  return parts.length ? `Check before relying on stock: ${parts.join('; ')}.` : 'All expected files are in.';
}

/** The unmatched/rejected buckets worth showing on an import preview, skipping zeros. */
export function counterBadges(counters) {
  if (!counters) return [];
  return [
    ['Unmatched items', counters.unmatchedItem],
    ['Unknown branches', counters.unmatchedBranch],
    ['Unmatched lots', counters.unmatchedLot],
    ['Archived items', counters.archivedItem],
    ['Other rejected', counters.rejected],
  ].filter(([, count]) => count > 0).map(([label, count]) => ({ label, count }));
}
