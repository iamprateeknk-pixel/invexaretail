import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { withDistributedLock } from '../distributed-lock.js';
import { enabledStudioAutomations } from './studio-automation-config.js';
import { studioBusinessEventRun } from './studio-business-events.js';

const EVENT = 'inventory.low_stock';
const PAGE_SIZE = 200;
const stockKey = (itemId: string, locationId: string) => JSON.stringify([itemId, locationId]);

export async function scanStudioLowStock(now: Date): Promise<void> {
  await withDistributedLock('studio-low-stock', async () => {
    const configs = await prisma.controlPlaneConfig.findMany({
      where: { kind: 'published', status: 'published' },
      distinct: ['companyId'],
      orderBy: [{ companyId: 'asc' }, { version: 'desc' }, { updatedAt: 'desc' }, { versionId: 'asc' }],
      select: { companyId: true, version: true, versionId: true, payload: true },
    });
    for (const config of configs) {
      const { companyId } = config;
      const reminders = enabledStudioAutomations(config.payload).filter((entry) => entry.trigger === 'event' && entry.expression === EVENT);
      if (!reminders.length) continue;
      try {
        const company = await prisma.controlPlaneCompany.findUnique({ where: { id: companyId }, select: { status: true } });
        if (company?.status === 'suspended') continue;
        let after: string | undefined;
        while (true) {
          const rules = await prisma.reorderRule.findMany({
            where: { id: { gt: after }, companyId, item: { companyId } },
            orderBy: { id: 'asc' }, take: PAGE_SIZE, select: { id: true, itemId: true, locationId: true, minQty: true },
          });
          if (!rules.length) break;
          await prisma.$transaction(async (tx) => {
            const locations = new Set((await tx.location.findMany({
              where: { companyId, id: { in: rules.map((rule) => rule.locationId) } }, select: { id: true },
            })).map(({ id }) => id));
            const scopedRules = rules.filter((rule) => locations.has(rule.locationId));
            if (!scopedRules.length) return;
            const stock = await tx.stockLedger.groupBy({
              by: ['itemId', 'locationId'],
              where: { companyId, OR: scopedRules.map(({ itemId, locationId }) => ({ itemId, locationId })) },
              _sum: { onHand: true },
            });
            const totals = new Map(stock.map((row) => [stockKey(row.itemId, row.locationId), row._sum.onHand]));
            const states = new Map((await tx.studioLowStockState.findMany({
              where: { companyId, ruleId: { in: scopedRules.map((rule) => rule.id) } },
            })).map((row) => [row.ruleId, row.episodeId]));
            const ended: string[] = [];
            const opened: Prisma.StudioLowStockStateCreateManyInput[] = [];
            const notifications: Prisma.StudioAutomationRunCreateManyInput[] = [];
            for (const rule of scopedRules) {
              const episode = states.get(rule.id);
              const isLow = rule.minQty.gte(totals.get(stockKey(rule.itemId, rule.locationId)) ?? 0);
              if (!isLow && episode) ended.push(rule.id);
              if (!isLow || episode) continue;
              const episodeId = randomUUID();
              opened.push({ companyId, ruleId: rule.id, episodeId });
              notifications.push(...reminders.map((reminder) => studioBusinessEventRun(config, reminder, EVENT, JSON.stringify([rule.id, episodeId]), now)));
            }
            if (ended.length) await tx.studioLowStockState.updateMany({ where: { companyId, ruleId: { in: ended } }, data: { episodeId: null } });
            for (const state of opened) {
              await tx.studioLowStockState.upsert({
                where: { companyId_ruleId: { companyId, ruleId: state.ruleId } },
                create: state, update: { episodeId: state.episodeId },
              });
            }
            if (notifications.length) await tx.studioAutomationRun.createMany({ data: notifications, skipDuplicates: true });
          }, { timeout: 30_000 });
          if (rules.length < PAGE_SIZE) break;
          after = rules.at(-1)?.id;
        }
      } catch (error) {
        console.error('[studio-low-stock] scan failed', { companyId, error });
      }
    }
  });
}

export async function lowStockNotification(tx: Prisma.TransactionClient, run: { companyId: string; occurrence: string }): Promise<string | null> {
  const occurrence: unknown = JSON.parse(run.occurrence.slice(`${EVENT}:`.length));
  if (!Array.isArray(occurrence) || occurrence.length !== 2 || occurrence.some((part) => typeof part !== 'string')) return null;
  const [ruleId, episodeId] = occurrence as string[];
  const { companyId } = run;
  const state = await tx.studioLowStockState.findUnique({ where: { companyId_ruleId: { companyId, ruleId } } });
  if (state?.episodeId !== episodeId) return null;
  const rule = await tx.reorderRule.findFirst({
    where: { id: ruleId, companyId, item: { companyId } },
    select: { itemId: true, locationId: true, minQty: true, item: { select: { name: true } } },
  });
  if (!rule) return null;
  const location = await tx.location.findFirst({ where: { id: rule.locationId, companyId }, select: { name: true } });
  if (!location) return null;
  const stock = await tx.stockLedger.aggregate({ where: { companyId, itemId: rule.itemId, locationId: rule.locationId }, _sum: { onHand: true } });
  const onHand = stock._sum.onHand ?? 0;
  if (!rule.minQty.gte(onHand)) return null;
  return `${rule.item.name} at ${location.name} has ${onHand} on hand. The reorder minimum is ${rule.minQty}.`;
}
