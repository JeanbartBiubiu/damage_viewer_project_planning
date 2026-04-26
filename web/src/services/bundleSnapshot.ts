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

  if (cachedRecord && cachedRecord.versionCode === currentVersion.versionCode) {
    return {
      currentVersion,
      bundle: cachedRecord.bundle,
      bundleEtag: null,
      cacheStatus: 'hit'
    };
  }

  const bundleResult = await getBundle(apiBaseUrl, gameId, currentVersion.versionCode);
  await safeUpsertCachedBundle(gameId, currentVersion, bundleResult.data);

  return {
    currentVersion,
    bundle: bundleResult.data,
    bundleEtag: null,
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
  bundle: GameDataBundle
) {
  try {
    await upsertCachedBundle(gameId, currentVersion, bundle);
  } catch (error) {
    console.warn('Bundle cache write failed.', error);
    return;
  }
}
