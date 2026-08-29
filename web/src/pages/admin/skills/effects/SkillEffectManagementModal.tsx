import {
  Alert,
  Button,
  Empty,
  Modal,
  Space,
  Table
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import { deleteSkillEffect, listSkillEffects } from '../../../../services/skillEffectClient';
import type { Skill } from '../../../../types/skill';
import type { SkillEffectSummary } from '../../../../types/skillEffect';
import { SKILL_EFFECT_LIFECYCLE_IN_USE_MESSAGE } from './effectForm';
import {
  SkillEffectEditorModal,
  type SkillEffectEditorMode
} from './SkillEffectEditorModal';

type SkillEffectManagementModalProps = {
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
  mode: SkillEffectEditorMode;
  effect: SkillEffectSummary | null;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

export function SkillEffectManagementModal({
  visible,
  skill,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSkillMissing,
  onDirtyChange
}: SkillEffectManagementModalProps) {
  const [items, setItems] = useState<SkillEffectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillEffectSummary | null>(null);
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
    setDeleteTarget(null);
    setDeleteError(null);
    setDeleting(false);
  }, []);

  const loadEffects = useCallback(async () => {
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
      const result = await listSkillEffects(apiBaseUrl, openGameId, openSkillKey, token);
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
    void loadEffects();
  }, [loadEffects, resetState, skill, visible]);

  const close = () => {
    if (deleting) return;
    resetState();
    onClose();
  };

  const handleSkillMissing = useCallback(() => {
    resetState();
    onSkillMissing();
  }, [onSkillMissing, resetState]);

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
      await deleteSkillEffect(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        deleteTarget.effectKey,
        token
      );
      setDeleteTarget(null);
      setNotice(`效果「${deletedName}」已删除。`);
      await loadEffects();
    } catch (error) {
      if (isSkillNotFound(error)) {
        handleSkillMissing();
        return;
      }
      if (error instanceof ApiRequestError && error.code === '409.SKILL_EFFECT_LIFECYCLE_IN_USE') {
        setDeleteError(SKILL_EFFECT_LIFECYCLE_IN_USE_MESSAGE);
        return;
      }
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const columns: TableColumnProps[] = [
    { title: '效果名称', dataIndex: 'name' },
    { title: '稳定标识', dataIndex: 'effectKey' },
    { title: '结果数量', dataIndex: 'resultCount', width: 100 },
    {
      title: '生命周期',
      dataIndex: 'lifecycleEnabled',
      width: 120,
      render: (_value, record: SkillEffectSummary) => (
        record.lifecycleEnabled ? '有生命周期' : '无生命周期'
      )
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
      width: 220,
      render: (_value, record: SkillEffectSummary) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setEditor({ mode: 'view', effect: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setEditor({ mode: 'edit', effect: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
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
        title={skill ? `效果与结果 - ${skill.name}` : '效果与结果'}
        visible={visible && skill !== null}
        maskClosable
        onCancel={close}
        style={{ width: 'calc(100vw - 80px)', maxWidth: 1800 }}
        footer={
          <Button onClick={close} disabled={deleting}>关闭</Button>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
          <Button
            loading={loading}
            disabled={!selectedGameId || !adminToken.trim() || !skill}
            onClick={() => void loadEffects()}
          >
            刷新
          </Button>
          <Button
            type="primary"
            disabled={!selectedGameId || !adminToken.trim() || !skill}
            onClick={() => setEditor({ mode: 'create', effect: null })}
          >
            新增效果
          </Button>
        </div>
        {loadError ? (
          <Alert
            type="error"
            content={loadError}
            action={
              <Button size="mini" loading={loading} onClick={() => void loadEffects()}>
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
          rowKey={(record: SkillEffectSummary) => record.effectKey}
          noDataElement={<Empty description="暂无效果" />}
        />
      </Modal>

      {skill && selectedGameId ? (
        <SkillEffectEditorModal
          visible={editor !== null}
          mode={editor?.mode ?? 'view'}
          skill={skill}
          effect={editor?.effect ?? null}
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          adminToken={adminToken}
          onClose={() => setEditor(null)}
          onSaved={async (saved) => {
            setEditor(null);
            setNotice(`效果「${saved.name}」已保存。`);
            onDirtyChange(false);
            await loadEffects();
          }}
          onSkillMissing={handleSkillMissing}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      <Modal
        title="删除效果"
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
        {deleteTarget ? `确定删除效果「${deleteTarget.name}」吗？` : null}
      </Modal>
    </>
  );
}
