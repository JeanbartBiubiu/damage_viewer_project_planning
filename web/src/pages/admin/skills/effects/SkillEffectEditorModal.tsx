import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import { createSkillEffect, getSkillEffect, listSkillEffects, updateSkillEffect } from '../../../../services/skillEffectClient';
import { listSkillFormulas } from '../../../../services/skillFormulaClient';
import type { Skill } from '../../../../types/skill';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  SkillEffect,
  SkillEffectExpiryMode,
  SkillEffectFirstPeriodicExecution,
  SkillEffectLifecycleInstanceScope,
  SkillEffectReapplicationDurationMode,
  SkillEffectReapplicationStackMode,
  SkillEffectSummary
} from '../../../../types/skillEffect';
import {
  SkillEffectResultEditorModal,
  type SkillEffectResultEditorMode
} from './SkillEffectResultEditorModal';
import {
  LIFECYCLE_PENDING_BEHAVIOR_LABEL,
  SKILL_EFFECT_CRITICAL_MODE_LABELS,
  SKILL_EFFECT_DAMAGE_DELIVERY_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_ORIGIN_KIND_LABELS,
  SKILL_EFFECT_EXPIRY_MODE_LABELS,
  SKILL_EFFECT_FIRST_PERIODIC_EXECUTION_LABELS,
  SKILL_EFFECT_INSTANCE_SCOPE_LABELS,
  SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS,
  SKILL_EFFECT_NORMAL_SHIELD_DECAY_MODE_LABELS,
  SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS,
  SKILL_EFFECT_REAPPLICATION_DURATION_MODE_LABELS,
  SKILL_EFFECT_REAPPLICATION_STACK_MODE_LABELS,
  SKILL_EFFECT_RESULT_TYPE_LABELS,
  SKILL_EFFECT_STACK_VALUE_MODE_LABELS,
  SKILL_EFFECT_TARGET_LABELS,
  SKILL_EFFECT_VALUE_READ_MODE_LABELS,
  applyDurationFormulaChange,
  applyExpiryModeChange,
  applyReapplicationDurationModeChange,
  buildCreateSkillEffectRequest,
  buildUpdateSkillEffectRequest,
  clearHiddenLifecycleFields,
  createEmptyEffectDraft,
  createEmptyResultDraft,
  disableLifecycleDraft,
  enableLifecycleDraft,
  hasLifecycleDraftContent,
  hasPeriodicResults,
  hasUnconfiguredLifecycleResults,
  isInstanceScopeLocked,
  listFormulaOptions,
  mapSkillEffectFieldIssues,
  normalizeEffectDraftForDirtyComparison,
  skillEffectToDraft,
  sortResultDrafts,
  validateSkillEffectDraft,
  type SkillEffectDraft,
  type SkillEffectDraftErrors,
  type SkillEffectResultDraft,
  type SkillEffectResultDraftErrors,
  type SkillEffectResultIndexError
} from './effectForm';

export type SkillEffectEditorMode = 'create' | 'view' | 'edit';

