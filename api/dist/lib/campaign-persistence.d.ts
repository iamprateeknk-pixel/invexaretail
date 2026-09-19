import type { CampaignItemRecord, CampaignRecord } from './stock-take-campaign.js';
export declare function persistCampaign(campaign: CampaignRecord): Promise<void>;
export declare function persistCampaignItems(rows: CampaignItemRecord[]): Promise<void>;
export declare function hydrateCampaignsFromDatabase(): Promise<void>;
