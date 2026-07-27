import { Alert, Button, Input, InputNumber, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/Panel';
import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import {
  formatCombatDataError,
  getCombatDataState,
  getEffectSequences,
  getEffectSteps,
  getProviderFormulas,
  getTypes,
  putEffectStep
} from '../../../services/combatDataClient';
import type {
  EffectSequence,
  EffectStep,
  ProviderFormula,
  TypeDefinition
} from '../../../types/combatData';
import {
  EffectStepEditor,
  type EffectStepEditorState
} from '../combat-data/EffectStepEditor';
import {
  buildEffectStepPutBodyFromDraft,
  buildSemanticTypeOptions,
  createDefaultFormDraft,
  createUnavailableReason,
  defaultStepOrderForSequence,
  draftFromExistingStep,
  formatStableLabel,
  isStandardSequenceId,
  listProviderFormulasForSelectedSequence,
  listSortedSequences,
  listStepsForSequence,
  validateEffectStepSetup,
  withProviderActionOperation,
  withRecommendedOperationForFamily,
  type EffectStepSetupFormDraft
} from './effectStepSetupModel';

export type EffectStepSetupPageProps = {
  apiBaseUrl: string;
  selectedGameId: string | null;
  adminToken: string;
  gamesReachable: boolean;
};

type SaveResultSummary = {
  stepId: string;
  sequenceId: string;
  stepOrder: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  currentRevision: number;
};

function filterSelectOption(inputValue: string, option: unknown): boolean {
  const needle = inputValue.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (!option || typeof option !== 'object') {
    return false;
  }
  const record = option as {
    value?: unknown;
    children?: unknown;
    label?: unknown;
    props?: { value?: unknown; children?: unknown; label?: unknown };
  };
  const candidates = [
    record.value,
    record.label,
    record.children,
    record.props?.value,
    record.props?.label,
    record.props?.children
  ];
  return candidates.some((item) => String(item ?? '').toLowerCase().includes(needle));
}

function formatApiErrorWithDetails(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const base = error.code ? `${error.code}: ${error.message}` : error.message;
    if (error.details && Object.keys(error.details).length > 0) {
      return `${base} details=${JSON.stringify(error.details)}`;
    }
    return base;
  }
  return getErrorMessage(error);
}

