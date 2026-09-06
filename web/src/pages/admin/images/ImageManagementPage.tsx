import { ImageUsageAction } from '../relations/ObjectRelationActions';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ResourceImageThumb } from '../../../components/ResourceImageThumb';
import { getErrorMessage } from '../../../services/apiClient';
import {
  applyIncrementalImageCache,
  clearGameImageCache,
  listCachedImages,
  replaceGameImageCache,
  summarizeCachedImages,
  upsertManagedImage,
  type CachedImageRecord,
  type GameImageCacheSummary
} from '../../../services/imageCache';
import { getImage, listPublicImages, updateImage } from '../../../services/imageClient';
import type { ManagedImage } from '../../../types/image';
import { ImageEditorModal, type ImageEditorMode } from './ImageEditorModal';

export type ImageManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  selectedGameName: string;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type EnabledFilter = boolean | '';
type EditorState = { mode: ImageEditorMode; image: ManagedImage | null };
type SyncAction = 'full' | 'incremental' | 'clear' | null;
type CachedImageQuery = { keyword?: string; enabled?: boolean };

const EMPTY_QUERY: CachedImageQuery = {};
const EMPTY_SUMMARY: GameImageCacheSummary = { count: 0, enabledCount: 0, latestUpdate: null };

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function statusBody(image: ManagedImage, enabled: boolean) {
  return {
    name: image.name,
    description: image.description,
    enabled
  };
}

function filterCachedImages(rows: CachedImageRecord[], query: CachedImageQuery): CachedImageRecord[] {
  const keyword = query.keyword?.trim().toLocaleLowerCase();
  return rows.filter((row) => (
    (!keyword || row.imageKey.toLocaleLowerCase().includes(keyword))
    && (query.enabled === undefined || row.enabled === query.enabled)
  ));
}

