// Plan P0-SYNC-002: the web app no longer keeps an offline write queue (see
// lib/offline-policy.js). This module only removes what older versions left
// behind. Those rows were a single global list with no user or company on them,
// so they could not be replayed safely and are discarded, once, at startup.
const LEGACY_DB_NAME = 'invexaretail_offline';
const LEGACY_SYNC_STORE = 'pending_sync';

/** Deletes the legacy offline database and returns how many unsent changes it held (0 when there was none). */
export const purgeLegacyOfflineQueue = (): Promise<number> => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    let count = 0;
    const open = indexedDB.open(LEGACY_DB_NAME);
    open.onerror = () => resolve(0);
    open.onupgradeneeded = () => {
      // The database did not exist: opening created an empty one. Remove it again below.
    };
    open.onsuccess = () => {
      const db = open.result;
      const finish = () => {
        db.close();
        const deletion = indexedDB.deleteDatabase(LEGACY_DB_NAME);
        deletion.onsuccess = () => resolve(count);
        deletion.onerror = () => resolve(count);
        deletion.onblocked = () => resolve(count);
      };
      if (!db.objectStoreNames.contains(LEGACY_SYNC_STORE)) { finish(); return; }
      const request = db.transaction([LEGACY_SYNC_STORE], 'readonly').objectStore(LEGACY_SYNC_STORE).count();
      request.onsuccess = () => { count = request.result; finish(); };
      request.onerror = () => finish();
    };
  });
};
