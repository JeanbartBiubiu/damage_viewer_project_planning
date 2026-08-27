import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Table,
  Tabs,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { getLevelConfig } from '../../../services/characterClient';
import { deleteSkillFormula, listSkillFormulas } from '../../../services/skillFormulaClient';
import { deleteSkillParameter, listSkillParameters } from '../../../services/skillParameterClient';
import type { Skill } from '../../../types/skill';
import type { SkillFormulaSummary } from '../../../types/skillFormula';
import type { SkillParameter, SkillParameterValueMode } from '../../../types/skillParameter';
import {
  SkillFormulaEditorModal,
  type SkillFormulaEditorMode
} from './SkillFormulaEditorModal';
import {
  SkillParameterEditorModal,
  type SkillParameterEditorMode
} from './SkillParameterEditorModal';
import { formatParameterValue, type LevelRange } from './parameterForm';

type SkillParameterFormulaModalProps = {
  visible: boolean;
  skill: Skill | null;
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  onClose: () => void;
  onSkillMissing: () => void;
};

type ParameterEditorState = {
  mode: SkillParameterEditorMode;
  parameter: SkillParameter | null;
};

type FormulaEditorState = {
  mode: SkillFormulaEditorMode;
  formula: SkillFormulaSummary | null;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function valueTypeLabel(valueType: SkillParameter['valueType']): string {
  return valueType === 'INTEGER' ? '整数' : '小数';
}

export function SkillParameterFormulaModal({
  visible,
  skill,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSkillMissing
}: SkillParameterFormulaModalProps) {
  const [activeTab, setActiveTab] = useState('parameters');
  const [keyword, setKeyword] = useState('');
  const [parameters, setParameters] = useState<SkillParameter[]>([]);
  const [formulas, setFormulas] = useState<SkillFormulaSummary[]>([]);
  const [parametersLoading, setParametersLoading] = useState(false);
  const [formulasLoading, setFormulasLoading] = useState(false);
  const [parametersError, setParametersError] = useState<string | null>(null);
  const [formulasError, setFormulasError] = useState<string | null>(null);
  const [characterLevelRange, setCharacterLevelRange] = useState<LevelRange | null>(null);
  const [characterLevelLoadError, setCharacterLevelLoadError] = useState<string | null>(null);
  const [characterLevelLoading, setCharacterLevelLoading] = useState(false);
  const [parameterEditor, setParameterEditor] = useState<ParameterEditorState | null>(null);
  const [formulaEditor, setFormulaEditor] = useState<FormulaEditorState | null>(null);
  const [deleteParameterTarget, setDeleteParameterTarget] = useState<SkillParameter | null>(null);
  const [deleteFormulaTarget, setDeleteFormulaTarget] = useState<SkillFormulaSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const parameterSerial = useRef(0);
  const formulaSerial = useRef(0);
  const levelSerial = useRef(0);
  const openSkillKey = skill?.skillKey ?? null;
  const openGameId = selectedGameId;

  const resetState = useCallback(() => {
    parameterSerial.current += 1;
    formulaSerial.current += 1;
    levelSerial.current += 1;
    setActiveTab('parameters');
    setKeyword('');
    setParameters([]);
    setFormulas([]);
    setParametersLoading(false);
    setFormulasLoading(false);
    setParametersError(null);
    setFormulasError(null);
    setCharacterLevelRange(null);
    setCharacterLevelLoadError(null);
    setCharacterLevelLoading(false);
    setParameterEditor(null);
    setFormulaEditor(null);
    setDeleteParameterTarget(null);
    setDeleteFormulaTarget(null);
    setDeleteError(null);
    setDeleting(false);
  }, []);

  const loadParameters = useCallback(async () => {
    const serial = parameterSerial.current + 1;
    parameterSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !openGameId || !openSkillKey || !token) {
      setParameters([]);
      setParametersError(null);
      setParametersLoading(false);
      return;
    }
    setParametersLoading(true);
    setParametersError(null);
    try {
      const result = await listSkillParameters(apiBaseUrl, openGameId, openSkillKey, token);
      if (parameterSerial.current !== serial) return;
      if (selectedGameId !== openGameId || skill?.skillKey !== openSkillKey) return;
      setParameters(result.data);
    } catch (error) {
      if (parameterSerial.current !== serial) return;
      if (error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND') {
        onSkillMissing();
        return;
      }
      setParameters([]);
      setParametersError(getErrorMessage(error));
    } finally {
      if (parameterSerial.current === serial) setParametersLoading(false);
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, openGameId, openSkillKey, selectedGameId, skill?.skillKey, visible]);

  const loadFormulas = useCallback(async () => {
    const serial = formulaSerial.current + 1;
    formulaSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !openGameId || !openSkillKey || !token) {
      setFormulas([]);
      setFormulasError(null);
      setFormulasLoading(false);
      return;
    }
    setFormulasLoading(true);
    setFormulasError(null);
    try {
      const result = await listSkillFormulas(apiBaseUrl, openGameId, openSkillKey, token);
      if (formulaSerial.current !== serial) return;
      if (selectedGameId !== openGameId || skill?.skillKey !== openSkillKey) return;
      setFormulas(result.data);
    } catch (error) {
      if (formulaSerial.current !== serial) return;
      if (error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND') {
        onSkillMissing();
        return;
      }
      setFormulas([]);
      setFormulasError(getErrorMessage(error));
    } finally {
      if (formulaSerial.current === serial) setFormulasLoading(false);
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, openGameId, openSkillKey, selectedGameId, skill?.skillKey, visible]);

  const loadLevelRange = useCallback(async () => {
    const serial = levelSerial.current + 1;
    levelSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !openGameId || !token) {
      setCharacterLevelRange(null);
      setCharacterLevelLoadError(null);
      setCharacterLevelLoading(false);
      return;
    }
    setCharacterLevelLoading(true);
    setCharacterLevelLoadError(null);
    try {
      const result = await getLevelConfig(apiBaseUrl, openGameId, token);
      if (levelSerial.current !== serial) return;
      setCharacterLevelRange({
        minLevel: result.data.minLevel,
        maxLevel: result.data.maxLevel
      });
      setCharacterLevelLoadError(null);
    } catch (error) {
      if (levelSerial.current !== serial) return;
      setCharacterLevelRange(null);
      if (error instanceof ApiRequestError && error.code === '409.LEVEL_CONFIG_REQUIRED') {
        setCharacterLevelLoadError(null);
        return;
      }
      setCharacterLevelLoadError(getErrorMessage(error));
    } finally {
      if (levelSerial.current === serial) setCharacterLevelLoading(false);
    }
  }, [adminToken, apiBaseUrl, openGameId, visible]);

  useEffect(() => {
    if (!visible || !skill) {
      resetState();
      return;
    }
    setKeyword('');
    setParameterEditor(null);
    setFormulaEditor(null);
    setDeleteParameterTarget(null);
    setDeleteFormulaTarget(null);
    setDeleteError(null);
    void loadParameters();
    void loadFormulas();
    void loadLevelRange();
  }, [loadFormulas, loadLevelRange, loadParameters, resetState, skill, skill?.maxLevel, visible]);

  const filteredParameters = useMemo(() => {
    const needle = keyword.trim().toLocaleLowerCase();
    if (!needle) return parameters;
    return parameters.filter((item) => (
      item.name.toLocaleLowerCase().includes(needle)
      || item.parameterKey.toLocaleLowerCase().includes(needle)
    ));
  }, [keyword, parameters]);

  const grouped = useMemo(() => {
    const groups: Record<SkillParameterValueMode, SkillParameter[]> = {
      FIXED: [],
      SKILL_LEVEL: [],
      CHARACTER_LEVEL: [],
      RUNTIME_INPUT: []
    };
    for (const item of filteredParameters) {
      groups[item.valueMode].push(item);
    }
    return groups;
  }, [filteredParameters]);

  const skillLevels = useMemo(
    () => Array.from({ length: skill?.maxLevel ?? 0 }, (_, index) => index + 1),
    [skill?.maxLevel]
  );

  const characterLevels = useMemo(() => {
    if (!characterLevelRange) return [] as number[];
    return Array.from(
      { length: characterLevelRange.maxLevel - characterLevelRange.minLevel + 1 },
      (_, index) => characterLevelRange.minLevel + index
    );
  }, [characterLevelRange]);

  const close = () => {
    if (deleting) return;
    resetState();
    onClose();
  };

  const handleSkillMissing = () => {
    resetState();
    onSkillMissing();
  };

  const confirmDeleteParameter = async () => {
    if (!deleteParameterTarget || !selectedGameId || !skill || deleting) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSkillParameter(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        deleteParameterTarget.parameterKey,
        token
      );
      setDeleteParameterTarget(null);
      await loadParameters();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === '409.SKILL_PARAMETER_IN_USE') {
        setDeleteError('该参数正在被技能公式使用，不能删除');
      } else if (error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND') {
        handleSkillMissing();
      } else {
        setDeleteError(getErrorMessage(error));
      }
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteFormula = async () => {
    if (!deleteFormulaTarget || !selectedGameId || !skill || deleting) return;
    const token = adminToken.trim();
    if (!token) {
      setDeleteError('请先配置 Admin Token。');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSkillFormula(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        deleteFormulaTarget.formulaKey,
        token
      );
      setDeleteFormulaTarget(null);
      await loadFormulas();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND') {
        handleSkillMissing();
      } else {
        setDeleteError(getErrorMessage(error));
      }
    } finally {
      setDeleting(false);
    }
  };

  const fixedColumns: TableColumnProps[] = [
    { title: '参数名称', dataIndex: 'name', width: 160 },
    { title: '稳定标识', dataIndex: 'parameterKey', width: 160 },
    {
      title: '数值类型',
      dataIndex: 'valueType',
      width: 90,
      render: (value) => valueTypeLabel(value)
    },
    {
      title: '当前值',
      dataIndex: 'fixedValue',
      width: 100,
      render: (value) => (typeof value === 'number' ? formatParameterValue(value) : '—')
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value) => formatUpdatedAt(String(value ?? ''))
    },
    {
      title: '操作',
      width: 200,
      render: (_value, record: SkillParameter) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setParameterEditor({ mode: 'view', parameter: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setParameterEditor({ mode: 'edit', parameter: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            onClick={() => {
              setDeleteParameterTarget(record);
              setDeleteError(null);
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const runtimeColumns: TableColumnProps[] = [
    { title: '参数名称', dataIndex: 'name', width: 160 },
    { title: '稳定标识', dataIndex: 'parameterKey', width: 160 },
    {
      title: '数值类型',
      dataIndex: 'valueType',
      width: 90,
      render: (value) => valueTypeLabel(value)
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value) => formatUpdatedAt(String(value ?? ''))
    },
    {
      title: '操作',
      width: 200,
      render: (_value, record: SkillParameter) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setParameterEditor({ mode: 'view', parameter: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setParameterEditor({ mode: 'edit', parameter: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            onClick={() => {
              setDeleteParameterTarget(record);
              setDeleteError(null);
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const buildLevelColumns = (levels: number[]): TableColumnProps[] => [
    {
      title: '参数名称 / 标识',
      width: 200,
      fixed: 'left',
      render: (_value, record: SkillParameter) => (
        <div>
          <div>{record.name}</div>
          <Typography.Text type="secondary">{record.parameterKey}</Typography.Text>
        </div>
      )
    },
    ...levels.map((level) => ({
      title: `Lv${level}`,
      width: 80,
      render: (_value: unknown, record: SkillParameter) => {
        const value = record.levelValues?.[String(level)];
        return typeof value === 'number' ? formatParameterValue(value) : '—';
      }
    })),
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_value: unknown, record: SkillParameter) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setParameterEditor({ mode: 'view', parameter: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setParameterEditor({ mode: 'edit', parameter: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            onClick={() => {
              setDeleteParameterTarget(record);
              setDeleteError(null);
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const formulaColumns: TableColumnProps[] = [
    { title: '公式名称', dataIndex: 'name', width: 180 },
    { title: '稳定标识', dataIndex: 'formulaKey', width: 180 },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value) => formatUpdatedAt(String(value ?? ''))
    },
    {
      title: '操作',
      width: 200,
      render: (_value, record: SkillFormulaSummary) => (
        <Space size="mini">
          <Button size="mini" onClick={() => setFormulaEditor({ mode: 'view', formula: record })}>
            查看
          </Button>
          <Button size="mini" onClick={() => setFormulaEditor({ mode: 'edit', formula: record })}>
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            onClick={() => {
              setDeleteFormulaTarget(record);
              setDeleteError(null);
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const renderParameterSection = (
    title: string,
    mode: SkillParameterValueMode,
    columns: TableColumnProps[],
    scrollX?: number
  ) => (
    <div style={{ marginBottom: 24 }}>
      <Typography.Title heading={6} style={{ marginTop: 0 }}>{title}</Typography.Title>
      <Table
        className="data-table-shell"
        loading={parametersLoading}
        columns={columns}
        data={grouped[mode]}
        pagination={false}
        rowKey={(record: SkillParameter) => record.parameterKey}
        scroll={scrollX ? { x: scrollX } : undefined}
        noDataElement={<Empty />}
      />
    </div>
  );

  return (
    <>
      <Modal
        title={skill ? `参数与公式 - ${skill.name}` : '参数与公式'}
        visible={visible && skill !== null}
        maskClosable
        onCancel={close}
        style={{ width: 1100 }}
        footer={
          <Button onClick={close}>关闭</Button>
        }
      >
        <Tabs activeTab={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane key="parameters" title="技能参数">
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'end' }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>关键词</span>
                <Input
                  aria-label="参数关键词"
                  value={keyword}
                  allowClear
                  onChange={setKeyword}
                />
              </label>
              <Button
                type="primary"
                disabled={!selectedGameId || !adminToken.trim() || !skill}
                onClick={() => setParameterEditor({ mode: 'create', parameter: null })}
              >
                新增参数
              </Button>
            </div>
            {parametersError ? (
              <Alert
                type="error"
                className="workspace-alert"
                content={parametersError}
                action={
                  <Button size="mini" loading={parametersLoading} onClick={() => void loadParameters()}>
                    重试
                  </Button>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {renderParameterSection('固定值', 'FIXED', fixedColumns)}
            {renderParameterSection(
              '按技能等级',
              'SKILL_LEVEL',
              buildLevelColumns(skillLevels),
              220 + skillLevels.length * 80 + 200
            )}
            <div style={{ marginBottom: 24 }}>
              <Typography.Title heading={6} style={{ marginTop: 0 }}>按角色等级</Typography.Title>
              {characterLevelLoadError ? (
                <Alert
                  type="error"
                  className="workspace-alert"
                  content={characterLevelLoadError}
                  action={
                    <Button
                      size="mini"
                      loading={characterLevelLoading}
                      onClick={() => void loadLevelRange()}
                    >
                      重试
                    </Button>
                  }
                  style={{ marginBottom: 12 }}
                />
              ) : !characterLevelRange ? (
                <Alert type="warning" content="请先设置游戏等级范围" style={{ marginBottom: 12 }} />
              ) : null}
              <Table
                className="data-table-shell"
                loading={parametersLoading}
                columns={buildLevelColumns(characterLevels)}
                data={grouped.CHARACTER_LEVEL}
                pagination={false}
                rowKey={(record: SkillParameter) => record.parameterKey}
                scroll={{ x: 220 + Math.max(characterLevels.length, 1) * 80 + 200 }}
                noDataElement={<Empty />}
              />
            </div>
            {renderParameterSection('计算时传入', 'RUNTIME_INPUT', runtimeColumns)}
          </Tabs.TabPane>
          <Tabs.TabPane key="formulas" title="技能公式">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button
                type="primary"
                disabled={!selectedGameId || !adminToken.trim() || !skill}
                onClick={() => setFormulaEditor({ mode: 'create', formula: null })}
              >
                新增公式
              </Button>
            </div>
            {formulasError ? (
              <Alert
                type="error"
                className="workspace-alert"
                content={formulasError}
                action={
                  <Button size="mini" loading={formulasLoading} onClick={() => void loadFormulas()}>
                    重试
                  </Button>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            <Table
              className="data-table-shell"
              loading={formulasLoading}
              columns={formulaColumns}
              data={formulas}
              pagination={false}
              rowKey={(record: SkillFormulaSummary) => record.formulaKey}
              noDataElement={<Empty />}
            />
          </Tabs.TabPane>
        </Tabs>
      </Modal>

      {skill && selectedGameId ? (
        <SkillParameterEditorModal
          visible={parameterEditor !== null}
          mode={parameterEditor?.mode ?? 'view'}
          parameter={parameterEditor?.parameter ?? null}
          skillMaxLevel={skill.maxLevel}
          characterLevelRange={characterLevelRange}
          characterLevelUnavailableMessage={
            characterLevelLoadError ?? '请先设置游戏等级范围'
          }
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          skillKey={skill.skillKey}
          adminToken={adminToken}
          onClose={() => setParameterEditor(null)}
          onSaved={async () => {
            setParameterEditor(null);
            await loadParameters();
          }}
          onSkillMissing={handleSkillMissing}
        />
      ) : null}

      {skill && selectedGameId ? (
        <SkillFormulaEditorModal
          visible={formulaEditor !== null}
          mode={formulaEditor?.mode ?? 'view'}
          formula={formulaEditor?.formula ?? null}
          apiBaseUrl={apiBaseUrl}
          selectedGameId={selectedGameId}
          skillKey={skill.skillKey}
          adminToken={adminToken}
          onClose={() => setFormulaEditor(null)}
          onSaved={async () => {
            setFormulaEditor(null);
            await loadFormulas();
          }}
          onSkillMissing={handleSkillMissing}
        />
      ) : null}

      <Modal
        title="删除参数"
        visible={deleteParameterTarget !== null}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={deleting}
        maskClosable
        onCancel={() => {
          if (deleting) return;
          setDeleteParameterTarget(null);
          setDeleteError(null);
        }}
        onOk={() => void confirmDeleteParameter()}
      >
        {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
        {deleteParameterTarget
          ? `确定删除参数「${deleteParameterTarget.name}」吗？`
          : null}
      </Modal>

      <Modal
        title="删除公式"
        visible={deleteFormulaTarget !== null}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ status: 'danger' }}
        confirmLoading={deleting}
        maskClosable
        onCancel={() => {
          if (deleting) return;
          setDeleteFormulaTarget(null);
          setDeleteError(null);
        }}
        onOk={() => void confirmDeleteFormula()}
      >
        {deleteError ? <Alert type="error" content={deleteError} style={{ marginBottom: 12 }} /> : null}
        {deleteFormulaTarget
          ? `确定删除公式「${deleteFormulaTarget.name}」吗？`
          : null}
      </Modal>
    </>
  );
}
