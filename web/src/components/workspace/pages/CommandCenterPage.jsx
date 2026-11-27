import CommandCenter from '../../command/CommandCenter';
import { useWorkspace } from '../WorkspaceContext';
import { canAccessSection } from '../../../lib/permissions';
import { Button } from '@/components/ui/button';

const DAILY_QUEUES = [
  ['import-wizard', 'Import ERP files'],
  ['approvals', 'Review approvals'],
  ['exceptions', 'Open exception inbox'],
];

export function CommandCenterPage() {
  const { authToken, liveRevision, locations, role, hiddenModules, navigateTo } = useWorkspace();
  const locationsById = new Map((locations ?? []).map((location) => [location.id, location]));
  const queues = DAILY_QUEUES.filter(([section]) => canAccessSection(section, { role, hiddenModules }));
  return (
    <div className="space-y-4">
      {queues.length > 0 && <div role="group" aria-label="Operational queues" className="flex flex-wrap gap-2">
        {queues.map(([section, label]) => <Button key={section} type="button" variant="outline" onClick={() => navigateTo(section)}>{label}</Button>)}
      </div>}
      <CommandCenter token={authToken} liveRevision={liveRevision} locationsById={locationsById} />;
    </div>
  );
}
