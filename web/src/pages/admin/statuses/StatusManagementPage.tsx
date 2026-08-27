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
import { getErrorMessage } from '../../../services/apiClient';
import {
  deleteStatus,
  listStatuses,
  updateStatus
} from '../../../services/statusClient';
import type {
  GameStatus,
  StatusListQuery,
  StatusRecordStatus,
  UpdateStatusRequest
} from '../../../types/status';
import { StatusEditorModal, type StatusEditorMode } from './StatusEditorModal';

export type StatusManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type StatusFilter = StatusRecordStatus | '';
type EditorState = { mode: StatusEditorMode; statusRecord: GameStatus | null };
type StatusTarget = { statusRecord: GameStatus; nextStatus: StatusRecordStatus };

const EMPTY_QUERY: StatusListQuery = {};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function statusRequest(statusRecord: GameStatus, status: StatusRecordStatus): UpdateStatusRequest {
  return {
    name: statusRecord.name,
    description: statusRecord.description,
    status,
    sortOrder: statusRecord.sortOrder
  };
}

export function StatusManagementPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDirtyChange
}: StatusManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<StatusFilter>('');
  const [appliedQuery, setAppliedQuery] = useState<StatusListQuery>(EMPTY_QUERY);
  const [items, setItems] = useState<GameStatus[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GameStatus | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestSerial = useRef(0);

  const loadList = useCallback(async (query: StatusListQuery) => {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setItems([]);
      setTotal(0);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listStatuses(apiBaseUrl, selectedGameId, token, query);
      if (requestSerial.current !== serial) return;
      setItems(result.data.items);
      setTotal(result.data.total);
    } catch (error) {
      if (requestSerial.current !== serial) return;
      setItems([]);
      setTotal(0);
      setLoadError(getErrorMessage(error));
    } finally {
      if (requestSerial.current === serial) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  useEffect(() => { void loadList(appliedQuery); }, [appliedQuery, loadList]);

  useEffect(() => {
    setKeywordDraft('');
    setStatusDraft('');
    setAppliedQuery(EMPTY_QUERY);
    setEditor(null);
    setStatusTarget(null);
    setStatusError(null);
    setDeleteTarget(null);
    setDeleteError(null);
    setNotice(null);
    onDirtyChange(false);
  }, [onDirtyChange, selectedGameId]);

  const applyQuery = () => {
    setNotice(null);
    setAppliedQuery({
      keyword: keywordDraft.trim() || undefined,
      status: statusDraft || undefined
    });
  };

  const resetQuery = () => {
    setKeywordDraft('');
    setStatusDraft('');
    setNotice(null);
    setAppliedQuery(EMPTY_QUERY);
  };

  const handleSaved = async (saved: GameStatus) => {
    setEditor(null);
    setNotice(`状态「${saved.name}」已保存。`);
    onDirtyChange(false);
    await loadList(appliedQuery);
  };

  const confirmStatusChange = async () => {
    if (!statusTarget || statusUpdatingKey || !selectedGameId) return;
    const token = adminToken.trim();
    if (!token) {
      setStatusError('请先配置 Admin Token。');
      return;
    }
    const { statusRecord, nextStatus } = statusTarget;
    const action = nextStatus === 'ENABLED' ? '启用' : '停用';
    setStatusUpdatingKey(statusRecord.statusKey);
    setStatusError(null);
    try {
      const result = await updateStatus(
        apiBaseUrl,
        selectedGameId,
        statusRecord.statusKey,
        token,
        statusRequest(statusRecord, nextStatus)
      );
      setStatusTarget(null);
      setNotice(`状态「${result.data.name}」已${action}。`);
      await loadList(appliedQuery);
    } catch (error) {
      setStatusError(getErrorMessage(error));
    } finally {
      setStatusUpdatingKey(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting || !selectedGameId) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const deletedName = deleteTarget.name;
      await deleteStatus(
        apiBaseUrl,
        selectedGameId,
        deleteTarget.statusKey,
        token
      );
      setDeleteTarget(null);
      setNotice(`状态「${deletedName}」已删除。`);
      await loadList(appliedQuery);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumnProps[] = [
    { title: '状态名称', dataIndex: 'name', width: 180 },
    { title: '状态标识', dataIndex: 'statusKey', width: 190 },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (value) => value || '—'
    },
    {
      title: '启停状态',
      dataIndex: 'status',
      width: 90,
      render: (value) => value === 'ENABLED'
        ? <Tag color="green">启用</Tag>
        : <Tag color="gray">停用</Tag>
    },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value) => formatUpdatedAt(String(value ?? ''))
    },
    {
      title: '操作',
      width: 280,
      fixed: 'right',
      render: (_value, record: GameStatus) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setEditor({ mode: 'view', statusRecord: record })}>查看</Button>
          <Button size="mini" onClick={() => setEditor({ mode: 'edit', statusRecord: record })}>编辑</Button>
          <Button
            size="mini"
            status={record.status === 'ENABLED' ? 'danger' : 'success'}
            onClick={() => {
              setStatusTarget({
                statusRecord: record,
                nextStatus: record.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
              });
              setStatusError(null);
            }}
          >
            {record.status === 'ENABLED' ? '停用' : '启用'}
          </Button>
          <Button size="mini" status="danger" onClick={() => {
            setDeleteTarget(record);
            setDeleteError(null);
          }}>删除</Button>
        </Space>
      )
    }
  ];

  return (
    <div className="page-stack">
      <Panel
        title="状态管理"
        actions={
          <Space>
            <Button
              loading={loading}
              disabled={!selectedGameId || !adminToken.trim()}
              onClick={() => void loadList(appliedQuery)}
            >刷新</Button>
            <Button
              type="primary"
              disabled={!selectedGameId}
              onClick={() => setEditor({ mode: 'create', statusRecord: null })}
            >新增状态</Button>
          </Space>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {selectedGameId && !adminToken.trim() ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
        {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
        {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, auto) auto', gap: 12, alignItems: 'end', marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>关键词</span>
            <Input
              aria-label="状态关键词"
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
              aria-label="状态筛选"
              type="button"
              size="small"
              value={statusDraft}
              onChange={(value) => {
                if (value === '' || value === 'ENABLED' || value === 'DISABLED') {
                  setStatusDraft(value);
                }
              }}
            >
              <Radio value="">全部</Radio>
              <Radio value="ENABLED">启用</Radio>
              <Radio value="DISABLED">停用</Radio>
            </Radio.Group>
          </div>
          <Space>
            <Button type="primary" disabled={!selectedGameId || !adminToken.trim()} onClick={applyQuery}>查询</Button>
            <Button onClick={resetQuery}>重置</Button>
          </Space>
        </div>

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          共 {total} 条状态
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={items}
          pagination={false}
          rowKey={(record: GameStatus) => record.statusKey}
          scroll={{ x: 1120 }}
          noDataElement={<Empty description="暂无状态" />}
        />
      </Panel>

      <StatusEditorModal
        visible={editor !== null}
        mode={editor?.mode ?? 'view'}
        statusRecord={editor?.statusRecord ?? null}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title={statusTarget?.nextStatus === 'ENABLED' ? '启用状态' : '停用状态'}
        visible={statusTarget !== null}
        okText={statusTarget?.nextStatus === 'ENABLED' ? '启用' : '停用'}
        cancelText="取消"
        okButtonProps={{ status: statusTarget?.nextStatus === 'ENABLED' ? 'success' : 'danger' }}
        confirmLoading={Boolean(statusUpdatingKey)}
        maskClosable
        onCancel={() => {
          if (statusUpdatingKey) return;
          setStatusTarget(null);
          setStatusError(null);
        }}
        onOk={() => void confirmStatusChange()}
      >
        {statusError ? <Alert type="error" content={statusError} style={{ marginBottom: 12 }} /> : null}
        {statusTarget ? `确定${statusTarget.nextStatus === 'ENABLED' ? '启用' : '停用'}状态「${statusTarget.statusRecord.name}」吗？` : null}
      </Modal>

      <Modal
        title="删除状态"
        visible={deleteTarget !== null}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={deleting}
        maskClosable
        onCancel={() => {
          if (deleting) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onOk={() => void confirmDelete()}
      >
        {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
        {deleteTarget ? `确定删除状态「${deleteTarget.name}」吗？` : null}
      </Modal>
    </div>
  );
}