type SkillEffectEditorModalProps = {
  visible: boolean;
  mode: SkillEffectEditorMode;
  skill: Skill;
  effect: SkillEffectSummary | null;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onSaved: (effect: SkillEffect) => void | Promise<void>;
  onSkillMissing: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

type ResultEditorState = {
  mode: SkillEffectResultEditorMode;
  index: number | null;
  draft: SkillEffectResultDraft;
  fieldErrors: SkillEffectResultDraftErrors;
};

const EMPTY_RESULT_DRAFT = createEmptyResultDraft();
const EMPTY_RESULT_ERRORS: SkillEffectResultDraftErrors = {};

function titleFor(mode: SkillEffectEditorMode): string {
  if (mode === 'create') return '新增效果';
  if (mode === 'edit') return '编辑效果';
  return '查看效果';
}

function composeSaveError(error: unknown, unmappedMessages: string[]): string {
  const general = getErrorMessage(error);
  const extra = unmappedMessages.filter((item) => item && item !== general);
  return extra.length > 0 ? [general, ...extra].join('；') : general;
}

function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

function resultErrorSummary(errors: SkillEffectResultDraftErrors | undefined): string | null {
  if (!errors) return null;
  const messages = Object.values(errors).filter((item): item is string => Boolean(item));
  return messages.length > 0 ? messages.join('；') : null;
}

function referenceSummary(result: SkillEffectResultDraft): string {
  switch (result.resultType) {
    case 'DAMAGE':
      return result.damageTypeKey || '—';
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      return result.formulaKey || '—';
    case 'ATTRIBUTE_CHANGE':
    case 'RESOURCE_CHANGE':
      return result.attributeKey || '—';
    case 'COOLDOWN_CHANGE':
      return result.affectedSkillKeys.length > 0 ? result.affectedSkillKeys.join('、') : '—';
    case 'STATUS_OPERATION':
      return result.statusKey || '—';
    case 'LIFECYCLE_OPERATION':
      return result.targetEffectKey || '—';
    default: {
      const unexpected: never = result.resultType;
      return unexpected;
    }
  }
}

function interactionSummary(result: SkillEffectResultDraft): string {
  if (result.resultType === 'DAMAGE') {
    const delivery = result.damageDeliveryKind
      ? SKILL_EFFECT_DAMAGE_DELIVERY_KIND_LABELS[result.damageDeliveryKind]
      : '—';
    const origin = result.damageOriginKind
      ? SKILL_EFFECT_DAMAGE_ORIGIN_KIND_LABELS[result.damageOriginKind]
      : '—';
    const critical = result.criticalMode
      ? SKILL_EFFECT_CRITICAL_MODE_LABELS[result.criticalMode]
      : '—';
    return `${delivery} / ${origin} / ${critical} / 吸血 ${result.vampRules.length} 条`;
  }
  if (result.resultType === 'NORMAL_SHIELD') {
    const damageType = result.absorbedDamageTypeKey || '全部伤害';
    const decay = result.shieldDecayMode
      ? SKILL_EFFECT_NORMAL_SHIELD_DECAY_MODE_LABELS[result.shieldDecayMode]
      : '—';
    return `${damageType} / ${decay}`;
  }
  return '—';
}

function sortResultsWithIndex(
  results: SkillEffectResultDraft[]
): Array<{ item: SkillEffectResultDraft; index: number }> {
  const sorted = sortResultDrafts(results);
  const used = new Set<number>();
  return sorted.map((item) => {
    const index = results.findIndex((candidate, candidateIndex) => (
      !used.has(candidateIndex) && candidate === item
    ));
    used.add(index);
    return { item, index };
  });
}

export function SkillEffectEditorModal({
  visible,
  mode,
  skill,
  effect,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onSkillMissing,
  onDirtyChange
}: SkillEffectEditorModalProps) {
  const [draft, setDraft] = useState<SkillEffectDraft>(createEmptyEffectDraft());
  const [baseline, setBaseline] = useState<SkillEffectDraft>(createEmptyEffectDraft());
  const [errors, setErrors] = useState<SkillEffectDraftErrors>({});
  const [resultErrors, setResultErrors] = useState<SkillEffectResultIndexError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formulasError, setFormulasError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailReady, setDetailReady] = useState(mode === 'create');
  const [formulas, setFormulas] = useState<SkillFormulaSummary[]>([]);
  const [formulasLoadState, setFormulasLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [effectSummaries, setEffectSummaries] = useState<SkillEffectSummary[]>([]);
  const [effectsLoadState, setEffectsLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [effectsError, setEffectsError] = useState<string | null>(null);
  const [resultEditor, setResultEditor] = useState<ResultEditorState | null>(null);
  const detailSerial = useRef(0);
  const formulaSerial = useRef(0);
  const effectsSerial = useRef(0);
  const readOnly = mode === 'view';
  const closeBlocked = saving || (mode === 'edit' && loadingDetail);

  const reportDirty = useCallback((next: SkillEffectDraft, currentBaseline: SkillEffectDraft) => {
    onDirtyChange(
      JSON.stringify(normalizeEffectDraftForDirtyComparison(next))
        !== JSON.stringify(normalizeEffectDraftForDirtyComparison(currentBaseline))
    );
  }, [onDirtyChange]);

  const resetLocalState = useCallback(() => {
    detailSerial.current += 1;
    formulaSerial.current += 1;
    effectsSerial.current += 1;
    const empty = createEmptyEffectDraft();
    setDraft(empty);
    setBaseline(empty);
    setErrors({});
    setResultErrors([]);
    setSaveError(null);
    setLoadError(null);
    setFormulasError(null);
    setSaving(false);
    setLoadingDetail(false);
    setDetailReady(mode === 'create');
    setFormulas([]);
    setFormulasLoadState(undefined);
    setEffectSummaries([]);
    setEffectsLoadState(undefined);
    setEffectsError(null);
    setResultEditor(null);
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

  const loadEffectSummaries = useCallback(async () => {
    const serial = effectsSerial.current + 1;
    effectsSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setEffectSummaries([]);
      setEffectsLoadState(undefined);
      setEffectsError(null);
      return;
    }
    try {
      const result = await listSkillEffects(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (effectsSerial.current !== serial) return;
      setEffectSummaries(result.data);
      setEffectsLoadState('ready');
      setEffectsError(null);
    } catch (error) {
      if (effectsSerial.current !== serial) return;
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      setEffectSummaries([]);
      setEffectsLoadState('failed');
      setEffectsError(getErrorMessage(error));
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
      const empty = createEmptyEffectDraft();
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
    if (!effect) {
      setLoadError('效果详情加载失败。');
      setDetailReady(false);
      setLoadingDetail(false);
      return;
    }
    setLoadingDetail(true);
    setLoadError(null);
    try {
      const result = await getSkillEffect(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        effect.effectKey,
        token
      );
      if (detailSerial.current !== serial) return;
      const next = skillEffectToDraft(result.data);
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
    effect,
    mode,
    onDirtyChange,
    onSkillMissing,
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
    setResultErrors([]);
    setSaveError(null);
    setResultEditor(null);
    setSaving(false);
    void loadDetail();
    void loadFormulas();
    void loadEffectSummaries();
  }, [loadDetail, loadEffectSummaries, loadFormulas, onDirtyChange, resetLocalState, visible]);

  const patchField = <K extends keyof SkillEffectDraft>(field: K, value: SkillEffectDraft[K]) => {
    const next = clearHiddenLifecycleFields({ ...draft, [field]: value });
    setDraft(next);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(null);
    reportDirty(next, baseline);
  };

  const patchLifecycleDraft = (nextDraft: SkillEffectDraft) => {
    const next = clearHiddenLifecycleFields(nextDraft);
    setDraft(next);
    setErrors({});
    setSaveError(null);
    reportDirty(next, baseline);
  };

  const replaceResults = (results: SkillEffectResultDraft[]) => {
    const next = clearHiddenLifecycleFields({ ...draft, results: sortResultDrafts(results) });
    setDraft(next);
    setErrors((current) => ({ ...current, results: undefined }));
    setSaveError(null);
    reportDirty(next, baseline);
  };

  const toggleLifecycle = (checked: boolean) => {
    if (checked) {
      patchLifecycleDraft(enableLifecycleDraft(draft));
      return;
    }
    if (!hasLifecycleDraftContent(draft)) {
      patchLifecycleDraft(disableLifecycleDraft(draft));
      return;
    }
    Modal.confirm({
      title: '关闭生命周期',
      content: '将清空生命周期配置和全部结果的生命周期行为，不会删除结果。',
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        patchLifecycleDraft(disableLifecycleDraft(draft));
      }
    });
  };

  const close = () => {
    if (closeBlocked) return;
    onDirtyChange(false);
    onClose();
  };

  const save = async () => {
    if (readOnly || saving || !detailReady || (mode === 'edit' && loadingDetail)) return;
    const sorted = { ...draft, results: sortResultDrafts(draft.results) };
    const validation = validateSkillEffectDraft(sorted, {
      includeEffectKey: mode === 'create',
      catalog: {
        parentSkillKey: skill.skillKey,
        parentEffectKey: mode === 'create' ? sorted.effectKey.trim() : (effect?.effectKey ?? sorted.effectKey),
        formulas,
        effects: effectSummaries,
        damageTypes: [],
        attributes: [],
        skills: [],
        statuses: []
      },
      catalogLoadState: {
        formulas: formulasLoadState,
        effects: effectsLoadState
      }
    });
    if (!validation.ok) {
      setDraft(sorted);
      setErrors(validation.fieldErrors);
      setResultErrors(validation.resultErrors);
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
        ? await createSkillEffect(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            token,
            buildCreateSkillEffectRequest(validation.normalized)
          )
        : await updateSkillEffect(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            effect!.effectKey,
            token,
            buildUpdateSkillEffectRequest(validation.normalized)
          );
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      if (isSkillNotFound(error)) {
        onSkillMissing();
        return;
      }
      const mapped = mapSkillEffectFieldIssues(error, sorted.results);
      setDraft(sorted);
      setErrors(mapped.fieldErrors);
      setResultErrors(mapped.resultErrors);
      setSaveError(composeSaveError(error, mapped.unmappedMessages));
    } finally {
      setSaving(false);
    }
  };

  const displayedResults = useMemo(
    () => sortResultsWithIndex(draft.results),
    [draft.results]
  );

  const resultErrorMap = useMemo(() => {
    const map = new Map<number, SkillEffectResultDraftErrors>();
    for (const item of resultErrors) {
      map.set(item.index, item.fieldErrors);
    }
    return map;
  }, [resultErrors]);

  const formulaOptions = useMemo(
    () => listFormulaOptions({
      parentSkillKey: skill.skillKey,
      formulas,
      effects: effectSummaries,
      damageTypes: [],
      attributes: [],
      skills: [],
      statuses: []
    }),
    [effectSummaries, formulas, skill.skillKey]
  );
  const formulaNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of formulas) {
      names.set(item.formulaKey, item.name);
    }
    return names;
  }, [formulas]);
  const showPeriodicFields = hasPeriodicResults(draft);
  const hasLinearDecayShield = draft.results.some((result) => (
    result.resultType === 'NORMAL_SHIELD' && result.shieldDecayMode === 'LINEAR_TO_ZERO'
  ));

  const lifecycleFormulaSelect = (currentKey: string) => formulaOptions.map((option) => ({
    value: option.key,
    label: option.source === 'unknown' ? option.key : (formulaNames.get(option.key) ?? option.key),
    disabled: option.source === 'unknown'
  })).concat(currentKey && !formulaOptions.some((item) => item.key === currentKey)
    ? [{ value: currentKey, label: currentKey, disabled: true }]
    : []);

  const columns: TableColumnProps[] = [
    {
      title: '结果名称',
      render: (_value, row: { item: SkillEffectResultDraft; index: number }) => (
        <div>
          <div>{row.item.name || '—'}</div>
          {resultErrorSummary(resultErrorMap.get(row.index)) ? (
            <Typography.Text type="error">
              {resultErrorSummary(resultErrorMap.get(row.index))}
            </Typography.Text>
          ) : null}
        </div>
      )
    },
    {
      title: '稳定标识',
      render: (_value, row: { item: SkillEffectResultDraft }) => row.item.resultKey || '—'
    },
    {
      title: '结果种类',
      render: (_value, row: { item: SkillEffectResultDraft }) => (
        SKILL_EFFECT_RESULT_TYPE_LABELS[row.item.resultType]
      )
    },
    {
      title: '作用对象',
      render: (_value, row: { item: SkillEffectResultDraft }) => (
        SKILL_EFFECT_TARGET_LABELS[row.item.target]
      )
    },
    ...(draft.lifecycleEnabled ? [
      {
        title: '生命周期时点',
        render: (_value: unknown, row: { item: SkillEffectResultDraft }) => (
          row.item.lifecycleBehavior.moment
            ? SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS[row.item.lifecycleBehavior.moment]
            : LIFECYCLE_PENDING_BEHAVIOR_LABEL
        )
      },
      {
        title: '数值读取',
        render: (_value: unknown, row: { item: SkillEffectResultDraft }) => (
          row.item.lifecycleBehavior.valueReadMode
            ? SKILL_EFFECT_VALUE_READ_MODE_LABELS[row.item.lifecycleBehavior.valueReadMode]
            : '—'
        )
      },
      {
        title: '层数值方式',
        render: (_value: unknown, row: { item: SkillEffectResultDraft }) => (
          row.item.lifecycleBehavior.stackValueMode
            ? SKILL_EFFECT_STACK_VALUE_MODE_LABELS[row.item.lifecycleBehavior.stackValueMode]
            : '—'
        )
      },
      {
        title: '周期执行',
        render: (_value: unknown, row: { item: SkillEffectResultDraft }) => (
          row.item.lifecycleBehavior.periodicExecutionMode
            ? SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS[row.item.lifecycleBehavior.periodicExecutionMode]
            : '—'
        )
      }
    ] : []),
    {
      title: '关键引用摘要',
      render: (_value, row: { item: SkillEffectResultDraft }) => referenceSummary(row.item)
    },
    {
      title: '特殊交互',
      render: (_value, row: { item: SkillEffectResultDraft }) => interactionSummary(row.item)
    },
    {
      title: '排序',
      render: (_value, row: { item: SkillEffectResultDraft }) => row.item.sortOrder
    },
    {
      title: '操作',
      render: (_value, row: { item: SkillEffectResultDraft; index: number }) => (
        <Space size="mini">
          <Button
            size="mini"
            onClick={() => setResultEditor({
              mode: 'view',
              index: row.index,
              draft: row.item,
              fieldErrors: resultErrorMap.get(row.index) ?? {}
            })}
          >
            查看
          </Button>
          {!readOnly ? (
            <>
              <Button
                size="mini"
                onClick={() => setResultEditor({
                  mode: 'edit',
                  index: row.index,
                  draft: row.item,
                  fieldErrors: resultErrorMap.get(row.index) ?? {}
                })}
              >
                编辑
              </Button>
              <Button
                size="mini"
                status="danger"
                disabled={saving}
                onClick={() => {
                  replaceResults(draft.results.filter((_, index) => index !== row.index));
                  setResultErrors((current) => current
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
            <Button onClick={close} disabled={closeBlocked}>{readOnly ? '关闭' : '取消'}</Button>
            {!readOnly ? (
              <Button
                type="primary"
                loading={saving || (mode === 'edit' && loadingDetail)}
                disabled={!detailReady || hasUnconfiguredLifecycleResults(draft)}
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
              action={
                <Button size="mini" loading={loadingDetail} onClick={() => void loadDetail()}>
                  重试
                </Button>
              }
            />
          ) : null}
          {formulasError ? (
            <Alert
              type="error"
              content={formulasError}
              action={
                <Button size="mini" onClick={() => void loadFormulas()}>重试</Button>
              }
            />
          ) : null}
          {effectsError ? (
            <Alert
              type="error"
              content={effectsError}
              action={
                <Button size="mini" onClick={() => void loadEffectSummaries()}>重试</Button>
              }
            />
          ) : null}
          <Form layout="vertical">
            <Form.Item
              label="效果标识"
              required
              validateStatus={errors.effectKey ? 'error' : undefined}
              help={errors.effectKey}
            >
              <Input
                aria-label="效果标识"
                value={draft.effectKey}
                disabled={readOnly || mode !== 'create' || saving}
                maxLength={64}
                onChange={(value) => patchField('effectKey', value)}
              />
            </Form.Item>
            <Form.Item
              label="效果名称"
              required
              validateStatus={errors.name ? 'error' : undefined}
              help={errors.name}
            >
              <Input
                aria-label="效果名称"
                value={draft.name}
                disabled={readOnly || saving}
                maxLength={100}
                onChange={(value) => patchField('name', value)}
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
                autoSize={{ minRows: 3, maxRows: 8 }}
                onChange={(value) => patchField('description', value)}
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
                onChange={(value) => patchField('sortOrder', value === undefined ? '' : String(value))}
              />
            </Form.Item>
          </Form>

          <div>
            <Typography.Title heading={6} style={{ margin: '0 0 12px' }}>生命周期</Typography.Title>
            {errors.lifecycle ? <Alert type="error" content={errors.lifecycle} style={{ marginBottom: 12 }} /> : null}
            <Form layout="vertical">
              <Form.Item label="生命周期">
                <Switch
                  aria-label="生命周期"
                  checked={draft.lifecycleEnabled}
                  disabled={readOnly || saving}
                  onChange={toggleLifecycle}
                />
              </Form.Item>
              {draft.lifecycleEnabled ? (
                <>
                  <Form.Item
                    label="持续时间公式"
                    validateStatus={errors.durationFormulaKey ? 'error' : undefined}
                    help={errors.durationFormulaKey}
                  >
                    <Select
                      aria-label="持续时间公式"
                      allowClear
                      value={draft.lifecycle.durationFormulaKey || undefined}
                      disabled={readOnly || saving}
                      options={lifecycleFormulaSelect(draft.lifecycle.durationFormulaKey)}
                      placeholder="无自然到期"
                      onChange={(value) => patchLifecycleDraft(
                        applyDurationFormulaChange(draft, String(value ?? ''))
                      )}
                    />
                  </Form.Item>
                  <Form.Item
                    label="最大层数公式"
                    required
                    validateStatus={errors.maxStacksFormulaKey ? 'error' : undefined}
                    help={errors.maxStacksFormulaKey}
                  >
                    <Select
                      aria-label="最大层数公式"
                      value={draft.lifecycle.maxStacksFormulaKey || undefined}
                      disabled={readOnly || saving}
                      options={lifecycleFormulaSelect(draft.lifecycle.maxStacksFormulaKey)}
                      placeholder="请选择最大层数公式"
                      onChange={(value) => patchLifecycleDraft({
                        ...draft,
                        lifecycle: { ...draft.lifecycle, maxStacksFormulaKey: String(value ?? '') }
                      })}
                    />
                  </Form.Item>
                  <Form.Item
                    label="每次施加层数公式"
                    required
                    validateStatus={errors.applicationStacksFormulaKey ? 'error' : undefined}
                    help={errors.applicationStacksFormulaKey}
                  >
                    <Select
                      aria-label="每次施加层数公式"
                      value={draft.lifecycle.applicationStacksFormulaKey || undefined}
                      disabled={readOnly || saving}
                      options={lifecycleFormulaSelect(draft.lifecycle.applicationStacksFormulaKey)}
                      placeholder="请选择每次施加层数公式"
                      onChange={(value) => patchLifecycleDraft({
                        ...draft,
                        lifecycle: { ...draft.lifecycle, applicationStacksFormulaKey: String(value ?? '') }
                      })}
                    />
                  </Form.Item>
                  <Form.Item
                    label="实例范围"
                    required
                    validateStatus={errors.instanceScope ? 'error' : undefined}
                    help={errors.instanceScope}
                  >
                    <Select
                      aria-label="实例范围"
                      value={draft.lifecycle.instanceScope || undefined}
                      disabled={readOnly || saving || isInstanceScopeLocked(draft)}
                      options={Object.entries(SKILL_EFFECT_INSTANCE_SCOPE_LABELS).map(([value, label]) => ({
                        value,
                        label
                      }))}
                      placeholder="请选择实例范围"
                      onChange={(value) => patchLifecycleDraft({
                        ...draft,
                        lifecycle: {
                          ...draft.lifecycle,
                          instanceScope: value as SkillEffectLifecycleInstanceScope
                        }
                      })}
                    />
                  </Form.Item>
                  <Form.Item
                    label="重复层数"
                    required
                    validateStatus={errors.reapplicationStackMode ? 'error' : undefined}
                    help={errors.reapplicationStackMode}
                  >
                    <Select
                      aria-label="重复层数"
                      value={draft.lifecycle.reapplicationStackMode || undefined}
                      disabled={readOnly || saving}
                      options={Object.entries(SKILL_EFFECT_REAPPLICATION_STACK_MODE_LABELS).map(([value, label]) => ({
                        value,
                        label
                      }))}
                      placeholder="请选择重复层数方式"
                      onChange={(value) => patchLifecycleDraft({
                        ...draft,
                        lifecycle: {
                          ...draft.lifecycle,
                          reapplicationStackMode: value as SkillEffectReapplicationStackMode
                        }
                      })}
                    />
                  </Form.Item>
                  {draft.lifecycle.durationFormulaKey ? (
                    <Form.Item
                      label="重复持续"
                      required
                      validateStatus={errors.reapplicationDurationMode ? 'error' : undefined}
                      help={errors.reapplicationDurationMode}
                    >
                      <Select
                        aria-label="重复持续"
                        value={draft.lifecycle.reapplicationDurationMode || undefined}
                        disabled={readOnly || saving}
                        options={Object.entries(SKILL_EFFECT_REAPPLICATION_DURATION_MODE_LABELS)
                          .filter(([value]) => !hasLinearDecayShield || value !== 'INDEPENDENT')
                          .map(([value, label]) => ({ value, label }))}
                        placeholder="请选择重复持续方式"
                        onChange={(value) => patchLifecycleDraft(
                          applyReapplicationDurationModeChange(
                            draft,
                            (value ?? '') as SkillEffectReapplicationDurationMode | ''
                          )
                        )}
                      />
                    </Form.Item>
                  ) : null}
                  <Form.Item
                    label="到期方式"
                    required
                    validateStatus={errors.expiryMode ? 'error' : undefined}
                    help={errors.expiryMode}
                  >
                    <Select
                      aria-label="到期方式"
                      value={draft.lifecycle.expiryMode || undefined}
                      disabled={readOnly || saving || !draft.lifecycle.durationFormulaKey}
                      options={Object.entries(SKILL_EFFECT_EXPIRY_MODE_LABELS)
                        .filter(([value]) => (
                          draft.lifecycle.durationFormulaKey
                            ? (
                              hasLinearDecayShield
                                ? value === 'ALL_AT_ONCE'
                                : value !== 'EXPLICIT_ONLY'
                            )
                            : value === 'EXPLICIT_ONLY'
                        ))
                        .map(([value, label]) => ({ value, label }))}
                      placeholder="请选择到期方式"
                      onChange={(value) => patchLifecycleDraft(
                        applyExpiryModeChange(draft, (value ?? '') as SkillEffectExpiryMode | '')
                      )}
                    />
                  </Form.Item>
                  {showPeriodicFields ? (
                    <>
                      <Form.Item
                        label="周期间隔公式"
                        required
                        validateStatus={errors.periodicIntervalFormulaKey ? 'error' : undefined}
                        help={errors.periodicIntervalFormulaKey}
                      >
                        <Select
                          aria-label="周期间隔公式"
                          value={draft.lifecycle.periodicIntervalFormulaKey || undefined}
                          disabled={readOnly || saving}
                          options={lifecycleFormulaSelect(draft.lifecycle.periodicIntervalFormulaKey)}
                          placeholder="请选择周期间隔公式"
                          onChange={(value) => patchLifecycleDraft({
                            ...draft,
                            lifecycle: {
                              ...draft.lifecycle,
                              periodicIntervalFormulaKey: String(value ?? '')
                            }
                          })}
                        />
                      </Form.Item>
                      <Form.Item
                        label="首次周期"
                        required
                        validateStatus={errors.firstPeriodicExecution ? 'error' : undefined}
                        help={errors.firstPeriodicExecution}
                      >
                        <Select
                          aria-label="首次周期"
                          value={draft.lifecycle.firstPeriodicExecution || undefined}
                          disabled={readOnly || saving}
                          options={Object.entries(SKILL_EFFECT_FIRST_PERIODIC_EXECUTION_LABELS).map(([value, label]) => ({
                            value,
                            label
                          }))}
                          placeholder="请选择首次周期"
                          onChange={(value) => patchLifecycleDraft({
                            ...draft,
                            lifecycle: {
                              ...draft.lifecycle,
                              firstPeriodicExecution: value as SkillEffectFirstPeriodicExecution
                            }
                          })}
                        />
                      </Form.Item>
                    </>
                  ) : null}
                </>
              ) : null}
            </Form>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Typography.Title heading={6} style={{ margin: 0 }}>结果</Typography.Title>
              {!readOnly ? (
                <Button
                  type="primary"
                  disabled={saving || !detailReady}
                  onClick={() => setResultEditor({
                    mode: 'create',
                    index: null,
                    draft: createEmptyResultDraft(),
                    fieldErrors: {}
                  })}
                >
                  新增结果
                </Button>
              ) : null}
            </div>
            {errors.results ? <Alert type="error" content={errors.results} style={{ marginBottom: 12 }} /> : null}
            <Table
              className="data-table-shell"
              loading={loadingDetail}
              columns={columns}
              data={displayedResults}
              pagination={false}
              rowKey={(row: { item: SkillEffectResultDraft; index: number }) => (
                `${row.index}-${row.item.resultKey || 'new'}`
              )}
              noDataElement={<Empty description="暂无结果" />}
            />
          </div>
        </Space>
      </Modal>

      <SkillEffectResultEditorModal
        key={resultEditor ? `${resultEditor.mode}-${resultEditor.index ?? 'new'}` : 'closed'}
        visible={resultEditor !== null}
        mode={resultEditor?.mode ?? 'view'}
        resultDraft={resultEditor?.draft ?? EMPTY_RESULT_DRAFT}
        siblingResults={draft.results}
        resultIndex={resultEditor?.index ?? null}
        fieldErrors={resultEditor?.fieldErrors ?? EMPTY_RESULT_ERRORS}
        formulas={formulas}
        formulasLoadState={formulasLoadState}
        parentSkill={skill}
        parentDraft={draft}
        effectSummaries={effectSummaries}
        effectsLoadState={effectsLoadState}
        effectsError={effectsError}
        onRetryEffects={() => void loadEffectSummaries()}
        apiBaseUrl={apiBaseUrl}
        selectedGameId={selectedGameId}
        adminToken={adminToken}
        onClose={() => setResultEditor(null)}
        onConfirm={(nextResult) => {
          if (!resultEditor) return;
          if (resultEditor.index === null) {
            replaceResults([...draft.results, nextResult]);
            setResultErrors([]);
          } else {
            const index = resultEditor.index;
            replaceResults(draft.results.map((item, itemIndex) => (
              itemIndex === index ? nextResult : item
            )));
            setResultErrors((current) => current.filter((item) => item.index !== index));
          }
          setResultEditor(null);
        }}
      />
    </>
  );
}
