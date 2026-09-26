import test from 'node:test';
import assert from 'node:assert/strict';
import { newDocumentNumber } from './document-number.js';

test('numbers are prefixed, dated and human-readable', () => {
  assert.match(newDocumentNumber('PO', new Date('2026-09-25T10:00:00Z')), /^PO-260925-[0-9A-HJ-NP-Z]{8}$/);
  assert.match(newDocumentNumber('JOB', new Date('2027-01-02T00:00:00Z')), /^JOB-270102-/);
});

test('the same instant does not produce the same number (the old clock-suffix scheme did)', () => {
  const at = new Date('2026-09-25T10:00:00.000Z');
  const seen = new Set(Array.from({ length: 5000 }, () => newDocumentNumber('PO', at)));
  assert.equal(seen.size, 5000);
});
