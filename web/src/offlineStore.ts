const DB_NAME = 'invexaretail_offline';
const DB_VERSION = 1;
const SYNC_STORE = 'pending_sync';
const DATA_STORE = 'cached_data';

interface SyncAction {
  id: string;
  type: 'count' | 'transfer' | 'assignment' | 'import';
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH';
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

interface CachedData {
  key: string;
  value: unknown;
  timestamp: number;
}

let db: IDBDatabase | null = null;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const newDb = (event.target as IDBOpenDBRequest).result;

      if (!newDb.objectStoreNames.contains(SYNC_STORE)) {
        newDb.createObjectStore(SYNC_STORE, { keyPath: 'id' });
      }

      if (!newDb.objectStoreNames.contains(DATA_STORE)) {
        newDb.createObjectStore(DATA_STORE, { keyPath: 'key' });
      }
    };
  });
};

export const addSyncAction = async (action: Omit<SyncAction, 'id' | 'timestamp' | 'retries'>): Promise<string> => {
  const database = await initDB();
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const syncAction: SyncAction = {
    ...action,
    id,
    timestamp: Date.now(),
    retries: 0,
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SYNC_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_STORE);
    const request = store.add(syncAction);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(id);
  });
};

export const getPendingSyncActions = async (): Promise<SyncAction[]> => {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SYNC_STORE], 'readonly');
    const store = transaction.objectStore(SYNC_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const actions = (request.result as SyncAction[]).sort((a, b) => a.timestamp - b.timestamp);
      resolve(actions);
    };
  });
};

export const removeSyncAction = async (id: string): Promise<void> => {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SYNC_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_STORE);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

export const updateSyncActionRetries = async (id: string, retries: number): Promise<void> => {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SYNC_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const action = getRequest.result as SyncAction;
      if (action) {
        action.retries = retries;
        const updateRequest = store.put(action);
        updateRequest.onerror = () => reject(updateRequest.error);
        updateRequest.onsuccess = () => resolve();
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
};

export const cacheData = async (key: string, value: unknown): Promise<void> => {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DATA_STORE], 'readwrite');
    const store = transaction.objectStore(DATA_STORE);
    const data: CachedData = { key, value, timestamp: Date.now() };
    const request = store.put(data);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

export const getCachedData = async (key: string): Promise<unknown | null> => {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DATA_STORE], 'readonly');
    const store = transaction.objectStore(DATA_STORE);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const data = request.result as CachedData | undefined;
      resolve(data ? data.value : null);
    };
  });
};

export const clearAllSyncActions = async (): Promise<void> => {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SYNC_STORE], 'readwrite');
    const store = transaction.objectStore(SYNC_STORE);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};
