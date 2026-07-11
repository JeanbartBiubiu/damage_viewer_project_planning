import type { CurrentVersion } from '../types/api';
import type { WasmCatalogV1 } from '../types/wasmCatalog';
import { ApiRequestError, getCurrentVersion, getWasmCatalog } from './apiClient';

export type PublishedWasmCatalogSnapshot = {
  currentVersion: CurrentVersion;
  catalog: WasmCatalogV1;
};

export type WasmCatalogEmptyError = ApiRequestError & {
  status: 404;
  details: {
    kind: 'wasm_catalog_empty';
    gameId: string;
    versionCode: string;
  };
};

export function isWasmCatalogEmptyError(error: unknown): error is WasmCatalogEmptyError {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.status !== 404) {
    return false;
  }
  const details = error.details as { kind?: string; gameId?: string; versionCode?: string } | undefined;
  return (
    details?.kind === 'wasm_catalog_empty' &&
    typeof details.gameId === 'string' &&
    typeof details.versionCode === 'string'
  );
}

/**
 * Uncached current-version → wasm-catalog read chain.
 * Never falls back to /bundle or IndexedDB.
 */
export async function loadPublishedWasmCatalogSnapshot(
  apiBaseUrl: string,
  gameId: string
): Promise<PublishedWasmCatalogSnapshot> {
  const currentResult = await getCurrentVersion(apiBaseUrl, gameId);
  const currentVersion = currentResult.data;

  try {
    const catalogResult = await getWasmCatalog(apiBaseUrl, gameId, currentVersion.versionCode);
    return {
      currentVersion,
      catalog: catalogResult.data
    };
  } catch (error) {
    // Catalog 404 (any backend code spelling, e.g. 404.NOT_FOUND) → dedicated empty state.
    // Current-version 404 is outside this try and remains an ordinary read error.
    if (error instanceof ApiRequestError && error.status === 404) {
      throw new ApiRequestError(
        '该发布版本尚未配置通用 Wasm catalog',
        404,
        'NOT_FOUND',
        {
          kind: 'wasm_catalog_empty',
          gameId,
          versionCode: currentVersion.versionCode
        }
      );
    }
    throw error;
  }
}
