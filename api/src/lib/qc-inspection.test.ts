import test from 'node:test';
import assert from 'node:assert/strict';
import { findTemplateForCategory, evaluateInspection } from './qc-inspection.js';

test('findTemplateForCategory prefers a category-specific template over a global one', () => {
  const global = { id: 'global', category: null, active: true };
  const specific = { id: 'electronics', category: 'Electronics', active: true };
  assert.equal(findTemplateForCategory([global, specific], 'Electronics')?.id, 'electronics');
  assert.equal(findTemplateForCategory([global, specific], 'Dairy')?.id, 'global');
});

test('findTemplateForCategory ignores an inactive template', () => {
  const inactive = { id: 'inactive', category: null, active: false };
  assert.equal(findTemplateForCategory([inactive], null), null);
});

test('findTemplateForCategory returns null when nothing matches', () => {
  const specific = { id: 'electronics', category: 'Electronics', active: true };
  assert.equal(findTemplateForCategory([specific], 'Dairy'), null);
});

test('evaluateInspection fails overall if any single check failed', () => {
  assert.equal(evaluateInspection({ SEAL_INTACT: 'PASS', PACKAGING_INTACT: 'FAIL' }), 'FAIL');
});

test('evaluateInspection passes when every check is PASS or NA', () => {
  assert.equal(evaluateInspection({ SEAL_INTACT: 'PASS', WEIGHT_MATCH: 'NA' }), 'PASS');
});

test('evaluateInspection passes an empty result set', () => {
  assert.equal(evaluateInspection({}), 'PASS');
});
