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
