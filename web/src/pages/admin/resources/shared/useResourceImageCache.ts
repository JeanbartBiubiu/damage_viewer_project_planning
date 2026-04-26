import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import { listCachedImages, toRemoteUri, upsertRemoteImage } from '../../../../services/imageCache';
import type { ImageAsset, LoadState } from '../../../../types/api';

type ResourceImageMap = Record<string, string>;

function toImageMap(gameId: string, rows: Awaited<ReturnType<typeof listCachedImages>>): ResourceImageMap {
  return rows.reduce<ResourceImageMap>((accumulator, row) => {
    accumulator[toRemoteUri(gameId, row.uri)] = row.image;
    return accumulator;
  }, {});
}

export function useResourceImageCache(selectedGameId: string | null) {
  const [imageSrcByUri, setImageSrcByUri] = useState<ResourceImageMap>({});
  const [cacheState, setCacheState] = useState<LoadState>('idle');
  const [cacheError, setCacheError] = useState<string | null>(null);

  const refreshImageCache = useCallback(async () => {
    if (!selectedGameId) {
      setImageSrcByUri({});
      setCacheState('idle');
      setCacheError(null);
      return;
    }

    setCacheState('loading');
    setCacheError(null);

    try {
      const rows = await listCachedImages(selectedGameId);
      setImageSrcByUri(toImageMap(selectedGameId, rows));
      setCacheState('success');
    } catch (error) {
      setImageSrcByUri({});
      setCacheState('error');
      setCacheError(getErrorMessage(error));
    }
  }, [selectedGameId]);

  const upsertImageAsset = useCallback(
    async (image: ImageAsset) => {
      if (!selectedGameId) {
        throw new Error('当前没有可写入图片缓存的 gameId。');
      }

      await upsertRemoteImage(selectedGameId, image);
      setImageSrcByUri((current) => ({
        ...current,
        [image.uri]: image.imageBase64
      }));
      setCacheState('success');
      setCacheError(null);
    },
    [selectedGameId]
  );

  useEffect(() => {
    void refreshImageCache();
  }, [refreshImageCache]);

  return {
    imageSrcByUri,
    cacheState,
    cacheError,
    refreshImageCache,
    upsertImageAsset
  };
}