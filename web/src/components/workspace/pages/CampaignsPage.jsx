import { StockTakeCampaigns } from '../../counts/StockTakeCampaigns';
import { useWorkspace } from '../WorkspaceContext';

// The automatic monthly stock take: set it up once and the daily counts are assigned by themselves.
export function CampaignsPage() {
  const { authToken, locations, storeUsers, locationId, campaignRevision } = useWorkspace();
  return <StockTakeCampaigns token={authToken} locations={locations} storeUsers={storeUsers} locationId={locationId} refreshKey={campaignRevision} />;
}
