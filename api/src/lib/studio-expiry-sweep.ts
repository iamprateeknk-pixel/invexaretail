import { prisma } from './db.js';
import { expirySeverity, recommendedExpiryAction } from './expiry-alerts.js';
import { expiryDayNumber, todayDayNumber } from './expiry-date.js';
import { expiryAlertId } from './expiry-lifecycle.js';
import { companyTimezone } from './timezone-context.js';
import { matchingLiveStudioRules, publishedLiveStudioRules } from './saas/live-studio-rules.js';
import { enabledStudioAutomations } from './saas/studio-automation-config.js';
import { studioBusinessEventRun } from './saas/studio-business-events.js';
import { NEAR_EXPIRY_DAYS } from './saas/near-expiry-notification.js';

export const STUDIO_EXPIRY_SOURCE = 'STUDIO_EXPIRY_RULE';
const PAGE_SIZE = 250;

export async function sweepStudioExpiryTasks(now: Date): Promise<void> {
  const configs = await prisma.controlPlaneConfig.findMany({
    where: { kind: 'published', status: 'published' },
    distinct: ['companyId'],
    orderBy: [{ companyId: 'asc' }, { version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
    select: { companyId: true, versionId: true, version: true, payload: true },
  });
  for (const config of configs) {
    const { companyId, versionId, version } = config;
    try {
      const rules = publishedLiveStudioRules(config.payload, 'EXPIRY_SWEEP');
      const reminders = enabledStudioAutomations(config.payload).filter((automation) => automation.trigger === 'event' && automation.expression === 'item.near_expiry');
      if (!rules.length && !reminders.length) continue;
      const timezone = companyTimezone(companyId);
      const today = todayDayNumber(now, timezone);
      const expiryFilter = rules.length ? { not: null } : {
        gte: new Date(today * 86_400_000), lt: new Date((today + NEAR_EXPIRY_DAYS + 1) * 86_400_000),
      };
      let afterId: string | undefined;
      while (true) {
        const rows = await prisma.stockLedger.findMany({
          where: {
            id: { gt: afterId }, companyId, onHand: { gt: 0 },
            item: { companyId }, location: { companyId },
            lot: { expiryDate: expiryFilter, status: { in: ['AVAILABLE', 'EXPIRED'] } },
          },
          select: { id: true, itemId: true, lotId: true, locationId: true, onHand: true, lot: { select: { itemId: true, expiryDate: true, status: true } } },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
        });
        const candidates = rows.flatMap((row) => {
          if (row.lot.itemId !== row.itemId || !row.lot.expiryDate) return [];
          const expiryDay = expiryDayNumber(row.lot.expiryDate);
          return expiryDay === null ? [] : [{ row, expiryDate: row.lot.expiryDate, days: expiryDay - today }];
        });
        const tasks = candidates.flatMap(({ row, expiryDate, days }) => {
          const rule = matchingLiveStudioRules(rules, 'EXPIRY_SWEEP', days)[0];
          if (!rule) return [];
          return [{
            id: expiryAlertId(row.itemId, row.lotId, row.locationId), companyId,
            itemId: row.itemId, lotId: row.lotId, locationId: row.locationId, quantity: row.onHand,
            expiryDate, daysUntilExpiry: days, recommendedAction: recommendedExpiryAction(days),
            metadata: { source: STUDIO_EXPIRY_SOURCE, ruleKey: rule.key, configVersion: version, versionId, severity: expirySeverity(days) },
          }];
        });
        const notifications = candidates.flatMap(({ row, expiryDate, days }) => {
          if (row.lot.status !== 'AVAILABLE' || days < 0 || days > NEAR_EXPIRY_DAYS) return [];
          const key = JSON.stringify([row.itemId, row.lotId, row.locationId, expiryDate.toISOString().slice(0, 10)]);
          return reminders.map((reminder) => studioBusinessEventRun(config, reminder, 'item.near_expiry', key, now));
        });
        if (notifications.length) await prisma.studioAutomationRun.createMany({ data: notifications, skipDuplicates: true });
        if (tasks.length) {
          await prisma.$transaction(async (tx) => {
            const created = await tx.expiryAlert.createManyAndReturn({ data: tasks, skipDuplicates: true, select: { id: true, metadata: true, locationId: true } });
            if (created.length) {
              await tx.auditLog.createMany({ data: created.map((task) => ({
                actorId: 'system', actorRole: 'SYSTEM', action: 'STUDIO_EXPIRY_TASK_CREATED',
                entityType: 'ExpiryAlert', entityId: task.id,
                metadata: { companyId, locationId: task.locationId, policy: task.metadata },
              })) });
            }
          });
        }
        if (rows.length < PAGE_SIZE) break;
        afterId = rows.at(-1)?.id;
      }
    } catch (error) {
      console.error('[studio-expiry-sweep] company scan failed', { companyId, versionId, error });
    }
  }
}