export function ImageManagementPage({
  apiBaseUrl,
  selectedGameId,
  selectedGameName,
  adminToken,
  onDirtyChange
}: ImageManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [enabledDraft, setEnabledDraft] = useState<EnabledFilter>('');
  const [appliedQuery, setAppliedQuery] = useState<CachedImageQuery>(EMPTY_QUERY);
  const [items, setItems] = useState<CachedImageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorLoadingKey, setEditorLoadingKey] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<ManagedImage | null>(null);
  const [statusLoadingKey, setStatusLoadingKey] = useState<string | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cacheSummary, setCacheSummary] = useState<GameImageCacheSummary>(EMPTY_SUMMARY);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('尚未同步。');
  const [syncAction, setSyncAction] = useState<SyncAction>(null);
  const requestSerial = useRef(0);

  const loadCachedList = useCallback(async (query: CachedImageQuery) => {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    if (!selectedGameId) {
      setItems([]);
      setTotal(0);
      setCacheSummary(EMPTY_SUMMARY);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await listCachedImages(selectedGameId);
      if (requestSerial.current !== serial) return;
      const filteredRows = filterCachedImages(rows, query);
      setItems(filteredRows);
      setTotal(filteredRows.length);
      setCacheSummary(summarizeCachedImages(rows));
      setCacheError(null);
    } catch (error) {
      if (requestSerial.current !== serial) return;
      setItems([]);
      setTotal(0);
      setCacheSummary(EMPTY_SUMMARY);
      const message = getErrorMessage(error);
      setLoadError(message);
      setCacheError(message);
    } finally {
      if (requestSerial.current === serial) setLoading(false);
    }
  }, [selectedGameId]);

  useEffect(() => { void loadCachedList(appliedQuery); }, [appliedQuery, loadCachedList]);

  useEffect(() => {
    setKeywordDraft('');
    setEnabledDraft('');
    setAppliedQuery(EMPTY_QUERY);
    setEditor(null);
    setStatusTarget(null);
    setStatusError(null);
    setNotice(null);
    setCacheError(null);
    setSyncMessage('尚未同步。');
    onDirtyChange(false);
  }, [onDirtyChange, selectedGameId]);

  const applyQuery = () => {
    setNotice(null);
    setAppliedQuery({
      keyword: keywordDraft.trim() || undefined,
      enabled: enabledDraft === '' ? undefined : enabledDraft
    });
  };

  const resetQuery = () => {
    setKeywordDraft('');
    setEnabledDraft('');
    setAppliedQuery(EMPTY_QUERY);
  };

  const openEditor = async (mode: ImageEditorMode, image: CachedImageRecord | null) => {
    if (mode === 'create') {
      setEditor({ mode, image: null });
      return;
    }
    if (!selectedGameId || !image || !adminToken.trim()) return;
    setEditorLoadingKey(image.imageKey);
    setLoadError(null);
    try {
      const result = await getImage(apiBaseUrl, selectedGameId, image.imageKey, adminToken.trim());
      setEditor({ mode, image: result.data });
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setEditorLoadingKey(null);
    }
  };

  const updateCacheAfterWrite = async (image: ManagedImage): Promise<void> => {
    try {
      await upsertManagedImage(image);
      setCacheError(null);
      await loadCachedList(appliedQuery);
    } catch (error) {
      setCacheError(`服务器已保存，但本地缓存更新失败：${getErrorMessage(error)}`);
    }
  };

  const handleSaved = async (image: ManagedImage) => {
    setEditor(null);
    onDirtyChange(false);
    setNotice(`图片“${image.name}”已保存。`);
    await updateCacheAfterWrite(image);
  };

  const beginStatusChange = async (record: CachedImageRecord) => {
    if (!selectedGameId || statusLoadingKey || statusUpdatingKey) return;
    const token = adminToken.trim();
    if (!token) {
      setLoadError('请先配置 Admin Token。');
      return;
    }
    setStatusLoadingKey(record.imageKey);
    setLoadError(null);
    setStatusError(null);
    try {
      const result = await getImage(apiBaseUrl, selectedGameId, record.imageKey, token);
      if (record.enabled) setStatusTarget(result.data);
      else await changeStatus(result.data, true);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setStatusLoadingKey(null);
    }
  };

  const changeStatus = async (image: ManagedImage, enabled: boolean) => {
    if (!selectedGameId || statusUpdatingKey) return;
    const token = adminToken.trim();
    if (!token) {
      setStatusError('请先配置 Admin Token。');
      return;
    }
    setStatusUpdatingKey(image.imageKey);
    setStatusError(null);
    try {
      const result = await updateImage(
        apiBaseUrl,
        selectedGameId,
        image.imageKey,
        token,
        statusBody(image, enabled)
      );
      setStatusTarget(null);
      setNotice(`图片“${result.data.name}”已${enabled ? '启用' : '停用'}。`);
      await updateCacheAfterWrite(result.data);
    } catch (error) {
      const message = getErrorMessage(error);
      if (enabled) setLoadError(message);
      else setStatusError(message);
    } finally {
      setStatusUpdatingKey(null);
    }
  };

  const runSync = async (mode: 'full' | 'incremental') => {
    if (!selectedGameId || syncAction) return;
    setSyncAction(mode);
    setCacheError(null);
    try {
      const before = summarizeCachedImages(await listCachedImages(selectedGameId));
      const updatedAfter = mode === 'incremental' ? before.latestUpdate ?? undefined : undefined;
      const result = await listPublicImages(apiBaseUrl, selectedGameId, updatedAfter);
      if (mode === 'full') {
        await replaceGameImageCache(selectedGameId, result.data.images);
      } else {
        await applyIncrementalImageCache(selectedGameId, result.data.images);
      }
      setSyncMessage(`${mode === 'full' ? '全量' : '增量'}同步完成，本次接收 ${result.data.images.length} 条变化。`);
      await loadCachedList(appliedQuery);
    } catch (error) {
      setCacheError(getErrorMessage(error));
      setSyncMessage('同步失败。');
    } finally {
      setSyncAction(null);
    }
  };

  const clearCache = async () => {
    if (!selectedGameId || syncAction) return;
    setSyncAction('clear');
    setCacheError(null);
    try {
      const removed = await clearGameImageCache(selectedGameId);
      setSyncMessage(`已清理 ${removed} 条当前游戏图片缓存。`);
      await loadCachedList(appliedQuery);
    } catch (error) {
      setCacheError(getErrorMessage(error));
    } finally {
      setSyncAction(null);
    }
  };

  const columns: TableColumnProps[] = [
    {
      title: '图片',
      width: 84,
      render: (_value, record: CachedImageRecord) => (
        <ResourceImageThumb src={record.imageBase64} alt={record.imageKey} size={48} />
      )
    },
    {
      title: '图片标识',
      dataIndex: 'imageKey',
      width: 200,
      render: (value) => <Typography.Text code>{String(value)}</Typography.Text>
    },
    {
      title: '缓存内容',
      width: 130,
      render: (_value, record: CachedImageRecord) => (
        record.enabled && record.imageBase64
          ? <Tag color="blue">已缓存</Tag>
          : <Tag color="gray">无可展示内容</Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (value) => value ? <Tag color="green">启用</Tag> : <Tag color="gray">停用</Tag>
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value) => formatDate(String(value ?? ''))
    },
    {
      title: '操作',
      width: 430,
      fixed: 'right',
      render: (_value, record: CachedImageRecord) => (
        <Space size="mini" wrap>
          <ImageUsageAction key={`${apiBaseUrl}:${selectedGameId}:${record.imageKey}`}
            imageKey={record.imageKey} apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
            adminToken={adminToken} onDirtyChange={onDirtyChange} />
          <Button
            size="mini"
            disabled={!adminToken.trim()}
            loading={editorLoadingKey === record.imageKey}
            onClick={() => void openEditor('view', record)}
          >查看</Button>
          <Button size="mini" disabled={!adminToken.trim()} onClick={() => void openEditor('edit', record)}>编辑</Button>
          <Button size="mini" disabled={!adminToken.trim()} onClick={() => void openEditor('edit', record)}>替换图片</Button>
          <Button
            size="mini"
            status={record.enabled ? 'danger' : 'success'}
            disabled={!adminToken.trim()}
            loading={statusLoadingKey === record.imageKey || statusUpdatingKey === record.imageKey}
            onClick={() => void beginStatusChange(record)}
          >{record.enabled ? '停用' : '启用'}</Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-images page-stack">
      <Panel title="本地缓存工具">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          图片管理列表直接读取浏览器本地缓存。若当前没有图片，请先全量同步；增量同步会保留停用记录的更新时间。
        </Typography.Paragraph>
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          <Space wrap>
            <Button type="primary" disabled={!selectedGameId || syncAction !== null} loading={syncAction === 'full'} onClick={() => void runSync('full')}>全量同步</Button>
            <Button disabled={!selectedGameId || syncAction !== null} loading={syncAction === 'incremental'} onClick={() => void runSync('incremental')}>增量同步</Button>
            <Button status="danger" disabled={!selectedGameId || syncAction !== null} loading={syncAction === 'clear'} onClick={() => void clearCache()}>清理当前缓存</Button>
          </Space>
          <div className="detail-grid">
            <div className="detail-grid-item">
              <span className="detail-grid-label">当前游戏</span>
              <span className="detail-grid-value">{selectedGameName}</span>
              <span className="detail-grid-hint">{selectedGameId ?? '未选择'}</span>
            </div>
            <div className="detail-grid-item">
              <span className="detail-grid-label">缓存记录</span>
              <span className="detail-grid-value">{cacheSummary.count}</span>
              <span className="detail-grid-hint">其中可展示 {cacheSummary.enabledCount} 条</span>
            </div>
            <div className="detail-grid-item">
              <span className="detail-grid-label">增量起点</span>
              <span className="detail-grid-value">{formatDate(cacheSummary.latestUpdate)}</span>
            </div>
          </div>
          <Alert type={cacheError ? 'error' : 'info'} content={cacheError ?? syncMessage} />
        </Space>
      </Panel>

      <Panel
        title="图片管理"
        actions={
          <Space>
            <Button
              loading={loading}
              disabled={!selectedGameId}
              onClick={() => void loadCachedList(appliedQuery)}
            >刷新缓存</Button>
            <Button type="primary" disabled={!selectedGameId} onClick={() => void openEditor('create', null)}>
              新建图片
            </Button>
          </Space>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {selectedGameId && !adminToken.trim() ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
        {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
        {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, auto) auto', gap: 12, alignItems: 'end', marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>图片标识关键词</span>
            <Input
              aria-label="图片标识关键词"
              value={keywordDraft}
              maxLength={100}
              allowClear
              onChange={setKeywordDraft}
              onPressEnter={applyQuery}
            />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>状态筛选</span>
            <Radio.Group
              aria-label="图片状态筛选"
              type="button"
              size="small"
              value={enabledDraft === '' ? '' : String(enabledDraft)}
              onChange={(value) => setEnabledDraft(value === '' ? '' : value === 'true')}
            >
              <Radio value="">全部</Radio>
              <Radio value="true">启用</Radio>
              <Radio value="false">停用</Radio>
            </Radio.Group>
          </div>
          <Space>
            <Button type="primary" disabled={!selectedGameId} onClick={applyQuery}>查询</Button>
            <Button onClick={resetQuery}>重置</Button>
          </Space>
        </div>

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          共 {total} 条本地缓存图片
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={items}
          pagination={false}
          rowKey={(record: CachedImageRecord) => record.imageKey}
          scroll={{ x: 900 }}
          noDataElement={(
            <Empty description={cacheSummary.count === 0
              ? '本地缓存暂无图片，请先全量同步'
              : '本地缓存中没有符合筛选条件的图片'} />
          )}
        />
      </Panel>

      <ImageEditorModal
        visible={editor !== null}
        mode={editor?.mode ?? 'view'}
        image={editor?.image ?? null}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title="停用图片"
        visible={statusTarget !== null}
        okText="停用"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={Boolean(statusUpdatingKey)}
        maskClosable
        onCancel={() => {
          if (statusUpdatingKey) return;
          setStatusTarget(null);
          setStatusError(null);
        }}
        onOk={() => statusTarget ? void changeStatus(statusTarget, false) : undefined}
      >
        {statusError ? <Alert type="error" content={statusError} style={{ marginBottom: 12 }} /> : null}
        {statusTarget ? `确定停用图片“${statusTarget.name}”吗？停用后公开同步不再提供图片内容。` : null}
      </Modal>
    </div>
  );
}
