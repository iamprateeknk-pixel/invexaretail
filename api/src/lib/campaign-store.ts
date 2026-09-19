import type { CampaignItemRecord, CampaignRecord } from './stock-take-campaign.js';

// In-memory campaign state, hydrated from MySQL at startup and written
// through by lib/campaign-persistence.ts (same shape as lib/repository.ts).

export const campaigns: CampaignRecord[] = [];
export const campaignItems: CampaignItemRecord[] = [];

export function listCampaigns(companyId?: string): CampaignRecord[] {
  return campaigns.filter((row) => !companyId || row.companyId === companyId).map((row) => ({ ...row, userIds: [...row.userIds], priorityOrder: [...row.priorityOrder] }));
}

export function getCampaign(id: string): CampaignRecord | undefined {
  const row = campaigns.find((candidate) => candidate.id === id);
  return row ? { ...row, userIds: [...row.userIds], priorityOrder: [...row.priorityOrder] } : undefined;
}

export function saveCampaign(campaign: CampaignRecord): CampaignRecord {
  const stored = { ...campaign, userIds: [...campaign.userIds], priorityOrder: [...campaign.priorityOrder] };
  const index = campaigns.findIndex((candidate) => candidate.id === campaign.id);
  if (index === -1) campaigns.push(stored);
  else campaigns[index] = stored;
  return { ...stored };
}

export function listCampaignItems(campaignId: string): CampaignItemRecord[] {
  return campaignItems.filter((row) => row.campaignId === campaignId).map((row) => ({ ...row }));
}

export function saveCampaignItems(rows: CampaignItemRecord[]): void {
  for (const row of rows) {
    const index = campaignItems.findIndex((candidate) => candidate.campaignId === row.campaignId && candidate.itemId === row.itemId);
    if (index === -1) campaignItems.push({ ...row });
    else campaignItems[index] = { ...row };
  }
}

export function replaceCampaignState(nextCampaigns: CampaignRecord[], nextItems: CampaignItemRecord[]): void {
  campaigns.splice(0, campaigns.length, ...nextCampaigns);
  campaignItems.splice(0, campaignItems.length, ...nextItems);
}

export function resetCampaignStateForTests(): void {
  replaceCampaignState([], []);
}
