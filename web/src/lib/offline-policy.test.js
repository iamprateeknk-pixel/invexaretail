import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFLINE_WRITE_CODE, OfflineWriteError, isMutatingMethod, shouldRefuseOfflineWrite } from './offline-policy.js';
import { apiRequest } from './api-client.js';

test('writes are refused offline; reads and online writes are not', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    assert.equal(shouldRefuseOfflineWrite({ method, onLine: false }), true, method);
    assert.equal(shouldRefuseOfflineWrite({ method, onLine: true }), false, method);
  }
  assert.equal(shouldRefuseOfflineWrite({ method: 'GET', onLine: false }), false);
  assert.equal(shouldRefuseOfflineWrite({ method: undefined, onLine: false }), false);
  assert.equal(isMutatingMethod('GET'), false);
});

test('the refusal says nothing was saved and what to do', () => {
  const error = new OfflineWriteError();
  assert.equal(error.code, OFFLINE_WRITE_CODE);
  assert.match(error.message, /not saved/);
  assert.match(error.message, /mobile app/);
});

test('apiRequest does not queue an offline write: it fails with OfflineWriteError and never touches the network', async () => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new TypeError('Failed to fetch'); };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    await assert.rejects(apiRequest('/api/v1/counts', { method: 'POST', body: JSON.stringify({ qty: 1 }) }), (error) => error.code === OFFLINE_WRITE_CODE);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
  }
});
