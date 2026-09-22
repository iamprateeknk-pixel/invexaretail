"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignItems = exports.campaigns = void 0;
exports.listCampaigns = listCampaigns;
exports.getCampaign = getCampaign;
exports.saveCampaign = saveCampaign;
exports.listCampaignItems = listCampaignItems;
exports.saveCampaignItems = saveCampaignItems;
exports.replaceCampaignState = replaceCampaignState;
exports.resetCampaignStateForTests = resetCampaignStateForTests;
// In-memory campaign state, hydrated from the database at startup and written
// through by lib/campaign-persistence.ts (same shape as lib/repository.ts).
exports.campaigns = [];
exports.campaignItems = [];
function listCampaigns(companyId) {
    return exports.campaigns.filter((row) => !companyId || row.companyId === companyId).map((row) => ({ ...row, userIds: [...row.userIds], priorityOrder: [...row.priorityOrder] }));
}
function getCampaign(id) {
    const row = exports.campaigns.find((candidate) => candidate.id === id);
    return row ? { ...row, userIds: [...row.userIds], priorityOrder: [...row.priorityOrder] } : undefined;
}
function saveCampaign(campaign) {
    const stored = { ...campaign, userIds: [...campaign.userIds], priorityOrder: [...campaign.priorityOrder] };
    const index = exports.campaigns.findIndex((candidate) => candidate.id === campaign.id);
    if (index === -1)
        exports.campaigns.push(stored);
    else
        exports.campaigns[index] = stored;
    return { ...stored };
}
function listCampaignItems(campaignId) {
    return exports.campaignItems.filter((row) => row.campaignId === campaignId).map((row) => ({ ...row }));
}
function saveCampaignItems(rows) {
    for (const row of rows) {
        const index = exports.campaignItems.findIndex((candidate) => candidate.campaignId === row.campaignId && candidate.itemId === row.itemId);
        if (index === -1)
            exports.campaignItems.push({ ...row });
        else
            exports.campaignItems[index] = { ...row };
    }
}
function replaceCampaignState(nextCampaigns, nextItems) {
    exports.campaigns.splice(0, exports.campaigns.length, ...nextCampaigns);
    exports.campaignItems.splice(0, exports.campaignItems.length, ...nextItems);
}
function resetCampaignStateForTests() {
    replaceCampaignState([], []);
}
