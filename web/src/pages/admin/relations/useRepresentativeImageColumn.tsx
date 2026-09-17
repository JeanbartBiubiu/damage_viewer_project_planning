import { Tooltip } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { ResourceImageThumb } from '../../../components/ResourceImageThumb';
import { getErrorMessage } from '../../../services/apiClient';
import type { ImageRelationTarget, RepresentativeImage } from '../../../types/imageRelation';
import { CachedImagePreview } from './CachedImagePreview';
import { imageTargetIdentity } from './imageRelationForm';
import { readTableRepresentativeImage } from './representativeImageRequests';

type Context = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
};

function RepresentativeImageCell({ apiBaseUrl, selectedGameId, adminToken, target, record }: Context & {
  target: ImageRelationTarget;
  record: { gameId: string };
}) {
  const [image, setImage] = useState<RepresentativeImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { kind, key, skillKey } = target;
  const canLoad = Boolean(selectedGameId && selectedGameId === record.gameId && adminToken.trim()
    && (kind !== 'skillEffect' || skillKey));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setImage(null);
    setError(null);
    setLoading(canLoad);
    if (canLoad && selectedGameId) {
      void readTableRepresentativeImage(apiBaseUrl, selectedGameId, { kind, key, skillKey, name: '' }, adminToken.trim(), controller.signal)
        .then(result => { if (active) setImage(result.data.image); })
        .catch(cause => { if (active) setError(getErrorMessage(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; controller.abort(); };
    // 刷新列表获得新记录时，重新读取关系；普通页面重绘不重复请求。
  }, [apiBaseUrl, selectedGameId, adminToken, kind, key, skillKey, record, canLoad]);

  const name = `${target.name}代表图片`;
  if (error) return <Tooltip content={error}>
    <span><ResourceImageThumb src={null} alt={name} size={48} emptyLabel="读取失败" /></span>
  </Tooltip>;
  if (loading || !canLoad) return <ResourceImageThumb src={null} alt={name} size={48} emptyLabel={canLoad ? '加载中' : '—'} />;
  return <CachedImagePreview gameId={selectedGameId} imageKey={image?.imageKey ?? null}
    enabled={image?.enabled} name={name} size={48} />;
}

export function useRepresentativeImageColumn<T extends { gameId: string }>(
  context: Context & { getTarget: (record: T) => ImageRelationTarget }
) {
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const { getTarget, ...connection } = context;
  const identity = (record: T) => JSON.stringify([
    connection.apiBaseUrl, connection.selectedGameId, connection.adminToken, imageTargetIdentity(getTarget(record))
  ]);
  const onImageSaved = (record: T) => {
    const id = identity(record);
    setRevisions(previous => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));
  };
  const imageColumn: TableColumnProps<T> = {
    title: '图片',
    key: 'representativeImage',
    width: 84,
    fixed: 'left',
    render: (_value, record) => <RepresentativeImageCell
      key={`${identity(record)}:${revisions[identity(record)] ?? 0}`}
      {...connection} target={getTarget(record)} record={record}
    />
  };
  return { imageColumn, onImageSaved };
}
