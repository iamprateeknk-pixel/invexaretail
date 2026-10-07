import { useEffect, useState } from 'react';
import { useWorkspace } from '../WorkspaceContext';
import { useEntity360 } from '../../../hooks/useEntity360';
import { entityFromHash, relatedHref } from '../../../lib/entity-360';
import { formatDateTime } from '../../../lib/workspace';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback-states';

const KIND_LABEL = { lot: 'Lot', location: 'Location', transfer: 'Transfer', count: 'Count', user: 'User', item: 'Item', exception: 'Exception', 'count-task': 'Count task' };

/** One place to investigate a lot, location, transfer, count or person: what it is, what it touches, what happened. */
export function Entity360Page() {
  const { authToken } = useWorkspace();
  const [target, setTarget] = useState(() => entityFromHash(window.location.hash));
  useEffect(() => {
    const sync = () => setTarget(entityFromHash(window.location.hash));
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const { entity, status, error, refetch } = useEntity360({ authToken, type: target?.type, id: target?.id });

  if (!target) return <EmptyState title="Pick something to look at" description="Open a lot, location, transfer, count or person from a list to see everything about it in one place." />;
  if (status === 'loading' || status === 'idle') return <LoadingState label="Loading…" />;
  if (status === 'notfound') return <EmptyState title="Not found" description="This record does not exist, or you do not have access to it." />;
  if (status === 'error') return <ErrorState description={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline">{KIND_LABEL[entity.type] ?? entity.type}</Badge>
        <h2 className="mt-2 text-2xl font-semibold">{entity.title}</h2>
        <p className="text-sm text-muted-foreground">{entity.subtitle}</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            {entity.summary.map((row) => (
              <div key={row.label}><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="text-lg font-semibold">{row.value}</dd></div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Connected to</CardTitle></CardHeader>
          <CardContent>
            {entity.related.length ? (
              <ul className="space-y-2">
                {entity.related.map((row) => {
                  const href = relatedHref(row);
                  return (
                    <li key={`${row.kind}-${row.id}-${row.label}`} className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm">
                      <span className="min-w-0">
                        <span className="text-xs text-muted-foreground">{KIND_LABEL[row.kind] ?? row.kind} </span>
                        {href ? <a href={href} className="font-medium underline-offset-2 hover:underline">{row.label}</a> : <span className="font-medium">{row.label}</span>}
                      </span>
                      {row.detail && <span className="text-xs text-muted-foreground">{row.detail}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nothing else is connected to this yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">What happened</CardTitle></CardHeader>
          <CardContent>
            {entity.timeline.length ? (
              <ol className="space-y-3">
                {entity.timeline.map((event, index) => (
                  <li key={`${event.at}-${index}`} className="flex gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <div className="text-sm">
                      <p className="font-medium">{event.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}{event.detail ? ` · ${event.detail}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
