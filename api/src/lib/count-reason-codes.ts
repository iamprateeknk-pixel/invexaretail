// Root-cause codes for count variances (audit C-3). Variances used to be adjusted with only a
// free-text reason, so nothing could be analysed. The set is small and fixed on purpose: a code you
// can group by beats a free-text field nobody aggregates.
export const COUNT_REASON_CODES = ['THEFT_SHRINKAGE', 'DAMAGE', 'EXPIRY_WRITE_OFF', 'RECEIVING_ERROR', 'PICKING_ERROR', 'MISCOUNT', 'SYSTEM_TIMING', 'SUPPLIER_SHORTAGE', 'OTHER'] as const;
export type CountReasonCode = (typeof COUNT_REASON_CODES)[number];

/** Undefined/empty -> undefined (optional); anything else must be one of the codes. */
export function parseCountReasonCode(value: unknown): CountReasonCode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const code = String(value).trim().toUpperCase();
  if (!(COUNT_REASON_CODES as readonly string[]).includes(code)) {
    throw new Error(`reasonCode must be one of: ${COUNT_REASON_CODES.join(', ')}.`);
  }
  return code as CountReasonCode;
}

/** Units and count of variances per code, worst absolute impact first; uncoded variances are reported as UNCODED. */
export function summarizeVarianceReasons(counts: Array<{ physicalQty: number; bookQty: number; reasonCode?: string | null }>) {
  const byCode = new Map<string, { counts: number; absoluteUnits: number; netUnits: number }>();
  for (const count of counts) {
    const variance = count.physicalQty - count.bookQty;
    if (variance === 0) continue;
    const key = count.reasonCode || 'UNCODED';
    const row = byCode.get(key) ?? { counts: 0, absoluteUnits: 0, netUnits: 0 };
    row.counts += 1;
    row.absoluteUnits += Math.abs(variance);
    row.netUnits += variance;
    byCode.set(key, row);
  }
  return [...byCode.entries()].map(([reasonCode, row]) => ({ reasonCode, ...row })).sort((a, b) => b.absoluteUnits - a.absoluteUnits || a.reasonCode.localeCompare(b.reasonCode));
}

/**
 * Count accuracy the way inventory managers report it (audit C-3): a count is accurate when its
 * variance is inside tolerance (not only when it is exactly equal), and accuracy is also weighed by
 * money so a 1-unit miss on an expensive item is not the same as one on a cheap item.
 * `unitCost` null = uncosted: it counts toward the unit figures and is left out of the value ones.
 */
type AccuracyCount = { physicalQty: number; bookQty: number; unitCost?: number | null; abcClass?: string | null };

/** Same summary, plus a per-ABC-class breakdown when the counts carry a class (A items matter most; a blended 95% can hide a 70% on A). */
export function summarizeCountAccuracyByClass(counts: AccuracyCount[], tolerance: { minUnits: number; percent: number }) {
  const byClass: Record<string, ReturnType<typeof summarizeCountAccuracy>> = {};
  for (const abcClass of ['A', 'B', 'C']) {
    const rows = counts.filter((count) => count.abcClass === abcClass);
    if (rows.length) byClass[abcClass] = summarizeCountAccuracy(rows, tolerance);
  }
  return { ...summarizeCountAccuracy(counts, tolerance), byClass };
}

export function summarizeCountAccuracy(
  counts: AccuracyCount[],
  tolerance: { minUnits: number; percent: number },
) {
  let within = 0;
  let varianceValue = 0;
  let bookValue = 0;
  let costed = 0;
  for (const count of counts) {
    const diff = Math.abs(count.physicalQty - count.bookQty);
    const allowed = Math.max(tolerance.minUnits, (Math.abs(count.bookQty) * tolerance.percent) / 100);
    if (diff <= allowed) within += 1;
    if (count.unitCost && count.unitCost > 0) {
      costed += 1;
      varianceValue += diff * count.unitCost;
      bookValue += Math.abs(count.bookQty) * count.unitCost;
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    counts: counts.length,
    withinTolerance: within,
    accuracyPercent: counts.length ? round((within / counts.length) * 100) : null,
    costedCounts: costed,
    varianceValue: round(varianceValue),
    /** 100 - variance value as a share of the counted book value; null when nothing costed was counted. */
    valueAccuracyPercent: bookValue > 0 ? round(Math.max(0, 100 - (varianceValue / bookValue) * 100)) : null,
  };
}
