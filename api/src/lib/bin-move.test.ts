import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidBinMove, BinMoveValidationError } from './bin-move.js';

test('a legal move between two bins at this location is accepted', () => {
  assert.doesNotThrow(() => assertValidBinMove({
    scannedFromBinCode: 'A-01-01',
    scannedToBinCode: 'A-02-01',
    allowedBinCodes: ['A-01-01', 'A-02-01', 'A-03-01'],
    quantity: 5,
  }));
});

test('rejects a zero or negative quantity', () => {
  assert.throws(() => assertValidBinMove({
    scannedFromBinCode: 'A-01-01',
    scannedToBinCode: 'A-02-01',
    allowedBinCodes: ['A-01-01', 'A-02-01'],
    quantity: 0,
  }), BinMoveValidationError);
});

test('rejects moving a bin into itself', () => {
  assert.throws(() => assertValidBinMove({
    scannedFromBinCode: 'A-01-01',
    scannedToBinCode: 'a-01-01',
    allowedBinCodes: ['A-01-01'],
    quantity: 3,
  }), BinMoveValidationError);
});

test('rejects a destination bin that does not belong to this location', () => {
  assert.throws(() => assertValidBinMove({
    scannedFromBinCode: 'A-01-01',
    scannedToBinCode: 'Z-99-99',
    allowedBinCodes: ['A-01-01', 'A-02-01'],
    quantity: 2,
  }), BinMoveValidationError);
});
