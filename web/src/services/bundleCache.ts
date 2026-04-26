import type { CurrentVersion, GameDataBundle } from '../types/api';

export type CachedBundleRecord = {
  gameId: string;
  versionCode: string;
  updatedAt: string;
  cachedAt: string;
  bundleSize: number;
  bundle: GameDataBundle;
};

type StoredBundleRecord = Omit<CachedBundleRecord, 'bundle'> & {
  bundleJson: string;
};

export const bundleCacheDescriptor = {
  dbName: 'bundle_db',
  dbVersion: 2,
  storeName: 'bundles'
} as const;

export async function getCachedBundle(gameId: string): Promise<CachedBundleRecord | null> {
  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(bundleCacheDescriptor.storeName, 'readonly');
    const store = transaction.objectStore(bundleCacheDescriptor.storeName);
    const request = store.get(gameId);

    request.onerror = () => {
      reject(request.error ?? new Error('读取 bundle 缓存失败。'));
      db.close();
    };

    request.onsuccess = () => {
      const storedRecord = (request.result as StoredBundleRecord | undefined) ?? null;
      resolve(normalizeStoredRecord(storedRecord));
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('读取 bundle 缓存事务失败。'));
      db.close();
    };
  });
}

export async function upsertCachedBundle(
  gameId: string,
  currentVersion: CurrentVersion,
  bundle: GameDataBundle
): Promise<void> {
  const bundleJson = JSON.stringify(bundle);
  const nextRecord: CachedBundleRecord = {
    gameId,
    versionCode: currentVersion.versionCode,
    updatedAt: currentVersion.updatedAt,
    cachedAt: new Date().toISOString(),
    bundleSize: bundleJson.length,
    bundle
  };

  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(bundleCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(bundleCacheDescriptor.storeName);
    const storedRecord: StoredBundleRecord = {
      gameId: nextRecord.gameId,
      versionCode: nextRecord.versionCode,
      updatedAt: nextRecord.updatedAt,
      cachedAt: nextRecord.cachedAt,
      bundleSize: nextRecord.bundleSize,
      bundleJson
    };
    store.put(storedRecord);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('写入 bundle 缓存失败。'));
      db.close();
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前运行环境不支持 IndexedDB。'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(bundleCacheDescriptor.dbName, bundleCacheDescriptor.dbVersion);

    request.onerror = () => {
      reject(request.error ?? new Error('无法打开 bundle 缓存数据库。'));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (database.objectStoreNames.contains(bundleCacheDescriptor.storeName)) {
        database.deleteObjectStore(bundleCacheDescriptor.storeName);
      }

      const store = database.createObjectStore(bundleCacheDescriptor.storeName, {
        keyPath: 'gameId'
      });
      store.createIndex('versionCode', 'versionCode', { unique: false });
      store.createIndex('cachedAt', 'cachedAt', { unique: false });
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function normalizeStoredRecord(storedRecord: StoredBundleRecord | null): CachedBundleRecord | null {
  if (!storedRecord) {
    return null;
  }

  try {
    const bundle = JSON.parse(storedRecord.bundleJson) as GameDataBundle;

    return {
      gameId: storedRecord.gameId,
      versionCode: storedRecord.versionCode,
      updatedAt: storedRecord.updatedAt,
      cachedAt: storedRecord.cachedAt,
      bundleSize: storedRecord.bundleSize ?? storedRecord.bundleJson.length,
      bundle
    };
  } catch {
    return null;
  }
}
