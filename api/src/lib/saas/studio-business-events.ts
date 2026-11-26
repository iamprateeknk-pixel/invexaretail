import type { Prisma } from '@prisma/client';
import { enabledStudioAutomations, type StudioBusinessEvent } from './studio-automation-config.js';

export function studioBusinessEventRun(
  config: { companyId: string; version: number; versionId: string },
  automation: { key: string; name: string },
  event: StudioBusinessEvent,
  entityId: string,
  now: Date,
): Prisma.StudioAutomationRunCreateManyInput {
  return {
    companyId: config.companyId, automationKey: automation.key, name: automation.name, expression: event,
    occurrence: `${event}:${entityId}`, configVersion: config.version, versionId: config.versionId, nextAttemptAt: now,
  };
}

/** Commit the configured notification runs together with the business record. */
export async function queueStudioBusinessEvent(tx: Prisma.TransactionClient, input: {
  event: StudioBusinessEvent;
  companyId: string;
  entityId: string;
}): Promise<void> {
  const { companyId, event, entityId } = input;
  const config = await tx.controlPlaneConfig.findFirst({
    where: { companyId, kind: 'published', status: 'published' },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { version: true, versionId: true, payload: true },
  });
  if (!config) return;
  const matches = enabledStudioAutomations(config.payload).filter((entry) => entry.trigger === 'event' && entry.expression === event);
  if (!matches.length) return;
  const now = new Date();
  await tx.studioAutomationRun.createMany({
    data: matches.map((automation) => studioBusinessEventRun({ ...config, companyId }, automation, event, entityId, now)),
    skipDuplicates: true,
  });
}
