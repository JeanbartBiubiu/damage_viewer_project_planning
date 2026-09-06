import { ObjectRelationActions } from '../relations/ObjectRelationActions';
import { useRepresentativeImageColumn } from '../relations/useRepresentativeImageColumn';
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
import { listSkillCategories } from '../../../services/skillCategoryClient';
import { deleteSkill, listSkills, updateSkill } from '../../../services/skillClient';
import type {
  Skill,
  SkillListQuery,
  SkillStatus,
  UpdateSkillRequest
} from '../../../types/skill';
import type { SkillCategory } from '../../../types/skillCategory';
import { SkillEditorModal, type SkillEditorMode } from './SkillEditorModal';
import { SkillEffectManagementModal } from './effects/SkillEffectManagementModal';
import { SkillParameterFormulaModal } from './SkillParameterFormulaModal';
import { SkillProcessInternalStateModal } from './processes/SkillProcessInternalStateModal';
import { SkillTriggerRuleManagementModal } from './triggers/SkillTriggerRuleManagementModal';
import { SKILL_TRIGGER_ENTRY_LABEL } from './triggers/triggerRuleForm';
import { loadFocusedSkill } from './focusedSkill';

export type SkillManagementPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onDirtyChange: (dirty: boolean) => void;
  focus?: {
    skillKey: string;
    characterKey: string;
    characterName: string;
    onReturn: () => void;
    returnLabel?: string;
  };
};

type StatusFilter = SkillStatus | '';
type EditorState = { mode: SkillEditorMode; skill: Skill | null };
type StatusTarget = { skill: Skill; nextStatus: SkillStatus };
type ParameterFormulaTarget = Skill;
type EffectTarget = Skill;
type ProcessInternalStateTarget = Skill;
type TriggerRuleTarget = Skill;

const EMPTY_QUERY: SkillListQuery = {};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function statusRequest(skill: Skill, status: SkillStatus): UpdateSkillRequest {
  return {
    name: skill.name,
    description: skill.description,
    maxLevel: skill.maxLevel,
    status,
    sortOrder: skill.sortOrder,
    skillCategoryKeys: [...skill.skillCategoryKeys]
  };
}

function categoryLabel(key: string, directory: SkillCategory[]): string {
  const category = directory.find((item) => item.skillCategoryKey === key);
  if (!category) return key;
  return category.status === 'DISABLED' ? `${category.name}（已停用）` : category.name;
}

