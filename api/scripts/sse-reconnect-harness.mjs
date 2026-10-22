#!/usr/bin/env node
// R12 evidence harness: polling + SSE load and reconnect behaviour against a
// RUNNING API (staging). Dependency-free (global fetch + AbortController),
// in the same spirit as scripts/load-test.mjs, which it complements:
// load-test.mjs measures plain request latency; this harness measures the
// live-update channel described by src/routes/events.ts —
//
//   * N concurrent SSE subscribers on GET /api/v1/events (the server caps
//     streams at 5 per user and 2000 total, so subscribers are spread
//     across the configured users, at most 5 each);
//   * M pollers hammering the read endpoints the web shell refreshes with;
//   * an event-latency probe: a mutation (POST /api/v1/items) is timed from
//     request start until the matching `item.changed` frame arrives on
//     each open stream;
//   * a drop/reconnect phase: every stream is aborted client-side, a
//     second mutation fires while disconnected, then each stream
//     reconnects with its Last-Event-ID cursor — the server either replays
//     what was missed or answers with an `event: reset` (both are correct
//     per events.ts; the summary records which one happened).
//
// Usage:
//   API_URL=https://staging-api.example \
//   LOAD_USERS=admin@x:pass1,picker@x:pass2 \
//   node scripts/sse-reconnect-harness.mjs [--subscribers 10] [--pollers 5] \
//     [--duration 30] [--out summary.json] [--max-error-rate 0.01]
//
// LOAD_EMAIL / LOAD_PASSWORD (or SEED_PASSWORD) work as a one-user
// fallback, exactly like load-test.mjs.
//
// Exit code: 1 when the poller error rate exceeds --max-error-rate, when a
// stream cannot connect / never says hello, or when NO stream receives the
// probe event. The latency figures themselves are reported, not gated —
// there is no staging baseline yet, so thresholds are PROPOSED in
// docs/staging-evidence-pack.md, not enforced here.
//
// This harness has NOT been run against staging yet (R12 evidence pending).

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const API_URL = (process.env.API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const SUBSCRIBERS = Number(flag('subscribers', '5'));
const POLLERS = Number(flag('pollers', '5'));
const DURATION_S = Number(flag('duration', '30'));
const OUT = flag('out');
const MAX_ERROR_RATE = Number(flag('max-error-rate', '0.01'));
const MAX_STREAMS_PER_USER = 5; // events.ts: MAX_STREAMS_PER_USER

export function parseUsers(env = process.env) {
  if (env.LOAD_USERS) {
    return env.LOAD_USERS.split(',').map((pair) => {
      const splitAt = pair.indexOf(':');
      return { email: pair.slice(0, splitAt).trim(), password: pair.slice(splitAt + 1) };
    }).filter((user) => user.email && user.password);
  }
  const email = env.LOAD_EMAIL || 'admin@retail.local';
  const password = env.LOAD_PASSWORD || env.SEED_PASSWORD || '';
  return password ? [{ email, password }] : [];
}

/** Spread `total` streams over `userCount` users, never above the server cap. */
export function distributeStreams(total, userCount) {
  const counts = Array.from({ length: userCount }, () => 0);
  let remaining = total;
  let index = 0;
  while (remaining > 0 && counts.some((count) => count < MAX_STREAMS_PER_USER)) {
    if (counts[index % userCount] < MAX_STREAMS_PER_USER) {
      counts[index % userCount] += 1;
      remaining -= 1;
    }
    index += 1;
  }
  return { counts, dropped: remaining };
}

/**
 * Incremental SSE parser: feed it decoded text chunks; it returns the
 * frames completed by '\n\n'. Comment frames (heartbeats, ': ping') come
 * back as { comment: true }. The caller keeps the returned `rest`.
 */
export function parseSseText(buffer) {
  const frames = [];
  let rest = buffer;
  let boundary = rest.indexOf('\n\n');
  while (boundary >= 0) {
    const raw = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const frame = { id: undefined, event: undefined, data: undefined, comment: false };
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) frame.comment = true;
      else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
      else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
      else if (line.startsWith('data:')) frame.data = (frame.data ?? '') + line.slice(5).trim();
    }
    frames.push(frame);
    boundary = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

export function percentile(sortedMs, p) {
  if (!sortedMs.length) return 0;
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, index)];
}

