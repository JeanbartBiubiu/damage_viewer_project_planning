import type { CurrentVersion, GameDataBundle } from '../types/api';
import { getBundle, getCurrentVersion } from './apiClient';
import { getCachedBundle, upsertCachedBundle } from './bundleCache';

export type PublishedBundleSnapshot = {
  currentVersion: CurrentVersion;
  bundle: GameDataBundle;
  bundleEtag: string | null;
  cacheStatus: 'hit' | 'miss';
};

export async function loadPublishedBundleSnapshot(apiBaseUrl: string, gameId: string): Promise<PublishedBundleSnapshot> {
  const currentResult = await getCurrentVersion(apiBaseUrl, gameId);
  const currentVersion = currentResult.data;
  const cachedRecord = await safeGetCachedBundle(gameId);

  if (cachedRecord && cachedRecord.versionId === currentVersion.versionId && cachedRecord.dataHash === currentVersion.dataHash) {
    if (cachedRecord.storageFormat === 'legacy') {
      await safeUpsertCachedBundle(gameId, currentVersion, cachedRecord.bundle, cachedRecord.etag ?? currentVersion.dataHash);
    }

    return {
      currentVersion,
      bundle: cachedRecord.bundle,
      bundleEtag: cachedRecord.etag ?? currentVersion.dataHash,
      cacheStatus: 'hit'
    };
  }

  const bundleResult = await getBundle(apiBaseUrl, gameId, currentVersion.versionId);
  const bundleEtag = bundleResult.etag ?? bundleResult.data.meta.dataHash ?? currentVersion.dataHash;
  await safeUpsertCachedBundle(gameId, currentVersion, bundleResult.data, bundleEtag);

  return {
    currentVersion,
    bundle: bundleResult.data,
    bundleEtag,
    cacheStatus: 'miss'
  };
}

async function safeGetCachedBundle(gameId: string) {
  try {
    return await getCachedBundle(gameId);
  } catch (error) {
    console.warn('Bundle cache read failed.', error);
    return null;
  }
}

async function safeUpsertCachedBundle(
  gameId: string,
  currentVersion: CurrentVersion,
  bundle: GameDataBundle,
  etag: string | null
) {
  try {
    await upsertCachedBundle(gameId, currentVersion, bundle, etag);
  } catch (error) {
    console.warn('Bundle cache write failed.', error);
    return;
  }
}
