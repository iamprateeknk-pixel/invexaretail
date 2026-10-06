// Nightly stock reconciliation (plan Area B WP4), one run per company, recorded in
// ReconciliationRun. Runs in the worker under a distributed lock so replicas do not
// reconcile twice, and never writes to stock: detection and evidence only.
import { prisma } from './db.js';
import { withDistributedLock } from './distributed-lock.js';
import { pruneReconciliationRuns, runAndRecordReconciliation } from './stock-reconciliation.js';

let timer: NodeJS.Timeout | null = null;

export async function reconcileAllCompaniesOnce(): Promise<{ companies: number; withMismatches: number }> {
  const result = await withDistributedLock('stock-reconciliation', async () => {
    const rows = (await prisma.stockLedger.findMany({ distinct: ['companyId'], select: { companyId: true } })) as Array<{ companyId: string }>;
    let withMismatches = 0;
    for (const { companyId } of rows) {
      const run = await runAndRecordReconciliation({ companyId, trigger: 'schedule' });
      if (run.mismatches > 0) {
        withMismatches += 1;
        console.error(`[reconciliation] company ${companyId}: ${run.mismatches} journal mismatch(es), max |delta| ${run.maxAbsDelta}. See GET /ops/reconciliation.`);
      }
    }
    await pruneReconciliationRuns();
    return { companies: rows.length, withMismatches };
  });
  return result ?? { companies: 0, withMismatches: 0 };
}

/** Starts the schedule: first run after a short delay (not during the boot burst), then every RECONCILE_INTERVAL_HOURS (default 24). */
export function startReconciliationSchedule(options: { intervalHours?: number; firstRunDelayMs?: number } = {}): void {
  if (timer) return;
  const hours = options.intervalHours ?? Number(process.env.RECONCILE_INTERVAL_HOURS ?? 24);
  const intervalMs = Math.max(1, Number.isFinite(hours) ? hours : 24) * 3_600_000;
  const run = () => { reconcileAllCompaniesOnce().catch((error) => console.error('[reconciliation] run failed', error instanceof Error ? error.message : error)); };
  const first = setTimeout(() => { run(); timer = setInterval(run, intervalMs); timer.unref?.(); }, options.firstRunDelayMs ?? 120_000);
  first.unref?.();
}

export function stopReconciliationSchedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
