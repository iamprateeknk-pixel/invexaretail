import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheCompanyCadence, cadenceForCompany, validCadenceDays, DEFAULT_CADENCE_DAYS } from './cycle-count-cadence-context.js';

test('a company with no override gets the 7/30/90 default', () => {
  assert.deepEqual(cadenceForCompany('never-cached'), DEFAULT_CADENCE_DAYS);
  assert.deepEqual(cadenceForCompany(undefined), DEFAULT_CADENCE_DAYS);
});

test('invalid values are rejected; out-of-range or non-integer days do not cache', () => {
  assert.equal(validCadenceDays(0), null);
  assert.equal(validCadenceDays(-1), null);
  assert.equal(validCadenceDays(3.5), null);
  assert.equal(validCadenceDays(3651), null);
  assert.equal(validCadenceDays('14'), 14);
});

test('a full override replaces all three classes; a partial one keeps the default for the rest', () => {
  cacheCompanyCadence('co-full', { cycleCountCadenceADays: 3, cycleCountCadenceBDays: 15, cycleCountCadenceCDays: 60 });
  assert.deepEqual(cadenceForCompany('co-full'), { A: 3, B: 15, C: 60 });

  cacheCompanyCadence('co-partial', { cycleCountCadenceADays: 14, cycleCountCadenceBDays: null, cycleCountCadenceCDays: null });
  assert.deepEqual(cadenceForCompany('co-partial'), { A: 14, B: DEFAULT_CADENCE_DAYS.B, C: DEFAULT_CADENCE_DAYS.C });
});

test('caching all-null clears any previous override back to the default', () => {
  cacheCompanyCadence('co-clear', { cycleCountCadenceADays: 20, cycleCountCadenceBDays: 40, cycleCountCadenceCDays: 100 });
  assert.deepEqual(cadenceForCompany('co-clear'), { A: 20, B: 40, C: 100 });
  cacheCompanyCadence('co-clear', { cycleCountCadenceADays: null, cycleCountCadenceBDays: null, cycleCountCadenceCDays: null });
  assert.deepEqual(cadenceForCompany('co-clear'), DEFAULT_CADENCE_DAYS);
});
