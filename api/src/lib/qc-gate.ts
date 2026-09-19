import { evaluateInspection, type QcCheckResult } from './qc-inspection.js';

// Blueprint v4 §25: "QC completion is a gate where configured, not an
// informational form", and "Failed QC can automatically quarantine stock".
// qc-receive.ts already refuses a receipt with no inspection; this adds the
// other half - what the inspection *said*. A pass lets the goods be received
// as sellable, a fail sends them to quarantine instead of onHand.

export type InspectionLike = {
  itemId?: string | null;
  lotId?: string | null;
  sourceLineId?: string | null;
  overallResult?: string | null;
  results?: Record<string, QcCheckResult> | null;
  createdAt?: string | Date | null;
};

export type QcVerdict = 'PASS' | 'FAIL' | null;

const stamp = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : 0);

function verdictOf(inspection: InspectionLike): 'PASS' | 'FAIL' {
  if (inspection.overallResult === 'PASS' || inspection.overallResult === 'FAIL') return inspection.overallResult;
  return inspection.results ? evaluateInspection(inspection.results) : 'PASS';
}

/** The latest inspection that applies to a receipt line: same item, and same line when both name one. Null when none was recorded. */
export function verdictForLine(inspections: InspectionLike[], line: { itemId: string; lineId?: string | null }): QcVerdict {
  const matching = inspections.filter((inspection) =>
    inspection.itemId === line.itemId
    && (!line.lineId || !inspection.sourceLineId || inspection.sourceLineId === line.lineId));
  if (!matching.length) return null;
  // Same timestamp (or none): the later entry in the list wins, and a failure never gets outvoted by ordering luck.
  const latest = matching.reduce((best, candidate) => (stamp(candidate.createdAt) >= stamp(best.createdAt) ? candidate : best));
  return verdictOf(latest);
}

export type GateLine = { itemId: string; lotId: string; lineId?: string; receivedQty: number; damagedQty: number };

/**
 * Lines whose inspection failed have their good quantity moved to the damaged
 * (quarantine) bucket. Totals are unchanged, so receipt validation and the
 * "received + damaged + short = ordered" arithmetic still hold; only where the
 * goods land changes.
 */
export function quarantineFailedLines<T extends GateLine>(lines: T[], verdictFor: (line: T) => QcVerdict): { lines: T[]; quarantined: Array<{ itemId: string; lotId: string; quantity: number }> } {
  const quarantined: Array<{ itemId: string; lotId: string; quantity: number }> = [];
  const next = lines.map((line) => {
    if (!(line.receivedQty > 0) || verdictFor(line) !== 'FAIL') return line;
    quarantined.push({ itemId: line.itemId, lotId: line.lotId, quantity: line.receivedQty });
    return { ...line, receivedQty: 0, damagedQty: Math.round((line.damagedQty + line.receivedQty) * 1000) / 1000 };
  });
  return { lines: next, quarantined };
}