export function SkillManagementPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onDirtyChange,
  focus
}: SkillManagementPageProps) {
  const focusedSkillKey = focus?.skillKey;
  const [keywordDraft, setKeywordDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<StatusFilter>('');
  const [appliedQuery, setAppliedQuery] = useState<SkillListQuery>(EMPTY_QUERY);
  const [items, setItems] = useState<Skill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);
  const [categoryDirectoryReady, setCategoryDirectoryReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [parameterFormulaTarget, setParameterFormulaTarget] = useState<ParameterFormulaTarget | null>(null);
  const [effectTarget, setEffectTarget] = useState<EffectTarget | null>(null);
  const [processInternalStateTarget, setProcessInternalStateTarget] = useState<ProcessInternalStateTarget | null>(null);
  const [triggerRuleTarget, setTriggerRuleTarget] = useState<TriggerRuleTarget | null>(null);
  const skillRequestSerial = useRef(0);
  const categoryRequestSerial = useRef(0);
  const [pageGameId, setPageGameId] = useState(selectedGameId);

  if (pageGameId !== selectedGameId) {
    setPageGameId(selectedGameId);
    skillRequestSerial.current += 1;
    categoryRequestSerial.current += 1;
    setKeywordDraft('');
    setStatusDraft('');
    setAppliedQuery(EMPTY_QUERY);
    setItems([]);
    setTotal(0);
    setLoading(false);
    setLoadError(null);
    setCategories([]);
    setCategoryLoading(false);
    setCategoryLoadError(null);
    setCategoryDirectoryReady(false);
    setEditor(null);
    setStatusTarget(null);
    setStatusError(null);
    setStatusUpdatingKey(null);
    setDeleteTarget(null);
    setDeleteError(null);
    setDeleting(false);
    setParameterFormulaTarget(null);
    setEffectTarget(null);
    setProcessInternalStateTarget(null);
    setTriggerRuleTarget(null);
    setNotice(null);
  }

  const loadSkills = useCallback(async (query: SkillListQuery) => {
    const serial = skillRequestSerial.current + 1;
    skillRequestSerial.current = serial;
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
      const result = focusedSkillKey
        ? { data: { items: [await loadFocusedSkill(apiBaseUrl, selectedGameId, focusedSkillKey, token)], total: 1 } }
        : await listSkills(apiBaseUrl, selectedGameId, token, query);
      if (skillRequestSerial.current !== serial) return;
      setItems(result.data.items);
      setTotal(result.data.total);
    } catch (error) {
      if (skillRequestSerial.current !== serial) return;
      setItems([]);
      setTotal(0);
      setLoadError(getErrorMessage(error));
    } finally {
      if (skillRequestSerial.current === serial) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId, focusedSkillKey]);

  const loadCategories = useCallback(async () => {
    const serial = categoryRequestSerial.current + 1;
    categoryRequestSerial.current = serial;
    const token = adminToken.trim();
    if (!selectedGameId || !token) {
      setCategories([]);
      setCategoryLoadError(null);
      setCategoryDirectoryReady(false);
      setCategoryLoading(false);
      return;
    }
    setCategoryLoading(true);
    try {
      const result = await listSkillCategories(apiBaseUrl, selectedGameId, token);
      if (categoryRequestSerial.current !== serial) return;
      setCategories(result.data.items);
      setCategoryLoadError(null);
      setCategoryDirectoryReady(true);
    } catch (error) {
      if (categoryRequestSerial.current !== serial) return;
      setCategories([]);
      setCategoryDirectoryReady(false);
      setCategoryLoadError(getErrorMessage(error));
    } finally {
      if (categoryRequestSerial.current === serial) setCategoryLoading(false);
    }
  }, [adminToken, apiBaseUrl, selectedGameId]);

  const handleEffectSkillMissing = useCallback(() => {
    setEffectTarget(null);
    void loadSkills(appliedQuery);
  }, [appliedQuery, loadSkills]);

  const handleProcessInternalStateSkillMissing = useCallback(() => {
    setProcessInternalStateTarget(null);
    void loadSkills(appliedQuery);
  }, [appliedQuery, loadSkills]);

  const handleTriggerRuleSkillMissing = useCallback(() => {
    setTriggerRuleTarget(null);
    void loadSkills(appliedQuery);
  }, [appliedQuery, loadSkills]);

  useEffect(() => {
    onDirtyChange(false);
  }, [onDirtyChange, selectedGameId]);

  useEffect(() => { void loadSkills(appliedQuery); }, [appliedQuery, loadSkills]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

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

  const handleSaved = async (saved: Skill, options?: { maxLevelExpanded?: boolean }) => {
    setEditor(null);
    const suffix = options?.maxLevelExpanded ? '新增等级参数已补 0。' : '';
    setNotice(`技能「${saved.name}」已保存。${suffix}`);
    onDirtyChange(false);
    await loadSkills(appliedQuery);
    setParameterFormulaTarget((current) => (
      current && current.skillKey === saved.skillKey ? saved : current
    ));
    setEffectTarget((current) => (
      current && current.skillKey === saved.skillKey ? saved : current
    ));
    setProcessInternalStateTarget((current) => (
      current && current.skillKey === saved.skillKey ? saved : current
    ));
    setTriggerRuleTarget((current) => (
      current && current.skillKey === saved.skillKey ? saved : current
    ));
  };

  const confirmStatusChange = async () => {
    if (!statusTarget || statusUpdatingKey || !selectedGameId) return;
    const token = adminToken.trim();
    if (!token) {
      setStatusError('请先配置 Admin Token。');
      return;
    }
    const { skill, nextStatus } = statusTarget;
    const action = nextStatus === 'ENABLED' ? '启用' : '停用';
    setStatusUpdatingKey(skill.skillKey);
    setStatusError(null);
    try {
      const result = await updateSkill(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        token,
        statusRequest(skill, nextStatus)
      );
      setStatusTarget(null);
      setNotice(`技能「${result.data.name}」已${action}。`);
      await loadSkills(appliedQuery);
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
      await deleteSkill(apiBaseUrl, selectedGameId, deleteTarget.skillKey, token);
      setDeleteTarget(null);
      setParameterFormulaTarget((current) => (
        current && current.skillKey === deleteTarget.skillKey ? null : current
      ));
      setEffectTarget((current) => (
        current && current.skillKey === deleteTarget.skillKey ? null : current
      ));
      setProcessInternalStateTarget((current) => (
        current && current.skillKey === deleteTarget.skillKey ? null : current
      ));
      setTriggerRuleTarget((current) => (
        current && current.skillKey === deleteTarget.skillKey ? null : current
      ));
      setNotice(`技能「${deletedName}」已删除。`);
      await loadSkills(appliedQuery);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const { imageColumn, onImageSaved } = useRepresentativeImageColumn<Skill>({
    apiBaseUrl, selectedGameId, adminToken,
    getTarget: record => ({ kind: 'skill', key: record.skillKey, name: record.name })
  });
  const columns: TableColumnProps[] = [
    imageColumn,
    { title: '技能名称', dataIndex: 'name', width: 180 },
    { title: '技能标识', dataIndex: 'skillKey', width: 190 },
    { title: '最高等级', dataIndex: 'maxLevel', width: 100 },
    {
      title: '技能分类',
      dataIndex: 'skillCategoryKeys',
      render: (value: string[] | undefined) => {
        const keys = Array.isArray(value) ? value : [];
        if (keys.length === 0) return '—';
        return (
          <Space wrap size="mini">
            {keys.map((key) => {
              const category = categories.find((item) => item.skillCategoryKey === key);
              return (
                <Tag key={key} color={category?.status === 'DISABLED' ? 'gray' : undefined}>
                  {categoryLabel(key, categories)}
                </Tag>
              );
            })}
          </Space>
        );
      }
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
      width: 520,
      fixed: 'right',
      render: (_value, record: Skill) => (
        <Space size="mini" wrap>
          <ObjectRelationActions
            key={`${apiBaseUrl}:${selectedGameId}:${record.skillKey}`}
            target={{ kind: 'skill', key: record.skillKey, name: record.name }}
            apiBaseUrl={apiBaseUrl} selectedGameId={selectedGameId} adminToken={adminToken}
            onDirtyChange={onDirtyChange}
            onImageSaved={() => onImageSaved(record)}
          />
          <Button size="mini" onClick={() => setEditor({ mode: 'view', skill: record })}>查看</Button>
          <Button
            size="mini"
            disabled={!categoryDirectoryReady}
            onClick={() => setEditor({ mode: 'edit', skill: record })}
          >编辑</Button>
          <Button size="mini" onClick={() => setParameterFormulaTarget(record)}>参数与公式</Button>
          <Button size="mini" onClick={() => setEffectTarget(record)}>效果与结果</Button>
          <Button size="mini" onClick={() => setProcessInternalStateTarget(record)}>过程与内部状态</Button>
          <Button size="mini" onClick={() => setTriggerRuleTarget(record)}>{SKILL_TRIGGER_ENTRY_LABEL}</Button>
          <Button
            size="mini"
            status={record.status === 'ENABLED' ? 'danger' : 'success'}
            onClick={() => {
              setStatusTarget({
                skill: record,
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
        title={focus ? `技能录入${items[0] ? ` · ${items[0].name}` : ''}` : '技能管理'}
        actions={
          <Space>
            {focus ? <Button type="primary" onClick={focus.onReturn}>{focus.returnLabel ?? '返回角色技能'}</Button> : null}
            <Button
              loading={loading}
              disabled={!selectedGameId || !adminToken.trim()}
              onClick={() => {
                void loadSkills(appliedQuery);
                void loadCategories();
              }}
            >刷新</Button>
            {!focus ? <Button
              type="primary"
              disabled={!selectedGameId || !adminToken.trim() || !categoryDirectoryReady}
              onClick={() => setEditor({ mode: 'create', skill: null })}
            >新增技能</Button> : null}
          </Space>
        }
      >
        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {selectedGameId && !adminToken.trim() ? <Alert type="warning" content="请先在顶部配置 Admin Token。" /> : null}
        {loadError ? <Alert type="error" content={loadError} className="workspace-alert" /> : null}
        {categoryLoadError ? (
          <Alert
            type="error"
            className="workspace-alert"
            content={categoryLoadError}
            action={
              <Button size="mini" loading={categoryLoading} onClick={() => void loadCategories()}>
                重试
              </Button>
            }
          />
        ) : null}
        {notice ? <Alert type="success" content={notice} className="workspace-alert" /> : null}

        {focus ? <Alert type="info" content={`来自角色：${focus.characterName}（${focus.characterKey}）。正在录入下方这一项技能；完成后${focus.returnLabel ?? '返回角色技能'}可继续核对。`} style={{ marginBottom: 16 }} /> : null}

        {!focus ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, auto) auto', gap: 12, alignItems: 'end', marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>关键词</span>
            <Input
              aria-label="技能关键词"
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
              aria-label="技能状态筛选"
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
        </div> : null}

        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {focus ? `当前技能标识：${focus.skillKey}` : `共 ${total} 条技能`}
        </Typography.Text>
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={items}
          pagination={false}
          rowKey={(record: Skill) => record.skillKey}
          scroll={{ x: 1654 }}
          noDataElement={<Empty description="暂无技能" />}
        />
      </Panel>

      {editor ? (
        <SkillEditorModal
          key={`${apiBaseUrl}:${selectedGameId}:${editor.mode}:${editor.skill?.skillKey ?? 'new'}`}
          visible
          mode={editor.mode}
          skill={editor.skill}
          skillCategories={categories}
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          adminToken={adminToken}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      <SkillParameterFormulaModal
        visible={parameterFormulaTarget !== null}
        skill={parameterFormulaTarget}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setParameterFormulaTarget(null)}
        onSkillMissing={() => {
          setParameterFormulaTarget(null);
          void loadSkills(appliedQuery);
        }}
      />

      <SkillEffectManagementModal
        visible={effectTarget !== null}
        skill={effectTarget}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setEffectTarget(null)}
        onSkillMissing={handleEffectSkillMissing}
        onDirtyChange={onDirtyChange}
      />

      <SkillProcessInternalStateModal
        visible={processInternalStateTarget !== null}
        skill={processInternalStateTarget}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setProcessInternalStateTarget(null)}
        onSkillMissing={handleProcessInternalStateSkillMissing}
        onDirtyChange={onDirtyChange}
      />

      <SkillTriggerRuleManagementModal
        visible={triggerRuleTarget !== null}
        skill={triggerRuleTarget}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setTriggerRuleTarget(null)}
        onSkillMissing={handleTriggerRuleSkillMissing}
        onDirtyChange={onDirtyChange}
      />

      <Modal
        title={statusTarget?.nextStatus === 'ENABLED' ? '启用技能' : '停用技能'}
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
        {statusTarget ? `确定${statusTarget.nextStatus === 'ENABLED' ? '启用' : '停用'}技能「${statusTarget.skill.name}」吗？` : null}
      </Modal>

      <Modal
        title="删除技能"
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
        {deleteTarget ? `确定删除技能「${deleteTarget.name}」吗？` : null}
      </Modal>
    </div>
  );
}
