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
  deleteSkillCategory,
  listSkillCategories,
  updateSkillCategory
} from '../../../services/skillCategoryClient';
import type {
  SkillCategory,
  SkillCategoryListQuery,
  SkillCategoryStatus,
  UpdateSkillCategoryRequest
} from '../../../types/skillCategory';
import {
  SkillCategoryEditorModal,
  type SkillCategoryEditorMode
} from './SkillCategoryEditorModal';

export type SkillCategoryManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
};

type StatusFilter = SkillCategoryStatus | '';
type EditorState = { mode: SkillCategoryEditorMode; category: SkillCategory | null };
type StatusTarget = { category: SkillCategory; nextStatus: SkillCategoryStatus };

const EMPTY_QUERY: SkillCategoryListQuery = {};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function statusRequest(category: SkillCategory, status: SkillCategoryStatus): UpdateSkillCategoryRequest {
  return {
    name: category.name,
    description: category.description,
    status,
    sortOrder: category.sortOrder
  };
}

export function SkillCategoryManagementPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDirtyChange
}: SkillCategoryManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<StatusFilter>('');
  const [appliedQuery, setAppliedQuery] = useState<SkillCategoryListQuery>(EMPTY_QUERY);
  const [items, setItems] = useState<SkillCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestSerial = useRef(0);

  const loadList = useCallback(async (query: SkillCategoryListQuery) => {
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
      const result = await listSkillCategories(apiBaseUrl, selectedGameId, token, query);
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

  const handleSaved = async (saved: SkillCategory) => {
    setEditor(null);
    setNotice(`技能分类「${saved.name}」已保存。`);
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
    const { category, nextStatus } = statusTarget;
    const action = nextStatus === 'ENABLED' ? '启用' : '停用';
    setStatusUpdatingKey(category.skillCategoryKey);
    setStatusError(null);
    try {
      const result = await updateSkillCategory(
        apiBaseUrl,
        selectedGameId,
        category.skillCategoryKey,
        token,
        statusRequest(category, nextStatus)
      );
      setStatusTarget(null);
      setNotice(`技能分类「${result.data.name}」已${action}。`);
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
      await deleteSkillCategory(
        apiBaseUrl,
        selectedGameId,
        deleteTarget.skillCategoryKey,
        token
      );
      setDeleteTarget(null);
      setNotice(`技能分类「${deletedName}」已删除。`);
      await loadList(appliedQuery);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumnProps[] = [
    { title: '技能分类名称', dataIndex: 'name', width: 180 },
    { title: '技能分类标识', dataIndex: 'skillCategoryKey', width: 190 },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
      render: (value) => value || '—'
    },
    {
      title: '状态',
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
      render: (_value, record: SkillCategory) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setEditor({ mode: 'view', category: record })}>查看</Button>
          <Button size="mini" onClick={() => setEditor({ mode: 'edit', category: record })}>编辑</Button>
          <Button
            size="mini"
            status={record.status === 'ENABLED' ? 'danger' : 'success'}
            onClick={() => {
              setStatusTarget({
                category: record,
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
        title="技能分类管理"
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
              onClick={() => setEditor({ mode: 'create', category: null })}
            >新增技能分类</Button>
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
              aria-label="技能分类关键词"
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
              aria-label="技能分类状态筛选"
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
          共 {total} 条技能分类
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={items}
          pagination={false}
          rowKey={(record: SkillCategory) => record.skillCategoryKey}
          scroll={{ x: 1120 }}
          noDataElement={<Empty description="暂无技能分类" />}
        />
      </Panel>

      <SkillCategoryEditorModal
        visible={editor !== null}
        mode={editor?.mode ?? 'view'}
        category={editor?.category ?? null}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEditor(null)}
        onSaved={handleSaved}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title={statusTarget?.nextStatus === 'ENABLED' ? '启用技能分类' : '停用技能分类'}
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
        {statusTarget ? `确定${statusTarget.nextStatus === 'ENABLED' ? '启用' : '停用'}技能分类「${statusTarget.category.name}」吗？` : null}
      </Modal>

      <Modal
        title="删除技能分类"
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
        {deleteTarget ? `确定删除技能分类「${deleteTarget.name}」吗？` : null}
      </Modal>
    </div>
  );
}
