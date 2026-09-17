import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGuidedWalkScan, assertPutawayScan, nextWalkBin } from './scan-enforcement.js';

test('assertPutawayScan requires a scan and rejects a bin from another location', () => {
  assert.equal(assertPutawayScan({ scannedBinCode: '', allowedBinCodes: ['A-01'] }).ok, false);
  const wrongLocation = assertPutawayScan({ scannedBinCode: 'B-99', allowedBinCodes: ['A-01', 'A-02'] });
  assert.equal(wrongLocation.ok, false);
  if (!wrongLocation.ok) assert.equal(wrongLocation.code, 'WRONG_LOCATION_BIN');
});

test('assertPutawayScan blocks a valid-but-wrong bin unless override is set', () => {
  const blocked = assertPutawayScan({
    scannedBinCode: 'A-02',
    suggestedBinCode: 'A-01',
    allowedBinCodes: ['A-01', 'A-02'],
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'WRONG_BIN');

  const overridden = assertPutawayScan({
    scannedBinCode: 'A-02',
    suggestedBinCode: 'A-01',
    allowedBinCodes: ['A-01', 'A-02'],
    allowOverride: true,
  });
  assert.equal(overridden.ok, true);
});

test('assertPutawayScan accepts the suggested bin case-insensitively', () => {
  assert.equal(
    assertPutawayScan({
      scannedBinCode: 'a-01',
      suggestedBinCode: 'A-01',
      allowedBinCodes: ['A-01'],
    }).ok,
    true,
  );
});

test('assertGuidedWalkScan only accepts the next bin in walking order', () => {
  const walk = ['Z1-A-01', 'Z1-A-02', 'Z2-B-01'];
  assert.equal(assertGuidedWalkScan({ scannedBinCode: 'Z1-A-02', walkOrder: walk, scannedIndex: 0 }).ok, false);
  assert.equal(assertGuidedWalkScan({ scannedBinCode: 'Z1-A-01', walkOrder: walk, scannedIndex: 0 }).ok, true);
  assert.equal(assertGuidedWalkScan({ scannedBinCode: 'Z1-A-02', walkOrder: walk, scannedIndex: 1 }).ok, true);
  assert.equal(nextWalkBin(walk, 2), 'Z2-B-01');
  assert.equal(nextWalkBin(walk, 3), null);
});
