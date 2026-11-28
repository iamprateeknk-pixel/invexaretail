import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, resolveDatabaseUrl } from '../db.js';
import { BUSINESS_TIMEZONE, validTimezone } from '../timezone-context.js';
import type { ScopeContext } from './control-plane.js';
import { enabledStudioAutomations, isStudioBusinessEvent, STUDIO_EVENT_MESSAGES } from './studio-automation-config.js';
import { scheduledStudioOccurrence } from './studio-schedule.js';
import { nearExpiryNotification } from './near-expiry-notification.js';
import { lowStockNotification, scanStudioLowStock } from './low-stock-notification.js';
import { lockStudioConfig } from './control-plane-repository.js';

const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 60_000;
let timer: NodeJS.Timeout | undefined;

class NoActiveAdmins extends Error {}

function taskCreationEnabled(): boolean {
  return process.env.ENABLE_STUDIO_AUTOMATION_TASKS === 'true';
}

async function runIsEnabled(tx: Prisma.TransactionClient, run: { companyId: string; automationKey: string; expression: string; actionKey: string }): Promise<boolean> {
  const current = await tx.controlPlaneConfig.findFirst({
    where: { companyId: run.companyId, kind: 'published', status: 'published' },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { payload: true },
  });
  const [lifecycle] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM "ControlPlaneCompany" WHERE id = ${run.companyId} FOR SHARE
  `;
  return lifecycle?.status !== 'suspended' &&
    enabledStudioAutomations(current?.payload).some((item) => item.key === run.automationKey && item.expression === run.expression && item.actionKey === run.actionKey);
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
      const schedules = enabledStudioAutomations(config.payload).filter((entry) => entry.trigger === 'schedule');
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
          companyId: config.companyId, automationKey: automation.key, name: automation.name, actionKey: automation.actionKey, expression: automation.expression, occurrence,
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
    where: {
      status: 'PENDING', nextAttemptAt: { lte: now },
      ...(taskCreationEnabled() ? {} : { actionKey: 'SEND_NOTIFICATION' }),
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: 50,
  });
  for (const run of due) {
    const claim = { id: run.id, companyId: run.companyId, status: 'PENDING', attempts: run.attempts, nextAttemptAt: run.nextAttemptAt };
    try {
      await prisma.$transaction(async (tx) => {
        await lockStudioConfig(tx, run.companyId, 'shared');
        // Hold the claim through notification insertion and completion. A crash rolls all three back.
        const claimed = await tx.studioAutomationRun.updateMany({ where: claim, data: { attempts: { increment: 1 } } });
        if (!claimed.count) return;
        const stillEnabled = await runIsEnabled(tx, run);
        let body: string | null = null;
        if (stillEnabled) {
          if (run.expression === 'inventory.low_stock') body = await lowStockNotification(tx, run);
          else if (run.expression === 'item.near_expiry') body = await nearExpiryNotification(tx, run, now);
          else body = isStudioBusinessEvent(run.expression) ? STUDIO_EVENT_MESSAGES[run.expression] : `Scheduled reminder for ${run.occurrence}.`;
        }
        if (body !== null) {
          const recipients = await tx.user.findMany({
            where: { companyId: run.companyId, status: 'ACTIVE', role: { in: ['ADMIN', 'ADMIN_USER'] } },
            select: { id: true }, orderBy: { id: 'asc' },
          });
          if (!recipients.length) throw new NoActiveAdmins();
          if (run.actionKey === 'CREATE_TASK') {
            const task = await tx.exceptionCase.create({ data: {
              companyId: run.companyId, type: 'AUTOMATION_TASK', title: run.name, description: body,
              reportedById: recipients[0].id, sourceDocument: run.id, dueAt: new Date(now.getTime() + 86_400_000),
              metadata: { source: 'studio', expression: run.expression, occurrence: run.occurrence, configVersion: run.configVersion },
            } });
            await tx.auditLog.create({ data: { actorId: 'system', actorRole: 'SYSTEM', action: 'STUDIO_TASK_CREATED',
              entityType: 'ExceptionCase', entityId: task.id, metadata: { studioTaskCompanyId: run.companyId, runId: run.id } } });
          } else {
            await tx.userNotification.createMany({ data: recipients.map(({ id }) => ({
              userId: id, companyId: run.companyId, title: run.name, body, type: 'studio.automation',
            })) });
          }
        }
        await tx.studioAutomationRun.update({
          where: { id: run.id, companyId: run.companyId },
          data: { status: body !== null ? 'DELIVERED' : 'CANCELLED', finishedAt: now, failureCode: null },
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
  const runs = await prisma.studioAutomationRun.findMany({
    where: { companyId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 25,
    select: { id: true, name: true, actionKey: true, expression: true, occurrence: true, createdAt: true, status: true, attempts: true, configVersion: true, failureCode: true, finishedAt: true },
  });
  const tasksPaused = !taskCreationEnabled();
  return runs.map((run) => ({ ...run, executionPaused: tasksPaused && run.status === 'PENDING' && run.actionKey === 'CREATE_TASK' }));
}

export async function retryStudioAutomationRun(scope: ScopeContext, id: string, finishedAt: Date, now = new Date()) {
  if (scope.sessionType !== 'control' || !scope.companyId) return 'forbidden' as const;
  const companyId = scope.companyId;
  if (!resolveDatabaseUrl()) return 'unavailable' as const;
  return prisma.$transaction(async (tx) => {
    await lockStudioConfig(tx, companyId, 'shared');
    const run = await tx.studioAutomationRun.findUnique({ where: { id, companyId } });
    if (!run) return 'missing' as const;
    if (run.status !== 'DEAD_LETTER' || run.finishedAt?.getTime() !== finishedAt.getTime()) return 'changed' as const;
    if (!await runIsEnabled(tx, run)) return 'disabled' as const;
    const retried = await tx.studioAutomationRun.updateMany({
      where: { id, companyId, status: 'DEAD_LETTER', finishedAt },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: now, finishedAt: null, failureCode: null },
    });
    if (!retried.count) return 'changed' as const;
    await tx.controlPlaneAudit.create({ data: {
      id: randomUUID(), actorUserId: scope.actorId, actorType: scope.actorType, tenantId: scope.tenantId,
      companyId, sessionId: scope.companySessionId, action: 'STUDIO_AUTOMATION_RETRIED',
      entityType: 'StudioAutomationRun', entityId: id,
      before: { status: run.status, attempts: run.attempts, failureCode: run.failureCode, finishedAt: finishedAt.toISOString() },
      after: { status: 'PENDING', nextAttemptAt: now.toISOString() }, timestamp: now.toISOString(),
    } });
    return 'queued' as const;
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
      await scanStudioLowStock(now).catch((error) => console.error('[studio-low-stock] scan unavailable', error));
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
