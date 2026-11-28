import { prisma, resolveDatabaseUrl } from '../db.js';
import { ControlPlaneError, controlPlane, type ControlPlane } from './control-plane.js';
import { refreshControlPlaneFromDb, StudioConfigConflict } from './control-plane-repository.js';
import { commitStudioRelease, finishStudioSchedule } from './persistence.js';

export async function activateDueStudioReleases(now = new Date(), plane: ControlPlane = controlPlane) {
  const due = await prisma.$queryRaw<Array<{ companyId: string; scheduleId: string }>>`
    SELECT "companyId", payload->'releaseSchedule'->>'id' AS "scheduleId"
    FROM "ControlPlaneConfig"
    WHERE kind = 'draft' AND payload->'releaseSchedule'->>'status' = 'scheduled'
      AND payload->'releaseSchedule'->>'activateAt' <= ${now.toISOString()}
    ORDER BY payload->'releaseSchedule'->>'activateAt', "companyId" LIMIT 20
  `;
  if (!due.length) return 0;
  await refreshControlPlaneFromDb(plane);
  let activated = 0;
  for (const { companyId, scheduleId } of due) {
    const schedule = plane.drafts.get(companyId)?.releaseSchedule;
    if (!schedule || schedule.id !== scheduleId || schedule.status !== 'scheduled' || new Date(schedule.activateAt) > now) continue;
    try {
      const company = plane.requireCompany(companyId);
      const scope = plane.createScope({ actorId: schedule.requestedBy, actorType: 'system',
        sessionType: 'control', companyId, tenantId: company.tenantId });
      await commitStudioRelease(plane, scope, { draftRevision: schedule.revision, reviewId: schedule.reviewId,
        scheduledActivation: { id: schedule.id, now } });
      activated += 1;
    } catch (error) {
      if (error instanceof StudioConfigConflict) continue;
      if (!(error instanceof ControlPlaneError) || error.status >= 500) {
        console.error('[studio-release] activation failed', { companyId, scheduleId, error });
        continue;
      }
      await finishStudioSchedule(plane, companyId, scheduleId, error.message).catch((failure) => {
        if (!(failure instanceof StudioConfigConflict)) console.error('[studio-release] could not record blocked release', failure);
      });
    }
  }
  return activated;
}

export function startStudioReleaseWorker(intervalMs = 30_000, onSuccess?: () => void) {
  if (!resolveDatabaseUrl()) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await activateDueStudioReleases();
      onSuccess?.();
    } catch (error) {
      console.error('[studio-release] worker tick failed', error);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
}
