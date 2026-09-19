import { counterBadges } from '../../lib/import-center';
import { Badge } from '@/components/ui/badge';

// Blueprint v4 §10.1: rejected rows broken down by why (unmatched item /
// branch / lot, archived item, other) so a file can be fixed quickly.
export function CounterBadges({ counters }) {
  const badges = counterBadges(counters);
  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Rejected rows by reason">
      <span className="text-muted-foreground">Rejected rows:</span>
      {badges.map((badge) => <Badge key={badge.label} variant="destructive">{badge.label} {badge.count}</Badge>)}
    </div>
  );
}
