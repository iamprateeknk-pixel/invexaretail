import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { replaceCampaignState } from './campaign-store.js';
import type { CampaignItemRecord, CampaignRecord, CampaignItemStatus, CampaignStatus, PriorityKey } from './stock-take-campaign.js';

const CHUNK = 200;

const toDate = (value?: string) => (value ? new Date(value) : null);
const toIso = (value: Date | null | undefined) => value?.toISOString();

export async function persistCampaign(campaign: CampaignRecord): Promise<void> {
  if (!databaseEnabled) return;
  const data = {
    companyId: campaign.companyId,
    name: campaign.name,
    locationId: campaign.locationId,
    status: campaign.status,
    dailyItemsPerUser: campaign.dailyItemsPerUser,
    userIds: campaign.userIds as unknown as Prisma.InputJsonValue,
    priorityOrder: campaign.priorityOrder as unknown as Prisma.InputJsonValue,
    includeNewStock: campaign.includeNewStock,
    timezone: campaign.timezone,
    startDate: campaign.startDate,
    endDate: campaign.endDate ?? null,
    lastRunDate: campaign.lastRunDate ?? null,
    pausedFrom: campaign.pausedFrom ?? null,
    createdById: campaign.createdById,
    activatedAt: toDate(campaign.activatedAt),
    completedAt: toDate(campaign.completedAt),
    cancelledAt: toDate(campaign.cancelledAt),
  };
  await prisma.stockTakeCampaign.upsert({
    where: { id: campaign.id },
    update: data,
    create: { id: campaign.id, createdAt: new Date(campaign.createdAt), ...data },
  });
}

export async function persistCampaignItems(rows: CampaignItemRecord[]): Promise<void> {
  if (!databaseEnabled || !rows.length) return;
  for (let start = 0; start < rows.length; start += CHUNK) {
    await prisma.$transaction(rows.slice(start, start + CHUNK).map((row) => {
      const data = {
        status: row.status,
        excludedReason: row.excludedReason ?? null,
        assignedToId: row.assignedToId ?? null,
        assignmentId: row.assignmentId ?? null,
        countId: row.countId ?? null,
        assignedDate: toDate(row.assignedDate),
        lastCountedAt: toDate(row.lastCountedAt),
        recounts: row.recounts,
      };
      return prisma.stockTakeCampaignItem.upsert({
        where: { campaignId_itemId: { campaignId: row.campaignId, itemId: row.itemId } },
        update: data,
        create: { campaignId: row.campaignId, itemId: row.itemId, addedAt: new Date(row.addedAt), ...data },
      });
    }));
  }
}

export async function hydrateCampaignsFromDatabase(): Promise<void> {
  if (!databaseEnabled) return;
  const [dbCampaigns, dbItems] = await Promise.all([
    prisma.stockTakeCampaign.findMany(),
    prisma.stockTakeCampaignItem.findMany(),
  ]);
  replaceCampaignState(
    dbCampaigns.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      locationId: row.locationId,
      status: row.status as CampaignStatus,
      dailyItemsPerUser: row.dailyItemsPerUser,
      userIds: row.userIds as string[],
      priorityOrder: row.priorityOrder as PriorityKey[],
      includeNewStock: row.includeNewStock,
      timezone: row.timezone,
      startDate: row.startDate,
      endDate: row.endDate ?? undefined,
      lastRunDate: row.lastRunDate ?? undefined,
      pausedFrom: (row.pausedFrom as CampaignStatus | null) ?? undefined,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      activatedAt: toIso(row.activatedAt),
      completedAt: toIso(row.completedAt),
      cancelledAt: toIso(row.cancelledAt),
    })),
    dbItems.map((row) => ({
      campaignId: row.campaignId,
      itemId: row.itemId,
      status: row.status as CampaignItemStatus,
      excludedReason: row.excludedReason ?? undefined,
      assignedToId: row.assignedToId ?? undefined,
      assignmentId: row.assignmentId ?? undefined,
      countId: row.countId ?? undefined,
      assignedDate: toIso(row.assignedDate),
      lastCountedAt: toIso(row.lastCountedAt),
      recounts: row.recounts,
      addedAt: row.addedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  );
}
