import { useNumericParameters } from '../useNumericParameters';
import { NumericValueField } from '../NumericValueField';
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import { listSkillEffects } from '../../../../services/skillEffectClient';
import { listSkillFormulas } from '../../../../services/skillFormulaClient';
import { listSkillInternalStates, getSkillInternalState } from '../../../../services/skillInternalStateClient';
import { createSkillProcess, getSkillProcess, updateSkillProcess } from '../../../../services/skillProcessClient';
import type { Skill } from '../../../../types/skill';
import type { SkillEffectSummary } from '../../../../types/skillEffect';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type { SkillInternalStateSummary } from '../../../../types/skillInternalState';
import type { SkillProcess, SkillProcessActivationType, SkillProcessSummary } from '../../../../types/skillProcess';
import {
  SkillProcessEffectBindingEditorModal,
  type SkillProcessEffectBindingEditorMode
} from './SkillProcessEffectBindingEditorModal';
import { SkillProcessMomentFields } from './SkillProcessMomentFields';
import {
  SkillProcessStateOperationEditorModal,
  type SkillProcessStateOperationEditorMode
} from './SkillProcessStateOperationEditorModal';
import {
  SkillProcessStepEditorModal,
  type SkillProcessStepEditorMode
} from './SkillProcessStepEditorModal';
import {
  MILLISECOND_FORMULA_HINT,
  MISSING_CATALOG_LABEL,
  SKILL_PROCESS_ACTIVATION_TYPES,
  SKILL_PROCESS_ACTIVATION_TYPE_LABELS,
  SKILL_PROCESS_MOMENT_TYPE_LABELS,
  SKILL_PROCESS_STEP_TYPE_LABELS,
  STATE_OPERATION_LABELS,
  buildCreateSkillProcessRequest,
  buildUpdateSkillProcessRequest,
  createEmptyEffectBindingDraft,
  createEmptyProcessDraft,
  createEmptyStateOperationDraft,
  createEmptyStepDraft,
  findStepDeleteBlockers,
  isProcessLevelMoment,
  mapSkillProcessFieldIssues,
  operationValueSummary,
  skillProcessToDraft,
  sortBindingDrafts,
  sortOperationDrafts,
  sortStepDrafts,
  stepSummary,
  validateSkillProcessDraft,
  type IndexedFieldErrors,
  type SkillProcessDraft,
  type SkillProcessDraftErrors,
  type SkillProcessEffectBindingDraft,
  type SkillProcessEffectBindingDraftErrors,
  type SkillProcessStateOperationDraft,
  type SkillProcessStateOperationDraftErrors,
  type SkillProcessStepDraft,
  type SkillProcessStepDraftErrors
} from './processForm';

export type SkillProcessEditorMode = 'create' | 'view' | 'edit';

type SkillProcessEditorModalProps = {
  visible: boolean;
  mode: SkillProcessEditorMode;
  skill: Skill;
  process: SkillProcessSummary | null;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onSaved: (process: SkillProcess) => void | Promise<void>;
  onSkillMissing: () => void;
  onDirtyChange: (dirty: boolean) => void;
  catalogRevision: number;
  onOpenParameterFormula?: () => void;
  onOpenEffects?: () => void;
};

type StepEditorState = {
  mode: SkillProcessStepEditorMode;
  index: number | null;
  draft: SkillProcessStepDraft;
  fieldErrors: SkillProcessStepDraftErrors;
};

type BindingEditorState = {
  mode: SkillProcessEffectBindingEditorMode;
  index: number | null;
  draft: SkillProcessEffectBindingDraft;
  fieldErrors: SkillProcessEffectBindingDraftErrors;
};

type OperationEditorState = {
  mode: SkillProcessStateOperationEditorMode;
  index: number | null;
  draft: SkillProcessStateOperationDraft;
  fieldErrors: SkillProcessStateOperationDraftErrors;
};

const EMPTY_STEP = createEmptyStepDraft();
const EMPTY_BINDING = createEmptyEffectBindingDraft();
const EMPTY_OPERATION = createEmptyStateOperationDraft();

function titleFor(mode: SkillProcessEditorMode): string {
  if (mode === 'create') return '新增过程';
  if (mode === 'edit') return '编辑过程';
  return '查看过程';
}

function composeSaveError(error: unknown, unmappedMessages: string[]): string {
  const general = getErrorMessage(error);
  const extra = unmappedMessages.filter((item) => item && item !== general);
  return extra.length > 0 ? [general, ...extra].join('；') : general;
}

function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

function errorSummary(errors: object | undefined): string | null {
  if (!errors) return null;
  const messages = Object.values(errors).filter((item): item is string => Boolean(item));
  return messages.length > 0 ? messages.join('；') : null;
}

