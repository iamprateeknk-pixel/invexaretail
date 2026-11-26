import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/feedback-states';

export function StudioExpiryTasks({ authToken, locationId, role }) {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [reason, setReason] = useState('');
  const [refresh, setRefresh] = useState(0);
  const canAcknowledge = ['ADMIN', 'ADMIN_USER'].includes(role);
  const headers = { Authorization: `Bearer ${authToken}` };

  useEffect(() => {
    if (!authToken || !locationId) return undefined;
    let active = true;
    apiRequest(`/api/v1/expiry-alerts?locationId=${encodeURIComponent(locationId)}&source=studio`, {
      headers: { Authorization: `Bearer ${authToken}` },
    }).then(({ alerts }) => {
      if (active) {
        setTasks(alerts);
        setError('');
      }
    }).catch((caught) => { if (active) setError(caught.message); });
    return () => { active = false; };
  }, [authToken, locationId, refresh]);

  async function updateStatus(taskId, status) {
    setBusy(taskId);
    setError('');
    try {
      await apiRequest(`/api/v1/expiry-alerts/${encodeURIComponent(taskId)}/status`, {
        method: 'PATCH', headers, body: JSON.stringify(status === 'RESOLVED' ? { status, reason: reason.trim() } : { status }),
      });
      if (status === 'RESOLVED') {
        setTasks((current) => current.filter((task) => task.id !== taskId));
        setResolving(null);
        setReason('');
      } else {
        setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status } : task));
      }
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(null);
    }
  }

  if (!tasks.length && !error) return null;
  return (
    <section className="grid gap-2 rounded-lg border p-4" aria-label="Expiry tasks">
      <h2 className="text-base font-semibold">Expiry tasks</h2>
      {error && <ErrorState description={error} onRetry={() => setRefresh((version) => version + 1)} />}
      <ul className="divide-y">
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p className="font-medium">{task.item.name} · Lot {task.lot.lotNo}</p>
              <p className="text-sm text-muted-foreground">{task.recommendedAction}</p>
              <p className="text-sm" aria-live="polite">{task.status === 'ACKNOWLEDGED' ? 'Acknowledged' : 'Needs review'}</p>
            </div>
            {canAcknowledge && task.status === 'ACTIVE' && (
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => updateStatus(task.id, 'ACKNOWLEDGED')} aria-label={`Acknowledge expiry task for lot ${task.lot.lotNo}`}>
                {busy === task.id ? 'Saving…' : 'Acknowledge'}
              </Button>
            )}
            {canAcknowledge && task.status === 'ACKNOWLEDGED' && (
              resolving !== task.id
                ? <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => { setResolving(task.id); setReason(''); }}>Resolve</Button>
                : <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim().length >= 5) void updateStatus(task.id, 'RESOLVED');
                }}>
                  <label className="text-sm">Resolution reason<Input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} required /></label>
                  <Button type="submit" size="sm" disabled={reason.trim().length < 5 || busy !== null}>Confirm resolution</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setResolving(null)}>Cancel</Button>
                </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
