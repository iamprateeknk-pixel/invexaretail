import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGs1Barcode } from './gs1.js';

test('parses a human-readable GTIN + expiry + lot + serial barcode', () => {
  const parsed = parseGs1Barcode('(01)12345678901231(17)251231(10)LOT123(21)SN00001');
  assert.equal(parsed.gtin, '12345678901231');
  assert.equal(parsed.expiryDate, '2025-12-31');
  assert.equal(parsed.batchOrLot, 'LOT123');
  assert.equal(parsed.serial, 'SN00001');
});

test('parses the same data as raw FNC1 (GS-separated) scanner output', () => {
  const raw = '01123456789012311725123110LOT12321SN00001';
  const parsed = parseGs1Barcode(raw);
  assert.equal(parsed.gtin, '12345678901231');
  assert.equal(parsed.expiryDate, '2025-12-31');
  assert.equal(parsed.batchOrLot, 'LOT123');
  assert.equal(parsed.serial, 'SN00001');
});

test('parses variable-count quantity and net weight (with implied decimal)', () => {
  assert.equal(parseGs1Barcode('(30)000012').quantity, 12);
  assert.equal(parseGs1Barcode('(37)5').quantity, 5);
  assert.equal(parseGs1Barcode('(3102)001234').netWeightKg, 12.34);
  assert.equal(parseGs1Barcode('(3100)000500').netWeightKg, 500);
});

test('production date and expiry date use the GS1 51/49 pivot year', () => {
  assert.equal(parseGs1Barcode('(11)500101').productionDate, '2050-01-01');
  assert.equal(parseGs1Barcode('(11)510101').productionDate, '1951-01-01');
});

test('day 00 (end of month) does not crash and falls back to day 01', () => {
  assert.equal(parseGs1Barcode('(17)250200').expiryDate, '2025-02-01');
});

test('returns null for a plain non-GS1 SKU/lot code so callers fall back to plain lookup', () => {
  assert.equal(parseGs1Barcode('SKU-001'), null);
  assert.equal(parseGs1Barcode('LOT-2026-09'), null);
  assert.equal(parseGs1Barcode(''), null);
  assert.equal(parseGs1Barcode(null), null);
});

test('a lone unrecognized AI segment does not fabricate a match', () => {
  assert.equal(parseGs1Barcode('(99)internal-tracking-id'), null);
});
