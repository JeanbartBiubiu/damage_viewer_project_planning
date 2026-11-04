import { Alert, Button, Empty, Input, Modal, Radio, Space, Table, Tag, Typography } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { getErrorMessage } from '../../../services/apiClient';
import { listSkillCategories } from '../../../services/skillCategoryClient';
import { deleteSkill, listSkills } from '../../../services/skillClient';
import type { Skill, SkillListQuery, SkillStatus } from '../../../types/skill';
import type { SkillCategory } from '../../../types/skillCategory';
import { ObjectRelationActions } from '../relations/ObjectRelationActions';
import { useRepresentativeImageColumn } from '../relations/useRepresentativeImageColumn';
import type { AuthoringNavigationRequest } from './authoringFocus';
import {
  SkillConfigurationWorkspace,
  moduleForAuthoringLocation,
  type SkillWorkspaceModule
} from './SkillConfigurationWorkspace';

export type SkillManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  onDirtyChange: (dirty: boolean) => void;
  focus?: {
    skillKey: string;
    sourceKind: 'character' | 'equipment' | 'buildOption';
    sourceKey: string;
    sourceName: string;
    systemKey?: string;
    systemName?: string;
    onReturn: () => void;
    returnLabel: string;
    navigation?: AuthoringNavigationRequest;
  };
};

type WorkspaceTarget = {
  id: number;
  skillKey: string | null;
  module: SkillWorkspaceModule;
  initialStatus?: SkillStatus;
  navigation?: AuthoringNavigationRequest;
};

const EMPTY_QUERY: SkillListQuery = {};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function categoryLabel(key: string, directory: SkillCategory[]): string {
  const category = directory.find((item) => item.skillCategoryKey === key);
  if (!category) return key;
  return category.status === 'DISABLED' ? `${category.name}（已停用）` : category.name;
}

