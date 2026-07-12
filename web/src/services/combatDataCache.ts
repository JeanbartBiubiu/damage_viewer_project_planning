import type { CombatDataGraph } from '../types/combatData';

export const combatDataCacheDescriptor = {
  dbName: 'combat_data_db',
  dbVersion: 1,
  storeName: 'graphs'
} as const;

type StoredGraphRecord = {
  cacheKey: string;
  gameId: string;
  revision: number;
  cachedAt: string;
  graphJson: string;
};

function buildCacheKey(gameId: string, revision: number): string {
  return `${gameId}::${revision}`;
}

export async function readCombatDataGraphCache(
  gameId: string,
  revision: number
): Promise<CombatDataGraph | null> {
  const cacheKey = buildCacheKey(gameId, revision);

  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(combatDataCacheDescriptor.storeName, 'readonly');
    const store = transaction.objectStore(combatDataCacheDescriptor.storeName);
    const request = store.get(cacheKey);

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read combat-data cache.'));
      db.close();
    };

    request.onsuccess = () => {
      const stored = (request.result as StoredGraphRecord | undefined) ?? null;
      resolve(parseStoredGraph(stored));
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Failed to read combat-data cache transaction.'));
      db.close();
    };
  });
}

export async function writeCombatDataGraphCache(graph: CombatDataGraph): Promise<void> {
  const cacheKey = buildCacheKey(graph.gameId, graph.currentRevision);
  const graphJson = JSON.stringify(graph);
  const record: StoredGraphRecord = {
    cacheKey,
    gameId: graph.gameId,
    revision: graph.currentRevision,
    cachedAt: new Date().toISOString(),
    graphJson
  };

  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(combatDataCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(combatDataCacheDescriptor.storeName);
    store.put(record);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Failed to write combat-data cache.'));
      db.close();
    };
  });
}

/**
 * Clear cached graphs. When gameId is provided, only that game's entries are removed.
 */
export async function clearCombatDataGraphCache(gameId?: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(combatDataCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(combatDataCacheDescriptor.storeName);

    if (!gameId) {
      store.clear();
    } else {
      const index = store.index('gameId');
      const request = index.openCursor(IDBKeyRange.only(gameId));

      request.onerror = () => {
        reject(request.error ?? new Error('Failed to clear combat-data cache.'));
      };

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Failed to clear combat-data cache transaction.'));
      db.close();
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(combatDataCacheDescriptor.dbName, combatDataCacheDescriptor.dbVersion);

    request.onerror = () => {
      reject(request.error ?? new Error('Unable to open combat-data cache database.'));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (database.objectStoreNames.contains(combatDataCacheDescriptor.storeName)) {
        database.deleteObjectStore(combatDataCacheDescriptor.storeName);
      }

      const store = database.createObjectStore(combatDataCacheDescriptor.storeName, {
        keyPath: 'cacheKey'
      });
      store.createIndex('gameId', 'gameId', { unique: false });
      store.createIndex('revision', 'revision', { unique: false });
      store.createIndex('cachedAt', 'cachedAt', { unique: false });
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function parseStoredGraph(stored: StoredGraphRecord | null): CombatDataGraph | null {
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored.graphJson) as CombatDataGraph;
  } catch {
    return null;
  }
}
