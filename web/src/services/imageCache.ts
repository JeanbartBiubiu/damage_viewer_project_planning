import type { ManagedImage, PublicImage } from '../types/image';

export type CachedImageRecord = {
  cacheKey: string;
  gameId: string;
  imageKey: string;
  enabled: boolean;
  imageBase64: string | null;
  updatedAt: string;
};

export type GameImageCacheSummary = {
  count: number;
  enabledCount: number;
  latestUpdate: string | null;
};

export type FullSyncPlan = {
  deleteKeys: string[];
  putRows: CachedImageRecord[];
};

export const imageCacheDescriptor = {
  dbName: 'image_db',
  dbVersion: 2,
  storeName: 'images'
} as const;

export function toImageCacheKey(gameId: string, imageKey: string): string {
  return `${gameId}:${imageKey}`;
}

export function toCachedImageRecord(gameId: string, image: PublicImage): CachedImageRecord {
  return {
    cacheKey: toImageCacheKey(gameId, image.imageKey),
    gameId,
    imageKey: image.imageKey,
    enabled: image.enabled,
    imageBase64: image.enabled ? image.imageBase64 : null,
    updatedAt: image.updatedAt
  };
}

export function toCachedAdminImage(image: ManagedImage): CachedImageRecord {
  return toCachedImageRecord(image.gameId, {
    imageKey: image.imageKey,
    enabled: image.enabled,
    imageBase64: image.enabled ? image.imageBase64 : null,
    updatedAt: image.updatedAt
  });
}

export function latestCachedUpdate(rows: CachedImageRecord[]): string | null {
  return rows.reduce<string | null>(
    (latest, row) => {
      if (latest === null) return row.updatedAt;
      return Date.parse(row.updatedAt) > Date.parse(latest) ? row.updatedAt : latest;
    },
    null
  );
}

export function summarizeCachedImages(rows: CachedImageRecord[]): GameImageCacheSummary {
  return {
    count: rows.length,
    enabledCount: rows.filter((row) => row.enabled && row.imageBase64).length,
    latestUpdate: latestCachedUpdate(rows)
  };
}

export function buildFullSyncPlan(
  existingRows: CachedImageRecord[],
  gameId: string,
  remoteImages: PublicImage[]
): FullSyncPlan {
  return {
    deleteKeys: existingRows
      .filter((row) => row.gameId === gameId)
      .map((row) => row.cacheKey),
    putRows: remoteImages.map((image) => toCachedImageRecord(gameId, image))
  };
}

export async function listCachedImages(gameId: string): Promise<CachedImageRecord[]> {
  const rows = await getAllRows();
  return rows
    .filter((row) => row.gameId === gameId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function getCachedImage(
  gameId: string,
  imageKey: string
): Promise<CachedImageRecord | null> {
  const row = await getRow(toImageCacheKey(gameId, imageKey));
  return row?.enabled && row.imageBase64 ? row : null;
}

export async function getCacheSummary(gameId: string): Promise<GameImageCacheSummary> {
  return summarizeCachedImages(await listCachedImages(gameId));
}

export async function replaceGameImageCache(
  gameId: string,
  remoteImages: PublicImage[]
): Promise<GameImageCacheSummary> {
  const allRows = await getAllRows();
  const plan = buildFullSyncPlan(allRows, gameId, remoteImages);
  await mutateRows(plan.deleteKeys, plan.putRows);
  return getCacheSummary(gameId);
}

export async function applyIncrementalImageCache(
  gameId: string,
  remoteImages: PublicImage[]
): Promise<GameImageCacheSummary> {
  if (remoteImages.length > 0) {
    await mutateRows([], remoteImages.map((image) => toCachedImageRecord(gameId, image)));
  }
  return getCacheSummary(gameId);
}

export async function upsertManagedImage(image: ManagedImage): Promise<GameImageCacheSummary> {
  await mutateRows([], [toCachedAdminImage(image)]);
  return getCacheSummary(image.gameId);
}

export async function clearGameImageCache(gameId: string): Promise<number> {
  const rows = await listCachedImages(gameId);
  await mutateRows(rows.map((row) => row.cacheKey), []);
  return rows.length;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前运行环境不支持浏览器本地数据库。'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(imageCacheDescriptor.dbName, imageCacheDescriptor.dbVersion);
    request.onerror = () => reject(request.error ?? new Error('无法打开图片缓存数据库。'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(imageCacheDescriptor.storeName)) {
        database.deleteObjectStore(imageCacheDescriptor.storeName);
      }
      const store = database.createObjectStore(imageCacheDescriptor.storeName, { keyPath: 'cacheKey' });
      store.createIndex('gameId', 'gameId', { unique: false });
      store.createIndex('updatedAt', 'updatedAt', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function getAllRows(): Promise<CachedImageRecord[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(imageCacheDescriptor.storeName, 'readonly');
    const request = transaction.objectStore(imageCacheDescriptor.storeName).getAll();
    request.onerror = () => reject(request.error ?? new Error('读取图片缓存失败。'));
    request.onsuccess = () => resolve((request.result as CachedImageRecord[]) ?? []);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('读取图片缓存事务失败。'));
      database.close();
    };
  });
}

async function getRow(cacheKey: string): Promise<CachedImageRecord | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(imageCacheDescriptor.storeName, 'readonly');
    const request = transaction.objectStore(imageCacheDescriptor.storeName).get(cacheKey);
    request.onerror = () => reject(request.error ?? new Error('读取图片缓存失败。'));
    request.onsuccess = () => resolve((request.result as CachedImageRecord | undefined) ?? null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('读取图片缓存事务失败。'));
      database.close();
    };
  });
}

async function mutateRows(deleteKeys: string[], putRows: CachedImageRecord[]): Promise<void> {
  if (deleteKeys.length === 0 && putRows.length === 0) return;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(imageCacheDescriptor.storeName, 'readwrite');
    const store = transaction.objectStore(imageCacheDescriptor.storeName);
    for (const key of deleteKeys) store.delete(key);
    for (const row of putRows) store.put(row);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('更新图片缓存失败。'));
      database.close();
    };
  });
}
