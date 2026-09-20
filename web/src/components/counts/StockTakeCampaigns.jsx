import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api-client';
import {
  CAMPAIGN_ACTION_LABEL,
  campaignStatusMeta,
  describeRunResult,
  progressSegments,
  storeUsersForLocation,
  validateCampaignForm,
} from '../../lib/campaigns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY_FORM = { name: '', dailyItemsPerUser: '20', userIds: [], startDate: '', endDate: '', includeNewStock: true };

export function StockTakeCampaigns({ token, locations, storeUsers, locationId, refreshKey }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busyId, setBusyId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const headers = { Authorization: `Bearer ${token}` };
  const locationName = (id) => locations.find((location) => location.id === id)?.name ?? id;
  const eligibleUsers = storeUsersForLocation(storeUsers, locationId);
  const bump = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    apiRequest('/api/v1/campaigns', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) { setCampaigns(response.campaigns ?? []); setError(''); } })
      .catch((err) => { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load campaigns.'); })
      .finally(() => { if (mounted.current) setLoading(false); });
  }, [token, revision, refreshKey]);

  useEffect(() => {
    if (!expandedId) { setDetail(null); return; }
    apiRequest(`/api/v1/campaigns/${expandedId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (mounted.current) setDetail(response); })
      .catch(() => { if (mounted.current) setDetail(null); });
  }, [expandedId, token, revision, refreshKey]);

  async function send(path, options, busy) {
    setBusyId(busy);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest(path, { headers, ...options });
      if (mounted.current) bump();
      return response;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'The request failed.');
      return null;
    } finally {
      if (mounted.current) setBusyId('');
    }
  }

  async function create() {
    const checked = validateCampaignForm(form, locationId);
    if (!checked.ok) { setError(checked.errors.join(' ')); return; }
    const response = await send('/api/v1/campaigns', { method: 'POST', body: JSON.stringify(checked.payload) }, 'new');
    if (response) { setForm(EMPTY_FORM); setShowForm(false); setNotice('Campaign created as a draft. Activate it to start assigning work.'); }
  }

  async function act(campaign, action) {
    if (action === 'cancel' && !window.confirm(`Cancel "${campaign.name}"? Open count tasks will be withdrawn.`)) return;
    const body = action === 'run' ? JSON.stringify({}) : undefined;
    const response = await send(`/api/v1/campaigns/${campaign.id}/${action}`, { method: 'POST', body }, campaign.id);
    if (!response) return;
    if (action === 'activate') setNotice(describeRunResult(response.run));
    if (action === 'run') setNotice(describeRunResult(response.result));
  }

  async function reassign(campaign, fromUserId, toUserId) {
    const response = await send(`/api/v1/campaigns/${campaign.id}/reassign`, { method: 'POST', body: JSON.stringify({ fromUserId, ...(toUserId ? { toUserId } : {}) }) }, campaign.id);
    if (!response) return;
    const { moved, returnedToQueue } = response.result;
    setNotice(moved ? `Moved ${moved} task${moved === 1 ? '' : 's'}.` : `Returned ${returnedToQueue} task${returnedToQueue === 1 ? '' : 's'} to the queue.`);
  }

  function toggleUser(userId) {
    setForm((current) => ({
      ...current,
      userIds: current.userIds.includes(userId) ? current.userIds.filter((id) => id !== userId) : [...current.userIds, userId],
    }));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Stock-take campaigns</CardTitle>
          <p className="text-xs text-muted-foreground">Set a monthly count once - daily work is assigned automatically, unfinished tasks roll over, and coverage is tracked to 100%.</p>
        </div>
        <Button size="sm" variant={showForm ? 'outline' : 'default'} onClick={() => { setShowForm((value) => !value); setError(''); }}>
          {showForm ? 'Close' : 'New campaign'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</div>}
        {notice && <div role="status" className="rounded-lg border p-3 text-sm">{notice}</div>}

        {showForm && (
          <div className="grid gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">New campaign for {locationName(locationId)}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>Name</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. September full count" /></div>
              <div className="grid gap-1.5"><Label>Items per user per day</Label><Input type="number" min="1" max="500" value={form.dailyItemsPerUser} onChange={(event) => setForm({ ...form, dailyItemsPerUser: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Start date (optional)</Label><Input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label>End date (optional)</Label><Input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></div>
            </div>
            <div className="grid gap-1.5">
              <Label>Count workers who will count</Label>
              {eligibleUsers.length ? (
                <div className="flex flex-wrap gap-2">
                  {eligibleUsers.map((user) => (
                    <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                      <input type="checkbox" checked={form.userIds.includes(user.id)} onChange={() => toggleUser(user.id)} />
                      {user.name}
                    </label>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No store users or warehouse pickers are assigned to this location.</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.includeNewStock} onChange={(event) => setForm({ ...form, includeNewStock: event.target.checked })} />
              Add newly stocked items to the remaining queue
            </label>
            <p className="text-xs text-muted-foreground">Only items with stock at this location are counted. Never-counted items go first, then the longest since last counted, then higher-value and earlier-expiring items.</p>
            <div><Button onClick={create} disabled={busyId === 'new'}>Create draft</Button></div>
          </div>
        )}

        {loading ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading campaigns…</p>
          : !campaigns.length ? <p className="py-6 text-center text-sm text-muted-foreground">No campaigns yet. Create one to stop assigning counts item by item.</p>
          : campaigns.map((campaign) => {
            const meta = campaignStatusMeta(campaign.status);
            const progress = campaign.progress;
            const expanded = expandedId === campaign.id;
            return (
              <div key={campaign.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" className="text-left" onClick={() => setExpandedId(expanded ? '' : campaign.id)} aria-expanded={expanded}>
                    <p className="font-medium">{campaign.name} <Badge variant={meta.variant} className="ml-1.5">{meta.label}</Badge></p>
                    <p className="text-xs text-muted-foreground">
                      {locationName(campaign.locationId)} · {campaign.dailyItemsPerUser}/user/day · {campaign.userIds.length} user{campaign.userIds.length === 1 ? '' : 's'}
                      {campaign.endDate ? ` · ends ${campaign.endDate}` : ''}
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    {meta.actions.map((action) => (
                      <Button key={action} size="sm" variant={action === 'cancel' ? 'outline' : action === 'run' ? 'secondary' : 'default'} disabled={busyId === campaign.id} onClick={() => act(campaign, action)}>
                        {CAMPAIGN_ACTION_LABEL[action]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.coveragePercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${campaign.name} coverage`}>
                    <div className="h-full bg-primary transition-all" style={{ width: `${campaign.status === 'DRAFT' ? 0 : progress.coveragePercent}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {campaign.status === 'DRAFT'
                      ? 'Not started - the item queue is built from current stock when you activate.'
                      : `${progress.covered} of ${progress.eligible} items covered (${progress.coveragePercent}%)${progressSegments(progress).map((segment) => ` · ${segment.label} ${segment.count}`).join('')}`}
                  </p>
                </div>

                {expanded && (
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">Workload by user</p>
                    {!detail ? <p className="text-xs text-muted-foreground">Loading…</p> : detail.workload.map((row) => (
                      <div key={row.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium">{row.name}</span>
                          {!row.available && <Badge variant="warning" className="ml-2">Unavailable</Badge>}
                          <span className="ml-2 text-xs text-muted-foreground">{row.open} open · {row.submitted} in review · {row.recount} recount · {row.approved} done</span>
                        </div>
                        {row.open > 0 && campaign.status !== 'COMPLETED' && campaign.status !== 'CANCELLED' && (
                          <select
                            aria-label={`Reassign ${row.name}'s open work`}
                            className="h-8 rounded-md border bg-background px-2 text-xs"
                            defaultValue=""
                            disabled={busyId === campaign.id}
                            onChange={(event) => {
                              const value = event.target.value;
                              event.target.value = '';
                              if (value) reassign(campaign, row.userId, value === '__queue__' ? '' : value);
                            }}
                          >
                            <option value="">Reassign open work…</option>
                            <option value="__queue__">Return to queue (absent)</option>
                            {storeUsersForLocation(storeUsers, campaign.locationId).filter((other) => other.id !== row.userId).map((other) => (
                              <option key={other.id} value={other.id}>Move to {other.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