export function SkillManagementPage({
  apiBaseUrl, selectedGameId, onDirtyChange, focus
}: SkillManagementPageProps) {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<SkillStatus | ''>('');
  const [appliedQuery, setAppliedQuery] = useState<SkillListQuery>(EMPTY_QUERY);
  const [items, setItems] = useState<Skill[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(!focus);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryDirectoryReady, setCategoryDirectoryReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceTarget | null>(() => focus ? {
    id: 0,
    skillKey: focus.skillKey,
    module: moduleForAuthoringLocation(focus.navigation?.location),
    navigation: focus.navigation
  } : null);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listGeneration = useRef(0);
  const categoryGeneration = useRef(0);
  const workspaceId = useRef(0);
  const workspaceDirty = useRef(false);

  const loadSkills = useCallback(async (query: SkillListQuery) => {
    if (focus) return;
    const generation = ++listGeneration.current;

    if (!selectedGameId) {
      setItems([]); setTotal(0); setLoading(false); setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listSkills(apiBaseUrl, selectedGameId, query);
      if (generation !== listGeneration.current) return;
      setItems(result.data.items);
      setTotal(result.data.total);
    } catch (error) {
      if (generation !== listGeneration.current) return;
      setItems([]); setTotal(0); setLoadError(getErrorMessage(error));
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  }, [apiBaseUrl, focus, selectedGameId]);

  const loadCategories = useCallback(async () => {
    const generation = ++categoryGeneration.current;

    if (!selectedGameId) {
      setCategories([]); setCategoryDirectoryReady(false); setCategoryLoading(false);
      return;
    }
    setCategoryLoading(true);
    setCategoryError(null);
    try {
      const result = await listSkillCategories(apiBaseUrl, selectedGameId);
      if (generation !== categoryGeneration.current) return;
      setCategories(result.data.items);
      setCategoryDirectoryReady(true);
    } catch (error) {
      if (generation !== categoryGeneration.current) return;
      setCategories([]);
      setCategoryDirectoryReady(false);
      setCategoryError(getErrorMessage(error));
    } finally {
      if (generation === categoryGeneration.current) setCategoryLoading(false);
    }
  }, [apiBaseUrl, selectedGameId]);

  useEffect(() => { void loadSkills(appliedQuery); }, [appliedQuery, loadSkills]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useEffect(() => () => { listGeneration.current += 1; categoryGeneration.current += 1; }, []);

  const openWorkspace = (skillKey: string | null, module: SkillWorkspaceModule, initialStatus?: SkillStatus) => {
    setWorkspace({ id: ++workspaceId.current, skillKey, module, initialStatus });
    workspaceDirty.current = false;
    setNotice(null);
  };
  const closeWorkspace = () => {
    if (workspaceDirty.current && !window.confirm('当前技能草稿尚未保存，确定返回技能列表吗？')) return;
    workspaceDirty.current = false;
    onDirtyChange(false);
    setWorkspace(null);
  };
  const reportWorkspaceDirty = useCallback((dirty: boolean) => {
    workspaceDirty.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);
  const workspaceSaved = async (skill: Skill) => {
    setWorkspace((current) => current ? { ...current, skillKey: skill.skillKey } : current);
    setNotice(`技能「${skill.name}」已保存并独立回读。`);
    if (!focus) await loadSkills(appliedQuery);
  };

  const applyQuery = () => {
    setCurrentPage(1);
    setAppliedQuery({ keyword: keywordDraft.trim() || undefined, status: statusDraft || undefined });
  };
  const resetQuery = () => {
    setKeywordDraft(''); setStatusDraft(''); setCurrentPage(1); setAppliedQuery(EMPTY_QUERY);
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deleting || !selectedGameId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const name = deleteTarget.name;
      await deleteSkill(apiBaseUrl, selectedGameId, deleteTarget.skillKey);
      setDeleteTarget(null);
      setNotice(`技能「${name}」已删除。`);
      await loadSkills(appliedQuery);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const { imageColumn, onImageSaved } = useRepresentativeImageColumn<Skill>({
    apiBaseUrl, selectedGameId, getTarget: (record) => ({ kind: 'skill', key: record.skillKey, name: record.name })
  });
  const columns: TableColumnProps[] = [
    imageColumn,
    { title: '技能名称', dataIndex: 'name', width: 180 },
    { title: '技能标识', dataIndex: 'skillKey', width: 190 },
    { title: '最高等级', dataIndex: 'maxLevel', width: 100 },
    { title: '技能分类', dataIndex: 'skillCategoryKeys', render: (value: string[] | undefined) => {
      const keys = Array.isArray(value) ? value : [];
      return keys.length ? <Space wrap size="mini">{keys.map((key) => <Tag key={key}>{categoryLabel(key, categories)}</Tag>)}</Space> : '—';
    } },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => value === 'ENABLED'
      ? <Tag color="green">启用</Tag> : <Tag color="gray">停用</Tag> },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 190, render: (value) => formatUpdatedAt(String(value ?? '')) },
    { title: '操作', width: 440, fixed: 'right', render: (_value, record: Skill) => <Space size="mini" wrap>
      <ObjectRelationActions
        key={`${apiBaseUrl}:${selectedGameId}:${record.skillKey}`}
        target={{ kind: 'skill', key: record.skillKey, name: record.name }}
        apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
        onDirtyChange={onDirtyChange} onImageSaved={() => onImageSaved(record)} />
      <Button size="mini" onClick={() => openWorkspace(record.skillKey, 'overview')}>编辑配置</Button>
      <Button size="mini" status={record.status === 'ENABLED' ? 'danger' : 'success'}
        onClick={() => openWorkspace(record.skillKey, 'basic', record.status === 'ENABLED' ? 'DISABLED' : 'ENABLED')}>
        {record.status === 'ENABLED' ? '停用' : '启用'}
      </Button>
      <Button size="mini" status="danger" onClick={() => { setDeleteTarget(record); setDeleteError(null); }}>删除</Button>
    </Space> }
  ];
  const lastPage = Math.max(1, Math.ceil(items.length / pageSize));
  const visiblePage = Math.min(currentPage, lastPage);

  if (workspace) {
    return <Panel title={focus ? '技能录入' : '技能管理'}>
      {categoryError ? <Alert type="warning" content={`技能分类目录读取失败：${categoryError}`}
        action={<Button size="mini" loading={categoryLoading} onClick={() => void loadCategories()}>重试目录</Button>} /> : null}
      <SkillConfigurationWorkspace
        key={workspace.id}
        apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId}
        skillKey={workspace.skillKey} initialModule={workspace.module} initialStatus={workspace.initialStatus}
        categories={categories} categoryDirectoryReady={categoryDirectoryReady}
        source={focus ? {
          kind: focus.sourceKind,
          name: focus.sourceName,
          key: focus.sourceKey,
          systemKey: focus.systemKey,
          systemName: focus.systemName
        } : null}
        backLabel={focus?.returnLabel}
        authoringLocation={workspace.navigation?.location}
        onBack={focus ? focus.onReturn : closeWorkspace}
        onSaved={workspaceSaved} onDirtyChange={reportWorkspaceDirty} />
    </Panel>;
  }

  return <div className="page-stack">
    <Panel title="技能管理" actions={<Space>
      <Button loading={loading} disabled={!selectedGameId}
        onClick={() => { void loadSkills(appliedQuery); void loadCategories(); }}>刷新</Button>
      <Button type="primary" disabled={!selectedGameId}
        onClick={() => openWorkspace(null, 'basic')}>新增技能</Button>
    </Space>}>
      {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}

      {loadError ? <Alert type="error" content={loadError} /> : null}
      {categoryError ? <Alert type="warning" content={`技能分类目录读取失败：${categoryError}`}
        action={<Button size="mini" loading={categoryLoading} onClick={() => void loadCategories()}>重试目录</Button>} /> : null}
      {notice ? <Alert type="success" content={notice} /> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, auto) auto', gap: 12, alignItems: 'end', marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span>关键词</span>
          <Input aria-label="技能关键词" value={keywordDraft} maxLength={100} allowClear
            onChange={setKeywordDraft} onPressEnter={applyQuery} /></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span>状态筛选</span>
          <Radio.Group aria-label="技能状态筛选" type="button" size="small" value={statusDraft}
            onChange={(value) => { if (value === '' || value === 'ENABLED' || value === 'DISABLED') setStatusDraft(value); }}>
            <Radio value="">全部</Radio><Radio value="ENABLED">启用</Radio><Radio value="DISABLED">停用</Radio>
          </Radio.Group></div>
        <Space><Button type="primary" onClick={applyQuery}>查询</Button><Button onClick={resetQuery}>重置</Button></Space>
      </div>
      <Typography.Text type="secondary">共 {total} 条技能</Typography.Text>
      <Table className="data-table-shell" loading={loading} columns={columns} data={items}
        pagination={{
          current: visiblePage, pageSize, total: items.length, showTotal: true,
          sizeCanChange: true, sizeOptions: [25, 50, 100],
          onChange: (page, nextPageSize) => {
            setCurrentPage(nextPageSize === pageSize ? page : 1);
            setPageSize(nextPageSize);
          }
        }}
        rowKey={(record: Skill) => record.skillKey} scroll={{ x: 1734 }} noDataElement={<Empty description="暂无技能" />} />
    </Panel>
    <Modal title="删除技能" visible={deleteTarget !== null} okText="删除" cancelText="取消"
      okButtonProps={{ status: 'danger' }} confirmLoading={deleting} maskClosable
      onCancel={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null); } }}
      onOk={() => void confirmDelete()}>
      {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
      {deleteTarget ? `确定删除技能「${deleteTarget.name}」吗？` : null}
    </Modal>
  </div>;
}
