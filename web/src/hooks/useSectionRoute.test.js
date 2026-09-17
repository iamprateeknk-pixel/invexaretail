import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionFromHash, sectionHash } from './useSectionRoute.js';

test('valid application hashes resolve to their section', () => {
  assert.equal(sectionFromHash('#/inventory'), 'inventory');
  assert.equal(sectionFromHash('#/reports'), 'reports');
});

test('unknown and malformed hashes fail safely to dashboard', () => {
  assert.equal(sectionFromHash('#/not-a-real-page'), 'dashboard');
  assert.equal(sectionFromHash('javascript:alert(1)'), 'dashboard');
  assert.equal(sectionFromHash(''), 'dashboard');
});

test('sectionHash produces canonical deep links', () => {
  assert.equal(sectionHash('counts'), '#/counts');
  assert.equal(sectionHash('unknown'), '#/dashboard');
});
