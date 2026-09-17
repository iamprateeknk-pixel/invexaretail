// Blueprint P3 "GS1 parser": one scan can carry item (GTIN), batch/lot,
// production/expiry dates, serial and quantity/weight in a single barcode
// (GS1-128 / GS1 DataMatrix / GS1 QR). Application Identifiers (AIs) are a
// numeric prefix followed by fixed- or variable-length data; variable-length
// fields are terminated by an FNC1 separator (ASCII 29, "GS") when they are
// not the last field, or by the end of the string.
//
// Only the AIs the blueprint calls out are supported: GTIN (01), batch/lot
// (10), production date (11), expiry date (17), serial (21), variable-count
// quantity (30), count of items (37), and net weight in kg (310x). Anything
// else is captured in `raw` but not interpreted.

const GS = ''; // FNC1 group separator, how most scanners emit it inline

const FIXED_LENGTH = { '00': 18, '01': 14, '11': 6, '13': 6, '15': 6, '17': 6 };
const VARIABLE_LENGTH_MAX = { 10: 20, 21: 20, 30: 8, 37: 8 };

function parseYYMMDD(value) {
  if (!/^\d{6}$/.test(value)) return undefined;
  const yy = Number(value.slice(0, 2));
  const mm = value.slice(2, 4);
  const dd = value.slice(4, 6);
  const year = yy >= 51 ? 1900 + yy : 2000 + yy; // GS1 pivot year, per spec
  // 00 for the day means "end of month" per GS1 - not resolved here, kept as-is.
  return `${year}-${mm}-${dd === '00' ? '01' : dd}`;
}

function isWeightAi(ai) {
  return /^31(0[0-9]|1[0-9]|2[0-9]|3[0-9])$/.test(ai);
}

/**
 * @param {string} raw - the scanned string, with or without FNC1 (GS) separators
 *   and with or without human-readable parentheses around AIs, e.g. both
 *   "01123456789012311725123110LOT1" and
 *   "(01)12345678901231(17)251231(10)LOT1" are accepted.
 * @returns {null | { gtin?: string, batchOrLot?: string, productionDate?: string,
 *   expiryDate?: string, serial?: string, quantity?: number, netWeightKg?: number,
 *   raw: Record<string, string> }}
 */
export function parseGs1Barcode(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  // Normalize human-readable "(01)...(17)..." into the same shape a scanner
  // would emit: AI immediately followed by its value.
  let normalized = raw.trim();
  if (normalized.includes('(')) {
    normalized = normalized.replace(/\((\d{2,4})\)/g, GS + '$1');
  }
  if (!normalized.startsWith(GS)) normalized = GS + normalized;

  const segments = normalized.split(GS).filter(Boolean);
  if (segments.length === 0) return null;

  const fields = {};
  for (const segment of segments) {
    const ai2 = segment.slice(0, 2);
    const ai3 = segment.slice(0, 3);
    const ai4 = segment.slice(0, 4);
    let ai;
    let rest;
    if (isWeightAi(ai4)) { ai = ai4; rest = segment.slice(4); }
    else if (FIXED_LENGTH[ai2] !== undefined) { ai = ai2; rest = segment.slice(2); }
    else if (VARIABLE_LENGTH_MAX[ai2] !== undefined) { ai = ai2; rest = segment.slice(2); }
    else { ai = ai3; rest = segment.slice(3); }

    if (FIXED_LENGTH[ai] !== undefined) {
      fields[ai] = rest.slice(0, FIXED_LENGTH[ai]);
    } else if (isWeightAi(ai)) {
      fields[ai] = rest.slice(0, 6);
    } else {
      const max = VARIABLE_LENGTH_MAX[ai2] ?? rest.length;
      fields[ai] = rest.slice(0, max);
    }
  }

  // A barcode with only one unrecognized AI and nothing else is not GS1 data
  // worth treating specially - let the caller fall back to plain code lookup.
  const known = Object.keys(fields).filter((ai) => ai === '01' || ai === '10' || ai === '11' || ai === '17' || ai === '21' || ai === '30' || ai === '37' || isWeightAi(ai));
  if (known.length === 0) return null;

  const result = { raw: fields };
  if (fields['01']) result.gtin = fields['01'];
  if (fields['10']) result.batchOrLot = fields['10'];
  if (fields['11']) result.productionDate = parseYYMMDD(fields['11']);
  if (fields['17']) result.expiryDate = parseYYMMDD(fields['17']);
  if (fields['21']) result.serial = fields['21'];
  if (fields['30']) result.quantity = Number(fields['30']);
  if (fields['37']) result.quantity = result.quantity ?? Number(fields['37']);
  const weightAi = Object.keys(fields).find(isWeightAi);
  if (weightAi) {
    const decimalPlaces = Number(weightAi[3]);
    result.netWeightKg = Number(fields[weightAi]) / 10 ** decimalPlaces;
  }
  return result;
}