export function EffectStepSetupPage({
  apiBaseUrl,
  selectedGameId,
  adminToken,
  gamesReachable
}: EffectStepSetupPageProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number | null>(null);
  const [types, setTypes] = useState<TypeDefinition[]>([]);
  const [sequences, setSequences] = useState<EffectSequence[]>([]);
  const [steps, setSteps] = useState<EffectStep[]>([]);
  const [typesLoaded, setTypesLoaded] = useState(false);
  const [sequencesLoaded, setSequencesLoaded] = useState(false);
  const [stepsLoaded, setStepsLoaded] = useState(false);
  const [providerFormulas, setProviderFormulas] = useState<ProviderFormula[]>([]);
  const [providerFormulasLoaded, setProviderFormulasLoaded] = useState(false);
  const [providerFormulasWarning, setProviderFormulasWarning] = useState<string | null>(null);

  const [draft, setDraft] = useState<EffectStepSetupFormDraft>(createDefaultFormDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SaveResultSummary | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const semanticTypeOptions = useMemo(() => buildSemanticTypeOptions(types), [types]);

  const validation = useMemo(
    () => validateEffectStepSetup(draft, steps, semanticTypeOptions),
    [draft, steps, semanticTypeOptions]
  );

  const createBlockReason = useMemo(
    () =>
      draft.selectedExistingStepId.trim() ? null : createUnavailableReason(draft.sequenceId),
    [draft.sequenceId, draft.selectedExistingStepId]
  );

  const sequenceOptions = useMemo(
    () =>
      listSortedSequences(sequences).map((item) => ({
        value: item.sequenceId,
        label: formatStableLabel(item.sequenceId, item.displayName)
      })),
    [sequences]
  );

  const stepOptions = useMemo(() => {
    const rows = listStepsForSequence(steps, draft.sequenceId);
    return rows.map((item) => ({
      value: item.stepId,
      label: `${item.stepId} (order ${item.stepOrder})`
    }));
  }, [steps, draft.sequenceId]);

  const providerFormulaRecords = useMemo(() => {
    if (!providerFormulasLoaded) {
      return undefined;
    }
    return listProviderFormulasForSelectedSequence(
      sequences,
      providerFormulas,
      draft.sequenceId
    );
  }, [providerFormulasLoaded, sequences, providerFormulas, draft.sequenceId]);

  const loadAll = useCallback(async () => {
    if (!selectedGameId) {
      setCurrentRevision(null);
      setTypes([]);
      setSequences([]);
      setSteps([]);
      setTypesLoaded(false);
      setSequencesLoaded(false);
      setStepsLoaded(false);
      setProviderFormulas([]);
      setProviderFormulasLoaded(false);
      setProviderFormulasWarning(null);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setProviderFormulasLoaded(false);
    setProviderFormulasWarning(null);

    const formulasPromise = getProviderFormulas(apiBaseUrl, selectedGameId);

    try {
      const [stateResult, typesResult, sequencesResult, stepsResult] = await Promise.all([
        getCombatDataState(apiBaseUrl, selectedGameId),
        getTypes(apiBaseUrl, selectedGameId),
        getEffectSequences(apiBaseUrl, selectedGameId),
        getEffectSteps(apiBaseUrl, selectedGameId)
      ]);

      setCurrentRevision(stateResult.data.currentRevision);
      setTypes(typesResult.data.data);
      setSequences(sequencesResult.data.data);
      setSteps(stepsResult.data.data);
      setTypesLoaded(true);
      setSequencesLoaded(true);
      setStepsLoaded(true);
    } catch (error) {
      setCurrentRevision(null);
      setTypes([]);
      setSequences([]);
      setSteps([]);
      setTypesLoaded(false);
      setSequencesLoaded(false);
      setStepsLoaded(false);
      setProviderFormulas([]);
      setProviderFormulasLoaded(false);
      setProviderFormulasWarning(null);
      setLoadError(
        formatCombatDataError(error, 'contract-entry', {
          apiBaseUrl,
          gamesReachable
        })
      );
      setLoading(false);
      void formulasPromise.catch(() => undefined);
      return;
    }

    setLoading(false);

    try {
      const formulasResult = await formulasPromise;
      setProviderFormulas(formulasResult.data.data);
      setProviderFormulasLoaded(true);
      setProviderFormulasWarning(null);
    } catch (error) {
      setProviderFormulas([]);
      setProviderFormulasLoaded(false);
      setProviderFormulasWarning(
        `Provider 公式列表加载失败，公式字段将保留手输：${formatApiErrorWithDetails(error)}`
      );
    }
  }, [apiBaseUrl, gamesReachable, selectedGameId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, reloadTick]);

  useEffect(() => {
    setDraft(createDefaultFormDraft());
    setLastResult(null);
    setSaveError(null);
    setSaveNotice(null);
    setTypesLoaded(false);
    setSequencesLoaded(false);
    setStepsLoaded(false);
    setProviderFormulas([]);
    setProviderFormulasLoaded(false);
    setProviderFormulasWarning(null);
  }, [selectedGameId]);

  const handleSequenceChange = (value: unknown) => {
    const sequenceId = typeof value === 'string' ? value : '';
    const next = createDefaultFormDraft();
    next.sequenceId = sequenceId;
    if (sequenceId) {
      next.stepOrder = defaultStepOrderForSequence(steps, sequenceId);
    }
    setDraft(next);
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleExistingStepChange = (value: unknown) => {
    const stepId = typeof value === 'string' ? value : '';
    if (!stepId) {
      setDraft((current) => {
        const next = createDefaultFormDraft();
        next.sequenceId = current.sequenceId;
        next.stepOrder = defaultStepOrderForSequence(steps, current.sequenceId);
        return next;
      });
      setSaveError(null);
      setSaveNotice(null);
      return;
    }
    const existing = steps.find((item) => item.stepId === stepId);
    if (!existing) {
      return;
    }
    setDraft(draftFromExistingStep(existing, semanticTypeOptions));
    setSaveError(null);
    setSaveNotice(null);
  };

  const handleEditorChange = (next: EffectStepEditorState) => {
    setDraft((current) => {
      let editor = next;
      if (next.detailFamily !== current.editor.detailFamily) {
        editor = withRecommendedOperationForFamily(next, next.detailFamily);
      } else if (
        next.detailFamily === 'providerDetail' &&
        String(next.detail.actionTypeId ?? '') !== String(current.editor.detail.actionTypeId ?? '')
      ) {
        editor = withProviderActionOperation(next, String(next.detail.actionTypeId ?? ''));
      }
      return { ...current, editor };
    });
    setSaveError(null);
    setSaveNotice(null);
  };

  const sequenceLocked = Boolean(draft.selectedExistingStepId.trim());
  const standardSequence = isStandardSequenceId(draft.sequenceId);
  const createDisabledVisibly =
    Boolean(draft.sequenceId.trim()) &&
    !draft.selectedExistingStepId.trim() &&
    !standardSequence;

  const canSave =
    Boolean(selectedGameId) &&
    gamesReachable === true &&
    !loading &&
    !loadError &&
    currentRevision !== null &&
    typesLoaded &&
    sequencesLoaded &&
    stepsLoaded &&
    validation.ok &&
    Boolean(adminToken.trim()) &&
    !saving;

  const handleSave = async () => {
    if (!selectedGameId || !validation.ok) {
      return;
    }

    const token = adminToken.trim();
    if (!token) {
      setSaveError('写入需要 Admin Token。');
      return;
    }

    const body = buildEffectStepPutBodyFromDraft(draft, validation.target, semanticTypeOptions);
    const targetStepId = validation.target.stepId;

    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    setLastResult(null);
    try {
      const result = await putEffectStep(apiBaseUrl, selectedGameId, targetStepId, token, body);
      setCurrentRevision(result.data.currentRevision);
      setLastResult({
        stepId: result.data.stepId,
        sequenceId: result.data.sequenceId,
        stepOrder: result.data.stepOrder,
        operationTypeId: result.data.operationTypeId,
        targetSelectorTypeId: result.data.targetSelectorTypeId,
        currentRevision: result.data.currentRevision
      });
      setSaveNotice(
        `已${validation.target.mode === 'update' ? '更新' : '创建'} Effect Step「${result.data.stepId}」（revision ${result.data.currentRevision}）。`
      );
      setReloadTick((value) => value + 1);
    } catch (error) {
      setSaveError(formatApiErrorWithDetails(error));
    } finally {
      setSaving(false);
    }
  };

  const editsDisabled = !selectedGameId || loading || saving;
  const target = validation.target;

  return (
    <div className="page-stack">
      <Panel
        title="Effect Step 创建"
        kicker="Effect Step Setup"
        actions={
          <Space>
            <Button loading={loading} onClick={() => void loadAll()} disabled={!selectedGameId}>
              刷新
            </Button>
            <Button type="primary" loading={saving} disabled={!canSave} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          普通 Effect Step 工作台：先选已有 Effect Sequence，再新建或有意更新该序列下的单步（
          <code>PUT /effect-steps/{'{stepId}'}</code>
          ；body 含 sequenceId / stepOrder / operationTypeId / targetSelectorTypeId、可选 conditionFormulaKey，以及恰好一个
          detail 家族）。本页是普通修订写，不是效果图聚合入口；直伤图见{' '}
          <a href="#/direct-damage-ability">#/direct-damage-ability</a>
          。高级分表仍可用{' '}
          <a href="#/combat-data/effect-steps">#/combat-data/effect-steps</a>。
        </Typography.Paragraph>

        {!selectedGameId ? <Alert type="warning" content="请先在顶部选择游戏。" /> : null}
        {loading ? (
          <Alert type="info" content="正在并发加载 combat-data state / types / effect-sequences / effect-steps…" />
        ) : null}
        {loadError ? <Alert type="error" content={loadError} /> : null}

        {selectedGameId && !loading && !loadError ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Text bold>当前 revision：</Typography.Text>{' '}
              <Tag color="arcoblue">{currentRevision ?? '—'}</Tag>
              <Tag color={typesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                typesLoaded={String(typesLoaded)}
              </Tag>
              <Tag color={sequencesLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                sequencesLoaded={String(sequencesLoaded)}
              </Tag>
              <Tag color={stepsLoaded ? 'green' : 'orangered'} style={{ marginLeft: 8 }}>
                stepsLoaded={String(stepsLoaded)}
              </Tag>
              {!adminToken.trim() ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  缺少 Admin Token，保存已禁用
                </Tag>
              ) : null}
              {!gamesReachable ? (
                <Tag color="orangered" style={{ marginLeft: 8 }}>
                  游戏列表不可达，保存已禁用
                </Tag>
              ) : null}
            </div>

            {sequences.length === 0 ? (
              <Alert
                type="warning"
                content={
                  <span>
                    当前游戏没有可用 Effect Sequence，请先到{' '}
                    <a href="#/effect-sequence-setup">#/effect-sequence-setup</a> 创建。
                  </span>
                }
              />
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>已有 Effect Sequence</span>
                <Select
                  showSearch
                  allowClear
                  placeholder="先选择 Sequence"
                  value={draft.sequenceId || undefined}
                  options={sequenceOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || sequenceLocked || sequences.length === 0}
                  onChange={handleSequenceChange}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>已有 Effect Step（可选；用于有意更新）</span>
                <Select
                  showSearch
                  allowClear
                  placeholder={
                    draft.sequenceId
                      ? createDisabledVisibly
                        ? '非标准 Sequence：请选择已有 Step（仅更新）'
                        : '留空=新建；选择则更新该 Step'
                      : '请先选择 Sequence'
                  }
                  value={draft.selectedExistingStepId || undefined}
                  options={stepOptions}
                  filterOption={filterSelectOption}
                  disabled={editsDisabled || !draft.sequenceId}
                  onChange={handleExistingStepChange}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>stepKey（可选；空白=主步骤 ID）</span>
                <Input
                  value={draft.stepKey}
                  disabled={
                    editsDisabled ||
                    !draft.sequenceId ||
                    sequenceLocked ||
                    createDisabledVisibly
                  }
                  placeholder="留空 → step_<stem>；填写 → step_<stem>_<key>"
                  onChange={(value) => {
                    setDraft((current) => ({ ...current, stepKey: value }));
                    setSaveError(null);
                    setSaveNotice(null);
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>步骤顺序 stepOrder</span>
                <InputNumber
                  value={draft.stepOrder}
                  disabled={editsDisabled || !draft.sequenceId}
                  onChange={(value) => {
                    setDraft((current) => ({
                      ...current,
                      stepOrder: typeof value === 'number' ? value : 0
                    }));
                    setSaveError(null);
                    setSaveNotice(null);
                  }}
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            {sequenceLocked ? (
              <Alert
                type="info"
                content="已选择既有 Effect Step：Sequence 选择已锁定。清除「已有 Effect Step」后可更换 Sequence 或改为新建。"
              />
            ) : null}

            {createBlockReason ? <Alert type="warning" content={createBlockReason} /> : null}
            {createDisabledVisibly ? (
              <Alert
                type="warning"
                content="新建已禁用：非标准 Sequence ID 仅支持更新已有 Step。请选择上方已有 Step，或改用 sequence_<stem> 形式的 Sequence。"
              />
            ) : null}

            <div>
              <Typography.Text bold>目标 Step ID（只读）：</Typography.Text>{' '}
              <code>
                {target.mode === 'create' || target.mode === 'update' ? target.stepId : '—'}
              </code>
              {target.mode === 'create' ? (
                <Tag color="green" style={{ marginLeft: 8 }}>
                  新建
                </Tag>
              ) : null}
              {target.mode === 'update' ? (
                <Tag color="arcoblue" style={{ marginLeft: 8 }}>
                  更新（保留遗留 ID）
                </Tag>
              ) : null}
            </div>

            {target.mode === 'update' ? (
              <Alert
                type="info"
                content={`将更新已有 Effect Step「${target.summary.stepId}」。stepId 固定不变（不是 ID 重命名）；可改 stepOrder / 操作 / 目标选择器 / detail。当前 stepOrder=${target.summary.stepOrder}。`}
              />
            ) : null}
            {target.mode === 'create' ? (
              <Alert type="success" content={`将创建新 Effect Step「${target.stepId}」。`} />
            ) : null}

            <Typography.Title heading={6} style={{ marginBottom: 0 }}>
              步骤内容（语义类型）
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              切换 Detail 家族会自动推荐对应 operation/*（Provider 初始为 apply_provider；选择
              provider_action 后对应 apply / refresh / expire）。推荐值可手动覆盖；仅当必选 typeKey
              无法从已加载 types 解析时才会拦截保存。
            </Typography.Paragraph>

            <EffectStepEditor
              value={draft.editor}
              readOnly={editsDisabled || !draft.sequenceId || createDisabledVisibly}
              hideIdentityFields
              semanticTypeOptions={semanticTypeOptions}
              providerFormulaRecords={providerFormulaRecords}
              onChange={handleEditorChange}
            />

            {providerFormulasWarning ? (
              <Alert type="warning" content={providerFormulasWarning} />
            ) : null}

            {!validation.ok &&
            (draft.sequenceId ||
              draft.stepKey ||
              draft.selectedExistingStepId ||
              draft.editor.common.operationTypeId) ? (
              <Alert type="warning" content={validation.reason} />
            ) : null}

            {saveError ? <Alert type="error" content={saveError} /> : null}
            {saveNotice ? <Alert type="success" content={saveNotice} /> : null}

            {lastResult ? (
              <section aria-label="保存结果">
                <Typography.Title heading={6}>保存结果</Typography.Title>
                <Typography.Paragraph style={{ marginTop: 0 }}>
                  stepId={lastResult.stepId} · sequenceId={lastResult.sequenceId} · stepOrder=
                  {lastResult.stepOrder} · operationTypeId={lastResult.operationTypeId} ·
                  targetSelectorTypeId={lastResult.targetSelectorTypeId} · revision=
                  {lastResult.currentRevision}
                </Typography.Paragraph>
              </section>
            ) : null}

            <Alert
              type="info"
              content={
                <span>
                  下一步：相位/监听绑定仍走分表；直伤图聚合入口见{' '}
                  <a href="#/direct-damage-ability">#/direct-damage-ability</a>
                  。推荐闭环：
                  <a href="#/effect-sequence-setup">#/effect-sequence-setup</a> → 本页。
                </span>
              }
            />
          </Space>
        ) : null}
      </Panel>
    </div>
  );
}