export function summarizeSamples(samples) {
  const ok = samples.filter((sample) => sample.ok);
  const sorted = ok.map((sample) => sample.ms).sort((a, b) => a - b);
  return {
    samples: samples.length,
    errors: samples.length - ok.length,
    errorRate: samples.length ? (samples.length - ok.length) / samples.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
  };
}

async function signIn(user) {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) throw new Error(`Sign-in failed for ${user.email} (${response.status})`);
  return body.token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One SSE subscriber: connect, record frames, support a cursor reconnect. */
class StreamProbe {
  constructor(label, token) {
    this.label = label;
    this.token = token;
    this.controller = null;
    this.helloAt = 0;
    this.connectStartedAt = 0;
    this.lastEventId = undefined;
    this.heartbeats = 0;
    this.events = []; // { topic, at } in arrival order
    this.error = null;
    this.probeArrivals = new Map(); // probeTag -> arrival performance.now()
    this.reconnect = null; // { helloMs, replayed, reset }
  }

  async connect(cursor) {
    this.controller = new AbortController();
    this.connectStartedAt = performance.now();
    this.helloAt = 0; // per-connection: reset so reconnect hello timing is measurable
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' };
    if (cursor !== undefined && cursor !== '') headers['Last-Event-ID'] = String(cursor);
    const response = await fetch(`${API_URL}/api/v1/events`, { headers, signal: this.controller.signal });
    if (!response.ok || !response.body) throw new Error(`events connect failed (${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseText(buffer);
      buffer = rest;
      for (const frame of frames) {
        const now = performance.now();
        if (frame.comment) { this.heartbeats += 1; continue; }
        if (frame.id !== undefined && frame.id !== '') this.lastEventId = frame.id;
        if (frame.event === 'hello' && !this.helloAt) this.helloAt = now;
        if (frame.event) {
          this.events.push({ topic: frame.event, at: now });
          if (frame.event === 'item.changed') {
            for (const tag of this.pendingProbes ?? []) {
              if (!this.probeArrivals.has(tag)) this.probeArrivals.set(tag, now);
            }
          }
          if (this.reconnect && frame.event === 'item.changed' && this.reconnect.replayed === undefined) {
            this.reconnect.replayed = true;
          }
          if (this.reconnect && frame.event === 'reset') this.reconnect.reset = true;
        }
      }
    }
  }

  start(cursor) {
    this.pendingProbes = this.pendingProbes ?? new Set();
    return this.connect(cursor).catch((error) => {
      if (!this.controller?.signal.aborted) this.error = error;
    });
  }

  drop() {
    this.controller?.abort();
  }
}

async function fireProbeMutation(token, tag) {
  const started = performance.now();
  const response = await fetch(`${API_URL}/api/v1/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: `SSE-PROBE-${tag}-${Date.now()}`, name: `SSE probe ${tag}` }),
  });
  if (!response.ok) throw new Error(`probe mutation failed (${response.status})`);
  return started;
}

