import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Grid, Space, Typography } from '@arco-design/web-react';
import { DataTable, DetailGrid, type DetailGridItem } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
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

const { Row, Col } = Grid;

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
  const [syncMessage, setSyncMessage] = useState('首次进入当前游戏时，页面会自动尝试同步一次图片。');

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
      setSyncMessage('清理失败，请稍后重试。');
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
    ? previewRows[0]
    : null;
  const previewSampleDetails: DetailGridItem[] = previewSample
    ? [
        {
          label: 'serverUri',
          value: <Typography.Text code>{selectedGameId ? toRemoteUri(selectedGameId, previewSample.uri) : previewSample.uri}</Typography.Text>,
          hint: '远端接口返回的资源路径'
        },
        {
          label: 'localUri',
          value: <Typography.Text code>{previewSample.uri}</Typography.Text>,
          hint: 'IndexedDB 里的主键片段'
        },
        {
          label: '创建时间',
          value: formatDate(previewSample.create_time),
          hint: '首次写入本地缓存的时间'
        },
        {
          label: '最近更新时间',
          value: formatDate(previewSample.update_time),
          hint: '增量同步会基于这个时间继续追数据'
        }
      ]
    : [
        {
          label: '示例记录',
          value: '暂无',
          hint: '同步完成后这里会展示首条缓存记录。'
        }
      ];

  return (
    <div className="page-images page-stack">
      <Panel title="缓存合约" kicker="IndexedDB Spec">
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <MetricCard label="DB 名称" value={imageCacheDescriptor.dbName} hint="与前端文档保持一致" />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <MetricCard label="Store" value={imageCacheDescriptor.storeName} hint="主键字段 uri" />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <MetricCard label="Version" value={String(imageCacheDescriptor.dbVersion)} hint="后续迁移可直接升级" />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <MetricCard label="本地主键" value="{gameId}_{uri}" hint="避免不同游戏图片冲突" />
          </Col>
        </Row>
      </Panel>

      <Panel title="同步动作" kicker="Sync Flow">
        {!selectedGameId ? (
          <EmptyState title="还没有选择 gameId" description="图片页会按当前 gameId 执行全量同步、增量同步和缓存清理。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <Button disabled={syncAction !== null} onClick={() => void runSync('full')} type="primary">
                全量同步
              </Button>
              <Button disabled={syncAction !== null} onClick={() => void runSync('incremental')}>
                增量同步
              </Button>
              <Button status="danger" disabled={syncAction !== null} onClick={() => void clearCache()}>
                清理当前缓存
              </Button>
            </Space>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="缓存状态" value={cacheState} hint={cacheError ?? '本地缓存可读写'} />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="进行中的动作" value={syncAction ?? 'none'} hint="同一时间只跑一个同步任务" />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="最后更新时间" value={formatDate(latestUpdate)} hint="增量同步会用它作为 updatedAfter" />
              </Col>
            </Row>

            <Alert type={cacheError ? 'error' : 'info'} content={cacheError ?? syncMessage} />
          </Space>
        )}
      </Panel>

      <Panel title="本地缓存概览" kicker="Cache Snapshot">
        {!selectedGameId ? (
          <EmptyState title="未选择游戏" description="选中 gameId 后，这里会展示该游戏的图片缓存规模和示例记录。" />
        ) : (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12}>
                    <MetricCard label="图片数量" value={String(cacheRows.length)} hint="本地已缓存的当前游戏图片数" />
                  </Col>
                  <Col xs={24} sm={12}>
                    <MetricCard label="最近更新时间" value={formatDate(latestUpdate)} hint="按 update_time 倒序展示" />
                  </Col>
                </Row>

                <DataTable
                  columns={['serverUri', 'localUri', 'update_time']}
                  rows={cacheRows.slice(0, 8).map((row) => [
                    <Typography.Text code key={`${row.uri}-remote`}>
                      {selectedGameId ? toRemoteUri(selectedGameId, row.uri) : row.uri}
                    </Typography.Text>,
                    <Typography.Text code key={`${row.uri}-local`}>
                      {row.uri}
                    </Typography.Text>,
                    formatDate(row.update_time)
                  ])}
                  emptyMessage="本地还没有缓存图片。"
                />
              </Space>
            </Col>

            <Col xs={24} lg={10}>
              <Card size="small">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    示例记录
                  </Typography.Title>
                  <DetailGrid items={previewSampleDetails} />
                </Space>
              </Card>
            </Col>
          </Row>
        )}
      </Panel>

      <Panel title="缓存预览" kicker="Image Preview">
        {previewRows.length === 0 ? (
          <EmptyState title="暂无预览图片" description="同步完成后，这里会直接渲染本地的 base64 图片。" />
        ) : (
          <Row gutter={[16, 16]}>
            {previewRows.map((row) => (
              <Col xs={24} sm={12} lg={8} xl={6} key={row.uri}>
                <Card size="small" className="image-card">
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div className="image-card-media">
                      <img
                        src={row.image}
                        alt={selectedGameId ? toRemoteUri(selectedGameId, row.uri) : row.uri}
                      />
                    </div>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Typography.Text className="image-card-title">
                        {selectedGameId ? toRemoteUri(selectedGameId, row.uri) : row.uri}
                      </Typography.Text>
                      <Typography.Text className="image-card-meta">{formatDate(row.update_time)}</Typography.Text>
                    </Space>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Panel>
    </div>
  );
}
