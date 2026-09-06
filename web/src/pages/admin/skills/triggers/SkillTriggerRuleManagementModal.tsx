import {
  Alert,
  Button,
  Empty,
  Modal,
  Space,
  Table,
  Tag
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import {
  deleteSkillTriggerRule,
  listSkillTriggerRules
} from '../../../../services/skillTriggerRuleClient';
import type { Skill } from '../../../../types/skill';
import type { SkillTriggerRuleDetail, SkillTriggerRuleSummary } from '../../../../types/skillTriggerRule';
import {
  SKILL_TRIGGER_EMPTY_STATE,
  SKILL_TRIGGER_ENTRY_LABEL,
  SKILL_TRIGGER_EVENT_TYPE_LABELS,
  isSkillNotFound,
  isTriggerRuleNotFound,
  skillTriggerManagementTitle
} from './triggerRuleForm';
import {
  SkillTriggerRuleEditorModal,
  type SkillTriggerRuleEditorMode
} from './SkillTriggerRuleEditorModal';

type SkillTriggerRuleManagementModalProps = {
  visible: boolean;
  skill: Skill | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSkillMissing: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

type EditorState = {
  mode: SkillTriggerRuleEditorMode;
  rule: SkillTriggerRuleSummary | null;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function SkillTriggerRuleManagementModal({
  visible,
  skill,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSkillMissing,
  onDirtyChange
}: SkillTriggerRuleManagementModalProps) {
  const [items, setItems] = useState<SkillTriggerRuleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillTriggerRuleSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listSerial = useRef(0);
  const openSkillKey = skill?.skillKey ?? null;
  const openGameId = selectedGameId;

  const resetState = useCallback(() => {
    listSerial.current += 1;
    setItems([]);
    setLoading(false);
    setLoadError(null);
    setNotice(null);
    setEditor(null);
    setEditorDirty(false);
    setDeleteTarget(null);
    setDeleteError(null);
    setDeleting(false);
  }, []);

  const loadRules = useCallback(async () => {
    const serial = listSerial.current + 1;
    listSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !openGameId || !openSkillKey || !token) {
      setItems([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listSkillTriggerRules(apiBaseUrl, openGameId, openSkillKey, token);
      if (listSerial.current !== serial) return;
      if (selectedGameId !== openGameId || skill?.skillKey !== openSkillKey) return;
      setItems(result.data);
    } catch (error) {
      if (listSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setItems([]);
      setLoadError(getErrorMessage(error));
    } finally {
      if (listSerial.current === serial) setLoading(false);
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, openGameId, openSkillKey, selectedGameId, skill?.skillKey, visible]);

  useEffect(() => {
    if (!visible || !skill) {
      resetState();
      return;
    }
    setEditor(null);
    setDeleteTarget(null);
    setDeleteError(null);
    setNotice(null);
    void loadRules();
  }, [loadRules, resetState, skill, visible]);

  const close = () => {
    if (deleting) return;
    if (editor && editorDirty) return;
    resetState();
    onClose();
  };

  const handleSkillMissing = useCallback(() => {
    resetState();
    onSkillMissing();
  }, [onSkillMissing, resetState]);

  const handleEditorDirtyChange = useCallback((dirty: boolean) => {
    setEditorDirty(dirty);
    onDirtyChange(dirty);
  }, [onDirtyChange]);

  const handleRuleMissing = useCallback(() => {
    setEditor(null);
    setEditorDirty(false);
    setNotice('规则已被其他会话删除。');
    void loadRules();
  }, [loadRules]);

  const confirmDelete = async () => {
    if (!deleteTarget || deleting || !selectedGameId || !skill) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const deletedName = deleteTarget.name;
      await deleteSkillTriggerRule(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        deleteTarget.ruleKey,
        token
      );
      setDeleteTarget(null);
      setNotice(`规则「${deletedName}」已删除。`);
      await loadRules();
    } catch (error) {
      if (isSkillNotFound(error)) {
        handleSkillMissing();
        return;
      }
      if (isTriggerRuleNotFound(error)) {
        setDeleteTarget(null);
        setNotice('规则已被其他会话删除。');
        await loadRules();
        return;
      }
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumnProps[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '稳定标识', dataIndex: 'ruleKey' },
    {
      title: '事件类型',
      dataIndex: 'eventType',
      render: (value: SkillTriggerRuleSummary['eventType']) => SKILL_TRIGGER_EVENT_TYPE_LABELS[value]
    },
    { title: '条件组', dataIndex: 'conditionGroupCount', width: 90 },
    { title: '动作', dataIndex: 'actionCount', width: 80 },
    {
      title: '每目标冷却',
      dataIndex: 'perTargetCooldownEnabled',
      width: 110,
      render: (value: boolean) => (value ? <Tag color="arcoblue">已配置</Tag> : '—')
    },
    {
      title: '过程次数',
      dataIndex: 'maxTriggersPerProcessEnabled',
      width: 100,
      render: (value: boolean) => (value ? <Tag color="arcoblue">已配置</Tag> : '—')
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
      width: 160,
      render: (_value, record: SkillTriggerRuleSummary) => (
        <Space size="mini">
          <Button
            size="mini"
            disabled={deleting}
            onClick={() => setEditor({ mode: 'edit', rule: record })}
          >
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            disabled={deleting}
            onClick={() => {
              setDeleteTarget(record);
              setDeleteError(null);
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <>
      <Modal
        title={skill ? skillTriggerManagementTitle(skill.name) : SKILL_TRIGGER_ENTRY_LABEL}
        visible={visible && skill !== null}
        maskClosable={!editorDirty}
        onCancel={close}
        style={{ width: 'calc(100vw - 80px)', maxWidth: 1800 }}
        footer={
          <Button onClick={close} disabled={deleting || Boolean(editor)}>关闭</Button>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
          <Button
            loading={loading}
            disabled={!selectedGameId || !adminToken.trim() || !skill || deleting}
            onClick={() => void loadRules()}
          >
            刷新
          </Button>
          <Button
            type="primary"
            disabled={!selectedGameId || !adminToken.trim() || !skill || deleting}
            onClick={() => setEditor({ mode: 'create', rule: null })}
          >
            新增规则
          </Button>
        </div>
        {loadError ? (
          <Alert
            type="error"
            content={loadError}
            action={
              <Button size="mini" loading={loading} onClick={() => void loadRules()}>
                重试
              </Button>
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {notice ? <Alert type="success" content={notice} style={{ marginBottom: 12 }} /> : null}
        <Table
          className="data-table-shell"
          loading={loading}
          columns={columns}
          data={items}
          pagination={false}
          rowKey={(record: SkillTriggerRuleSummary) => record.ruleKey}
          noDataElement={<Empty description={SKILL_TRIGGER_EMPTY_STATE} />}
        />
      </Modal>

      {skill && selectedGameId ? (
        <SkillTriggerRuleEditorModal
          visible={editor !== null}
          mode={editor?.mode ?? 'create'}
          skill={skill}
          rule={editor?.rule ?? null}
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          adminToken={adminToken}
          onClose={() => {
            setEditor(null);
            setEditorDirty(false);
          }}
          onSaved={async (saved: SkillTriggerRuleDetail) => {
            setEditor(null);
            setEditorDirty(false);
            setNotice(`规则「${saved.name}」已保存。`);
            onDirtyChange(false);
            await loadRules();
          }}
          onSkillMissing={handleSkillMissing}
          onRuleMissing={handleRuleMissing}
          onDirtyChange={handleEditorDirtyChange}
        />
      ) : null}

      <Modal
        title="删除规则"
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
        {deleteTarget ? `确定删除规则「${deleteTarget.name}」吗？` : null}
      </Modal>
    </>
  );
}