function sortWithIndex<T>(
  items: T[],
  sort: (items: T[]) => T[]
): Array<{ item: T; index: number }> {
  const sorted = sort(items);
  const used = new Set<number>();
  return sorted.map((item) => {
    const index = items.findIndex((candidate, candidateIndex) => (
      !used.has(candidateIndex) && candidate === item
    ));
    used.add(index);
    return { item, index };
  });
}

export function SkillProcessEditorModal({
  visible,
  mode,
  skill,
  process,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onSkillMissing,
  onDirtyChange,
  catalogRevision,
  onOpenParameterFormula,
  onOpenEffects
}: SkillProcessEditorModalProps) {
  const [draft, setDraft] = useState<SkillProcessDraft>(createEmptyProcessDraft());
  const [baseline, setBaseline] = useState<SkillProcessDraft>(createEmptyProcessDraft());
  const [errors, setErrors] = useState<SkillProcessDraftErrors>({});
  const [stepErrors, setStepErrors] = useState<IndexedFieldErrors<SkillProcessStepDraftErrors>[]>([]);
  const [bindingErrors, setBindingErrors] = useState<IndexedFieldErrors<SkillProcessEffectBindingDraftErrors>[]>([]);
  const [operationErrors, setOperationErrors] = useState<IndexedFieldErrors<SkillProcessStateOperationDraftErrors>[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formulasError, setFormulasError] = useState<string | null>(null);
  const [effectsError, setEffectsError] = useState<string | null>(null);
  const [internalStatesError, setInternalStatesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [formulas, setFormulas] = useState<SkillFormulaSummary[]>([]);
  const { parameters, parametersLoadState } = useNumericParameters(apiBaseUrl, selectedGameId, skill.skillKey, adminToken, visible, catalogRevision);
  const [effects, setEffects] = useState<SkillEffectSummary[]>([]);
  const [internalStates, setInternalStates] = useState<SkillInternalStateSummary[]>([]);
  const [modeOptionsByStateKey, setModeOptionsByStateKey] = useState<{ [stateKey: string]: Array<{ optionKey: string; name: string }> }>({});
  const [formulasLoadState, setFormulasLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [effectsLoadState, setEffectsLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [internalStatesLoadState, setInternalStatesLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [stepEditor, setStepEditor] = useState<StepEditorState | null>(null);
  const [bindingEditor, setBindingEditor] = useState<BindingEditorState | null>(null);
  const [operationEditor, setOperationEditor] = useState<OperationEditorState | null>(null);
  const [stepDeleteError, setStepDeleteError] = useState<string | null>(null);
  const detailSerial = useRef(0);
  const formulaSerial = useRef(0);
  const effectSerial = useRef(0);
  const internalStateSerial = useRef(0);
  const readOnly = mode === 'view';
  const closeBlocked = saving || (mode === 'edit' && loadingDetail);

  const reportDirty = useCallback((next: SkillProcessDraft, currentBaseline: SkillProcessDraft) => {
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(currentBaseline));
  }, [onDirtyChange]);

  const resetLocalState = useCallback(() => {
    detailSerial.current += 1;
    formulaSerial.current += 1;
    effectSerial.current += 1;
    internalStateSerial.current += 1;
    const empty = createEmptyProcessDraft();
    setDraft(empty);
    setBaseline(empty);
    setErrors({});
    setStepErrors([]);
    setBindingErrors([]);
    setOperationErrors([]);
    setSaveError(null);
    setLoadError(null);
    setFormulasError(null);
    setEffectsError(null);
    setInternalStatesError(null);
    setSaving(false);
    setLoadingDetail(false);
    setDetailReady(false);
    setFormulas([]);
    setEffects([]);
    setInternalStates([]);
    setModeOptionsByStateKey({});
    setFormulasLoadState(undefined);
    setEffectsLoadState(undefined);
    setInternalStatesLoadState(undefined);
    setStepEditor(null);
    setBindingEditor(null);
    setOperationEditor(null);
    setStepDeleteError(null);
  }, [mode]);

  const loadFormulas = useCallback(async () => {
    const serial = formulaSerial.current + 1;
    formulaSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setFormulas([]);
      setFormulasLoadState(undefined);
      setFormulasError(null);
      return;
    }
    try {
      const result = await listSkillFormulas(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (formulaSerial.current !== serial) return;
      setFormulas(result.data);
      setFormulasLoadState('ready');
      setFormulasError(null);
    } catch (error) {
      if (formulaSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setFormulas([]);
      setFormulasLoadState('failed');
      setFormulasError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, selectedGameId, skill.skillKey, visible]);

  const loadEffects = useCallback(async () => {
    const serial = effectSerial.current + 1;
    effectSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setEffects([]);
      setEffectsLoadState(undefined);
      setEffectsError(null);
      return;
    }
    try {
      const result = await listSkillEffects(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (effectSerial.current !== serial) return;
      setEffects(result.data);
      setEffectsLoadState('ready');
      setEffectsError(null);
    } catch (error) {
      if (effectSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setEffects([]);
      setEffectsLoadState('failed');
      setEffectsError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, selectedGameId, skill.skillKey, visible]);

  const loadInternalStates = useCallback(async () => {
    const serial = internalStateSerial.current + 1;
    internalStateSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setInternalStates([]);
      setInternalStatesLoadState(undefined);
      setInternalStatesError(null);
      return;
    }
    try {
      const result = await listSkillInternalStates(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (internalStateSerial.current !== serial) return;
      setInternalStates(result.data);
      setInternalStatesLoadState('ready');
      setInternalStatesError(null);
      const modeStates = result.data.filter((item) => item.stateType === 'MODE');
      const nextOptions: { [stateKey: string]: Array<{ optionKey: string; name: string }> } = {};
      for (const item of modeStates) {
        try {
          const detail = await getSkillInternalState(apiBaseUrl, selectedGameId, skill.skillKey, item.stateKey, token);
          if (internalStateSerial.current !== serial) return;
          if (detail.data.stateType === 'MODE') {
            nextOptions[item.stateKey] = detail.data.detail.options.map((option) => ({
              optionKey: option.optionKey,
              name: option.name
            }));
          }
        } catch {
          if (internalStateSerial.current !== serial) return;
        }
      }
      if (internalStateSerial.current !== serial) return;
      setModeOptionsByStateKey(nextOptions);
    } catch (error) {
      if (internalStateSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setInternalStates([]);
      setInternalStatesLoadState('failed');
      setInternalStatesError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, onSkillMissing, selectedGameId, skill.skillKey, visible]);

  const loadDetail = useCallback(async () => {
    const serial = detailSerial.current + 1;
    detailSerial.current = serial;
    if (!visible) {
      setLoadingDetail(false);
      return;
    }
    if (mode === 'create') {
      const empty = createEmptyProcessDraft();
      setDraft(empty);
      setBaseline(empty);
      setDetailReady(true);
      setLoadingDetail(false);
      setLoadError(null);
      onDirtyChange(false);
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setLoadError('请先配置 Admin Token。');
      setDetailReady(false);
      setLoadingDetail(false);
      return;
    }
    if (!process) {
      setLoadError('过程详情加载失败。');
      setDetailReady(false);
      setLoadingDetail(false);
      return;
    }
    setDetailReady(false);
    setLoadingDetail(true);
    setLoadError(null);
    try {
      const result = await getSkillProcess(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        process.processKey,
        token
      );
      if (detailSerial.current !== serial) return;
      const next = skillProcessToDraft(result.data);
      setDraft(next);
      setBaseline(next);
      setDetailReady(true);
      onDirtyChange(false);
    } catch (error) {
      if (detailSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setDetailReady(false);
      setLoadError(getErrorMessage(error));
    } finally {
      if (detailSerial.current === serial) setLoadingDetail(false);
    }
  }, [
    adminToken,
    apiBaseUrl,
    mode,
    onDirtyChange,
    onSkillMissing,
    process,
    selectedGameId,
    skill.skillKey,
    visible
  ]);

  useEffect(() => {
    if (!visible) {
      resetLocalState();
      onDirtyChange(false);
      return;
    }
    setErrors({});
    setStepErrors([]);
    setBindingErrors([]);
    setOperationErrors([]);
    setSaveError(null);
    setStepEditor(null);
    setBindingEditor(null);
    setOperationEditor(null);
    setSaving(false);
    void loadDetail();
    void loadFormulas();
    void loadEffects();
    void loadInternalStates();
  }, [
    loadDetail,
    loadEffects,
    loadFormulas,
    loadInternalStates,
    onDirtyChange,
    resetLocalState,
    visible
  ]);

  const catalogRevisionRef = useRef(catalogRevision);
  useEffect(() => {
    const previous = catalogRevisionRef.current;
    catalogRevisionRef.current = catalogRevision;
    if (!visible || previous === catalogRevision) {
      return;
    }
    void loadFormulas();
    void loadEffects();
  }, [catalogRevision, loadEffects, loadFormulas, visible]);

  const patchDraft = (next: SkillProcessDraft) => {
    setDraft(next);
    setErrors({});
    setSaveError(null);
    setStepDeleteError(null);
    reportDirty(next, baseline);
  };

  const close = () => {
    if (closeBlocked) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    if (readOnly || saving || !detailReady || (mode === 'edit' && loadingDetail)) return;
    const sorted: SkillProcessDraft = {
      ...draft,
      steps: sortStepDrafts(draft.steps),
      effectBindings: sortBindingDrafts(draft.effectBindings),
      stateOperations: sortOperationDrafts(draft.stateOperations)
    };
    const validation = validateSkillProcessDraft(sorted, {
      parameters, parametersLoadState,
      includeProcessKey: mode === 'create',
      catalog: {
        formulas,
        effects,
        internalStates,
        modeOptionsByStateKey
      },
      catalogLoadState: {
        formulas: formulasLoadState,
        effects: effectsLoadState,
        internalStates: internalStatesLoadState
      }
    });
    if (!validation.ok) {
      setDraft(sorted);
      setErrors(validation.fieldErrors);
      setStepErrors(validation.stepErrors);
      setBindingErrors(validation.bindingErrors);
      setOperationErrors(validation.operationErrors);
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = mode === 'create'
        ? await createSkillProcess(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            token,
            buildCreateSkillProcessRequest(validation.normalized)
          )
        : await updateSkillProcess(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            process!.processKey,
            token,
            buildUpdateSkillProcessRequest(validation.normalized)
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      const mapped = mapSkillProcessFieldIssues(error);
      setDraft(sorted);
      setErrors(mapped.fieldErrors);
      setStepErrors(mapped.stepErrors);
      setBindingErrors(mapped.bindingErrors);
      setOperationErrors(mapped.operationErrors);
      setSaveError(composeSaveError(error, mapped.unmappedMessages));
    } finally {
      setSaving(false);
    }
  };

  const displayedSteps = useMemo(() => sortWithIndex(draft.steps, sortStepDrafts), [draft.steps]);
  const displayedBindings = useMemo(
    () => sortWithIndex(draft.effectBindings, sortBindingDrafts),
    [draft.effectBindings]
  );
  const displayedOperations = useMemo(
    () => sortWithIndex(draft.stateOperations, sortOperationDrafts),
    [draft.stateOperations]
  );

  const stepErrorMap = useMemo(() => {
    const map = new Map<number, SkillProcessStepDraftErrors>();
    for (const item of stepErrors) map.set(item.index, item.fieldErrors);
    return map;
  }, [stepErrors]);
  const bindingErrorMap = useMemo(() => {
    const map = new Map<number, SkillProcessEffectBindingDraftErrors>();
    for (const item of bindingErrors) map.set(item.index, item.fieldErrors);
    return map;
  }, [bindingErrors]);
  const operationErrorMap = useMemo(() => {
    const map = new Map<number, SkillProcessStateOperationDraftErrors>();
    for (const item of operationErrors) map.set(item.index, item.fieldErrors);
    return map;
  }, [operationErrors]);
  const effectNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of effects) names.set(item.effectKey, item.name);
    return names;
  }, [effects]);
  const stateNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of internalStates) names.set(item.stateKey, item.name);
    return names;
  }, [internalStates]);

  const deleteStep = (index: number) => {
    const step = draft.steps[index];
    if (!step) return;
    const blockers = findStepDeleteBlockers(step.stepKey, draft);
    if (blockers.length > 0) {
      setStepDeleteError(`无法删除步骤「${step.name || step.stepKey}」，仍被引用：${blockers.map((item) => item.label).join('、')}`);
      return;
    }
    patchDraft({ ...draft, steps: draft.steps.filter((_, itemIndex) => itemIndex !== index) });
    setStepErrors((current) => current
      .filter((item) => item.index !== index)
      .map((item) => ({
        ...item,
        index: item.index > index ? item.index - 1 : item.index
      })));
  };

  const stepColumns: TableColumnProps[] = [
    {
      title: '步骤名称',
      render: (_value, row: { item: SkillProcessStepDraft; index: number }) => (
        <div>
          <div>{row.item.name || '—'}</div>
          {errorSummary(stepErrorMap.get(row.index)) ? (
            <Typography.Text type="error">{errorSummary(stepErrorMap.get(row.index))}</Typography.Text>
          ) : null}
        </div>
      )
    },
    {
      title: '稳定标识',
      render: (_value, row: { item: SkillProcessStepDraft }) => row.item.stepKey || '—'
    },
    {
      title: '步骤种类',
      render: (_value, row: { item: SkillProcessStepDraft }) => SKILL_PROCESS_STEP_TYPE_LABELS[row.item.stepType]
    },
    {
      title: '关键时间或次数摘要',
      render: (_value, row: { item: SkillProcessStepDraft }) => stepSummary(row.item)
    },
    {
      title: '排序',
      render: (_value, row: { item: SkillProcessStepDraft }) => row.item.sortOrder
    },
    {
      title: '操作',
      render: (_value, row: { item: SkillProcessStepDraft; index: number }) => (
        <Space size="mini">
          <Button
            size="mini"
            onClick={() => setStepEditor({
              mode: 'view',
              index: row.index,
              draft: row.item,
              fieldErrors: stepErrorMap.get(row.index) ?? {}
            })}
          >
            查看
          </Button>
          {!readOnly ? (
            <>
              <Button
                size="mini"
                onClick={() => setStepEditor({
                  mode: 'edit',
                  index: row.index,
                  draft: row.item,
                  fieldErrors: stepErrorMap.get(row.index) ?? {}
                })}
              >
                编辑
              </Button>
              <Button size="mini" status="danger" disabled={saving} onClick={() => deleteStep(row.index)}>
                删除
              </Button>
            </>
          ) : null}
        </Space>
      )
    }
  ];

  const bindingColumns: TableColumnProps[] = [
    {
      title: '挂接标识',
      render: (_value, row: { item: SkillProcessEffectBindingDraft; index: number }) => (
        <div>
          <div>{row.item.bindingKey || '—'}</div>
          {errorSummary(bindingErrorMap.get(row.index)) ? (
            <Typography.Text type="error">{errorSummary(bindingErrorMap.get(row.index))}</Typography.Text>
          ) : null}
        </div>
      )
    },
    {
      title: '效果',
      render: (_value, row: { item: SkillProcessEffectBindingDraft }) => {
        const name = effectNames.get(row.item.effectKey);
        if (!name && row.item.effectKey) return `${row.item.effectKey}（${MISSING_CATALOG_LABEL}）`;
        return name || row.item.effectKey || '—';
      }
    },
    {
      title: '过程时点',
      render: (_value, row: { item: SkillProcessEffectBindingDraft }) => {
        const momentLabel = SKILL_PROCESS_MOMENT_TYPE_LABELS[row.item.momentType];
        return row.item.stepKey ? `${momentLabel} / ${row.item.stepKey}` : momentLabel;
      }
    },
    {
      title: '排序',
      render: (_value, row: { item: SkillProcessEffectBindingDraft }) => row.item.sortOrder
    },
    {
      title: '操作',
      render: (_value, row: { item: SkillProcessEffectBindingDraft; index: number }) => (
        <Space size="mini">
          <Button
            size="mini"
            onClick={() => setBindingEditor({
              mode: 'view',
              index: row.index,
              draft: row.item,
              fieldErrors: bindingErrorMap.get(row.index) ?? {}
            })}
          >
            查看
          </Button>
          {!readOnly ? (
            <>
              <Button
                size="mini"
                onClick={() => setBindingEditor({
                  mode: 'edit',
                  index: row.index,
                  draft: row.item,
                  fieldErrors: bindingErrorMap.get(row.index) ?? {}
                })}
              >
                编辑
              </Button>
              <Button
                size="mini"
                status="danger"
                disabled={saving}
                onClick={() => {
                  patchDraft({
                    ...draft,
                    effectBindings: draft.effectBindings.filter((_, index) => index !== row.index)
                  });
                  setBindingErrors((current) => current
                    .filter((item) => item.index !== row.index)
                    .map((item) => ({
                      ...item,
                      index: item.index > row.index ? item.index - 1 : item.index
                    })));
                }}
              >
                删除
              </Button>
            </>
          ) : null}
        </Space>
      )
    }
  ];

  const operationColumns: TableColumnProps[] = [
    {
      title: '操作名称',
      render: (_value, row: { item: SkillProcessStateOperationDraft; index: number }) => (
        <div>
          <div>{row.item.name || '—'}</div>
          {errorSummary(operationErrorMap.get(row.index)) ? (
            <Typography.Text type="error">{errorSummary(operationErrorMap.get(row.index))}</Typography.Text>
          ) : null}
        </div>
      )
    },
    {
      title: '稳定标识',
      render: (_value, row: { item: SkillProcessStateOperationDraft }) => row.item.operationKey || '—'
    },
    {
      title: '内部状态',
      render: (_value, row: { item: SkillProcessStateOperationDraft }) => {
        const name = stateNames.get(row.item.stateKey);
        if (!name && row.item.stateKey) return `${row.item.stateKey}（${MISSING_CATALOG_LABEL}）`;
        return name || row.item.stateKey || '—';
      }
    },
    {
      title: '操作',
      render: (_value, row: { item: SkillProcessStateOperationDraft }) => (
        row.item.operation ? STATE_OPERATION_LABELS[row.item.operation] : '—'
      )
    },
    {
      title: '数值或模式选项摘要',
      render: (_value, row: { item: SkillProcessStateOperationDraft }) => operationValueSummary(row.item)
    },
    {
      title: '过程时点',
      render: (_value, row: { item: SkillProcessStateOperationDraft }) => {
        const momentLabel = SKILL_PROCESS_MOMENT_TYPE_LABELS[row.item.momentType];
        return row.item.stepKey ? `${momentLabel} / ${row.item.stepKey}` : momentLabel;
      }
    },
    {
      title: '排序',
      render: (_value, row: { item: SkillProcessStateOperationDraft }) => row.item.sortOrder
    },
    {
      title: '操作',
      render: (_value, row: { item: SkillProcessStateOperationDraft; index: number }) => (
        <Space size="mini">
          <Button
            size="mini"
            onClick={() => setOperationEditor({
              mode: 'view',
              index: row.index,
              draft: row.item,
              fieldErrors: operationErrorMap.get(row.index) ?? {}
            })}
          >
            查看
          </Button>
          {!readOnly ? (
            <>
              <Button
                size="mini"
                onClick={() => setOperationEditor({
                  mode: 'edit',
                  index: row.index,
                  draft: row.item,
                  fieldErrors: operationErrorMap.get(row.index) ?? {}
                })}
              >
                编辑
              </Button>
              <Button
                size="mini"
                status="danger"
                disabled={saving}
                onClick={() => {
                  patchDraft({
                    ...draft,
                    stateOperations: draft.stateOperations.filter((_, index) => index !== row.index)
                  });
                  setOperationErrors((current) => current
                    .filter((item) => item.index !== row.index)
                    .map((item) => ({
                      ...item,
                      index: item.index > row.index ? item.index - 1 : item.index
                    })));
                }}
              >
                删除
              </Button>
            </>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <>
      <Modal
        title={titleFor(mode)}
        visible={visible}
        maskClosable
        onCancel={close}
        style={{ width: 'calc(100vw - 80px)', maxWidth: 1800 }}
        footer={
          <Space>
            {!readOnly ? (
              <>
                <Button onClick={onOpenParameterFormula}>参数与公式</Button>
                <Button onClick={onOpenEffects}>效果与结果</Button>
              </>
            ) : null}
            <Button onClick={close} disabled={closeBlocked}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly ? (
              <Button
                type="primary"
                loading={saving || (mode === 'edit' && loadingDetail)}
                disabled={!detailReady}
                onClick={() => void save()}
              >
                保存
              </Button>
            ) : null}
          </Space>
        }
      >
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          {saveError ? <Alert type="error" content={saveError} /> : null}
          {loadError ? (
            <Alert
              type="error"
              content={loadError}
              action={<Button size="mini" loading={loadingDetail} onClick={() => void loadDetail()}>重试</Button>}
            />
          ) : null}
          {formulasError ? (
            <Alert
              type="error"
              content={formulasError}
              action={<Button size="mini" onClick={() => void loadFormulas()}>重试</Button>}
            />
          ) : null}
          {effectsError ? (
            <Alert
              type="error"
              content={effectsError}
              action={<Button size="mini" onClick={() => void loadEffects()}>重试</Button>}
            />
          ) : null}
          {internalStatesError ? (
            <Alert
              type="error"
              content={internalStatesError}
              action={<Button size="mini" onClick={() => void loadInternalStates()}>重试</Button>}
            />
          ) : null}
          {stepDeleteError ? <Alert type="error" content={stepDeleteError} /> : null}

          {mode === 'create' || (detailReady && !loadingDetail) ? (
          <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          <Form layout="vertical">
            <Form.Item
              label="过程标识"
              required
              validateStatus={errors.processKey ? 'error' : undefined}
              help={errors.processKey}
            >
              <Input
                aria-label="过程标识"
                value={draft.processKey}
                disabled={readOnly || mode !== 'create' || saving}
                maxLength={64}
                onChange={(value) => patchDraft({ ...draft, processKey: value })}
              />
            </Form.Item>
            <Form.Item
              label="过程名称"
              required
              validateStatus={errors.name ? 'error' : undefined}
              help={errors.name}
            >
              <Input
                aria-label="过程名称"
                value={draft.name}
                disabled={readOnly || saving}
                maxLength={100}
                onChange={(value) => patchDraft({ ...draft, name: value })}
              />
            </Form.Item>
            <Form.Item
              label="启动方式"
              required
              validateStatus={errors.activationType ? 'error' : undefined}
              help={errors.activationType}
            >
              <Select
                aria-label="启动方式"
                value={draft.activationType}
                disabled={readOnly || saving}
                options={SKILL_PROCESS_ACTIVATION_TYPES.map((value) => ({
                  value,
                  label: SKILL_PROCESS_ACTIVATION_TYPE_LABELS[value]
                }))}
                onChange={(value) => patchDraft({ ...draft, activationType: value as SkillProcessActivationType })}
              />
            </Form.Item>
            <Form.Item
              label="排序"
              required
              validateStatus={errors.sortOrder ? 'error' : undefined}
              help={errors.sortOrder}
            >
              <InputNumber
                aria-label="排序"
                value={draft.sortOrder.trim() ? Number(draft.sortOrder) : undefined}
                disabled={readOnly || saving}
                min={0}
                precision={0}
                style={{ width: '100%' }}
                onChange={(value) => patchDraft({ ...draft, sortOrder: value === undefined ? '' : String(value) })}
              />
            </Form.Item>
            <Form.Item
              label="说明"
              validateStatus={errors.description ? 'error' : undefined}
              help={errors.description}
            >
              <Input.TextArea
                aria-label="说明"
                value={draft.description}
                disabled={readOnly || saving}
                maxLength={2000}
                showWordLimit
                autoSize={{ minRows: 3, maxRows: 6 }}
                onChange={(value) => patchDraft({ ...draft, description: value })}
              />
            </Form.Item>
            <Form.Item label="普通冷却" required>
              <Radio.Group
                aria-label="普通冷却"
                value={draft.cooldownEnabled ? 'configured' : 'none'}
                disabled={readOnly || saving}
                onChange={(value) => patchDraft({
                  ...draft,
                  cooldownEnabled: value === 'configured',
                  cooldownDurationValue: value === 'configured' ? draft.cooldownDurationValue : null,
                  cooldownMomentType: value === 'configured' ? draft.cooldownMomentType : 'PROCESS_START',
                  cooldownStepKey: value === 'configured' ? draft.cooldownStepKey : ''
                })}
              >
                <Radio value="none">无普通冷却</Radio>
                <Radio value="configured">配置普通冷却</Radio>
              </Radio.Group>
            </Form.Item>
            {draft.cooldownEnabled ? (
              <>
                <Form.Item
                  label="冷却时长取值"
                  required
                  extra={MILLISECOND_FORMULA_HINT}
                  validateStatus={errors.cooldownDurationValue ? 'error' : undefined}
                  help={errors.cooldownDurationValue}
                >
                  <NumericValueField aria-label="冷却时长取值"
                  value={draft.cooldownDurationValue}
                  onChange={(value) => patchDraft({ ...draft, cooldownDurationValue: value! })}
                  parameters={parameters}
                  parametersLoadState={parametersLoadState}
                  formulas={formulas}
                  disabled={readOnly || saving} />
                </Form.Item>
                <SkillProcessMomentFields
                  momentType={draft.cooldownMomentType}
                  stepKey={draft.cooldownStepKey}
                  steps={draft.steps}
                  momentError={errors.cooldownMoment}
                  disabled={readOnly || saving}
                  onMomentTypeChange={(value) => patchDraft({
                    ...draft,
                    cooldownMomentType: value,
                    cooldownStepKey: isProcessLevelMoment(value) ? '' : draft.cooldownStepKey
                  })}
                  onStepKeyChange={(value) => patchDraft({ ...draft, cooldownStepKey: value })}
                />
              </>
            ) : null}
          </Form>

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Typography.Title heading={6} style={{ margin: 0 }}>过程步骤</Typography.Title>
              {!readOnly ? (
                <Button
                  type="primary"
                  disabled={saving || !detailReady}
                  onClick={() => setStepEditor({
                    mode: 'create',
                    index: null,
                    draft: createEmptyStepDraft(),
                    fieldErrors: {}
                  })}
                >
                  新增步骤
                </Button>
              ) : null}
            </div>
            {errors.steps ? <Alert type="error" content={errors.steps} style={{ marginBottom: 12 }} /> : null}
            <Table
              className="data-table-shell"
              loading={loadingDetail}
              columns={stepColumns}
              data={displayedSteps}
              pagination={false}
              rowKey={(row: { item: SkillProcessStepDraft; index: number }) => `${row.index}-${row.item.stepKey || 'new'}`}
              noDataElement={<Empty description="暂无步骤" />}
            />
          </section>

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Typography.Title heading={6} style={{ margin: 0 }}>效果挂接</Typography.Title>
              {!readOnly ? (
                <Button
                  type="primary"
                  disabled={saving || !detailReady}
                  onClick={() => setBindingEditor({
                    mode: 'create',
                    index: null,
                    draft: createEmptyEffectBindingDraft(),
                    fieldErrors: {}
                  })}
                >
                  新增效果挂接
                </Button>
              ) : null}
            </div>
            {errors.effectBindings ? (
              <Alert type="error" content={errors.effectBindings} style={{ marginBottom: 12 }} />
            ) : null}
            <Table
              className="data-table-shell"
              columns={bindingColumns}
              data={displayedBindings}
              pagination={false}
              rowKey={(row: { item: SkillProcessEffectBindingDraft; index: number }) => (
                `${row.index}-${row.item.bindingKey || 'new'}`
              )}
              noDataElement={<Empty description="暂无效果挂接" />}
            />
          </section>

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Typography.Title heading={6} style={{ margin: 0 }}>内部状态操作</Typography.Title>
              {!readOnly ? (
                <Button
                  type="primary"
                  disabled={saving || !detailReady}
                  onClick={() => setOperationEditor({
                    mode: 'create',
                    index: null,
                    draft: createEmptyStateOperationDraft(),
                    fieldErrors: {}
                  })}
                >
                  新增内部状态操作
                </Button>
              ) : null}
            </div>
            {errors.stateOperations ? (
              <Alert type="error" content={errors.stateOperations} style={{ marginBottom: 12 }} />
            ) : null}
            <Table
              className="data-table-shell"
              columns={operationColumns}
              data={displayedOperations}
              pagination={false}
              rowKey={(row: { item: SkillProcessStateOperationDraft; index: number }) => (
                `${row.index}-${row.item.operationKey || 'new'}`
              )}
              noDataElement={<Empty description="暂无内部状态操作" />}
            />
          </section>
          </Space>
          ) : !loadError ? <Alert type="info" content="正在加载过程详情…" /> : null}
        </Space>
      </Modal>

      <SkillProcessStepEditorModal
        key={stepEditor ? `step-${stepEditor.mode}-${stepEditor.index ?? 'new'}` : 'step-closed'}
        visible={stepEditor !== null}
        mode={stepEditor?.mode ?? 'view'}
        stepDraft={stepEditor?.draft ?? EMPTY_STEP}
        siblingSteps={draft.steps}
        stepIndex={stepEditor?.index ?? null}
        fieldErrors={stepEditor?.fieldErrors ?? {}}
        parameters={parameters}
        parametersLoadState={parametersLoadState}
        formulas={formulas}
        formulasLoadState={formulasLoadState}
        onOpenParameterFormula={onOpenParameterFormula}
        onClose={() => setStepEditor(null)}
        onConfirm={(nextStep) => {
          if (!stepEditor) return;
          if (stepEditor.index === null) {
            patchDraft({ ...draft, steps: sortStepDrafts([...draft.steps, nextStep]) });
            setStepErrors([]);
          } else {
            const index = stepEditor.index;
            patchDraft({
              ...draft,
              steps: sortStepDrafts(draft.steps.map((item, itemIndex) => (
                itemIndex === index ? nextStep : item
              )))
            });
            setStepErrors((current) => current.filter((item) => item.index !== index));
          }
          setStepEditor(null);
        }}
      />

      <SkillProcessEffectBindingEditorModal
        key={bindingEditor ? `binding-${bindingEditor.mode}-${bindingEditor.index ?? 'new'}` : 'binding-closed'}
        visible={bindingEditor !== null}
        mode={bindingEditor?.mode ?? 'view'}
        bindingDraft={bindingEditor?.draft ?? EMPTY_BINDING}
        siblingBindings={draft.effectBindings}
        bindingIndex={bindingEditor?.index ?? null}
        steps={draft.steps}
        fieldErrors={bindingEditor?.fieldErrors ?? {}}
        effects={effects}
        effectsLoadState={effectsLoadState}
        onOpenEffects={onOpenEffects}
        onClose={() => setBindingEditor(null)}
        onConfirm={(nextBinding) => {
          if (!bindingEditor) return;
          if (bindingEditor.index === null) {
            patchDraft({
              ...draft,
              effectBindings: sortBindingDrafts([...draft.effectBindings, nextBinding])
            });
            setBindingErrors([]);
          } else {
            const index = bindingEditor.index;
            patchDraft({
              ...draft,
              effectBindings: sortBindingDrafts(draft.effectBindings.map((item, itemIndex) => (
                itemIndex === index ? nextBinding : item
              )))
            });
            setBindingErrors((current) => current.filter((item) => item.index !== index));
          }
          setBindingEditor(null);
        }}
      />

      <SkillProcessStateOperationEditorModal
        key={operationEditor ? `operation-${operationEditor.mode}-${operationEditor.index ?? 'new'}` : 'operation-closed'}
        visible={operationEditor !== null}
        mode={operationEditor?.mode ?? 'view'}
        operationDraft={operationEditor?.draft ?? EMPTY_OPERATION}
        siblingOperations={draft.stateOperations}
        operationIndex={operationEditor?.index ?? null}
        steps={draft.steps}
        fieldErrors={operationEditor?.fieldErrors ?? {}}
        parameters={parameters}
        parametersLoadState={parametersLoadState}
        formulas={formulas}
        formulasLoadState={formulasLoadState}
        internalStates={internalStates}
        internalStatesLoadState={internalStatesLoadState}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        skillKey={skill.skillKey}
        adminToken={adminToken}
        onOpenParameterFormula={onOpenParameterFormula}
        onClose={() => setOperationEditor(null)}
        onConfirm={(nextOperation) => {
          if (!operationEditor) return;
          if (operationEditor.index === null) {
            patchDraft({
              ...draft,
              stateOperations: sortOperationDrafts([...draft.stateOperations, nextOperation])
            });
            setOperationErrors([]);
          } else {
            const index = operationEditor.index;
            patchDraft({
              ...draft,
              stateOperations: sortOperationDrafts(draft.stateOperations.map((item, itemIndex) => (
                itemIndex === index ? nextOperation : item
              )))
            });
            setOperationErrors((current) => current.filter((item) => item.index !== index));
          }
          setOperationEditor(null);
        }}
      />
    </>
  );
}
