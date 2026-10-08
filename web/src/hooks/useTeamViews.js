import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api-client.js';
import { readPersistedSession } from '../lib/session.js';
import { DEFAULT_TABLE_STATE, toTeamViews } from '../lib/table-state.js';

const SHARE_ROLES = new Set(['ADMIN', 'ADMIN_USER']);

/**
 * Views shared by an Admin with everyone in the same company. They live on the server (SavedView with
 * entityType `TABLE:<tableId>`), so unlike personal views (browser storage) they follow the team.
 * Returns null when there is no signed-in session, so a toolbar rendered without one stays local-only.
 */
export function useTeamViews(tableId, defaults = DEFAULT_TABLE_STATE) {
  const session = readPersistedSession();
  const token = session?.token;
  const [views, setViews] = useState([]);
  const [error, setError] = useState('');
  const entityType = `TABLE:${tableId}`;
  const headers = { Authorization: `Bearer ${token}` };

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await apiRequest(`/api/v1/saved-views?entityType=${encodeURIComponent(entityType)}`, { headers });
      setViews(toTeamViews(payload?.savedViews, defaults));
      setError('');
    } catch (cause) {
      setError(cause?.message || 'Could not load team views.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, entityType]);

  useEffect(() => { reload(); }, [reload]);

  if (!token) return null;
  const canShare = SHARE_ROLES.has(session?.user?.role);
  return {
    views,
    error,
    canShare,
    async share(name, state) {
      const { page: _page, ...rest } = state;
      await apiRequest('/api/v1/saved-views', { method: 'POST', headers, body: JSON.stringify({ name, entityType, filter: { ...rest, page: 1 }, isShared: true }) });
      await reload();
    },
    async remove(id) {
      await apiRequest(`/api/v1/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      await reload();
    },
  };
}
