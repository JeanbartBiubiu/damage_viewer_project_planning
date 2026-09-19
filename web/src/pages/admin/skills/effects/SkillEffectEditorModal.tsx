import { getSkillFormula } from '../../../../services/skillFormulaClient';
import { formulaHasRuntimeInput } from '../triggers/triggerRuleForm';
import { numericValueSummary } from '../numericValueForm';
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
  Select,
  Space,
  Switch,
  Table,
  Typography
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import { listAttributes } from '../../../../services/attributeClient';
import { createSkillEffect, getSkillEffect, listSkillEffects, updateSkillEffect } from '../../../../services/skillEffectClient';
import { listSkillFormulas } from '../../../../services/skillFormulaClient';
import { listSkillCategories } from '../../../../services/skillCategoryClient';
import { listSkills } from '../../../../services/skillClient';
import { listStatuses } from '../../../../services/statusClient';
import type { GameStatus } from '../../../../types/status';
import type { Attribute } from '../../../../types/attribute';
import type { Skill } from '../../../../types/skill';
import type { SkillCategory } from '../../../../types/skillCategory';
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
  COOLDOWN_CHANGE_OPERATION_LABELS,
  LIFECYCLE_PENDING_BEHAVIOR_LABEL,
  SKILL_EFFECT_CRITICAL_MODE_LABELS,
  SKILL_EFFECT_CRITICAL_FILTER_LABELS,
  SKILL_EFFECT_DAMAGE_DELIVERY_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_FILTER_DELIVERY_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_FILTER_ORIGIN_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_MODIFIER_DIRECTION_LABELS,
  SKILL_EFFECT_DAMAGE_ORIGIN_KIND_LABELS,
  SKILL_EFFECT_EXPIRY_MODE_LABELS,
  SKILL_EFFECT_FIRST_PERIODIC_EXECUTION_LABELS,
  SKILL_EFFECT_INSTANCE_SCOPE_LABELS,
  SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS,
  SKILL_EFFECT_HEALING_KIND_LABELS,
  SKILL_EFFECT_HEALING_MODIFIER_DIRECTION_LABELS,
  SKILL_EFFECT_MODIFIER_OPERATION_LABELS,
  SKILL_EFFECT_NORMAL_SHIELD_DECAY_MODE_LABELS,
  SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS,
  SKILL_EFFECT_REAPPLICATION_DURATION_MODE_LABELS,
  SKILL_EFFECT_REAPPLICATION_STACK_MODE_LABELS,
  SKILL_EFFECT_RESULT_TYPE_LABELS,
  SKILL_EFFECT_STACK_VALUE_MODE_LABELS,
  SKILL_EFFECT_SPELL_SHIELD_BLOCK_SCOPE_LABELS,
  SKILL_EFFECT_TARGET_LABELS,
  SKILL_EFFECT_VALUE_READ_MODE_LABELS,
  SKILL_HASTE_MODIFIER_OPERATION_LABELS,
  affectedSkillScopeSummary,
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
  isPersistentOnlyResultType,
  mapSkillEffectFieldIssues,
  normalizeEffectDraftForDirtyComparison,
  skillEffectToCopyDraft,
  skillEffectToDraft,
  sortResultDrafts,
  validateSkillEffectDraft,
  type SkillEffectDraft,
  type SkillEffectDraftErrors,
  type SkillEffectResultDraft,
  type SkillEffectResultDraftErrors,
  type SkillEffectResultIndexError
} from './effectForm';

export type SkillEffectEditorMode = 'create' | 'copy' | 'view' | 'edit';

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
  if (mode === 'copy') return '复制为新效果';
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

function catalogDisplayName(key: string, names: Map<string, string> | undefined): string {
  if (!key) return '—';
  return names?.get(key) || key;
}