async function main() {
  const users = parseUsers();
  if (!users.length) throw new Error('Set LOAD_USERS=email:password[,…] or LOAD_PASSWORD (staging credentials, never committed).');
  const tokens = [];
  for (const user of users) tokens.push(await signIn(user));

  const { counts, dropped } = distributeStreams(SUBSCRIBERS, users.length);
  if (dropped) console.error(`WARN: ${dropped} subscriber(s) dropped — the server caps streams at ${MAX_STREAMS_PER_USER} per user; add LOAD_USERS to scale.`);
  const streams = [];
  counts.forEach((count, userIndex) => {
    for (let i = 0; i < count; i += 1) streams.push(new StreamProbe(`u${userIndex}s${i}`, tokens[userIndex]));
  });
  console.log(`SSE harness: ${API_URL}  users=${users.length}  subscribers=${streams.length}  pollers=${POLLERS}  duration=${DURATION_S}s`);

  const running = streams.map((stream) => stream.start());
  await sleep(1500);
  const helloFailures = streams.filter((stream) => !stream.helloAt);
  if (helloFailures.length) throw new Error(`${helloFailures.length} stream(s) never received the hello frame.`);

  // Pollers: the read paths the web shell refreshes alongside the stream.
  const pollerSamples = [];
  const pollPaths = ['/api/v1/transfers/list', '/api/v1/items/search?limit=25'];
  const deadline = Date.now() + DURATION_S * 1000;
  const pollers = Array.from({ length: POLLERS }, async (_, pollerIndex) => {
    let flip = pollerIndex % pollPaths.length;
    while (Date.now() < deadline) {
      const path = pollPaths[flip % pollPaths.length];
      flip += 1;
      const t0 = performance.now();
      try {
        const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${tokens[0]}` } });
        await response.arrayBuffer();
        pollerSamples.push({ ok: response.ok, ms: performance.now() - t0 });
      } catch {
        pollerSamples.push({ ok: false, ms: performance.now() - t0 });
      }
    }
  });

  // Probe 1: event latency on the healthy streams.
  await sleep(2000);
  for (const stream of streams) stream.pendingProbes.add('p1');
  const probe1At = await fireProbeMutation(tokens[0], 'p1');
  await sleep(3000);
  const latencies1 = streams.map((stream) => stream.probeArrivals.get('p1')).filter(Boolean).map((at) => at - probe1At);

  // Drop phase: cut every stream, mutate while disconnected, reconnect
  // with cursors and see whether the missed event is replayed (or a reset
  // is served instead — both are correct per events.ts).
  const cursors = streams.map((stream) => stream.lastEventId);
  for (const stream of streams) stream.drop();
  await sleep(1500);
  const probe2At = await fireProbeMutation(tokens[0], 'p2');
  await sleep(500);
  const reconnects = streams.map((stream, index) => {
    stream.reconnect = { helloMs: 0, replayed: undefined, reset: false };
    const started = performance.now();
    const done = stream.start(cursors[index] ?? '0');
    return { stream, started, done };
  });
  await sleep(4000);
  for (const { stream } of reconnects) {
    if (stream.reconnect && stream.helloAt) stream.reconnect.helloMs = stream.helloAt - stream.connectStartedAt;
  }
  const replayedCount = streams.filter((stream) => stream.reconnect?.replayed).length;
  const resetCount = streams.filter((stream) => stream.reconnect?.reset).length;

  await Promise.allSettled(pollers);
  for (const stream of streams) stream.drop();
  await Promise.allSettled(running);

  const pollerSummary = summarizeSamples(pollerSamples);
  const streamErrors = streams.filter((stream) => stream.error).length;
  const summary = {
    apiUrl: API_URL,
    users: users.length,
    subscribers: streams.length,
    pollers: POLLERS,
    durationS: DURATION_S,
    probeEventLatencyMs: summarizeSamples(latencies1.map((ms) => ({ ok: true, ms }))),
    probeDeliveredTo: `${latencies1.length}/${streams.length} streams`,
    reconnect: {
      helloMs: summarizeSamples(streams.filter((s) => s.reconnect?.helloMs).map((s) => ({ ok: true, ms: s.reconnect.helloMs }))),
      replayedStreams: replayedCount,
      resetStreams: resetCount,
      note: 'replayed = missed item.changed arrived after cursor reconnect; reset = server asked for a full resync. Both are correct per events.ts.',
    },
    heartbeatsSeen: streams.reduce((sum, stream) => sum + stream.heartbeats, 0),
    streamErrors,
    pollerSummary,
    thresholdsNote: 'Latency figures are reported, not gated — no staging baseline exists yet. Proposed thresholds live in docs/staging-evidence-pack.md.',
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(OUT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Summary written to ${OUT}`);
  }
  let failed = false;
  if (pollerSummary.errorRate > MAX_ERROR_RATE) { console.error(`FAIL: poller error rate ${(pollerSummary.errorRate * 100).toFixed(1)}% > ${(MAX_ERROR_RATE * 100).toFixed(1)}%`); failed = true; }
  if (streamErrors) { console.error(`FAIL: ${streamErrors} stream error(s)`); failed = true; }
  if (!latencies1.length) { console.error('FAIL: the probe event reached no stream'); failed = true; }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sse-reconnect-harness.mjs')) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
