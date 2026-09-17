// Blueprint §8.3 + P8 Mobile Excellence: wrong-bin scans are blocked, and
// a guided warehouse walk must be scanned in order. These helpers are pure
// so the putaway confirm API, pick-wave scan endpoint and the Flutter
// client can share one rule.

export type ScanDecision = { ok: true } | { ok: false; code: string; message: string };

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function assertBinBelongsToLocation(
  scannedBinCode: string,
  allowedBinCodes: string[],
): ScanDecision {
  const scanned = normalizeCode(scannedBinCode);
  if (!scanned) return { ok: false, code: 'SCAN_REQUIRED', message: 'Scan a bin barcode before confirming.' };
  const allowed = new Set(allowedBinCodes.map(normalizeCode).filter(Boolean));
  if (!allowed.has(scanned)) {
    return { ok: false, code: 'WRONG_LOCATION_BIN', message: `Bin ${scanned} does not belong to this location.` };
  }
  return { ok: true };
}

/**
 * Putaway: the scanned barcode must be a bin at this location. When a
 * suggestion exists and override is off, scanning a different (still
 * valid) bin is a wrong-bin block, not a silent confirm.
 */
export function assertPutawayScan(input: {
  scannedBinCode: string;
  suggestedBinCode?: string | null;
  allowedBinCodes: string[];
  allowOverride?: boolean;
}): ScanDecision {
  const membership = assertBinBelongsToLocation(input.scannedBinCode, input.allowedBinCodes);
  if (!membership.ok) return membership;
  const scanned = normalizeCode(input.scannedBinCode);
  const suggested = normalizeCode(input.suggestedBinCode);
  if (suggested && scanned !== suggested && !input.allowOverride) {
    return {
      ok: false,
      code: 'WRONG_BIN',
      message: `Expected bin ${suggested}; scanned ${scanned}. Override is required to confirm a different bin.`,
    };
  }
  return { ok: true };
}

/**
 * Guided walk: the next unscanned bin in walking order is the only legal
 * scan. Scanning ahead or skipping is blocked so the picker cannot jump
 * the path the wave was sequenced for.
 */
export function assertGuidedWalkScan(input: {
  scannedBinCode: string;
  walkOrder: string[];
  scannedIndex?: number;
}): ScanDecision {
  const scanned = normalizeCode(input.scannedBinCode);
  if (!scanned) return { ok: false, code: 'SCAN_REQUIRED', message: 'Scan the next bin in the walk path.' };
  const walk = input.walkOrder.map(normalizeCode).filter(Boolean);
  if (!walk.length) return { ok: true };
  const nextIndex = input.scannedIndex ?? 0;
  const expected = walk[nextIndex];
  if (!expected) return { ok: true };
  if (scanned !== expected) {
    return {
      ok: false,
      code: 'WALK_ORDER',
      message: `Guided walk expects bin ${expected} next; scanned ${scanned}.`,
    };
  }
  return { ok: true };
}

export function nextWalkBin(walkOrder: string[], scannedIndex = 0): string | null {
  return walkOrder[scannedIndex] ?? null;
}
