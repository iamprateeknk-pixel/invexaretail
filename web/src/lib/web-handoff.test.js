import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffCodeFromHash, urlWithoutHandoff } from './web-handoff.js';

const CODE = 'abcDEF0123456789_-abcDEF0123456789_-xyz';

test('only a well-formed handoff hash yields a code', () => {
  assert.equal(handoffCodeFromHash(`#/handoff?code=${CODE}`), CODE);
  assert.equal(handoffCodeFromHash(`#handoff?code=${CODE}`), CODE);
  assert.equal(handoffCodeFromHash('#/handoff'), '');
  assert.equal(handoffCodeFromHash('#/handoff?code='), '');
  assert.equal(handoffCodeFromHash(`#/orders?code=${CODE}`), '', 'a code on another route is ignored');
  assert.equal(handoffCodeFromHash('#/handoff?code=short'), '');
  assert.equal(handoffCodeFromHash('#/handoff?code=<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa'), '');
  assert.equal(handoffCodeFromHash(''), '');
  assert.equal(handoffCodeFromHash(undefined), '');
});

test('the address bar is reset to the app root without the code', () => {
  assert.equal(urlWithoutHandoff('/', ''), '/#/');
  assert.equal(urlWithoutHandoff('/app', '?lang=en'), '/app?lang=en#/');
});
