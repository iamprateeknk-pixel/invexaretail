import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { outboxHealthSnapshot } from './event-bus.js';
import { STALE_IN_PROGRESS_MS } from './mutation-idempotency.js';
import { withDistributedLock } from './distributed-lock.js';

// Release checklist (Operations / DR): "Alerts ... are live." The queryable SLO signals
// (`/ops/metrics`, `/ops/reconciliation`, `/ops/sync-health`) only help if someone is told. This sweep
// turns the breaches into notifications to ONE configurable destination (ALERT_WEBHOOK_URL, a Slack
// "incoming webhook" or any endpoint that accepts JSON). It is deliberately transport-agnostic: no
// paging vendor is bundled, the owner points it at whatever they use. Unset = the sweep is off and
// nothing is sent; the signals stay available through the ops endpoints.

export const OUTBOX_LAG_ALERT_SECONDS = 15 * 60;
export const REPEAT_ALERT_MS = 6 * 3_600_000;

export type Alert = { key: string; severity: 'page' | 'warn'; title: string; detail: string };

export type AlertInputs = {
  outbox?: { pending: number; poison: number; oldestPendingAgeSeconds: number };
  /** Companies whose latest stock reconciliation found journal mismatches. */
  mismatchCompanies?: Array<{ companyId: string; mismatches: number }>;
  /** Mutation receipts still IN_PROGRESS past the stale window, across all companies. */
  stuckReceipts?: number;
};

/** Pure: which alerts are firing for a snapshot of the signals. */
export function collectAlerts(input: AlertInputs): Alert[] {
  const alerts: Alert[] = [];
  const { outbox } = input;
  if (outbox && outbox.poison > 0) {
    alerts.push({ key: 'outbox-poison', severity: 'page', title: 'Outbox has POISON events', detail: `${outbox.poison} event(s) failed delivery permanently. Inspect them; do not delete.` });
  }
  if (outbox && outbox.oldestPendingAgeSeconds >= OUTBOX_LAG_ALERT_SECONDS) {
    alerts.push({ key: 'outbox-lag', severity: 'page', title: 'Outbox delivery is stuck', detail: `Oldest pending event is ${Math.round(outbox.oldestPendingAgeSeconds / 60)} min old (${outbox.pending} pending). Is the worker running?` });
  }
  for (const entry of input.mismatchCompanies ?? []) {
    alerts.push({ key: `stock-mismatch:${entry.companyId}`, severity: 'page', title: 'Stock does not reconcile', detail: `Company ${entry.companyId}: ${entry.mismatches} balance(s) disagree with the movement journal. See GET /ops/reconciliation.` });
  }
  if ((input.stuckReceipts ?? 0) > 0) {
    alerts.push({ key: 'sync-stuck', severity: 'warn', title: 'Offline commands are stuck', detail: `${input.stuckReceipts} mutation receipt(s) claimed but never finished. See GET /ops/sync-health.` });
  }
  return alerts;
}

export type AlertTransport = (payload: { text: string; alerts: Alert[]; resolved: string[] }) => Promise<void>;

/**
 * Remembers what has already been sent so a standing breach is announced once, repeated only every
 * REPEAT_ALERT_MS, and a cleared breach is reported as resolved - instead of one message per sweep.
 */
export class AlertNotifier {
  private firing = new Map<string, number>();

  constructor(private readonly send: AlertTransport, private readonly repeatMs = REPEAT_ALERT_MS) {}

  async notify(current: Alert[], now = Date.now()): Promise<{ sent: Alert[]; resolved: string[] }> {
    const sent: Alert[] = [];
    for (const alert of current) {
      const last = this.firing.get(alert.key);
      if (last === undefined || now - last >= this.repeatMs) sent.push(alert);
    }
    const currentKeys = new Set(current.map((alert) => alert.key));
    const resolved = [...this.firing.keys()].filter((key) => !currentKeys.has(key));
    if (sent.length || resolved.length) {
      const text = [
        ...sent.map((alert) => `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.detail}`),
        ...resolved.map((key) => `[RESOLVED] ${key}`),
      ].join('\n');
      await this.send({ text: `[invexa] ${text}`, alerts: sent, resolved }); // a failed send is retried next sweep (state untouched)
    }
    for (const alert of sent) this.firing.set(alert.key, now);
    for (const key of resolved) this.firing.delete(key);
    return { sent, resolved };
  }
}

export function webhookTransport(url: string, fetchImpl: typeof fetch = fetch): AlertTransport {
  return async (payload) => {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Alert endpoint responded ${response.status}`);
  };
}

async function gatherInputs(now = new Date()): Promise<AlertInputs> {
  if (!databaseEnabled) return {};
  const outbox = await outboxHealthSnapshot(now);
  const latest = (await prisma.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 500, select: { companyId: true, mismatches: true } })) as Array<{ companyId: string | null; mismatches: number }>;
  const seen = new Set<string>();
  const mismatchCompanies: Array<{ companyId: string; mismatches: number }> = [];
  for (const row of latest) {
    const id = row.companyId ?? 'all';
    if (seen.has(id)) continue; // newest run per company only
    seen.add(id);
    if (row.mismatches > 0) mismatchCompanies.push({ companyId: id, mismatches: row.mismatches });
  }
  const stuckReceipts = await prisma.mutationReceipt.count({ where: { state: 'IN_PROGRESS', updatedAt: { lt: new Date(now.getTime() - STALE_IN_PROGRESS_MS) } } });
  return { outbox, mismatchCompanies, stuckReceipts };
}

let notifier: AlertNotifier | null = null;
let timer: NodeJS.Timeout | null = null;

export async function runAlertSweepOnce(transport?: AlertTransport): Promise<{ firing: number; sent: number; resolved: number } | null> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!transport && !url) return null;
  notifier ??= new AlertNotifier(transport ?? webhookTransport(url!));
  const alerts = collectAlerts(await gatherInputs());
  const result = await notifier.notify(alerts);
  return { firing: alerts.length, sent: result.sent.length, resolved: result.resolved.length };
}

/** Starts the sweep in the worker (every ALERT_SWEEP_MINUTES, default 5). A no-op unless ALERT_WEBHOOK_URL is set. */
export function startAlertSweep(): void {
  if (timer || !process.env.ALERT_WEBHOOK_URL?.trim()) return;
  const minutes = Number(process.env.ALERT_SWEEP_MINUTES ?? 5);
  const run = () => { void withDistributedLock('alert-sweep', () => runAlertSweepOnce()).catch((error) => console.error('[alerts] sweep failed', error instanceof Error ? error.message : error)); };
  timer = setInterval(run, Math.max(1, Number.isFinite(minutes) ? minutes : 5) * 60_000);
  timer.unref?.();
  run();
}

export function resetAlertSweepForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  notifier = null;
}
