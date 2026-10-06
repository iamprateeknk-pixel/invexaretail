import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps } from './verify.mjs';

test('quick mode is typecheck and lint only', () => {
  const names = buildSteps({ quick: true }).map((step) => step.name);
  assert.deepEqual(names, ['api: typecheck', 'api: architecture lint', 'web: lint']);
});

test('the full run orders cheap checks before slow ones and ends with the web build', () => {
  const names = buildSteps().map((step) => step.name);
  assert.equal(names[0], 'api: typecheck');
  assert.ok(names.indexOf('api: architecture lint') < names.indexOf('api: tests (memory mode)'));
  assert.equal(names.at(-1), 'web: build');
});

test('mobile steps are opt-in', () => {
  assert.ok(!buildSteps().some((step) => step.cwd === 'mobile'));
  assert.deepEqual(buildSteps({ withMobile: true }).filter((step) => step.cwd === 'mobile').map((step) => step.cmd), ['flutter analyze', 'flutter test']);
});
