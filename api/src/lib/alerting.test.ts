import assert from 'node:assert/strict';
import test from 'node:test';
import { AlertNotifier, OUTBOX_LAG_ALERT_SECONDS, REPEAT_ALERT_MS, collectAlerts, webhookTransport, type Alert } from './alerting.js';

test('nothing fires for a healthy system', () => {
  assert.deepEqual(collectAlerts({}), []);
  assert.deepEqual(collectAlerts({ outbox: { pending: 3, poison: 0, oldestPendingAgeSeconds: 20 }, mismatchCompanies: [], stuckReceipts: 0 }), []);
});

test('poison events, a stuck outbox, a stock mismatch and stuck receipts each raise their own alert', () => {
  const keys = collectAlerts({
    outbox: { pending: 9, poison: 2, oldestPendingAgeSeconds: OUTBOX_LAG_ALERT_SECONDS },
    mismatchCompanies: [{ companyId: 'co-a', mismatches: 3 }, { companyId: 'co-b', mismatches: 1 }],
    stuckReceipts: 4,
  }).map((alert) => alert.key);
  assert.deepEqual(keys.sort(), ['outbox-lag', 'outbox-poison', 'stock-mismatch:co-a', 'stock-mismatch:co-b', 'sync-stuck']);
  assert.equal(collectAlerts({ outbox: { pending: 1, poison: 0, oldestPendingAgeSeconds: OUTBOX_LAG_ALERT_SECONDS - 1 } }).length, 0, 'just under the lag threshold is quiet');
});

test('a standing breach is announced once, repeated only after the repeat window, and reported when it clears', async () => {
  const sends: Array<{ text: string; alerts: Alert[]; resolved: string[] }> = [];
  const notifier = new AlertNotifier(async (payload) => { sends.push(payload); });
  const poison: Alert = { key: 'outbox-poison', severity: 'page', title: 'Outbox has POISON events', detail: '2 events' };

  assert.equal((await notifier.notify([poison], 1_000)).sent.length, 1);
  assert.equal((await notifier.notify([poison], 2_000)).sent.length, 0, 'not repeated on the next sweep');
  assert.equal((await notifier.notify([poison], 1_000 + REPEAT_ALERT_MS)).sent.length, 1, 'repeated after the repeat window');
  const cleared = await notifier.notify([], 1_000 + REPEAT_ALERT_MS + 5);
  assert.deepEqual(cleared.resolved, ['outbox-poison']);
  assert.equal((await notifier.notify([], 1_000 + REPEAT_ALERT_MS + 10)).resolved.length, 0, 'resolved is reported once');
  assert.equal(sends.length, 3);
  assert.match(sends[0].text, /^\[invexa\] \[PAGE\] Outbox has POISON events/);
  assert.match(sends[2].text, /\[RESOLVED\] outbox-poison/);
});

test('a failed send is retried on the next sweep instead of being forgotten', async () => {
  let fail = true;
  const notifier = new AlertNotifier(async () => { if (fail) throw new Error('endpoint down'); });
  const alert: Alert = { key: 'sync-stuck', severity: 'warn', title: 't', detail: 'd' };
  await assert.rejects(() => notifier.notify([alert], 1_000), /endpoint down/);
  fail = false;
  assert.equal((await notifier.notify([alert], 2_000)).sent.length, 1, 'the alert was not marked as sent');
});

test('the webhook transport posts JSON and treats a non-2xx answer as a failure', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const ok = webhookTransport('https://hooks.example.com/alerts', (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return { ok: true, status: 200 } as Response; }) as unknown as typeof fetch);
  await ok({ text: 'hi', alerts: [], resolved: [] });
  assert.equal(calls[0].url, 'https://hooks.example.com/alerts');
  assert.equal(JSON.parse(calls[0].body).text, 'hi');
  const bad = webhookTransport('https://hooks.example.com/alerts', (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
  await assert.rejects(() => bad({ text: 'x', alerts: [], resolved: [] }), /responded 500/);
});
