import { prisma, resolveDatabaseUrl } from '../db.js';
import { BUSINESS_TIMEZONE, validTimezone } from '../timezone-context.js';
import type { AutomationDefinition } from './control-plane.js';
import { scheduledStudioOccurrence, validateLiveAutomation } from './studio-schedule.js';

const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 60_000;
let timer: NodeJS.Timeout | undefined;

class NoActiveAdmins extends Error {}

function enabledSchedules(payload: unknown): AutomationDefinition[] {
  if (!payload || typeof payload !== 'object' || !('automations' in payload) || !Array.isArray(payload.automations)) return [];
  const enabled = payload.automations.filter((row): row is AutomationDefinition => row?.enforce === true);
  enabled.forEach(validateLiveAutomation);
  return enabled;
}

export async function enqueueStudioSchedules(now: Date): Promise<number> {
  const configs = await prisma.controlPlaneConfig.findMany({
    where: { kind: 'published', status: 'published' },
    distinct: ['companyId'],
    orderBy: [{ companyId: 'asc' }, { version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { companyId: true, version: true, versionId: true, payload: true },
  });
  let queued = 0;
  for (const config of configs) {
    try {
      const schedules = enabledSchedules(config.payload);
      if (!schedules.length) continue;
      const payload = config.payload as { publishedAt?: string };
      const publishedAt = new Date(payload.publishedAt ?? '');
      if (!Number.isFinite(publishedAt.getTime())) continue;
      const [company, lifecycle] = await Promise.all([
        prisma.companyProfile.findUnique({ where: { id: config.companyId }, select: { timezone: true } }),
        prisma.controlPlaneCompany.findUnique({ where: { id: config.companyId }, select: { status: true } }),
      ]);
      if (!company || lifecycle?.status === 'suspended') continue;
      const timezone = validTimezone(company.timezone) ?? BUSINESS_TIMEZONE;
      const rows = schedules.flatMap((automation) => {
        const occurrence = scheduledStudioOccurrence(automation.expression, now, timezone, publishedAt);
        return occurrence ? [{
          companyId: config.companyId, automationKey: automation.key, name: automation.name, expression: automation.expression, occurrence,
          configVersion: config.version, versionId: config.versionId, nextAttemptAt: now,
        }] : [];
      });
      if (rows.length) queued += (await prisma.studioAutomationRun.createMany({ data: rows, skipDuplicates: true })).count;
    } catch (error) {
      console.error('[studio-schedule] enqueue failed', { companyId: config.companyId, versionId: config.versionId, error });
    }
  }
  return queued;
}

export async function drainStudioAutomationRuns(now: Date): Promise<void> {
  const due = await prisma.studioAutomationRun.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: 50,
  });
  for (const run of due) {
    const claim = { id: run.id, companyId: run.companyId, status: 'PENDING', attempts: run.attempts };
    try {
      await prisma.$transaction(async (tx) => {
        // Hold the claim through notification insertion and completion. A crash rolls all three back.
        const claimed = await tx.studioAutomationRun.updateMany({ where: claim, data: { attempts: { increment: 1 } } });
        if (!claimed.count) return;
        const [current, lifecycle] = await Promise.all([
          tx.controlPlaneConfig.findFirst({
            where: { companyId: run.companyId, kind: 'published', status: 'published' },
            orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
            select: { payload: true },
          }),
          tx.controlPlaneCompany.findUnique({ where: { id: run.companyId }, select: { status: true } }),
        ]);
        const stillEnabled = lifecycle?.status !== 'suspended' &&
          enabledSchedules(current?.payload).some((item) => item.key === run.automationKey && item.expression === run.expression);
        if (stillEnabled) {
          const recipients = await tx.user.findMany({
            where: { companyId: run.companyId, status: 'ACTIVE', role: { in: ['ADMIN', 'ADMIN_USER'] } },
            select: { id: true },
          });
          if (!recipients.length) throw new NoActiveAdmins();
          await tx.userNotification.createMany({ data: recipients.map(({ id }) => ({
            userId: id, companyId: run.companyId, title: run.name, body: `Scheduled reminder for ${run.occurrence}.`, type: 'studio.scheduled',
          })) });
        }
        await tx.studioAutomationRun.update({
          where: { id: run.id, companyId: run.companyId },
          data: { status: stillEnabled ? 'DELIVERED' : 'CANCELLED', finishedAt: now, failureCode: null },
        });
      });
    } catch (error) {
      const attempts = run.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const failureCode = error instanceof NoActiveAdmins ? 'NO_ACTIVE_ADMINS' : 'DELIVERY_FAILED';
      // A concurrent successful delivery may have won after the rollback.
      await prisma.studioAutomationRun.updateMany({
        where: claim,
        data: {
          attempts, failureCode, status: exhausted ? 'DEAD_LETTER' : 'PENDING',
          nextAttemptAt: new Date(now.getTime() + FIRST_RETRY_MS * 2 ** (attempts - 1)),
          finishedAt: exhausted ? now : null,
        },
      });
    }
  }
}

export async function listStudioAutomationRuns(companyId: string) {
  if (!resolveDatabaseUrl()) return [];
  return prisma.studioAutomationRun.findMany({
    where: { companyId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 25,
    select: { id: true, name: true, occurrence: true, status: true, attempts: true, configVersion: true, failureCode: true, finishedAt: true },
  });
}

export function startStudioAutomationWorker(intervalMs = 60_000): void {
  if (timer || !resolveDatabaseUrl()) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      await enqueueStudioSchedules(now);
      await drainStudioAutomationRuns(now);
    } catch (error) {
      console.error('[studio-schedule] worker tick failed', error);
    } finally {
      running = false;
    }
  };
  void tick();
  timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
}
