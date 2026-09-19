// Blueprint v4 §11 real-time client: an authenticated SSE stream read with
// fetch (an EventSource cannot send an Authorization header, and the token
// must not go in a URL). Events are payload-free invalidations - the app
// refetches through its normal role/location-scoped endpoints.

export const LIVE_STATUS = {
  connecting: 'connecting',
  live: 'live',
  reconnecting: 'reconnecting',
  stale: 'stale',
  offline: 'offline',
  unauthorized: 'unauthorized',
};

const HEARTBEAT_STALE_MS = 70_000;
const WATCHDOG_MS = 15_000;

/** Splits an SSE text buffer into complete frames plus the unfinished tail. */
export function parseSseBuffer(buffer) {
  const frames = [];
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const frame = { id: null, event: 'message', data: '' };
    let any = false;
    for (const line of part.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') { frame.id = value; any = true; }
      else if (field === 'event') { frame.event = value; any = true; }
      else if (field === 'data') { frame.data += (frame.data ? '\n' : '') + value; any = true; }
    }
    if (any) frames.push(frame);
  }
  return { frames, rest };
}

export function backoffDelay(attempt, random = Math.random) {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.8 + random() * 0.4));
}

// Which slices of client state a set of topics invalidates. '*' means the
// stream cannot vouch for continuity (server restart / cursor too old).
export function invalidationsForTopics(topics) {
  const out = new Set();
  for (const topic of topics) {
    switch (topic) {
      case '*':
        // Continuity lost: refetch every data slice, but not the full
        // hydrate (that also resets in-progress form defaults).
        ['counts', 'assignments', 'stock', 'items', 'transfers', 'dashboard', 'pickerTasks', 'campaigns'].forEach((slice) => out.add(slice));
        break;
      case 'permission.changed':
      case 'config.changed':
        out.add('full');
        break;
      case 'count.changed':
      case 'assignment.changed':
        out.add('counts'); out.add('assignments'); out.add('dashboard');
        break;
      case 'campaign.changed':
        out.add('campaigns'); out.add('counts'); out.add('assignments'); out.add('dashboard');
        break;
      case 'stock.changed':
      case 'receipt.changed':
      case 'putaway.changed':
        out.add('stock'); out.add('dashboard');
        break;
      case 'pick.changed':
        out.add('stock'); out.add('pickerTasks'); out.add('transfers');
        break;
      case 'transfer.changed':
        out.add('transfers'); out.add('stock'); out.add('dashboard');
        break;
      case 'item.changed':
      case 'lot.changed':
        out.add('items'); out.add('stock');
        break;
      case 'import.committed':
        out.add('items'); out.add('stock'); out.add('dashboard');
        break;
      case 'exception.changed':
      case 'approval.changed':
      case 'connector.changed':
        out.add('dashboard');
        break;
      default:
        break;
    }
  }
  return out;
}

export function createLiveClient({
  url,
  getToken,
  onEvents,
  onStatus,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  let stopped = false;
  let controller = null;
  let cursor = null;
  let epoch = null;
  let status = null;
  let lastByteAt = 0;
  let watchdog = null;
  let immediate = false;

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  };

  async function connectOnce(attempt) {
    controller = new AbortController();
    setStatus(attempt === 0 ? LIVE_STATUS.connecting : attempt >= 3 ? LIVE_STATUS.polling : LIVE_STATUS.reconnecting);
    const token = getToken();
    if (!token) { setStatus(LIVE_STATUS.unauthorized); stopped = true; return; }
    const headers = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
    if (cursor !== null) headers['Last-Event-ID'] = String(cursor);
    const query = epoch ? `?epoch=${encodeURIComponent(epoch)}` : '';
    const response = await fetchImpl(`${url}${query}`, { headers, signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      setStatus(LIVE_STATUS.unauthorized);
      stopped = true;
      return;
    }
    if (!response.ok || !response.body) throw new Error(`live stream failed: ${response.status}`);

    lastByteAt = now();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      lastByteAt = now();
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      const topics = [];
      for (const frame of parsed.frames) {
        let data = {};
        try { data = frame.data ? JSON.parse(frame.data) : {}; } catch { data = {}; }
        if (frame.event === 'hello') {
          const changedEpoch = epoch !== null && data.epoch !== epoch;
          epoch = data.epoch ?? epoch;
          if (changedEpoch) { cursor = null; topics.push('*'); }
          setStatus(LIVE_STATUS.live);
        } else if (frame.event === 'reset') {
          cursor = null;
          topics.push('*');
        } else if (frame.id !== null) {
          const id = Number(frame.id);
          if (Number.isFinite(id)) {
            if (cursor !== null && id <= cursor) continue;
            cursor = id;
          }
          topics.push(frame.event);
        }
      }
      if (topics.length) onEvents?.(topics);
    }
  }

  async function run() {
    let attempt = 0;
    while (!stopped) {
      try {
        await connectOnce(attempt);
        if (stopped) return;
        attempt = 0;
      } catch (error) {
        if (stopped) return;
        attempt += 1;
        void error;
      }
      if (stopped) return;
      if (immediate) {
        immediate = false;
        attempt = 0;
        continue;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) setStatus(LIVE_STATUS.offline);
      else if (![LIVE_STATUS.stale, LIVE_STATUS.polling].includes(status)) setStatus(LIVE_STATUS.reconnecting);
      await sleep(backoffDelay(attempt, random));
    }
  }

  return {
    start() {
      stopped = false;
      watchdog = setInterval(() => {
        if (status === LIVE_STATUS.live && now() - lastByteAt > HEARTBEAT_STALE_MS) {
          setStatus(LIVE_STATUS.stale);
          controller?.abort();
        }
      }, WATCHDOG_MS);
      void run();
    },
    // Called when the tab regains network / focus: don't wait out a backoff.
    reconnectNow() {
      if (stopped) return;
      immediate = true;
      controller?.abort();
    },
    markOffline() {
      setStatus(LIVE_STATUS.offline);
    },
    stop() {
      stopped = true;
      clearInterval(watchdog);
      controller?.abort();
    },
    get cursor() { return cursor; },
    get status() { return status; },
  };
}
