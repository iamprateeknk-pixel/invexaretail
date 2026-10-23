import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRequest } from './api-client.js';

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, status: 200, json: async () => handler(calls.length) };
  };
  return calls;
}

test('a double-clicked write is sent once and both callers get the same result', async () => {
  const calls = stubFetch((n) => ({ n }));
  const options = { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ qty: 5 }) };
  const [a, b] = await Promise.all([apiRequest('/api/v1/transfers', options), apiRequest('/api/v1/transfers', options)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
});

test('the same write sent again after the first finished is a new request', async () => {
  const calls = stubFetch((n) => ({ n }));
  const options = { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ qty: 5 }) };
  await apiRequest('/api/v1/transfers', options);
  await apiRequest('/api/v1/transfers', options);
  assert.equal(calls.length, 2);
});

test('different bodies, and reads, are never coalesced', async () => {
  const calls = stubFetch(() => ({}));
  const headers = { Authorization: 'Bearer t' };
  await Promise.all([
    apiRequest('/api/v1/transfers', { method: 'POST', headers, body: JSON.stringify({ qty: 1 }) }),
    apiRequest('/api/v1/transfers', { method: 'POST', headers, body: JSON.stringify({ qty: 2 }) }),
    apiRequest('/api/v1/items', { headers }),
    apiRequest('/api/v1/items', { headers }),
  ]);
  assert.equal(calls.length, 4);
});
