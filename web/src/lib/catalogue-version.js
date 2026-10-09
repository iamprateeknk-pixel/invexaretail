import { apiRequest } from './api-client.js';

// The full catalogue (GET /items) is large (about 24 MB at 20,000 items). Almost every refresh finds it unchanged,
// so we ask the server for a cheap version first and refetch the catalogue only when that version moved.
// The version is read BEFORE the catalogue, so a change that lands in between is picked up on the next check
// instead of being hidden behind a version newer than the data we hold.

/** The server's catalogue version, or null when unknown (memory mode, an older server, a failed request). */
export async function fetchCatalogueVersion(headers) {
  try {
    const response = await apiRequest('/api/v1/items/version', { headers });
    return typeof response?.version === 'string' ? response.version : null;
  } catch {
    return null;
  }
}

/**
 * Decides whether the catalogue must be refetched.
 * Returns { items: null, version } when the held copy is still current, otherwise { items, version }.
 * A null version (unknown) always refetches, which is exactly how it behaved before versions existed.
 */
export async function loadCatalogueIfChanged({ lastVersion, fetchVersion, fetchItems }) {
  const version = await fetchVersion();
  if (version !== null && lastVersion !== null && version === lastVersion) return { items: null, version };
  return { items: await fetchItems(), version };
}
