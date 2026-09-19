"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistCampaign = persistCampaign;
exports.persistCampaignItems = persistCampaignItems;
exports.hydrateCampaignsFromDatabase = hydrateCampaignsFromDatabase;
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
const campaign_store_js_1 = require("./campaign-store.js");
const CHUNK = 200;
const toDate = (value) => (value ? new Date(value) : null);
const toIso = (value) => value?.toISOString();
async function persistCampaign(campaign) {
    if (!persistence_js_1.databaseEnabled)
        return;
    const data = {
        companyId: campaign.companyId,
        name: campaign.name,
        locationId: campaign.locationId,
        status: campaign.status,
        dailyItemsPerUser: campaign.dailyItemsPerUser,
        userIds: campaign.userIds,
        priorityOrder: campaign.priorityOrder,
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
    await db_js_1.prisma.stockTakeCampaign.upsert({
        where: { id: campaign.id },
        update: data,
        create: { id: campaign.id, createdAt: new Date(campaign.createdAt), ...data },
    });
}
async function persistCampaignItems(rows) {
    if (!persistence_js_1.databaseEnabled || !rows.length)
        return;
    for (let start = 0; start < rows.length; start += CHUNK) {
        await db_js_1.prisma.$transaction(rows.slice(start, start + CHUNK).map((row) => {
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
            return db_js_1.prisma.stockTakeCampaignItem.upsert({
                where: { campaignId_itemId: { campaignId: row.campaignId, itemId: row.itemId } },
                update: data,
                create: { campaignId: row.campaignId, itemId: row.itemId, addedAt: new Date(row.addedAt), ...data },
            });
        }));
    }
}
async function hydrateCampaignsFromDatabase() {
    if (!persistence_js_1.databaseEnabled)
        return;
    const [dbCampaigns, dbItems] = await Promise.all([
        db_js_1.prisma.stockTakeCampaign.findMany(),
        db_js_1.prisma.stockTakeCampaignItem.findMany(),
    ]);
    (0, campaign_store_js_1.replaceCampaignState)(dbCampaigns.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        name: row.name,
        locationId: row.locationId,
        status: row.status,
        dailyItemsPerUser: row.dailyItemsPerUser,
        userIds: row.userIds,
        priorityOrder: row.priorityOrder,
        includeNewStock: row.includeNewStock,
        timezone: row.timezone,
        startDate: row.startDate,
        endDate: row.endDate ?? undefined,
        lastRunDate: row.lastRunDate ?? undefined,
        pausedFrom: row.pausedFrom ?? undefined,
        createdById: row.createdById,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        activatedAt: toIso(row.activatedAt),
        completedAt: toIso(row.completedAt),
        cancelledAt: toIso(row.cancelledAt),
    })), dbItems.map((row) => ({
        campaignId: row.campaignId,
        itemId: row.itemId,
        status: row.status,
        excludedReason: row.excludedReason ?? undefined,
        assignedToId: row.assignedToId ?? undefined,
        assignmentId: row.assignmentId ?? undefined,
        countId: row.countId ?? undefined,
        assignedDate: toIso(row.assignedDate),
        lastCountedAt: toIso(row.lastCountedAt),
        recounts: row.recounts,
        addedAt: row.addedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    })));
}
