import { useEffect, useState } from 'react';
import { ResourceImageThumb } from '../../../components/ResourceImageThumb';
import { getCachedImage } from '../../../services/imageCache';
import { cachedRelationImageContent } from './imageRelationForm';

type CachedImagePreviewProps = {
  gameId: string | null;
  imageKey: string | null;
  enabled?: boolean;
  name?: string;
  size?: number;
};

export function CachedImagePreview({ gameId, imageKey, enabled = true, name = '代表图片', size = 64 }: CachedImagePreviewProps) {
  const [cached, setCached] = useState<{ gameId: string; imageKey: string; src: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    setCached(null);
    if (gameId && imageKey && enabled) {
      void getCachedImage(gameId, imageKey).then((row) => {
        if (active) setCached({ gameId, imageKey, src: cachedRelationImageContent(row, gameId, imageKey, enabled) });
      }).catch(() => {
        if (active) setCached(null);
      });
    }
    return () => { active = false; };
  }, [gameId, imageKey, enabled]);
  const src = enabled && cached?.gameId === gameId && cached?.imageKey === imageKey ? cached.src : null;
  return <ResourceImageThumb src={src} alt={name} size={size} emptyLabel={!enabled ? '已停用' : imageKey ? '未缓存' : '未设置'} />;
}
