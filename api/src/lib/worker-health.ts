import { prisma, resolveDatabaseUrl } from './db.js';

export const WORKER_HEALTH_WINDOW_MS = 180_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
type WorkerPoll = 'outbox' | 'imports' | 'automations' | 'studioReleases';
export type WorkerPollProgress = Partial<Record<WorkerPoll, Date>>;

/** A later write from a slower replica must not move the release's progress backwards. */
export async function recordWorkerHealth(release: string, heartbeatAt: Date, progress: WorkerPollProgress): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "WorkerHealth" ("release", "heartbeatAt", "outboxAt", "importsAt", "automationsAt", "studioReleasesAt")
    VALUES (${release}, ${heartbeatAt}, ${progress.outbox ?? null}, ${progress.imports ?? null},
      ${progress.automations ?? null}, ${progress.studioReleases ?? null})
    ON CONFLICT ("release") DO UPDATE SET
      "heartbeatAt" = GREATEST("WorkerHealth"."heartbeatAt", EXCLUDED."heartbeatAt"),
      "outboxAt" = GREATEST("WorkerHealth"."outboxAt", EXCLUDED."outboxAt"),
      "importsAt" = GREATEST("WorkerHealth"."importsAt", EXCLUDED."importsAt"),
      "automationsAt" = GREATEST("WorkerHealth"."automationsAt", EXCLUDED."automationsAt"),
      "studioReleasesAt" = GREATEST("WorkerHealth"."studioReleasesAt", EXCLUDED."studioReleasesAt")
  `;
}

export async function readWorkerHealth(release: string, now = new Date()) {
  const row = resolveDatabaseUrl() && release !== 'unknown' ? await prisma.workerHealth.findUnique({ where: { release } }) : null;
  const heartbeatAt = row?.heartbeatAt ?? null;
  const lastSuccess = {
    outbox: row?.outboxAt ?? null, imports: row?.importsAt ?? null,
    automations: row?.automationsAt ?? null, studioReleases: row?.studioReleasesAt ?? null,
  };
  const fresh = (value: Date | null) => value !== null && now.getTime() - value.getTime() <= WORKER_HEALTH_WINDOW_MS;
  const state = release === 'unknown' ? 'unidentified' : !row ? 'missing' : !fresh(heartbeatAt) ? 'stale'
    : Object.values(lastSuccess).every(fresh) ? 'ready' : 'degraded';
  return { state, heartbeatAt, lastSuccess } as const;
}

export function startWorkerHeartbeat(release: string, progress: WorkerPollProgress): void {
  if (!resolveDatabaseUrl()) return;
  let writing = false;
  async function beat() {
    if (writing) return;
    writing = true;
    try {
      await recordWorkerHealth(release, new Date(), progress);
    } catch (error) {
      console.warn('[worker-health] heartbeat failed', error instanceof Error ? error.name : 'Unknown error');
    } finally {
      writing = false;
    }
  }
  void beat();
  // The dedicated worker must stay alive when all queues are idle.
  setInterval(() => { void beat(); }, HEARTBEAT_INTERVAL_MS);
}
