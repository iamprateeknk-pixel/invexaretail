import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeStreams, parseSseText, parseUsers, summarizeSamples } from './sse-reconnect-harness.mjs';

// Unit coverage for the harness's pure helpers only — the live behaviour
// (streams, replay, pollers) is staging evidence and runs via
// `npm run load:sse`, never in CI.

test('parseSseText splits complete frames and keeps the partial rest', () => {
  const { frames, rest } = parseSseText('id: 7\nevent: item.changed\ndata: {"id":7}\n\n: ping\n\nevent: hel');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, '7');
  assert.equal(frames[0].event, 'item.changed');
  assert.equal(frames[0].data, '{"id":7}');
  assert.equal(frames[1].comment, true);
  assert.equal(rest, 'event: hel');
});

test('parseSseText reads the hello frame the server sends first', () => {
  const { frames } = parseSseText('retry: 3000\n\nevent: hello\ndata: {"epoch":"e1","latestEventId":3}\n\n');
  assert.equal(frames[1].event, 'hello');
  assert.equal(JSON.parse(frames[1].data).latestEventId, 3);
});

test('distributeStreams respects the 5-per-user server cap', () => {
  assert.deepEqual(distributeStreams(5, 1), { counts: [5], dropped: 0 });
  assert.deepEqual(distributeStreams(8, 1), { counts: [5], dropped: 3 });
  assert.deepEqual(distributeStreams(7, 2), { counts: [4, 3], dropped: 0 });
  assert.deepEqual(distributeStreams(12, 2), { counts: [5, 5], dropped: 2 });
});

test('parseUsers reads LOAD_USERS pairs and the single-user fallback', () => {
  assert.deepEqual(parseUsers({ LOAD_USERS: 'a@x:p1, b@x:p:2' }), [
    { email: 'a@x', password: 'p1' },
    { email: 'b@x', password: 'p:2' },
  ]);
  assert.deepEqual(parseUsers({ LOAD_EMAIL: 'a@x', LOAD_PASSWORD: 'pw' }), [{ email: 'a@x', password: 'pw' }]);
  assert.deepEqual(parseUsers({}), []);
});

test('summarizeSamples reports error rate and percentiles over ok samples', () => {
  const summary = summarizeSamples([
    { ok: true, ms: 10 }, { ok: true, ms: 20 }, { ok: true, ms: 30 }, { ok: false, ms: 5 },
  ]);
  assert.equal(summary.samples, 4);
  assert.equal(summary.errors, 1);
  assert.equal(summary.errorRate, 0.25);
  assert.equal(summary.p50, 20);
  assert.equal(summary.max, 30);
});
