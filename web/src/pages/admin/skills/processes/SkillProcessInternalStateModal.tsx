import {
  Alert,
  Button,
  Empty,
  Modal,
  Space,
  Table,
  Tabs
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import {
  deleteSkillInternalState,
  listSkillInternalStates
} from '../../../../services/skillInternalStateClient';
import { deleteSkillProcess, listSkillProcesses } from '../../../../services/skillProcessClient';
import type { Skill } from '../../../../types/skill';
import type { SkillInternalStateSummary } from '../../../../types/skillInternalState';
import type { SkillProcessSummary } from '../../../../types/skillProcess';
import { SkillEffectManagementModal } from '../effects/SkillEffectManagementModal';
import { SkillParameterFormulaModal } from '../SkillParameterFormulaModal';
import {
  SkillInternalStateEditorModal,
  type SkillInternalStateEditorMode
} from './SkillInternalStateEditorModal';
import {
  SkillProcessEditorModal,
  type SkillProcessEditorMode
} from './SkillProcessEditorModal';
import {
  SKILL_INTERNAL_STATE_SCOPE_LABELS,
  SKILL_INTERNAL_STATE_TYPE_LABELS
} from './internalStateForm';
import { SKILL_PROCESS_ACTIVATION_TYPE_LABELS } from './processForm';

type ContentManager = 'parameter-formula' | 'effects' | null;

type SkillProcessInternalStateModalProps = {
  visible: boolean;
  skill: Skill | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSkillMissing: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

type ProcessEditorState = {
  mode: SkillProcessEditorMode;
  process: SkillProcessSummary | null;
};

type InternalStateEditorState = {
  mode: SkillInternalStateEditorMode;
  internalState: SkillInternalStateSummary | null;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

export function SkillProcessInternalStateModal({
  visible,
  skill,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSkillMissing,
  onDirtyChange
}: SkillProcessInternalStateModalProps) {
  const [activeTab, setActiveTab] = useState('processes');
  const [processes, setProcesses] = useState<SkillProcessSummary[]>([]);
  const [internalStates, setInternalStates] = useState<SkillInternalStateSummary[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [internalStatesLoading, setInternalStatesLoading] = useState(false);
  const [processesError, setProcessesError] = useState<string | null>(null);
  const [internalStatesError, setInternalStatesError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [processEditor, setProcessEditor] = useState<ProcessEditorState | null>(null);
  const [internalStateEditor, setInternalStateEditor] = useState<InternalStateEditorState | null>(null);
  const [deleteProcessTarget, setDeleteProcessTarget] = useState<SkillProcessSummary | null>(null);
  const [deleteInternalStateTarget, setDeleteInternalStateTarget] = useState<SkillInternalStateSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [contentManager, setContentManager] = useState<ContentManager>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [processEditorDirty, setProcessEditorDirty] = useState(false);
  const [contentEditorDirty, setContentEditorDirty] = useState(false);
  const processSerial = useRef(0);
  const internalStateSerial = useRef(0);
  const openSkillKey = skill?.skillKey ?? null;
  const openGameId = selectedGameId;

  const handleProcessEditorDirty = useCallback((dirty: boolean) => {
    setProcessEditorDirty(dirty);
  }, []);

  const handleContentEditorDirty = useCallback((dirty: boolean) => {
    setContentEditorDirty(dirty);
  }, []);

  const openParameterFormula = useCallback(() => {
    setContentManager('parameter-formula');
  }, []);

  const openEffects = useCallback(() => {
    setContentManager('effects');
  }, []);

  const closeContentManager = useCallback(() => {
    setContentManager(null);
    setContentEditorDirty(false);
    setCatalogRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    onDirtyChange(processEditorDirty || contentEditorDirty);
  }, [contentEditorDirty, onDirtyChange, processEditorDirty]);

  const resetState = useCallback(() => {
    processSerial.current += 1;
    internalStateSerial.current += 1;
    setActiveTab('processes');
    setProcesses([]);
    setInternalStates([]);
    setProcessesLoading(false);
    setInternalStatesLoading(false);
    setProcessesError(null);
    setInternalStatesError(null);
    setNotice(null);
    setProcessEditor(null);
    setInternalStateEditor(null);
    setDeleteProcessTarget(null);
    setDeleteInternalStateTarget(null);
    setDeleteError(null);
    setDeleting(false);
    setContentManager(null);
    setCatalogRevision(0);
    setProcessEditorDirty(false);
    setContentEditorDirty(false);
  }, []);

  const loadProcesses = useCallback(async () => {
    const serial = processSerial.current + 1;
    processSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !openGameId || !openSkillKey || !token) {
      setProcesses([]);
      setProcessesError(null);
      setProcessesLoading(false);
      return;
    }
    setProcessesLoading(true);
    setProcessesError(null);
    try {
      const result = await listSkillProcesses(apiBaseUrl, openGameId, openSkillKey, token);
      if (processSerial.current !== serial) return;
      if (selectedGameId !== openGameId || skill?.skillKey !== openSkillKey) return;
      setProcesses(result.data);
    } catch (error) {
      if (processSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setProcesses([]);
      setProcessesError(getErrorMessage(error));
    } finally {
      if (processSerial.current === serial) setProcessesLoading(false);
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, openGameId, openSkillKey, selectedGameId, skill?.skillKey, visible]);

  const loadInternalStates = useCallback(async () => {
    const serial = internalStateSerial.current + 1;
    internalStateSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !openGameId || !openSkillKey || !token) {
      setInternalStates([]);
      setInternalStatesError(null);
      setInternalStatesLoading(false);
      return;
    }
    setInternalStatesLoading(true);
    setInternalStatesError(null);
    try {
      const result = await listSkillInternalStates(apiBaseUrl, openGameId, openSkillKey, token);
      if (internalStateSerial.current !== serial) return;
      if (selectedGameId !== openGameId || skill?.skillKey !== openSkillKey) return;
      setInternalStates(result.data);
    } catch (error) {
      if (internalStateSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setInternalStates([]);
      setInternalStatesError(getErrorMessage(error));
    } finally {
      if (internalStateSerial.current === serial) setInternalStatesLoading(false);
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, openGameId, openSkillKey, selectedGameId, skill?.skillKey, visible]);

  useEffect(() => {
    if (!visible || !skill) {
      resetState();
      return;
    }
    setProcessEditor(null);
    setInternalStateEditor(null);
    setDeleteProcessTarget(null);
    setDeleteInternalStateTarget(null);
    setDeleteError(null);
    setNotice(null);
    void loadProcesses();
    void loadInternalStates();
  }, [loadInternalStates, loadProcesses, resetState, skill, visible]);

  const close = () => {
    if (deleting) return;
    resetState();
    onClose();
  };

  const handleSkillMissing = useCallback(() => {
    resetState();
    onSkillMissing();
  }, [onSkillMissing, resetState]);

  const confirmDeleteProcess = async () => {
    if (!deleteProcessTarget || deleting || !selectedGameId || !skill) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const deletedName = deleteProcessTarget.name;
      await deleteSkillProcess(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        deleteProcessTarget.processKey,
        token
      );
      setDeleteProcessTarget(null);
      setNotice(`过程「${deletedName}」已删除。`);
      await loadProcesses();
    } catch (error) {
      if (isSkillNotFound(error)) {
        handleSkillMissing();
        return;
      }
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteInternalState = async () => {
    if (!deleteInternalStateTarget || deleting || !selectedGameId || !skill) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const deletedName = deleteInternalStateTarget.name;
      await deleteSkillInternalState(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        deleteInternalStateTarget.stateKey,
        token
      );
      setDeleteInternalStateTarget(null);
      setNotice(`内部状态「${deletedName}」已删除。`);
      await loadInternalStates();
    } catch (error) {
      if (isSkillNotFound(error)) {
        handleSkillMissing();
        return;
      }
      if (error instanceof ApiRequestError && error.code === '409.SKILL_INTERNAL_STATE_IN_USE') {
        setDeleteError('该内部状态正在被技能过程使用，不能删除');
      } else {
        setDeleteError(getErrorMessage(error));
      }
    } finally {
      setDeleting(false);
    }
  };

  const processColumns: TableColumnProps[] = [
    { title: '过程名称', dataIndex: 'name' },
    { title: '稳定标识', dataIndex: 'processKey' },
    {
      title: '启动方式',
      dataIndex: 'activationType',
      render: (value: SkillProcessSummary['activationType']) => SKILL_PROCESS_ACTIVATION_TYPE_LABELS[value]
    },
    { title: '步骤数量', dataIndex: 'stepCount', width: 100 },
    { title: '效果挂接数量', dataIndex: 'effectBindingCount', width: 120 },
    { title: '内部状态操作数量', dataIndex: 'stateOperationCount', width: 150 },
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
      render: (_value, record: SkillProcessSummary) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setProcessEditor({ mode: 'view', process: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setProcessEditor({ mode: 'edit', process: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            onClick={() => {
              setDeleteProcessTarget(record);
              setDeleteError(null);
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const internalStateColumns: TableColumnProps[] = [
    { title: '内部状态名称', dataIndex: 'name' },
    { title: '稳定标识', dataIndex: 'stateKey' },
    {
      title: '状态种类',
      dataIndex: 'stateType',
      render: (value: SkillInternalStateSummary['stateType']) => SKILL_INTERNAL_STATE_TYPE_LABELS[value]
    },
    {
      title: '保存范围',
      dataIndex: 'scope',
      render: (value: SkillInternalStateSummary['scope']) => SKILL_INTERNAL_STATE_SCOPE_LABELS[value]
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
      render: (_value, record: SkillInternalStateSummary) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setInternalStateEditor({ mode: 'view', internalState: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setInternalStateEditor({ mode: 'edit', internalState: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            onClick={() => {
              setDeleteInternalStateTarget(record);
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
        title={skill ? `过程与内部状态 - ${skill.name}` : '过程与内部状态'}
        visible={visible && skill !== null}
        maskClosable
        onCancel={close}
        style={{ width: 'calc(100vw - 80px)', maxWidth: 1800 }}
        footer={
          <Space>
            <Button onClick={openParameterFormula} disabled={deleting}>参数与公式</Button>
            <Button onClick={openEffects} disabled={deleting}>效果与结果</Button>
            <Button onClick={close} disabled={deleting}>关闭</Button>
          </Space>
        }
      >
        {notice ? <Alert type="success" content={notice} style={{ marginBottom: 12 }} /> : null}
        <Tabs activeTab={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane key="processes" title="技能过程">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
              <Button
                loading={processesLoading}
                disabled={!selectedGameId || !adminToken.trim() || !skill}
                onClick={() => void loadProcesses()}
              >
                刷新
              </Button>
              <Button
                type="primary"
                disabled={!selectedGameId || !adminToken.trim() || !skill}
                onClick={() => setProcessEditor({ mode: 'create', process: null })}
              >
                新增过程
              </Button>
            </div>
            {processesError ? (
              <Alert
                type="error"
                content={processesError}
                action={
                  <Button size="mini" loading={processesLoading} onClick={() => void loadProcesses()}>
                    重试
                  </Button>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            <Table
              className="data-table-shell"
              loading={processesLoading}
              columns={processColumns}
              data={processes}
              pagination={false}
              rowKey={(record: SkillProcessSummary) => record.processKey}
              noDataElement={<Empty description="暂无技能过程" />}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="internal-states" title="内部状态">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
              <Button
                loading={internalStatesLoading}
                disabled={!selectedGameId || !adminToken.trim() || !skill}
                onClick={() => void loadInternalStates()}
              >
                刷新
              </Button>
              <Button
                type="primary"
                disabled={!selectedGameId || !adminToken.trim() || !skill}
                onClick={() => setInternalStateEditor({ mode: 'create', internalState: null })}
              >
                新增内部状态
              </Button>
            </div>
            {internalStatesError ? (
              <Alert
                type="error"
                content={internalStatesError}
                action={
                  <Button size="mini" loading={internalStatesLoading} onClick={() => void loadInternalStates()}>
                    重试
                  </Button>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            <Table
              className="data-table-shell"
              loading={internalStatesLoading}
              columns={internalStateColumns}
              data={internalStates}
              pagination={false}
              rowKey={(record: SkillInternalStateSummary) => record.stateKey}
              noDataElement={<Empty description="暂无内部状态" />}
            />
          </Tabs.TabPane>
        </Tabs>
      </Modal>

      {skill && selectedGameId ? (
        <SkillProcessEditorModal
          visible={processEditor !== null}
          mode={processEditor?.mode ?? 'view'}
          skill={skill}
          process={processEditor?.process ?? null}
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          adminToken={adminToken}
          onClose={() => setProcessEditor(null)}
          catalogRevision={catalogRevision}
          onOpenParameterFormula={openParameterFormula}
          onOpenEffects={openEffects}
          onSaved={async (saved) => {
            setProcessEditor(null);
            setNotice(`过程「${saved.name}」已保存。`);
            handleProcessEditorDirty(false);
            await loadProcesses();
          }}
          onSkillMissing={handleSkillMissing}
          onDirtyChange={handleProcessEditorDirty}
        />
      ) : null}

      {skill && selectedGameId ? (
        <SkillInternalStateEditorModal
          visible={internalStateEditor !== null}
          mode={internalStateEditor?.mode ?? 'view'}
          skill={skill}
          internalState={internalStateEditor?.internalState ?? null}
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          adminToken={adminToken}
          onClose={() => setInternalStateEditor(null)}
          catalogRevision={catalogRevision}
          onOpenParameterFormula={openParameterFormula}
          onSaved={async (saved) => {
            setInternalStateEditor(null);
            setNotice(`内部状态「${saved.name}」已保存。`);
            handleProcessEditorDirty(false);
            await loadInternalStates();
          }}
          onSkillMissing={handleSkillMissing}
          onDirtyChange={handleProcessEditorDirty}
        />
      ) : null}

      <Modal
        title="删除过程"
        visible={deleteProcessTarget !== null}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={deleting}
        maskClosable
        onCancel={() => {
          if (deleting) return;
          setDeleteProcessTarget(null);
          setDeleteError(null);
        }}
        onOk={() => void confirmDeleteProcess()}
      >
        {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
        {deleteProcessTarget ? `确定删除过程「${deleteProcessTarget.name}」吗？` : null}
      </Modal>

      <Modal
        title="删除内部状态"
        visible={deleteInternalStateTarget !== null}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={deleting}
        maskClosable
        onCancel={() => {
          if (deleting) return;
          setDeleteInternalStateTarget(null);
          setDeleteError(null);
        }}
        onOk={() => void confirmDeleteInternalState()}
      >
        {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
        {deleteInternalStateTarget ? `确定删除内部状态「${deleteInternalStateTarget.name}」吗？` : null}
      </Modal>

      <SkillParameterFormulaModal
        visible={contentManager === 'parameter-formula'}
        skill={skill}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={closeContentManager}
        onSkillMissing={handleSkillMissing}
      />

      <SkillEffectManagementModal
        visible={contentManager === 'effects'}
        skill={skill}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={closeContentManager}
        onSkillMissing={handleSkillMissing}
        onDirtyChange={handleContentEditorDirty}
      />
    </>
  );
}
