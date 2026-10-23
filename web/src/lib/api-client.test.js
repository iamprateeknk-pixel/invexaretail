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

test('writes carry an X-Mutation-Id that is reused when the same write is retried after a network failure', async () => {
  const seen = [];
  let fail = true;
  globalThis.fetch = async (_url, init) => {
    seen.push(init.headers['X-Mutation-Id']);
    if (fail) { fail = false; throw new TypeError('network down'); }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const options = { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ qty: 9 }) };
  await assert.rejects(apiRequest('/api/v1/counts', options));
  await apiRequest('/api/v1/counts', options);
  assert.equal(seen.length, 2);
  assert.match(seen[0], /^web-/);
  assert.equal(seen[0], seen[1]);
  await apiRequest('/api/v1/counts', options);
  assert.notEqual(seen[2], seen[1]);
});

test('a definitive 4xx releases the id so a corrected retry is a new action', async () => {
  const seen = [];
  let status = 400;
  globalThis.fetch = async (_url, init) => {
    seen.push(init.headers['X-Mutation-Id']);
    return { ok: status === 200, status, json: async () => ({ message: 'bad' }) };
  };
  const options = { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ qty: 3 }) };
  await assert.rejects(apiRequest('/api/v1/counts', options));
  status = 200;
  await apiRequest('/api/v1/counts', options);
  assert.notEqual(seen[0], seen[1]);
});
