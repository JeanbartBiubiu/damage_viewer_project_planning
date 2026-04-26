import type { ImageAsset } from '../types/api';

export type CachedImageRecord = {
  uri: string;
  create_time: string;
  update_time: string;
  image: string;
};

export type GameImageCacheSummary = {
  count: number;
  latestUpdate: string | null;
};

export const imageCacheDescriptor = {
  dbName: 'image_db',
  dbVersion: 1,
  storeName: 'images'
} as const;

export function toLocalUri(gameId: string, uri: string): string {
  return `${gameId}_${uri}`;
}

export function toRemoteUri(gameId: string, localUri: string): string {
  const prefix = `${gameId}_`;
  return localUri.startsWith(prefix) ? localUri.slice(prefix.length) : localUri;
}

export async function listCachedImages(gameId: string): Promise<CachedImageRecord[]> {
  const prefix = `${gameId}_`;
  const rows = await getAllRows();
  return rows
    .filter((row) => row.uri.startsWith(prefix))
    .sort((left, right) => right.update_time.localeCompare(left.update_time));
}

export async function getCachedImage(gameId: string, uri: string): Promise<CachedImageRecord | null> {
  const rows = await listCachedImages(gameId);
  const key = toLocalUri(gameId, uri);
  return rows.find((row) => row.uri === key) ?? null;
}

export async function getCacheSummary(gameId: string): Promise<GameImageCacheSummary> {
  const rows = await listCachedImages(gameId);
  return {
    count: rows.length,
    latestUpdate: rows[0]?.update_time ?? null
  };
}

export async function upsertRemoteImages(gameId: string, remoteImages: ImageAsset[]): Promise<GameImageCacheSummary> {
  if (remoteImages.length === 0) {
    return getCacheSummary(gameId);
  }

  const existingRows = await listCachedImages(gameId);
  const createTimeMap = new Map(existingRows.map((row) => [row.uri, row.create_time]));
  const now = new Date().toISOString();

  const nextRows = remoteImages.map<CachedImageRecord>((entry) => {
    const localUri = toLocalUri(gameId, entry.uri);

    return {
      uri: localUri,
      create_time: createTimeMap.get(localUri) ?? now,
      update_time: entry.updatedAt,
      image: entry.imageBase64
    };
  });

  await putRows(nextRows);
  return getCacheSummary(gameId);
}

export async function upsertRemoteImage(gameId: string, remoteImage: ImageAsset): Promise<GameImageCacheSummary> {
  return upsertRemoteImages(gameId, [remoteImage]);
}

export async function clearGameImageCache(gameId: string): Promise<number> {
  const rows = await listCachedImages(gameId);
  if (rows.length === 0) {
    return 0;
  }

  await deleteRows(rows.map((row) => row.uri));
  return rows.length;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前运行环境不支持 IndexedDB。'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(imageCacheDescriptor.dbName, imageCacheDescriptor.dbVersion);

    request.onerror = () => {
      reject(request.error ?? new Error('无法打开图片缓存数据库。'));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(imageCacheDescriptor.storeName)) {
        const store = database.createObjectStore(imageCacheDescriptor.storeName, {
          keyPath: 'uri'
        });
        store.createIndex('uri', 'uri', { unique: true });
        store.createIndex('create_time', 'create_time', { unique: false });
        store.createIndex('update_time', 'update_time', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function getAllRows(): Promise<CachedImageRecord[]> {
  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(imageCacheDescriptor.storeName, 'readonly');
    const store = transaction.objectStore(imageCacheDescriptor.storeName);
    const request = store.getAll();

    request.onerror = () => {
      reject(request.error ?? new Error('读取图片缓存失败。'));
      db.close();
    };

    request.onsuccess = () => {
      resolve((request.result as CachedImageRecord[]) ?? []);
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('读取图片缓存事务失败。'));
      db.close();
    };
  });
}

function putRows(rows: CachedImageRecord[]): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(imageCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(imageCacheDescriptor.storeName);

    for (const row of rows) {
      store.put(row);
    }

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('写入图片缓存失败。'));
      db.close();
    };
  });
}

function deleteRows(keys: string[]): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const db = await openDatabase().catch(reject);
    if (!db) {
      return;
    }

    const transaction = db.transaction(imageCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(imageCacheDescriptor.storeName);

    for (const key of keys) {
      store.delete(key);
    }

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('清理图片缓存失败。'));
      db.close();
    };
  });
}
