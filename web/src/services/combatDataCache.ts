import type { CombatDataGraph } from '../types/combatData';
import { resolveApiBaseUrl } from './apiClient';

export const combatDataCacheDescriptor = {
  dbName: 'combat_data_db',
  dbVersion: 2,
  storeName: 'graphs'
} as const;

type StoredGraphRecord = {
  cacheKey: string;
  apiNamespace: string;
  apiGameScopeKey: string;
  gameId: string;
  revision: number;
  cachedAt: string;
  graphJson: string;
};

/**
 * Deterministic API namespace for cache isolation across backends.
 * Uses resolveApiBaseUrl, then URL-canonical host/port when possible.
 */
export function normalizeCombatDataApiNamespace(apiBaseUrl: string): string {
  const resolved = resolveApiBaseUrl(apiBaseUrl);

  try {
    const url = new URL(resolved);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    let port = url.port;

    if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
      port = '';
    }

    const origin = port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
    const path = url.pathname.replace(/\/+$/, '');
    const normalizedPath = path === '/' ? '' : path;

    return `${origin}${normalizedPath}`;
  } catch {
    return resolved.trim().replace(/\/+$/, '').toLowerCase();
  }
}

export function buildCombatDataApiGameScopeKey(apiNamespace: string, gameId: string): string {
  return `${apiNamespace}::${gameId}`;
}

export function buildCombatDataCacheKey(apiNamespace: string, gameId: string, revision: number): string {
  return `${apiNamespace}::${gameId}::${revision}`;
}

export async function readCombatDataGraphCache(
  apiBaseUrl: string,
  gameId: string,
  revision: number
): Promise<CombatDataGraph | null> {
  const apiNamespace = normalizeCombatDataApiNamespace(apiBaseUrl);
  const cacheKey = buildCombatDataCacheKey(apiNamespace, gameId, revision);

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

export async function writeCombatDataGraphCache(
  apiBaseUrl: string,
  graph: CombatDataGraph
): Promise<void> {
  const apiNamespace = normalizeCombatDataApiNamespace(apiBaseUrl);
  const cacheKey = buildCombatDataCacheKey(apiNamespace, graph.gameId, graph.currentRevision);
  const apiGameScopeKey = buildCombatDataApiGameScopeKey(apiNamespace, graph.gameId);
  const graphJson = JSON.stringify(graph);
  const record: StoredGraphRecord = {
    cacheKey,
    apiNamespace,
    apiGameScopeKey,
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
 * Clear cached graphs for one normalized API base + gameId scope only.
 */
export async function clearCombatDataGraphCache(apiBaseUrl: string, gameId: string): Promise<void> {
  const apiNamespace = normalizeCombatDataApiNamespace(apiBaseUrl);
  const apiGameScopeKey = buildCombatDataApiGameScopeKey(apiNamespace, gameId);

  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(combatDataCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(combatDataCacheDescriptor.storeName);
    const index = store.index('apiGameScopeKey');
    const request = index.openCursor(IDBKeyRange.only(apiGameScopeKey));

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
      store.createIndex('apiNamespace', 'apiNamespace', { unique: false });
      store.createIndex('apiGameScopeKey', 'apiGameScopeKey', { unique: false });
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
