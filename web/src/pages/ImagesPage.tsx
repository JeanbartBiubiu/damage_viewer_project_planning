import { useEffect, useRef, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { JsonBlock } from '../components/JsonBlock';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { getErrorMessage, getImages } from '../services/apiClient';
import {
  clearGameImageCache,
  imageCacheDescriptor,
  listCachedImages,
  toRemoteUri,
  upsertRemoteImages,
  type CachedImageRecord
} from '../services/imageCache';
import type { LoadState } from '../types/api';

type ImagesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
};

type SyncAction = 'full' | 'incremental' | 'clear' | null;

type CacheSnapshot = {
  rows: CachedImageRecord[];
  latestUpdate: string | null;
};

function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

async function loadCacheSnapshot(gameId: string): Promise<CacheSnapshot> {
  const rows = await listCachedImages(gameId);
  return {
    rows,
    latestUpdate: rows[0]?.update_time ?? null
  };
}

export function ImagesPage({ apiBaseUrl, selectedGameId, selectedGameName }: ImagesPageProps) {
  const autoPrimedGames = useRef<Record<string, boolean>>({});
  const [cacheRows, setCacheRows] = useState<CachedImageRecord[]>([]);
  const [latestUpdate, setLatestUpdate] = useState<string | null>(null);
  const [cacheState, setCacheState] = useState<LoadState>('idle');
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [syncAction, setSyncAction] = useState<SyncAction>(null);
  const [syncMessage, setSyncMessage] = useState('首次进入当前游戏时，会自动尝试全量同步一次图片。');

  async function refreshCache(gameId: string): Promise<CacheSnapshot> {
    const snapshot = await loadCacheSnapshot(gameId);
    setCacheRows(snapshot.rows);
    setLatestUpdate(snapshot.latestUpdate);
    return snapshot;
  }

  async function runSync(mode: 'full' | 'incremental', silent = false) {
    if (!selectedGameId) {
      return;
    }

    const gameId = selectedGameId;
    setSyncAction(mode);
    setCacheError(null);

    try {
      const currentSnapshot = await loadCacheSnapshot(gameId);
      const updatedAfter = mode === 'incremental' ? currentSnapshot.latestUpdate ?? undefined : undefined;
      const response = await getImages(apiBaseUrl, gameId, updatedAfter);
      await upsertRemoteImages(gameId, response.data.images);
      const nextSnapshot = await refreshCache(gameId);

      if (response.data.images.length === 0) {
        setSyncMessage('本地图片缓存已经是最新状态。');
      } else {
        setSyncMessage(`已同步 ${response.data.images.length} 张图片；本地当前共 ${nextSnapshot.rows.length} 张。`);
      }
    } catch (error) {
      setCacheError(getErrorMessage(error));
      if (!silent) {
        setSyncMessage('同步失败，请检查后端接口或图片数据。');
      }
    } finally {
      setSyncAction(null);
    }
  }

  async function clearCache() {
    if (!selectedGameId) {
      return;
    }

    const gameId = selectedGameId;
    setSyncAction('clear');
    setCacheError(null);

    try {
      const removed = await clearGameImageCache(gameId);
      await refreshCache(gameId);
      setSyncMessage(removed === 0 ? '当前游戏没有可清理的缓存。' : `已清理 ${removed} 条图片缓存。`);
    } catch (error) {
      setCacheError(getErrorMessage(error));
      setSyncMessage('清理失败，请稍后再试。');
    } finally {
      setSyncAction(null);
    }
  }

  useEffect(() => {
    if (!selectedGameId) {
      setCacheRows([]);
      setLatestUpdate(null);
      setCacheState('idle');
      setCacheError(null);
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function bootstrap() {
      setCacheState('loading');
      setCacheError(null);

      try {
        const snapshot = await refreshCache(gameId);
        if (cancelled) {
          return;
        }

        setCacheState('success');

        if (snapshot.rows.length === 0 && !autoPrimedGames.current[gameId]) {
          autoPrimedGames.current[gameId] = true;
          await runSync('full', true);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCacheRows([]);
        setLatestUpdate(null);
        setCacheState('error');
        setCacheError(getErrorMessage(error));
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId]);

  const previewRows = cacheRows.slice(0, 12);
  const previewSample = previewRows[0]
    ? {
        localUri: previewRows[0].uri,
        serverUri: selectedGameId ? toRemoteUri(selectedGameId, previewRows[0].uri) : previewRows[0].uri,
        create_time: previewRows[0].create_time,
        update_time: previewRows[0].update_time
      }
    : { message: '当前还没有本地图片记录。' };

  return (
    <div className="page-grid">
      <Panel title="缓存契约" kicker="IndexDB Spec">
        <div className="metric-grid">
          <MetricCard label="DB 名称" value={imageCacheDescriptor.dbName} hint="与前端文档保持一致" />
          <MetricCard label="Store" value={imageCacheDescriptor.storeName} hint="主键字段 uri" />
          <MetricCard label="Version" value={String(imageCacheDescriptor.dbVersion)} hint="后续迁移可直接升版" />
          <MetricCard label="本地主键" value="{gameId}_{uri}" hint="避免多游戏图片冲突" />
        </div>
      </Panel>

      <Panel title="同步动作" kicker="Sync Flow">
        {!selectedGameId ? (
          <EmptyState title="还没选 gameId" description="图片页会按当前 gameId 进行全量同步、增量同步和清理缓存。" />
        ) : (
          <>
            <div className="toolbar-actions">
              <button className="button" type="button" disabled={syncAction !== null} onClick={() => void runSync('full')}>
                全量同步
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={syncAction !== null}
                onClick={() => void runSync('incremental')}
              >
                增量同步
              </button>
              <button className="button danger" type="button" disabled={syncAction !== null} onClick={() => void clearCache()}>
                清理当前缓存
              </button>
            </div>

            <div className="metric-grid compact">
              <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId} />
              <MetricCard label="缓存状态" value={cacheState} hint={cacheError ?? '本地缓存可读写'} />
              <MetricCard label="进行中的动作" value={syncAction ?? 'none'} hint="同一时间只跑一个同步任务" />
              <MetricCard label="最后更新时间" value={formatDate(latestUpdate)} hint="增量同步会用它作为 updatedAfter" />
            </div>

            <div className={`notice${cacheError ? ' notice-error' : ''}`}>{cacheError ?? syncMessage}</div>
          </>
        )}
      </Panel>

      <Panel title="本地缓存概览" kicker="Cache Snapshot">
        {!selectedGameId ? (
          <EmptyState title="未选择游戏" description="选择 gameId 后，这里会显示该游戏的图片缓存规模和示例记录。" />
        ) : (
          <div className="split-grid">
            <div className="stack-block">
              <div className="metric-grid compact">
                <MetricCard label="图片数量" value={String(cacheRows.length)} hint="本地已缓存的当前游戏图片数" />
                <MetricCard label="最近更新时间" value={formatDate(latestUpdate)} hint="按 update_time 倒序展示" />
              </div>
              <DataTable
                columns={['serverUri', 'localUri', 'update_time']}
                rows={cacheRows.slice(0, 8).map((row) => [
                  <span className="mono" key={`${row.uri}-remote`}>
                    {selectedGameId ? toRemoteUri(selectedGameId, row.uri) : row.uri}
                  </span>,
                  <span className="mono" key={`${row.uri}-local`}>
                    {row.uri}
                  </span>,
                  formatDate(row.update_time)
                ])}
                emptyMessage="本地还没有缓存图片。"
              />
            </div>
            <div className="stack-block">
              <JsonBlock value={previewSample} />
            </div>
          </div>
        )}
      </Panel>

      <Panel title="缓存预览" kicker="Image Preview">
        {previewRows.length === 0 ? (
          <EmptyState title="暂无预览图片" description="全量或增量同步完成后，这里会直接使用 base64 从本地渲染。" />
        ) : (
          <div className="preview-grid">
            {previewRows.map((row) => (
              <article className="image-card" key={row.uri}>
                <div className="image-card-media">
                  <img src={row.image} alt={selectedGameId ? toRemoteUri(selectedGameId, row.uri) : row.uri} />
                </div>
                <div className="image-card-body">
                  <p className="image-card-title">{selectedGameId ? toRemoteUri(selectedGameId, row.uri) : row.uri}</p>
                  <p className="image-card-meta">{formatDate(row.update_time)}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