function referenceSummary(
  result: SkillEffectResultDraft,
  names?: {
    attributes?: Map<string, string>;
    formulas?: Map<string, string>;
    skills?: Map<string, string>;
    skillCategories?: Map<string, string>;
    categoryStatuses?: Map<string, 'ENABLED' | 'DISABLED' | null>;
  }
): string {
  const scope = affectedSkillScopeSummary(result.affectedSkillScope, {
    skills: names?.skills,
    skillCategories: names?.skillCategories,
    categoryStatuses: names?.categoryStatuses
  });
  const formula = numericValueSummary(result.value, names?.formulas);
  switch (result.resultType) {
    case 'DAMAGE':
      return result.damageTypeKey || '—';
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      return numericValueSummary(result.value, names?.formulas);
    case 'ATTRIBUTE_CHANGE':
    case 'RESOURCE_CHANGE':
      return result.attributeKey || '—';
    case 'COOLDOWN_CHANGE': {
      const operation = result.cooldownOperation
        ? COOLDOWN_CHANGE_OPERATION_LABELS[result.cooldownOperation]
        : '—';
      const value = result.cooldownOperation === 'RESET' ? '无数值规则' : formula;
      return `${operation} · ${value} · ${scope}`;
    }
    case 'SKILL_HASTE_MODIFIER': {
      const operation = result.skillHasteOperation
        ? SKILL_HASTE_MODIFIER_OPERATION_LABELS[result.skillHasteOperation]
        : '—';
      return `${operation} · ${formula} · ${scope}`;
    }
    case 'STATUS_OPERATION':
      return result.value !== null && result.statusOperation === 'APPLY'
        ? `${result.statusKey} · 减速比例 ${formula} × ${result.fixedMultiplier}（0 至 1）`
        : result.statusKey || '—';
    case 'LIFECYCLE_OPERATION':
      return result.targetEffectKey || '—';
    case 'DAMAGE_MODIFIER':
    case 'DAMAGE_IMMUNITY':
      return result.damageTypeKey || '全部伤害';
    case 'HEALING_MODIFIER':
      return numericValueSummary(result.value, names?.formulas);
    case 'HEALTH_FLOOR':
      return result.attributeKey || '—';
    case 'EXECUTE':
      return [
        catalogDisplayName(result.attributeKey, names?.attributes),
        numericValueSummary(result.value, names?.formulas)
      ].join(' · ');
    case 'HIT_LINK_APPLICATION':
    case 'ATTACK_LINK_APPLICATION':
      return numericValueSummary(result.value, names?.formulas);
    case 'SPELL_SHIELD':
      return '—';
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
  if (result.resultType === 'DAMAGE_MODIFIER') {
    const direction = result.modifierDirection
      ? SKILL_EFFECT_DAMAGE_MODIFIER_DIRECTION_LABELS[result.modifierDirection]
      : '—';
    const operation = result.modifierOperation
      ? SKILL_EFFECT_MODIFIER_OPERATION_LABELS[result.modifierOperation]
      : '—';
    const delivery = result.damageFilterDeliveryKind
      ? SKILL_EFFECT_DAMAGE_FILTER_DELIVERY_KIND_LABELS[result.damageFilterDeliveryKind]
      : '—';
    const origin = result.damageFilterOriginKind
      ? SKILL_EFFECT_DAMAGE_FILTER_ORIGIN_KIND_LABELS[result.damageFilterOriginKind]
      : '—';
    const critical = result.criticalFilter
      ? SKILL_EFFECT_CRITICAL_FILTER_LABELS[result.criticalFilter]
      : '—';
    return `${direction} / ${operation} / ${delivery} / ${origin} / ${critical}`;
  }
  if (result.resultType === 'HEALING_MODIFIER') {
    const direction = result.healingModifierDirection
      ? SKILL_EFFECT_HEALING_MODIFIER_DIRECTION_LABELS[result.healingModifierDirection]
      : '—';
    const operation = result.modifierOperation
      ? SKILL_EFFECT_MODIFIER_OPERATION_LABELS[result.modifierOperation]
      : '—';
    const kind = result.healingKind
      ? SKILL_EFFECT_HEALING_KIND_LABELS[result.healingKind]
      : '—';
    return `${direction} / ${operation} / ${kind}`;
  }
  if (result.resultType === 'DAMAGE_IMMUNITY') {
    const delivery = result.damageFilterDeliveryKind
      ? SKILL_EFFECT_DAMAGE_FILTER_DELIVERY_KIND_LABELS[result.damageFilterDeliveryKind]
      : '—';
    const origin = result.damageFilterOriginKind
      ? SKILL_EFFECT_DAMAGE_FILTER_ORIGIN_KIND_LABELS[result.damageFilterOriginKind]
      : '—';
    return `${delivery} / ${origin}`;
  }
  if (result.resultType === 'HEALTH_FLOOR') {
    return '持续生命下限';
  }
  if (result.resultType === 'SPELL_SHIELD') {
    return '法术护盾';
  }
  if (result.resultType === 'EXECUTE') {
    return '斩杀';
  }
  if (result.resultType === 'HIT_LINK_APPLICATION') {
    return '命中联动应用';
  }
  if (result.resultType === 'ATTACK_LINK_APPLICATION') {
    return '攻击联动应用';
  }
  if (result.resultType === 'SKILL_HASTE_MODIFIER') {
    return result.skillHasteOperation
      ? SKILL_HASTE_MODIFIER_OPERATION_LABELS[result.skillHasteOperation]
      : '技能急速修正';
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
  const [detailReady, setDetailReady] = useState(false);
  const [formulas, setFormulas] = useState<SkillFormulaSummary[]>([]);
  const { parameters, parametersLoadState } = useNumericParameters(apiBaseUrl, selectedGameId, skill.skillKey, adminToken, visible);
  const [formulasLoadState, setFormulasLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [statuses, setStatuses] = useState<GameStatus[]>([]);
  const [statusesLoadState, setStatusesLoadState] = useState<'ready' | 'failed' | undefined>();
  const [statusesError, setStatusesError] = useState<string | null>(null);
  const statusSerial = useRef(0);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [attributesLoadState, setAttributesLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [attributesError, setAttributesError] = useState<string | null>(null);
  const [effectSummaries, setEffectSummaries] = useState<SkillEffectSummary[]>([]);
  const [effectsLoadState, setEffectsLoadState] = useState<'ready' | 'failed' | undefined>(undefined);
  const [effectsError, setEffectsError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillCategories, setSkillCategories] = useState<SkillCategory[]>([]);
  const [resultEditor, setResultEditor] = useState<ResultEditorState | null>(null);
  const detailSerial = useRef(0);
  const formulaSerial = useRef(0);
  const attributeSerial = useRef(0);
  const effectsSerial = useRef(0);
  const skillSerial = useRef(0);
  const skillCategorySerial = useRef(0);
  const readOnly = mode === 'view';
  const closeBlocked = saving || (!readOnly && loadingDetail);

  const reportDirty = useCallback((next: SkillEffectDraft, currentBaseline: SkillEffectDraft) => {
    onDirtyChange(
      JSON.stringify(normalizeEffectDraftForDirtyComparison(next))
        !== JSON.stringify(normalizeEffectDraftForDirtyComparison(currentBaseline))
    );
  }, [onDirtyChange]);

  const resetLocalState = useCallback(() => {
    statusSerial.current += 1;
    setStatuses([]);
    setStatusesLoadState(undefined);
    setStatusesError(null);
    detailSerial.current += 1;
    formulaSerial.current += 1;
    attributeSerial.current += 1;
    effectsSerial.current += 1;
    skillSerial.current += 1;
    skillCategorySerial.current += 1;
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
    setDetailReady(false);
    setFormulas([]);
    setFormulasLoadState(undefined);
    setAttributes([]);
    setAttributesLoadState(undefined);
    setAttributesError(null);
    setEffectSummaries([]);
    setEffectsLoadState(undefined);
    setEffectsError(null);
    setSkills([]);
    setSkillCategories([]);
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

  const loadStatusesCatalog = useCallback(async () => {
    const serial = ++statusSerial.current;
    const token = adminToken.trim();
    setStatuses([]);
    setStatusesLoadState(undefined);
    setStatusesError(null);
    if (!visible || !token) return;
    try {
      const response = await listStatuses(apiBaseUrl, selectedGameId, token);
      if (serial !== statusSerial.current) return;
      setStatuses(response.data.items);
      setStatusesLoadState('ready');
      setStatusesError(null);
    } catch (error) {
      if (serial !== statusSerial.current) return;
      setStatusesLoadState('failed');
      setStatusesError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadAttributesCatalog = useCallback(async () => {
    const serial = attributeSerial.current + 1;
    attributeSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setAttributes([]);
      setAttributesLoadState(undefined);
      setAttributesError(null);
      return;
    }
    try {
      const result = await listAttributes(apiBaseUrl, selectedGameId, token);
      if (attributeSerial.current !== serial) return;
      setAttributes(result.data.items);
      setAttributesLoadState('ready');
      setAttributesError(null);
    } catch (error) {
      if (attributeSerial.current !== serial) return;
      setAttributes([]);
      setAttributesLoadState('failed');
      setAttributesError(getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadSkillsCatalog = useCallback(async () => {
    const serial = skillSerial.current + 1;
    skillSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setSkills([]);
      return;
    }
    try {
      const result = await listSkills(apiBaseUrl, selectedGameId, token);
      if (skillSerial.current !== serial) return;
      setSkills(result.data.items);
    } catch {
      if (skillSerial.current !== serial) return;
      setSkills([]);
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadSkillCategoriesCatalog = useCallback(async () => {
    const serial = skillCategorySerial.current + 1;
    skillCategorySerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setSkillCategories([]);
      return;
    }
    try {
      const result = await listSkillCategories(apiBaseUrl, selectedGameId, token);
      if (skillCategorySerial.current !== serial) return;
      setSkillCategories(result.data.items);
    } catch {
      if (skillCategorySerial.current !== serial) return;
      setSkillCategories([]);
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

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
    setDetailReady(false);
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
      const next = mode === 'copy' ? skillEffectToCopyDraft(result.data) : skillEffectToDraft(result.data);
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
    void loadStatusesCatalog();
    void loadAttributesCatalog();
    void loadSkillsCatalog();
    void loadSkillCategoriesCatalog();
    void loadEffectSummaries();
  }, [loadStatusesCatalog, loadAttributesCatalog, loadDetail, loadEffectSummaries, loadFormulas, loadSkillCategoriesCatalog, loadSkillsCatalog, onDirtyChange, resetLocalState, visible]);

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
    const requiredBy = draft.results.filter((result) => isPersistentOnlyResultType(result.resultType));
    if (requiredBy.length > 0) {
      Modal.warning({
        title: '不能关闭生命周期',
        content: `以下结果只能持续生效：${requiredBy.map((result) => result.name || result.resultKey).join('、')}。请先删除或修改这些结果。`
      });
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
    if (readOnly || saving || !detailReady || loadingDetail) return;
    const sorted = { ...draft, results: sortResultDrafts(draft.results) };
    const validation = validateSkillEffectDraft(sorted, {
      parameters, parametersLoadState,
      includeEffectKey: mode === 'create' || mode === 'copy',
      catalog: {
        parentSkillKey: skill.skillKey,
        parentEffectKey: mode === 'create' || mode === 'copy' ? sorted.effectKey.trim() : (effect?.effectKey ?? sorted.effectKey),
        formulas,
        effects: effectSummaries,
        damageTypes: [],
        attributes,
        skills,
        skillCategories,
        statuses
      },
      catalogLoadState: {
        formulas: formulasLoadState,
        effects: effectsLoadState,
        attributes: attributesLoadState,
        statuses: statusesLoadState
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
      for (const resultDraft of sorted.results) {
        if (resultDraft.lifecycleBehavior.valueReadMode === 'MOMENT_EVALUATION' && resultDraft.value?.kind === 'FORMULA') {
          const formula = await getSkillFormula(apiBaseUrl, selectedGameId, skill.skillKey, resultDraft.value.formulaKey, token);
          if (parametersLoadState !== 'ready') { setSaveError('参数目录不完整，无法核对当前时点取值。'); return; }
          if (formulaHasRuntimeInput(formula.data, parameters)) {
            setSaveError('当前时点取值不能引用计算时传入的技能参数。'); return;
          }
        }
      }
      const result = mode === 'create' || mode === 'copy'
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
  const formulaNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of formulas) {
      names.set(item.formulaKey, item.name);
    }
    return names;
  }, [formulas]);
  const attributeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of attributes) {
      names.set(item.attributeKey, item.name);
    }
    return names;
  }, [attributes]);
  const skillNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of skills) {
      names.set(item.skillKey, item.name);
    }
    return names;
  }, [skills]);
  const skillCategoryNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of skillCategories) {
      names.set(item.skillCategoryKey, item.name);
    }
    return names;
  }, [skillCategories]);
  const skillCategoryStatuses = useMemo(() => {
    const statuses = new Map<string, 'ENABLED' | 'DISABLED' | null>();
    for (const item of skillCategories) {
      statuses.set(item.skillCategoryKey, item.status);
    }
    return statuses;
  }, [skillCategories]);
  const showPeriodicFields = hasPeriodicResults(draft);
  const hasLinearDecayShield = draft.results.some((result) => (
    result.resultType === 'NORMAL_SHIELD' && result.shieldDecayMode === 'LINEAR_TO_ZERO'
  ));

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
    {
      title: '法术护盾阻挡',
      render: (_value, row: { item: SkillEffectResultDraft }) => (
        row.item.spellShieldBlockScope
          ? SKILL_EFFECT_SPELL_SHIELD_BLOCK_SCOPE_LABELS[row.item.spellShieldBlockScope]
          : '—'
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
      render: (_value, row: { item: SkillEffectResultDraft }) => referenceSummary(row.item, {
        attributes: attributeNames,
        formulas: formulaNames,
        skills: skillNames,
        skillCategories: skillCategoryNames,
        categoryStatuses: skillCategoryStatuses
      })
    },
    {
      title: '特殊交互',
      render: (_value, row: { item: SkillEffectResultDraft }) => interactionSummary(row.item)
    },
    {
      title: '排序',
      width: 80,
      render: (_value, row: { item: SkillEffectResultDraft }) => row.item.sortOrder
    },
    {
      title: '操作',
      width: 180,
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
                loading={saving || loadingDetail}
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
          {mode === 'copy' ? (
            <Alert type="info" content="填写新的效果标识后保存。公式及其他引用仍指向原有对象，请核对后调整；已有规则不会自动切换到新效果。" />
          ) : null}
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
          {statusesError && draft.results.some((item) => item.resultType === 'STATUS_OPERATION') ? (
            <Alert type="error" content={statusesError}
              action={<Button size="mini" onClick={() => void loadStatusesCatalog()}>重试状态目录</Button>} />
          ) : null}
          {attributesError ? (
            <Alert
              type="error"
              content={attributesError}
              action={
                <Button size="mini" onClick={() => void loadAttributesCatalog()}>重试</Button>
              }
            />
          ) : null}
          {mode === 'create' || (detailReady && !loadingDetail) ? (
          <Space direction="vertical" size="medium" style={{ width: '100%' }}>
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
                disabled={readOnly || (mode !== 'create' && mode !== 'copy') || saving}
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
                    label="持续时间取值"
                    validateStatus={errors.durationValue ? 'error' : undefined}
                    help={errors.durationValue}
                  >
                    <NumericValueField aria-label="持续时间取值"
                  value={draft.lifecycle.durationValue}
                  onChange={(value) => patchLifecycleDraft(
                        applyDurationFormulaChange(draft, value!)
                      )}
                  parameters={parameters}
                  parametersLoadState={parametersLoadState}
                  formulas={formulas}
                  disabled={readOnly || saving}
                  allowClear />
                  </Form.Item>
                  <Form.Item
                    label="最大层数取值"
                    required
                    validateStatus={errors.maxStacksValue ? 'error' : undefined}
                    help={errors.maxStacksValue}
                  >
                    <NumericValueField aria-label="最大层数取值"
                  value={draft.lifecycle.maxStacksValue}
                  onChange={(value) => patchLifecycleDraft({
                        ...draft,
                        lifecycle: { ...draft.lifecycle, maxStacksValue: value! }
                      })}
                  parameters={parameters}
                  parametersLoadState={parametersLoadState}
                  formulas={formulas}
                  disabled={readOnly || saving} />
                  </Form.Item>
                  <Form.Item
                    label="每次施加层数取值"
                    required
                    validateStatus={errors.applicationStacksValue ? 'error' : undefined}
                    help={errors.applicationStacksValue}
                  >
                    <NumericValueField aria-label="每次施加层数取值"
                  value={draft.lifecycle.applicationStacksValue}
                  onChange={(value) => patchLifecycleDraft({
                        ...draft,
                        lifecycle: { ...draft.lifecycle, applicationStacksValue: value! }
                      })}
                  parameters={parameters}
                  parametersLoadState={parametersLoadState}
                  formulas={formulas}
                  disabled={readOnly || saving} />
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
                  {draft.lifecycle.durationValue ? (
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
                      disabled={readOnly || saving || !draft.lifecycle.durationValue}
                      options={Object.entries(SKILL_EFFECT_EXPIRY_MODE_LABELS)
                        .filter(([value]) => (
                          draft.lifecycle.durationValue
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
                        label="周期间隔取值"
                        required
                        validateStatus={errors.periodicIntervalValue ? 'error' : undefined}
                        help={errors.periodicIntervalValue}
                      >
                        <NumericValueField aria-label="周期间隔取值"
                  value={draft.lifecycle.periodicIntervalValue}
                  onChange={(value) => patchLifecycleDraft({
                            ...draft,
                            lifecycle: {
                              ...draft.lifecycle,
                              periodicIntervalValue: value!
                            }
                          })}
                  parameters={parameters}
                  parametersLoadState={parametersLoadState}
                  formulas={formulas}
                  disabled={readOnly || saving} />
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
              scroll={{ x: draft.lifecycleEnabled ? 1800 : 1320 }}
              rowKey={(row: { item: SkillEffectResultDraft; index: number }) => (
                `${row.index}-${row.item.resultKey || 'new'}`
              )}
              noDataElement={<Empty description="暂无结果" />}
            />
          </div>
          </Space>
          ) : !loadError ? <Alert type="info" content="正在加载效果详情…" /> : null}
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
        parameters={parameters}
        parametersLoadState={parametersLoadState}
        formulas={formulas}
        formulasLoadState={formulasLoadState}
        onRetryFormulas={() => void loadFormulas()}
        parentSkill={skill}
        parentDraft={draft}
        effectSummaries={effectSummaries}
        effectsLoadState={effectsLoadState}
        effectsError={effectsError}
        onRetryEffects={() => void loadEffectSummaries()}
        onEnableLifecycle={() => patchLifecycleDraft(enableLifecycleDraft(draft))}
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
          void loadSkillsCatalog();
          void loadSkillCategoriesCatalog();
        }}
      />
    </>
  );
}
