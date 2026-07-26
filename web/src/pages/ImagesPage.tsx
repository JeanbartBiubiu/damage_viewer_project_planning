import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Grid, Input, Space, Typography } from '@arco-design/web-react';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Panel } from '../components/Panel';
import { ResourceImageUploadField } from '../components/ResourceImageUploadField';
import { getErrorMessage, getImages, putImage } from '../services/apiClient';
import {
  clearGameImageCache,
  listCachedImages,
  toRemoteUri,
  upsertRemoteImage,
  upsertRemoteImages,
  type CachedImageRecord
} from '../services/imageCache';
import {
  imageAssetUriValidationMessage,
  normalizeImageAssetUri,
  readImageFileAsDataUrl
} from '../services/resourceImage';

type ImagesPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  adminToken: string;
};

const { Row, Col } = Grid;

type SyncAction = 'full' | 'incremental' | 'clear' | 'upload' | null;

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

export function ImagesPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  adminToken
}: ImagesPageProps) {
  const autoPrimedGames = useRef<Record<string, boolean>>({});
  const [cacheRows, setCacheRows] = useState<CachedImageRecord[]>([]);
  const [latestUpdate, setLatestUpdate] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [syncAction, setSyncAction] = useState<SyncAction>(null);
  const [syncMessage, setSyncMessage] = useState('首次进入当前游戏时，页面会自动尝试同步一次图片。');
  const [uriDraft, setUriDraft] = useState('');
  const [uriError, setUriError] = useState<string | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'success' | 'error'; content: string } | null>(
    null
  );

  const actionBusy = syncAction !== null;
  const uploading = syncAction === 'upload';
  const normalizedUri = normalizeImageAssetUri(uriDraft);

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

  async function handleUpload(file: File) {
    if (!selectedGameId) {
      setUploadFeedback({ type: 'error', content: '请先选择游戏后再上传图片。' });
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setUploadFeedback({ type: 'error', content: '请先在侧栏配置非空的 Admin Token。' });
      return;
    }

    const uri = normalizeImageAssetUri(uriDraft);
    if (!uri) {
      const message = imageAssetUriValidationMessage(uriDraft) ?? '图片 URI 无效。';
      setUriError(message);
      setUploadFeedback({ type: 'error', content: message });
      return;
    }

    const gameId = selectedGameId;
    setSyncAction('upload');
    setUriError(null);
    setUploadFeedback(null);

    try {
      const imageBase64 = await readImageFileAsDataUrl(file);
      const result = await putImage(apiBaseUrl, gameId, uri, token, imageBase64);
      await upsertRemoteImage(gameId, result.data);
      await refreshCache(gameId);
      setUploadFeedback({
        type: 'success',
        content: `已上传并写入本地缓存：${result.data.uri}`
      });
    } catch (error) {
      setUploadFeedback({ type: 'error', content: getErrorMessage(error) });
    } finally {
      setSyncAction(null);
    }
  }

  useEffect(() => {
    setUriDraft('');
    setUriError(null);
    setUploadFeedback(null);
  }, [selectedGameId]);

  useEffect(() => {
    if (!selectedGameId) {
      setCacheRows([]);
      setLatestUpdate(null);
      setCacheError(null);
      return;
    }

    const gameId = selectedGameId;
    let cancelled = false;

    async function bootstrap() {
      setCacheError(null);

      try {
        const snapshot = await refreshCache(gameId);
        if (cancelled) {
          return;
        }

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
        setCacheError(getErrorMessage(error));
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, selectedGameId]);

  const previewRows = cacheRows.slice(0, 12);
  const previewSrc =
    selectedGameId && normalizedUri
      ? (cacheRows.find((row) => toRemoteUri(selectedGameId, row.uri) === normalizedUri)?.image ?? null)
      : null;

  return (
    <div className="page-images page-stack">
      <Panel title="同步动作" kicker="Sync Flow">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          缓存同步只更新本地 IndexedDB 预览，不会改写实体 / 属性定义上的 <code>imageUri</code> 关联。绑定编辑：
          <a href="#/entity-setup">实体创建</a>
          {' · '}
          <a href="#/combat-data/entities">通用实体</a>
          {' · '}
          <a href="#/combat-data/attribute-definitions">属性定义</a>
          。
        </Typography.Paragraph>
        {!selectedGameId ? (
          <EmptyState title="还没有选择 gameId" description="图片页会按当前 gameId 执行全量同步、增量同步和缓存清理。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space wrap>
              <Button disabled={actionBusy} onClick={() => void runSync('full')} type="primary">
                全量同步
              </Button>
              <Button disabled={actionBusy} onClick={() => void runSync('incremental')}>
                增量同步
              </Button>
              <Button status="danger" disabled={actionBusy} onClick={() => void clearCache()}>
                清理当前缓存
              </Button>
            </Space>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <MetricCard label="当前游戏" value={selectedGameName} hint={selectedGameId} />
              </Col>
            </Row>

            <Alert type={cacheError ? 'error' : 'info'} content={cacheError ?? syncMessage} />
          </Space>
        )}
      </Panel>

      <Panel title="独立图片上传" kicker="Asset Upload">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 0 }}>
            本面板只管理独立图片资产（写入 Admin images 接口并回写本地缓存）。它不会保存战斗数据资源的{' '}
            <code>imageUri</code> 关联。实体 / 属性定义上的关联请到{' '}
            <a href="#/entity-setup">实体创建</a>、
            <a href="#/combat-data/entities">通用实体</a> 或{' '}
            <a href="#/combat-data/attribute-definitions">属性定义</a> 编辑并保存；此处上传成功后，仍需在那些页面选择 URI 并保存资源表单。
          </Typography.Paragraph>

          {!selectedGameId ? (
            <EmptyState title="还没有选择 gameId" description="选中游戏并配置 Admin Token 后，才能上传独立图片资产。" />
          ) : (
            <>
              {!adminToken.trim() ? (
                <Alert type="warning" content="侧栏尚未配置非空 Admin Token，上传已禁用。" />
              ) : null}

              <div>
                <Typography.Text bold>图片 URI</Typography.Text>
                <Input
                  style={{ marginTop: 8 }}
                  value={uriDraft}
                  placeholder="例如 character_vayne / item_2510"
                  disabled={actionBusy}
                  status={uriError ? 'error' : undefined}
                  onChange={(value) => {
                    setUriDraft(value);
                    setUriError(imageAssetUriValidationMessage(value));
                  }}
                />
                {uriError ? (
                  <Typography.Text type="error" style={{ display: 'block', marginTop: 4 }}>
                    {uriError}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    仅接受稳定单段标识（字母/数字开头，可含点、下划线、连字符，最长 128）。
                  </Typography.Text>
                )}
              </div>

              <ResourceImageUploadField
                src={previewSrc}
                alt={normalizedUri ?? '独立图片资产'}
                imageUri={normalizedUri}
                uriPlaceholder="先填写有效的图片 URI"
                uploading={actionBusy}
                error={null}
                emptyLabel="未上传"
                buttonText={uploading ? '正在上传…' : '选择并上传图片'}
                helperText="支持常见图片文件；上传前会居中裁切为 64x64 data URI，成功后立即写入本地缓存。"
                onUpload={handleUpload}
              />

              {uploadFeedback ? (
                <Alert type={uploadFeedback.type === 'success' ? 'success' : 'error'} content={uploadFeedback.content} />
              ) : (
                <Alert
                  type="info"
                  content="上传前需同时满足：已选游戏、非空 Admin Token、有效 URI，并选择本地图片文件。"
                />
              )}
            </>
          )}
        </Space>
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
