import { prisma } from './db.js';
import { expirySeverity, recommendedExpiryAction } from './expiry-alerts.js';
import { daysUntilExpiryDate } from './expiry-date.js';
import { expiryAlertId } from './expiry-lifecycle.js';
import { companyTimezone } from './timezone-context.js';
import { matchingLiveStudioRules, publishedLiveStudioRules } from './saas/live-studio-rules.js';

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
      if (!rules.length) continue;
      const timezone = companyTimezone(companyId);
      let afterId: string | undefined;
      while (true) {
        const rows = await prisma.stockLedger.findMany({
          where: {
            id: { gt: afterId }, companyId, onHand: { gt: 0 },
            item: { companyId }, location: { companyId },
            lot: { expiryDate: { not: null }, status: { in: ['AVAILABLE', 'EXPIRED'] } },
          },
          select: { id: true, itemId: true, lotId: true, locationId: true, onHand: true, lot: { select: { itemId: true, expiryDate: true } } },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
        });
        const tasks = rows.flatMap((row) => {
          if (row.lot.itemId !== row.itemId || !row.lot.expiryDate) return [];
          const days = daysUntilExpiryDate(row.lot.expiryDate, now, timezone);
          if (days === null) return [];
          const rule = matchingLiveStudioRules(rules, 'EXPIRY_SWEEP', days)[0];
          if (!rule) return [];
          return [{
            id: expiryAlertId(row.itemId, row.lotId, row.locationId), companyId,
            itemId: row.itemId, lotId: row.lotId, locationId: row.locationId, quantity: row.onHand,
            expiryDate: row.lot.expiryDate, daysUntilExpiry: days, recommendedAction: recommendedExpiryAction(days),
            metadata: { source: STUDIO_EXPIRY_SOURCE, ruleKey: rule.key, configVersion: version, versionId, severity: expirySeverity(days) },
          }];
        });
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
