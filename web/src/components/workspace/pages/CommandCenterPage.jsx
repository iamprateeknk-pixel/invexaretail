import CommandCenter from '../../command/CommandCenter';
import { useWorkspace } from '../WorkspaceContext';

export function CommandCenterPage() {
  const { authToken, liveRevision, locations } = useWorkspace();
  const locationsById = new Map((locations ?? []).map((location) => [location.id, location]));
  return <CommandCenter token={authToken} liveRevision={liveRevision} locationsById={locationsById} />;
}
