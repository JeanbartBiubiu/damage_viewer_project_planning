import { type NumericValue, numericFormulaKey } from '../../../../types/numericValue';
import { NumericValueField } from '../NumericValueField';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Typography
} from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ApiRequestError, getErrorMessage } from '../../../../services/apiClient';
import { listAttributes } from '../../../../services/attributeClient';
import { listDamageTypes } from '../../../../services/damageTypeClient';
import { getSkillEffect, listSkillEffects } from '../../../../services/skillEffectClient';
import { getSkillFormula, listSkillFormulas } from '../../../../services/skillFormulaClient';
import { getSkillInternalState, listSkillInternalStates } from '../../../../services/skillInternalStateClient';
import { listSkillParameters } from '../../../../services/skillParameterClient';
import { getSkillProcess, listSkillProcesses } from '../../../../services/skillProcessClient';
import { listSkills } from '../../../../services/skillClient';
import { listStatuses } from '../../../../services/statusClient';
import {
  createSkillTriggerRule,
  getSkillTriggerRule,
  listSkillTriggerRules,
  updateSkillTriggerRule
} from '../../../../services/skillTriggerRuleClient';
import type { Attribute } from '../../../../types/attribute';
import type { DamageType } from '../../../../types/damageType';
import type { Skill } from '../../../../types/skill';
import type { AuthoringLocation } from '../../../../types/authoringLocation';
import { resolveAuthoringLocation } from '../authoringLocation';
import {
  authoringLocateMessage,
  keyedChildKey,
  lastFieldName,
  shouldDegradeUnsupportedAnchor
} from '../authoringFocus';
import type { SkillEffect, SkillEffectSummary } from '../../../../types/skillEffect';
import type { SkillFormula, SkillFormulaSummary } from '../../../../types/skillFormula';
import type { SkillInternalState, SkillInternalStateSummary } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type {
  SkillProcess,
  SkillProcessFailureReason,
  SkillProcessMoment,
  SkillProcessMomentType,
  SkillProcessSummary
} from '../../../../types/skillProcess';
import type { GameStatus } from '../../../../types/status';
import type {
  SkillTriggerCastPhase,
  SkillTriggerEventSource,
  SkillTriggerEventType,
  SkillTriggerEventUseKind,
  SkillTriggerDamageDeliveryKind,
  SkillTriggerDamageOriginKind,
  SkillTriggerHealthDirection,
  SkillTriggerInternalStateChangeKind,
  SkillTriggerLifecycleEventMoment,
  SkillTriggerRuleDetail,
  SkillTriggerRuleSummary,
  SkillTriggerStatusChangeKind,
  SkillTriggerTargetContext
} from '../../../../types/skillTriggerRule';
import {
  SkillTriggerActionEditorModal,
  type SkillTriggerActionEditorMode
} from './SkillTriggerActionEditorModal';
import {
  SkillTriggerConditionEditorModal,
  type SkillTriggerConditionEditorMode
} from './SkillTriggerConditionEditorModal';
import {
  DISABLED_CATALOG_LABEL,
  INCOMPLETE_CATALOG_MESSAGE,
  MISSING_CATALOG_LABEL,
  MAX_TRIGGERS_SCOPE_HINT,
  SKILL_TRIGGER_ACTION_TYPE_LABELS,
  SKILL_TRIGGER_CONDITION_GROUP_HINT,
  SKILL_TRIGGER_CYCLE_HINT,
  SKILL_TRIGGER_CYCLE_MESSAGE,
  SKILL_TRIGGER_RESULT_EVENT_GRAPH_HINT,
  SKILL_TRIGGER_SOURCE_INITIALIZED_HINT,
  SKILL_TRIGGER_TAKEDOWN_HINT,
  SKILL_TRIGGER_SOURCE_SKILL_FILTER_HINT,
  SKILL_TRIGGER_DAMAGE_DELIVERY_KIND_LABELS,
  SKILL_TRIGGER_DAMAGE_ORIGIN_KIND_LABELS,
  SKILL_TRIGGER_EVENT_TYPE_LABELS,
  SKILL_TRIGGER_EVENT_CAPABILITIES,
  SKILL_TRIGGER_EVENT_TYPES,
  SKILL_TRIGGER_GROUP_AND_LABEL,
  SKILL_TRIGGER_GROUP_OR_LABEL,
  SKILL_TRIGGER_HEALTH_DIRECTION_LABELS,
  SKILL_TRIGGER_INTERNAL_STATE_CHANGE_LABELS,
  SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENT_LABELS,
  SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS,
  SKILL_TRIGGER_STATUS_CHANGE_LABELS,
  SKILL_TRIGGER_SUBJECT_LABELS,
  SKILL_TRIGGER_TARGET_CONTEXT_LABELS,
  SKILL_TRIGGER_CAST_PHASE_LABELS,
  SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL,
  SKILL_TRIGGER_CAST_PHASES,
  SKILL_TRIGGER_CAST_PHASE_REQUIRED_MESSAGE,
  SKILL_TRIGGER_UNSAVED_CONFIRM,
  SKILL_TRIGGER_USE_KIND_LABELS,
  actionSummary,
  analyzeEventSwitchImpact,
  applyEventSwitchCleanup,
  canMoveAction,
  catalogsBlockingSave,
  canOverwriteMissingRecord,
  changeKindsForInternalState,
  collectDirectFormulaKeys,
  collectExecuteEffectValues,
  collectStartProcessValues,
  conditionSummary,
  createEmptyActionDraft,
  createEmptyConditionDraft,
  createEmptyEventSource,
  createEmptyGroupDraft,
  createEmptyRuleDraft,
  createFormulaSessionCache,
  ensureFailProcessLast,
  eventHasEventSource,
  eventStepType,
  findStalePriorResultBindings,
  formatCyclePath,
  fromDetail,
  groupConditionSummary,
  isSkillNotFound,
  isSpellShieldEventEffect,
  isTriggerRuleNotFound,
  mapTriggerFieldIssues,
  moveActionDrafts,
  nestedErrorFor,
  reachableRuntimeInputParameters,
  removeBindingsByKeys,
  requiredCatalogsForDraft,
  shouldKeepDraftOnHttpStatus,
  sortActionDrafts,
  sortConditionDrafts,
  sortGroupDrafts,
  isTriggerRuleDraftDirty,
  targetContextOptionsForEvent,
  toCreateRequest,
  toUpdateRequest,
  validateSkillTriggerDraft,
  type CatalogLoadState,
  type MappedTriggerFieldIssues,
  type NestedFieldError,
  type SkillTriggerActionDraft,
  type SkillTriggerCatalogKind,
  type SkillTriggerConditionDraft,
  type SkillTriggerConditionGroupDraft,
  type SkillTriggerDraftErrors,
  type SkillTriggerRuleDraft
} from './triggerRuleForm';
import {
  PROCESS_FAILURE_REASON_ANY_LABEL,
  PROCESS_FAILURE_REASON_LABELS,
  PROCESS_FAILURE_REASONS,
  SKILL_PROCESS_MOMENT_TYPE_LABELS,
  SKILL_PROCESS_MOMENT_TYPES,
  applyMomentTypeChange,
  isProcessLevelMoment
} from '../processes/processForm';

export type SkillTriggerRuleEditorMode = 'create' | 'edit';

type SkillTriggerRuleEditorModalProps = {
  visible: boolean;
  mode: SkillTriggerRuleEditorMode;
  skill: Skill;
  rule: SkillTriggerRuleSummary | null;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onSaved: (rule: SkillTriggerRuleDetail) => void | Promise<void>;
  onSkillMissing: () => void;
  onRuleMissing: () => void;
  onDirtyChange: (dirty: boolean) => void;
  authoringLocation?: AuthoringLocation | null;
};

type ConditionEditorState = {
  mode: SkillTriggerConditionEditorMode;
  groupIndex: number;
  conditionIndex: number | null;
  draft: SkillTriggerConditionDraft;
  focusField?: string | null;
  locateMessage?: string | null;
};

type ActionEditorState = {
  mode: SkillTriggerActionEditorMode;
  index: number | null;
  draft: SkillTriggerActionDraft;
  focusField?: string | null;
  locateMessage?: string | null;
  focusBindingKey?: string | null;
};

type CatalogOption = { label: string; value: string; disabled?: boolean };

function titleFor(mode: SkillTriggerRuleEditorMode): string {
  return mode === 'create' ? '新增规则' : '编辑规则';
}

function composeSaveError(error: unknown, unmappedMessages: string[]): string {
  const general = getErrorMessage(error);
  const extra = unmappedMessages.filter((item) => item && item !== general);
  return extra.length > 0 ? [general, ...extra].join('；') : general;
}

function processMomentFrom(
  momentType: SkillProcessMomentType,
  stepKey: string,
  failureReason: SkillProcessFailureReason | '' = ''
): SkillProcessMoment {
  const next = applyMomentTypeChange({
    momentType,
    stepKey,
    failureReason: momentType === 'PROCESS_FAILURE' ? failureReason : ''
  }, momentType);
  if (isProcessLevelMoment(next.momentType)) {
    return {
      momentType: next.momentType,
      stepKey: null,
      failureReason: next.momentType === 'PROCESS_FAILURE' ? (next.failureReason || null) : null
    };
  }
  return { momentType: next.momentType, stepKey: next.stepKey, failureReason: null };
}

function disabledName(name: string, key: string, disabled: boolean): string {
  const label = name || key;
  return disabled ? `${label}（${DISABLED_CATALOG_LABEL}）` : label;
}

function matchesSelectOptionSearch(inputValue: string, option: ReactElement): boolean {
  const query = inputValue.trim().toLowerCase();
  if (!query) return true;
  const value = String(option.props.value ?? null).toLowerCase();
  const children = option.props.children;
  const label = String(
    typeof children === 'string' || typeof children === 'number' ? children : ''
  ).toLowerCase();
  return value.includes(query) || label.includes(query);
}

export function SkillTriggerRuleEditorModal({
  visible,
  mode,
  skill,
  rule,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onSaved,
  onSkillMissing,
  onRuleMissing,
  onDirtyChange,
  authoringLocation
}: SkillTriggerRuleEditorModalProps) {
  const [draft, setDraft] = useState<SkillTriggerRuleDraft>(createEmptyRuleDraft());
  const [baseline, setBaseline] = useState<SkillTriggerRuleDraft>(createEmptyRuleDraft());
  const [fieldErrors, setFieldErrors] = useState<SkillTriggerDraftErrors>({});
  const [nestedErrors, setNestedErrors] = useState<NestedFieldError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<MappedTriggerFieldIssues['cycle']>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailReady, setDetailReady] = useState(false);
  const [recordMissing, setRecordMissing] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [statuses, setStatuses] = useState<GameStatus[]>([]);
  const [parameters, setParameters] = useState<SkillParameter[]>([]);
  const [formulas, setFormulas] = useState<SkillFormulaSummary[]>([]);
  const [effects, setEffects] = useState<SkillEffectSummary[]>([]);
  const [processes, setProcesses] = useState<SkillProcessSummary[]>([]);
  const [internalStates, setInternalStates] = useState<SkillInternalStateSummary[]>([]);
  const [ruleNames, setRuleNames] = useState<Map<string, string>>(() => new Map());
  const [catalogStates, setCatalogStates] = useState<Partial<Record<SkillTriggerCatalogKind, CatalogLoadState>>>({});
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<SkillTriggerCatalogKind, string>>>({});
  const [spellShieldCatalogState, setSpellShieldCatalogState] = useState<CatalogLoadState>('idle');
  const [effectByKey, setEffectByKey] = useState<Map<string, SkillEffect>>(() => new Map());
  const [processByKey, setProcessByKey] = useState<Map<string, SkillProcess>>(() => new Map());
  const [stateByKey, setStateByKey] = useState<Map<string, SkillInternalState>>(() => new Map());
  const [formulaByKey, setFormulaByKey] = useState<Map<string, SkillFormula>>(() => new Map());
  const [conditionEditor, setConditionEditor] = useState<ConditionEditorState | null>(null);
  const [actionEditor, setActionEditor] = useState<ActionEditorState | null>(null);
  const [locateNotice, setLocateNotice] = useState<string | null>(null);
  const [reachableParameters, setReachableParameters] = useState<SkillParameter[]>([]);
  const formulaCacheRef = useRef(createFormulaSessionCache());
  const effectByKeyRef = useRef(effectByKey);
  const processByKeyRef = useRef(processByKey);
  const stateByKeyRef = useRef(stateByKey);
  const formulaByKeyRef = useRef(formulaByKey);
  const detailSerial = useRef(0);
  const catalogSerial = useRef(0);
  const spellShieldSerial = useRef(0);
  effectByKeyRef.current = effectByKey;
  processByKeyRef.current = processByKey;
  stateByKeyRef.current = stateByKey;
  formulaByKeyRef.current = formulaByKey;

  const closeBlocked = saving || (mode === 'edit' && loadingDetail);
  const subEditorOpen = conditionEditor !== null || actionEditor !== null;
  const dirty = visible && isTriggerRuleDraftDirty(draft, baseline);
  const selectedProcess = draft.eventSource.eventType === 'PROCESS_MOMENT'
    ? processByKey.get(draft.eventSource.detail.processKey) ?? null
    : null;
  const selectedResultEffect = draft.eventSource.eventType === 'RESULT_AVAILABLE'
    ? effectByKey.get(draft.eventSource.detail.effectKey) ?? null
    : null;
  const currentStepType = eventStepType(draft.eventSource, selectedProcess);
  const hasEventSource = eventHasEventSource(draft.eventSource.eventType);
  const targetOptions = targetContextOptionsForEvent(draft.eventSource.eventType);
  const requiredCatalogs = requiredCatalogsForDraft(draft, { effectsByKey: effectByKey, processesByKey: processByKey, statesByKey: stateByKey });
  const blockingCatalogs = catalogsBlockingSave(requiredCatalogs, catalogStates);
  const spellShieldCatalogBlocked = draft.eventSource.eventType === 'SPELL_SHIELD_BLOCKED'
    && spellShieldCatalogState !== 'ready';
  const sortedGroups = useMemo(() => sortGroupDrafts(draft.conditionGroups), [draft.conditionGroups]);
  const sortedActions = useMemo(() => sortActionDrafts(draft.actions), [draft.actions]);

  const reportDirty = useCallback((next: SkillTriggerRuleDraft, currentBaseline: SkillTriggerRuleDraft) => {
    onDirtyChange(isTriggerRuleDraftDirty(next, currentBaseline));
  }, [onDirtyChange]);

  const patchDraft = (next: SkillTriggerRuleDraft) => {
    setDraft(next);
    setFieldErrors({});
    setNestedErrors([]);
    setSaveError(null);
    reportDirty(next, baseline);
  };

  const setCatalog = (kind: SkillTriggerCatalogKind, state: CatalogLoadState, message?: string) => {
    setCatalogStates((current) => ({ ...current, [kind]: state }));
    setCatalogErrors((current) => {
      if (!message) {
        const { [kind]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [kind]: message };
    });
  };

  const resetLocalState = useCallback(() => {
    detailSerial.current += 1;
    catalogSerial.current += 1;
    spellShieldSerial.current += 1;
    const empty = createEmptyRuleDraft();
    setDraft(empty);
    setBaseline(empty);
    setFieldErrors({});
    setNestedErrors([]);
    setSaveError(null);
    setLoadError(null);
    setReferenceError(null);
    setCycle(null);
    setSaving(false);
    setLoadingDetail(false);
    setDetailReady(false);
    setRecordMissing(false);
    setSkills([]);
    setAttributes([]);
    setDamageTypes([]);
    setStatuses([]);
    setParameters([]);
    setFormulas([]);
    setEffects([]);
    setProcesses([]);
    setInternalStates([]);
    setRuleNames(new Map());
    setCatalogStates({});
    setCatalogErrors({});
    setSpellShieldCatalogState('idle');
    setEffectByKey(new Map());
    setProcessByKey(new Map());
    setStateByKey(new Map());
    setFormulaByKey(new Map());
    setConditionEditor(null);
    setActionEditor(null);
    setLocateNotice(null);
    setReachableParameters([]);
    formulaCacheRef.current = createFormulaSessionCache();
    effectByKeyRef.current = new Map();
    processByKeyRef.current = new Map();
    stateByKeyRef.current = new Map();
    formulaByKeyRef.current = new Map();
  }, [mode]);

  const handleMissing = useCallback((error: unknown): boolean => {
    if (isSkillNotFound(error)) {
      onSkillMissing();
      return true;
    }
    return false;
  }, [onSkillMissing]);

  const loadSkillsCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('skills', 'loading');
    try {
      const result = await listSkills(apiBaseUrl, selectedGameId, token);
      if (catalogSerial.current !== serial) return;
      setSkills(result.data.items);
      setCatalog('skills', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setSkills([]);
      setCatalog('skills', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, visible]);

  const loadAttributesCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('attributes', 'loading');
    try {
      const result = await listAttributes(apiBaseUrl, selectedGameId, token);
      if (catalogSerial.current !== serial) return;
      setAttributes(result.data.items);
      setCatalog('attributes', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setAttributes([]);
      setCatalog('attributes', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, visible]);

  const loadDamageTypesCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('damageTypes', 'loading');
    try {
      const result = await listDamageTypes(apiBaseUrl, selectedGameId, token);
      if (catalogSerial.current !== serial) return;
      setDamageTypes(result.data.items);
      setCatalog('damageTypes', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setDamageTypes([]);
      setCatalog('damageTypes', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, visible]);

  const loadStatusesCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('statuses', 'loading');
    try {
      const result = await listStatuses(apiBaseUrl, selectedGameId, token);
      if (catalogSerial.current !== serial) return;
      setStatuses(result.data.items);
      setCatalog('statuses', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setStatuses([]);
      setCatalog('statuses', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, visible]);

  const loadParametersCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('parameters', 'loading');
    try {
      const result = await listSkillParameters(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (catalogSerial.current !== serial) return;
      setParameters(result.data);
      setCatalog('parameters', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setParameters([]);
      setCatalog('parameters', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey, visible]);

  const loadFormulasCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('formulas', 'loading');
    try {
      const result = await listSkillFormulas(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (catalogSerial.current !== serial) return;
      setFormulas(result.data);
      setCatalog('formulas', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setFormulas([]);
      setCatalog('formulas', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey, visible]);

  const loadEffectsCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('effects', 'loading');
    try {
      const result = await listSkillEffects(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (catalogSerial.current !== serial) return;
      setEffects(result.data);
      setCatalog('effects', 'ready');
      return result.data;
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setEffects([]);
      setCatalog('effects', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey, visible]);

  const loadProcessesCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('processes', 'loading');
    try {
      const result = await listSkillProcesses(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (catalogSerial.current !== serial) return;
      setProcesses(result.data);
      setCatalog('processes', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setProcesses([]);
      setCatalog('processes', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey, visible]);

  const loadInternalStatesCatalog = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    setCatalog('internalStates', 'loading');
    try {
      const result = await listSkillInternalStates(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (catalogSerial.current !== serial) return;
      setInternalStates(result.data);
      setCatalog('internalStates', 'ready');
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
      setInternalStates([]);
      setCatalog('internalStates', 'error', getErrorMessage(error));
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey, visible]);

  const loadRuleNames = useCallback(async () => {
    const serial = catalogSerial.current;
    const token = adminToken.trim();
    if (!visible || !token) return;
    try {
      const result = await listSkillTriggerRules(apiBaseUrl, selectedGameId, skill.skillKey, token);
      if (catalogSerial.current !== serial) return;
      const names = new Map<string, string>();
      for (const item of result.data) names.set(item.ruleKey, item.name);
      setRuleNames(names);
    } catch (error) {
      if (catalogSerial.current !== serial) return;
      if (handleMissing(error)) return;
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey, visible]);

  const loadDetail = useCallback(async () => {
    const serial = detailSerial.current + 1;
    detailSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || mode !== 'edit' || !rule) {
      setLoadingDetail(false);
      setDetailReady(visible && mode === 'create');
      return;
    }
    if (!token) {
      setLoadError('请先配置 Admin Token。');
      setLoadingDetail(false);
      setDetailReady(false);
      return;
    }
    setDetailReady(false);
    setLoadingDetail(true);
    setLoadError(null);
    try {
      const result = await getSkillTriggerRule(
        apiBaseUrl,
        selectedGameId,
        skill.skillKey,
        rule.ruleKey,
        token
      );
      if (detailSerial.current !== serial) return;
      const next = fromDetail(result.data);
      setDraft(next);
      setBaseline(next);
      setDetailReady(true);
      setRecordMissing(false);
      reportDirty(next, next);
      if (authoringLocation) {
        const resolved = resolveAuthoringLocation(authoringLocation, result.data);
        const unsupported = shouldDegradeUnsupportedAnchor(authoringLocation.editor, resolved.matchedSegments, resolved.precision);
        const notice = (resolved.precision !== 'FIELD' || unsupported || resolved.reason)
          ? authoringLocateMessage({
            originalFieldPath: resolved.originalFieldPath,
            reason: resolved.reason,
            unsupportedAnchor: unsupported,
            reportChanged: resolved.reportChanged
          })
          : null;
        setLocateNotice(notice);
        const groupKey = keyedChildKey(resolved.matchedSegments, 'conditionGroups');
        const conditionKey = keyedChildKey(resolved.matchedSegments, 'conditions');
        const actionKey = keyedChildKey(resolved.matchedSegments, 'actions');
        const bindingKey = keyedChildKey(resolved.matchedSegments, 'runtimeInputBindings');
        const field = lastFieldName(resolved.matchedSegments);
        const canFocus = resolved.precision === 'FIELD' && !unsupported;
        if (conditionKey) {
          const groupIndex = next.conditionGroups.findIndex((group) => group.groupKey === groupKey);
          const group = groupIndex >= 0 ? next.conditionGroups[groupIndex] : undefined;
          const conditionIndex = group?.conditions.findIndex((item) => item.conditionKey === conditionKey) ?? -1;
          if (!group || conditionIndex < 0) {
            setLocateNotice(authoringLocateMessage({ originalFieldPath: resolved.originalFieldPath, reason: 'MISSING_KEY' }));
          } else {
            setConditionEditor({
              mode: 'edit',
              groupIndex,
              conditionIndex,
              draft: group.conditions[conditionIndex]!,
              focusField: canFocus ? field : null,
              locateMessage: notice
            });
          }
        } else if (actionKey) {
          const index = next.actions.findIndex((item) => item.actionKey === actionKey);
          if (index < 0) {
            setLocateNotice(authoringLocateMessage({ originalFieldPath: resolved.originalFieldPath, reason: 'MISSING_KEY' }));
          } else {
            const action = next.actions[index]!;
            if (bindingKey && !action.runtimeInputBindings.some((item) => item.bindingKey === bindingKey)) {
              setLocateNotice(authoringLocateMessage({ originalFieldPath: resolved.originalFieldPath, reason: 'MISSING_KEY' }));
            }
            setActionEditor({
              mode: 'edit',
              index,
              draft: action,
              focusField: canFocus ? field : null,
              locateMessage: notice,
              focusBindingKey: bindingKey && action.runtimeInputBindings.some((item) => item.bindingKey === bindingKey)
                ? bindingKey
                : null
            });
          }
        }
      }
    } catch (error) {
      if (detailSerial.current !== serial) return;
      if (handleMissing(error)) return;
      if (isTriggerRuleNotFound(error)) {
        setRecordMissing(true);
        setLoadError(getErrorMessage(error));
        setDetailReady(false);
        onRuleMissing();
        return;
      }
      setLoadError(getErrorMessage(error));
      setDetailReady(false);
      if (authoringLocation) {
        setLocateNotice(authoringLocateMessage({
          originalFieldPath: authoringLocation.fieldPath,
          reason: 'OBJECT_MISSING'
        }));
      }
    } finally {
      if (detailSerial.current === serial) setLoadingDetail(false);
    }
  }, [adminToken, apiBaseUrl, authoringLocation, handleMissing, mode, onRuleMissing, reportDirty, rule, selectedGameId, skill.skillKey, visible]);

  const ensureEffect = useCallback(async (effectKey: string): Promise<SkillEffect | null> => {
    if (!effectKey.trim()) return null;
    const cached = effectByKeyRef.current.get(effectKey);
    if (cached) return cached;
    const token = adminToken.trim();
    if (!token) return null;
    try {
      const result = await getSkillEffect(apiBaseUrl, selectedGameId, skill.skillKey, effectKey, token);
      effectByKeyRef.current.set(effectKey, result.data);
      setEffectByKey(new Map(effectByKeyRef.current));
      setReferenceError(null);
      return result.data;
    } catch (error) {
      if (handleMissing(error)) return null;
      setReferenceError(getErrorMessage(error));
      return null;
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey]);

  const refreshSpellShieldEffectDetails = useCallback(async (): Promise<boolean> => {
    const serial = spellShieldSerial.current + 1;
    spellShieldSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setSpellShieldCatalogState('error');
      return false;
    }
    setSpellShieldCatalogState('loading');
    const loaded = await Promise.all(effects.map(async (summary) => {
      try {
        const result = await getSkillEffect(
          apiBaseUrl,
          selectedGameId,
          skill.skillKey,
          summary.effectKey,
          token
        );
        return result.data;
      } catch (error) {
        if (!handleMissing(error)) setReferenceError(getErrorMessage(error));
        return null;
      }
    }));
    if (spellShieldSerial.current !== serial) return false;
    if (loaded.some((item) => item === null)) {
      setSpellShieldCatalogState('error');
      return false;
    }
    const next = new Map(effectByKeyRef.current);
    for (const effect of loaded) {
      if (effect) next.set(effect.effectKey, effect);
    }
    effectByKeyRef.current = next;
    setEffectByKey(new Map(next));
    setSpellShieldCatalogState('ready');
    return true;
  }, [adminToken, apiBaseUrl, effects, handleMissing, selectedGameId, skill.skillKey, visible]);

  const ensureProcess = useCallback(async (processKey: string): Promise<SkillProcess | null> => {
    if (!processKey.trim()) return null;
    const cached = processByKeyRef.current.get(processKey);
    if (cached) return cached;
    const token = adminToken.trim();
    if (!token) return null;
    try {
      const result = await getSkillProcess(apiBaseUrl, selectedGameId, skill.skillKey, processKey, token);
      processByKeyRef.current.set(processKey, result.data);
      setProcessByKey(new Map(processByKeyRef.current));
      return result.data;
    } catch (error) {
      if (handleMissing(error)) return null;
      setReferenceError(getErrorMessage(error));
      return null;
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey]);

  const ensureInternalState = useCallback(async (stateKey: string): Promise<SkillInternalState | null> => {
    if (!stateKey.trim()) return null;
    const cached = stateByKeyRef.current.get(stateKey);
    if (cached) return cached;
    const token = adminToken.trim();
    if (!token) return null;
    try {
      const result = await getSkillInternalState(apiBaseUrl, selectedGameId, skill.skillKey, stateKey, token);
      stateByKeyRef.current.set(stateKey, result.data);
      setStateByKey(new Map(stateByKeyRef.current));
      return result.data;
    } catch (error) {
      if (handleMissing(error)) return null;
      setReferenceError(getErrorMessage(error));
      return null;
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey]);

  const ensureFormula = useCallback(async (formulaKey: string): Promise<SkillFormula | null> => {
    if (!formulaKey.trim()) return null;
    const cached = formulaCacheRef.current.get(selectedGameId, skill.skillKey, formulaKey);
    if (cached) return cached;
    const token = adminToken.trim();
    if (!token) return null;
    try {
      const result = await getSkillFormula(apiBaseUrl, selectedGameId, skill.skillKey, formulaKey, token);
      formulaCacheRef.current.set(selectedGameId, skill.skillKey, formulaKey, result.data);
      formulaByKeyRef.current.set(formulaKey, result.data);
      setFormulaByKey(new Map(formulaByKeyRef.current));
      return result.data;
    } catch (error) {
      if (handleMissing(error)) return null;
      setReferenceError(getErrorMessage(error));
      return null;
    }
  }, [adminToken, apiBaseUrl, handleMissing, selectedGameId, skill.skillKey]);

  const reloadReferences = useCallback(async () => {
    setReferenceError(null);
    await Promise.all([
      loadSkillsCatalog(),
      loadAttributesCatalog(),
      loadDamageTypesCatalog(),
      loadStatusesCatalog(),
      loadParametersCatalog(),
      loadFormulasCatalog(),
      loadEffectsCatalog(),
      loadProcessesCatalog(),
      loadInternalStatesCatalog(),
      loadRuleNames()
    ]);
  }, [
    loadAttributesCatalog,
    loadDamageTypesCatalog,
    loadEffectsCatalog,
    loadFormulasCatalog,
    loadInternalStatesCatalog,
    loadParametersCatalog,
    loadProcessesCatalog,
    loadRuleNames,
    loadSkillsCatalog,
    loadStatusesCatalog
  ]);

  useEffect(() => {
    if (!visible) {
      resetLocalState();
      onDirtyChange(false);
      return;
    }
    void loadDetail();
    void reloadReferences();
  }, [loadDetail, onDirtyChange, reloadReferences, resetLocalState, visible]);

  useEffect(() => {
    if (!visible) return;
    const eventSource = draft.eventSource;
    if (eventSource.eventType === 'PROCESS_MOMENT' && eventSource.detail.processKey) {
      void ensureProcess(eventSource.detail.processKey);
    }
    if (eventSource.eventType === 'RESULT_AVAILABLE' && eventSource.detail.effectKey) {
      void ensureEffect(eventSource.detail.effectKey);
    }
    if (eventSource.eventType === 'LIFECYCLE_MOMENT' && eventSource.detail.effectKey) {
      void ensureEffect(eventSource.detail.effectKey);
    }
    if (eventSource.eventType === 'INTERNAL_STATE_CHANGED' && eventSource.detail.stateKey) {
      void ensureInternalState(eventSource.detail.stateKey);
    }
  }, [draft.eventSource, ensureEffect, ensureInternalState, ensureProcess, visible]);

  useEffect(() => {
    if (!visible || draft.eventSource.eventType !== 'SPELL_SHIELD_BLOCKED') {
      spellShieldSerial.current += 1;
      setSpellShieldCatalogState('idle');
      return;
    }
    if (catalogStates.effects !== 'ready') {
      setSpellShieldCatalogState('loading');
      return;
    }
    void refreshSpellShieldEffectDetails();
  }, [catalogStates.effects, draft.eventSource.eventType, refreshSpellShieldEffectDetails, visible]);

  const skillOptions = (currentKey: string | null): CatalogOption[] => {
    const options: CatalogOption[] = [
      { value: '', label: '任意技能' },
      ...skills
        .filter((item) => item.status === 'ENABLED' || item.skillKey === currentKey)
        .map((item) => ({
          value: item.skillKey,
          label: disabledName(item.name ? `${item.name}（${item.skillKey}）` : item.skillKey, item.skillKey, item.status === 'DISABLED'),
          disabled: item.status === 'DISABLED' && item.skillKey !== currentKey
        }))
    ];
    if (currentKey && !options.some((item) => item.value === currentKey)) {
      const catalogLabel = catalogStates.skills === 'ready'
        ? MISSING_CATALOG_LABEL
        : catalogStates.skills === 'error'
          ? '目录加载失败'
          : '目录加载中';
      options.push({
        value: currentKey,
        label: `${currentKey}（${catalogLabel}）`,
        disabled: true
      });
    }
    return options;
  };

  const attributeOptions = (currentKey: string): CatalogOption[] => (
    attributes
      .filter((item) => item.status === 'ENABLED' || item.attributeKey === currentKey)
      .map((item) => ({
        value: item.attributeKey,
        label: disabledName(item.name, item.attributeKey, item.status === 'DISABLED'),
        disabled: item.status === 'DISABLED' && item.attributeKey !== currentKey
      }))
  );

  const damageTypeOptions = (currentKey: string | null): CatalogOption[] => (
    [
      { value: '', label: '任意伤害类型' },
      ...damageTypes
        .filter((item) => item.status === 'ENABLED' || item.damageTypeKey === currentKey)
        .map((item) => ({
          value: item.damageTypeKey,
          label: disabledName(item.name, item.damageTypeKey, item.status === 'DISABLED'),
          disabled: item.status === 'DISABLED' && item.damageTypeKey !== currentKey
        }))
    ]
  );

  const statusOptions = (currentKey: string): CatalogOption[] => (
    statuses
      .filter((item) => item.status === 'ENABLED' || item.statusKey === currentKey)
      .map((item) => ({
        value: item.statusKey,
        label: disabledName(item.name, item.statusKey, item.status === 'DISABLED'),
        disabled: item.status === 'DISABLED' && item.statusKey !== currentKey
      }))
  );

  const formulaOptions = formulas.map((item) => ({
    value: item.formulaKey,
    label: item.name || item.formulaKey
  }));

  const commitEventSource = (next: SkillTriggerEventSource) => {
    const process = next.eventType === 'PROCESS_MOMENT'
      ? processByKey.get(next.detail.processKey) ?? null
      : null;
    const stepType = eventStepType(next, process);
    const processCatalog = [...processByKey.values()];
    const impact = analyzeEventSwitchImpact(draft, next, stepType, processCatalog);
    if (impact.summary) {
      Modal.confirm({
        content: impact.summary,
        okText: '确定',
        cancelText: '取消',
        onOk: () => patchDraft(applyEventSwitchCleanup(draft, next, stepType, processCatalog))
      });
      return;
    }
    patchDraft({ ...draft, eventSource: next });
  };

  const actuallyClose = () => {
    onDirtyChange(false);
    onClose();
  };

  const close = () => {
    if (closeBlocked || subEditorOpen) return;
    if (dirty) {
      Modal.confirm({
        content: SKILL_TRIGGER_UNSAVED_CONFIRM,
        okText: '确定',
        cancelText: '取消',
        onOk: actuallyClose
      });
      return;
    }
    actuallyClose();
  };

  const collectActionNumericValues = async (action: SkillTriggerActionDraft): Promise<NumericValue[] | null> => {
    if (action.actionType === 'EXECUTE_EFFECT') {
      const effect = await ensureEffect(action.detail.effectKey);
      return effect ? collectExecuteEffectValues(effect) : null;
    }
    if (action.actionType === 'START_PROCESS' || action.actionType === 'FAIL_PROCESS' || action.actionType === 'ADVANCE_PROCESS') {
      if (action.detail.processKey) await ensureProcess(action.detail.processKey);
      if (action.actionType !== 'START_PROCESS') return [];
      const process = await ensureProcess(action.detail.processKey);
      if (!process) return null;
      const effectsMap = new Map(effectByKeyRef.current);
      const statesMap = new Map(stateByKeyRef.current);
      for (const binding of process.effectBindings) {
        const effect = await ensureEffect(binding.effectKey);
        if (!effect) return null;
        effectsMap.set(effect.effectKey, effect);
      }
      for (const operation of process.stateOperations) {
        const state = await ensureInternalState(operation.stateKey);
        if (!state) return null;
        statesMap.set(state.stateKey, state);
      }
      return collectStartProcessValues(process, effectsMap, statesMap);
    }
    return [];
  };

  const refreshActionReferences = async (actionDraft: SkillTriggerActionDraft) => {
    setReferenceError(null);
    const serial = detailSerial.current;
    const values = await collectActionNumericValues(actionDraft);
    if (serial !== detailSerial.current || values === null) return;
    const formulaKeys = values.map(numericFormulaKey).filter(Boolean);
    const formulasMap = new Map(formulaByKeyRef.current);
    for (const key of formulaKeys) {
      const formula = await ensureFormula(key);
      if (formula) formulasMap.set(key, formula);
    }
    if (serial !== detailSerial.current) return;
    setReachableParameters(reachableRuntimeInputParameters(values, formulasMap, parameters));
  };

  const openActionEditor = async (
    editorMode: SkillTriggerActionEditorMode,
    index: number | null,
    actionDraft: SkillTriggerActionDraft
  ) => {
    await refreshActionReferences(actionDraft);
    const sorted = sortActionDrafts(draft.actions);
    const priorCount = index === null ? sorted.length : index;
    for (const action of sorted.slice(0, priorCount)) {
      if (action.actionType === 'EXECUTE_EFFECT') {
        await ensureEffect(action.detail.effectKey);
      }
    }
    setActionEditor({ mode: editorMode, index, draft: actionDraft });
  };

  const retryLifecycleConditionEffects = async () => {
    const serial = detailSerial.current;
    setReferenceError(null);
    const summaries = await loadEffectsCatalog();
    if (!summaries || serial !== detailSerial.current) return;
    await Promise.all(summaries.filter((item) => item.lifecycleEnabled).map((item) => ensureEffect(item.effectKey)));
  };

  const openConditionEditor = async (
    editorMode: SkillTriggerConditionEditorMode,
    groupIndex: number,
    conditionIndex: number | null,
    conditionDraft: SkillTriggerConditionDraft
  ) => {
    const serial = detailSerial.current;
    setReferenceError(null);
    await Promise.all(internalStates.map((item) => ensureInternalState(item.stateKey)));
    await Promise.all(
      effects.filter((item) => item.lifecycleEnabled).map((item) => ensureEffect(item.effectKey))
    );
    if (serial !== detailSerial.current) return;
    setConditionEditor({ mode: editorMode, groupIndex, conditionIndex, draft: conditionDraft });
  };

  const ensureSaveReferences = async (): Promise<boolean> => {
    setReferenceError(null);
    const lifecycleEffects = draft.conditionGroups.flatMap((group) => group.conditions.flatMap((condition) => condition.conditionType === 'LIFECYCLE_CHECK' ? [condition.detail.effectKey] : []));
    const conditionEffects = await Promise.all([...new Set(lifecycleEffects)].map(ensureEffect));
    if (conditionEffects.some((effect) => effect === null)) return false;
    const formulaKeys = new Set(collectDirectFormulaKeys(draft));
    for (const action of draft.actions) {
      const keys = await collectActionNumericValues(action);
      if (keys === null) return false;
      for (const key of keys.map(numericFormulaKey).filter(Boolean)) formulaKeys.add(key);
    }
    const loaded = await Promise.all([...formulaKeys].map((key) => ensureFormula(key)));
    const priorEffects = draft.actions.flatMap((action) => {
      if (action.actionType === 'EXECUTE_EFFECT') return [ensureEffect(action.detail.effectKey)];
      return action.runtimeInputBindings
        .filter((item) => item.sourceType === 'PRIOR_ACTION_RESULT')
        .map((binding) => {
          const source = draft.actions.find((item) => (
            item.actionType === 'EXECUTE_EFFECT' && item.actionKey === binding.detail.sourceActionKey
          ));
          if (!source || source.actionType !== 'EXECUTE_EFFECT') return Promise.resolve(null);
          return ensureEffect(source.detail.effectKey);
        });
    });
    const loadedEffects = await Promise.all(priorEffects);
    return loaded.every((item) => item !== null) && loadedEffects.every((item) => item !== null);
  };

  const save = async () => {
    if (saving || closeBlocked || !detailReady || recordMissing || subEditorOpen) return;
    const token = adminToken.trim();
    if (!token) {
      setSaveError('请先配置 Admin Token。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setCycle(null);
    try {
      const spellShieldReferencesReady = draft.eventSource.eventType === 'SPELL_SHIELD_BLOCKED'
        ? await refreshSpellShieldEffectDetails()
        : true;
      const referencesReady = await ensureSaveReferences();
      const validation = validateSkillTriggerDraft(draft, {
        includeRuleKey: mode === 'create',
        skillKey: skill.skillKey,
        catalogStates,
        attributes,
        formulasByKey: formulaByKeyRef.current,
        parameters,
        effectsByKey: effectByKeyRef.current,
        damageTypesByKey: new Map(damageTypes.map((item) => [item.damageTypeKey, item])),
        processesByKey: processByKeyRef.current,
        statesByKey: stateByKeyRef.current,
        stepType: currentStepType
      });
      if (!validation.ok) {
        setFieldErrors(validation.fieldErrors);
        setNestedErrors(validation.nestedErrors);
        return;
      }
      if (!referencesReady || !spellShieldReferencesReady || blockingCatalogs.length > 0) {
        setFieldErrors({ ...fieldErrors, eventSource: INCOMPLETE_CATALOG_MESSAGE });
        return;
      }
      const result = mode === 'create'
        ? await createSkillTriggerRule(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            token,
            toCreateRequest(draft)
          )
        : await updateSkillTriggerRule(
            apiBaseUrl,
            selectedGameId,
            skill.skillKey,
            rule?.ruleKey ?? draft.ruleKey,
            token,
            toUpdateRequest(draft)
          );
      const next = fromDetail(result.data);
      setDraft(next);
      setBaseline(next);
      onDirtyChange(false);
      await onSaved(result.data);
    } catch (error) {
      if (handleMissing(error)) return;
      if (isTriggerRuleNotFound(error)) {
        setRecordMissing(true);
        setSaveError(getErrorMessage(error));
        return;
      }
      const status = error instanceof ApiRequestError ? error.status : 0;
      if (shouldKeepDraftOnHttpStatus(status) || status === 400 || status === 409) {
        const mapped = mapTriggerFieldIssues(error);
        setFieldErrors(mapped.fieldErrors);
        setNestedErrors(mapped.nestedErrors);
        setCycle(mapped.cycle);
        setSaveError(composeSaveError(error, mapped.unmappedMessages));
        return;
      }
      if (!canOverwriteMissingRecord(status, error instanceof ApiRequestError ? error.code : undefined)) {
        setRecordMissing(true);
      }
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoveAction = (index: number) => {
    const sorted = sortActionDrafts(draft.actions);
    const target = sorted[index];
    if (!target) return;
    const apply = () => {
      const without = draft.actions.filter((item) => item.actionKey !== target.actionKey);
      const impact = findStalePriorResultBindings(without, effectByKeyRef.current);
      const cleaned = removeBindingsByKeys(
        without,
        impact.flatMap((item) => item.bindingKeys)
      );
      patchDraft({ ...draft, actions: ensureFailProcessLast(cleaned) });
    };
    const previewWithout = draft.actions.filter((item) => item.actionKey !== target.actionKey);
    const impact = findStalePriorResultBindings(previewWithout, effectByKeyRef.current);
    if (impact.length === 0) {
      apply();
      return;
    }
    Modal.confirm({
      content: `将删除失效绑定：${impact.flatMap((item) => item.summaries).join('；')}`,
      okText: '确定',
      cancelText: '取消',
      onOk: apply
    });
  };

  const moveAction = (index: number, direction: -1 | 1) => {
    const permission = canMoveAction(sortedActions, index, direction);
    if (!permission.ok) {
      setSaveError(permission.message);
      return;
    }
    const next = moveActionDrafts(sortedActions, index, direction);
    const impact = findStalePriorResultBindings(next, effectByKeyRef.current);
    const apply = () => {
      patchDraft({
        ...draft,
        actions: ensureFailProcessLast(
          removeBindingsByKeys(next, impact.flatMap((item) => item.bindingKeys))
        )
      });
    };
    if (impact.length === 0) {
      patchDraft({ ...draft, actions: next });
      return;
    }
    Modal.confirm({
      content: `将删除失效绑定：${impact.flatMap((item) => item.summaries).join('；')}`,
      okText: '确定',
      cancelText: '取消',
      onOk: apply
    });
  };

  const replaceGroup = (groupIndex: number, group: SkillTriggerConditionGroupDraft) => {
    patchDraft({
      ...draft,
      conditionGroups: sortedGroups.map((item, index) => (index === groupIndex ? group : item))
    });
  };

  const catalogAlerts = (Object.keys(catalogErrors) as SkillTriggerCatalogKind[]).map((kind) => (
    <Alert
      key={kind}
      type="error"
      content={catalogErrors[kind]}
      action={
        <Button size="mini" onClick={() => void reloadReferences()}>重试</Button>
      }
    />
  ));

  const eventError = fieldErrors.eventSource || nestedErrorFor('eventSource', nestedErrors);

  return (
    <>
      <Modal
        title={titleFor(mode)}
        visible={visible}
        maskClosable={!dirty && !subEditorOpen && !saving}
        onCancel={close}
        style={{ width: 'calc(100vw - 80px)', maxWidth: 1800 }}
        footer={
          <Space>
            <Button onClick={close} disabled={closeBlocked || subEditorOpen}>取消</Button>
            <Button
              type="primary"
              loading={saving || (mode === 'edit' && loadingDetail)}
              disabled={
                !detailReady
                || recordMissing
                || subEditorOpen
                || blockingCatalogs.length > 0
                || spellShieldCatalogBlocked
                || saving
              }
              onClick={() => void save()}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          {saveError ? <Alert type="error" content={saveError} /> : null}
          {locateNotice ? <Alert type="warning" content={locateNotice} /> : null}
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
          {referenceError ? (
            <Alert
              type="error"
              content={referenceError}
              action={
                <Button size="mini" onClick={() => void reloadReferences()}>重新加载引用</Button>
              }
            />
          ) : null}
          {catalogAlerts}
          {nestedErrors.filter((item) => (
            !item.path.startsWith('eventSource')
            && !item.path.startsWith('conditionGroups')
            && !item.path.startsWith('actions')
            && !item.path.startsWith('perTargetCooldown')
            && !item.path.startsWith('maxTriggersPerProcess')
          )).map((item) => (
            <Alert key={item.path} type="error" content={`${item.path}：${item.message}`} />
          ))}

          {mode === 'create' || (detailReady && !loadingDetail) ? (
          <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          <Typography.Title heading={6}>基本信息</Typography.Title>
          <Form layout="vertical">
            <Form.Item
              label="规则标识"
              required
              validateStatus={fieldErrors.ruleKey ? 'error' : undefined}
              help={fieldErrors.ruleKey}
            >
              <Input
                aria-label="规则标识"
                value={draft.ruleKey}
                disabled={mode === 'edit' || saving}
                maxLength={64}
                onChange={(value) => patchDraft({ ...draft, ruleKey: value })}
              />
            </Form.Item>
            <Form.Item
              label="规则名称"
              required
              validateStatus={fieldErrors.name ? 'error' : undefined}
              help={fieldErrors.name}
            >
              <Input
                aria-label="规则名称"
                value={draft.name}
                disabled={saving}
                maxLength={100}
                onChange={(value) => patchDraft({ ...draft, name: value })}
              />
            </Form.Item>
            <Form.Item
              label="说明"
              validateStatus={fieldErrors.description ? 'error' : undefined}
              help={fieldErrors.description}
            >
              <Input.TextArea
                aria-label="规则说明"
                value={draft.description}
                disabled={saving}
                maxLength={1000}
                onChange={(value) => patchDraft({ ...draft, description: value })}
              />
            </Form.Item>
            <Form.Item
              label="排序"
              required
              validateStatus={fieldErrors.sortOrder ? 'error' : undefined}
              help={fieldErrors.sortOrder}
            >
              <Input
                aria-label="规则排序"
                value={draft.sortOrder}
                disabled={saving}
                onChange={(value) => patchDraft({ ...draft, sortOrder: value })}
              />
            </Form.Item>
          </Form>

          <Typography.Title heading={6}>事件来源</Typography.Title>
          {eventError ? <Alert type="error" content={eventError} /> : null}
          <Form layout="vertical">
            <Form.Item label="事件类型" required>
              <Select
                aria-label="事件类型"
                showSearch
                filterOption={matchesSelectOptionSearch}
                value={draft.eventSource.eventType}
                disabled={saving}
                options={SKILL_TRIGGER_EVENT_TYPES.map((value) => ({
                  value,
                  label: SKILL_TRIGGER_EVENT_TYPE_LABELS[value]
                }))}
                onChange={(value) => commitEventSource(
                  createEmptyEventSource(value as SkillTriggerEventType)
                )}
              />
            </Form.Item>
            {draft.eventSource.eventType === 'SOURCE_INITIALIZED' ? (
              <Alert type="info" content={`${SKILL_TRIGGER_SOURCE_INITIALIZED_HINT} ${SKILL_TRIGGER_EVENT_CAPABILITIES.SOURCE_INITIALIZED.currentTargetBinding}`} />
            ) : null}
            {draft.eventSource.eventType === 'TAKEDOWN' ? (
              <Alert type="info" content={SKILL_TRIGGER_TAKEDOWN_HINT} />
            ) : null}
            {renderEventSourceFields({
              eventSource: draft.eventSource,
              disabled: saving,
              skills: skillOptions,
              attributes: attributeOptions,
              damageTypes: damageTypeOptions,
              statuses: statusOptions,
              formulas: formulaOptions,
              numericFormulas: formulas,
              parameters,
              effects,
              effectDetails: effectByKey,
              spellShieldCatalogState,
              processes,
              internalStates,
              selectedProcess,
              selectedResultEffect,
              onChange: commitEventSource,
              onSelectProcess: (processKey) => void ensureProcess(processKey),
              onSelectEffect: (effectKey) => void ensureEffect(effectKey)
            })}
          </Form>

          <Typography.Title heading={6}>条件组</Typography.Title>
          <Alert type="info" content={SKILL_TRIGGER_CONDITION_GROUP_HINT} />
          {fieldErrors.conditionGroups ? <Alert type="error" content={fieldErrors.conditionGroups} /> : null}
          <Space>
            <Button
              disabled={saving}
              onClick={() => patchDraft({
                ...draft,
                conditionGroups: [
                  ...draft.conditionGroups,
                  createEmptyGroupDraft(draft.conditionGroups.map((item) => item.groupKey))
                ]
              })}
            >
              新增条件组
            </Button>
          </Space>
          {sortedGroups.map((group, groupIndex) => (
            <div key={group.draftId}>
              {groupIndex > 0 ? <div>{SKILL_TRIGGER_GROUP_OR_LABEL}</div> : null}
              <Card
                title={group.name || group.groupKey}
                extra={
                  <Space size="mini">
                    <Button
                      size="mini"
                      disabled={saving}
                      onClick={() => void openConditionEditor(
                        'create',
                        groupIndex,
                        null,
                        createEmptyConditionDraft([...group.conditions.map((item) => item.conditionKey), ...baseline.conditionGroups.flatMap((item) => item.conditions.map((condition) => condition.conditionKey))])
                      )}
                    >
                      新增条件
                    </Button>
                    <Button
                      size="mini"
                      status="danger"
                      disabled={saving}
                      onClick={() => patchDraft({
                        ...draft,
                        conditionGroups: sortedGroups.filter((_, index) => index !== groupIndex)
                      })}
                    >
                      删除
                    </Button>
                  </Space>
                }
              >
                {nestedErrorFor(`conditionGroups[${groupIndex}]`, nestedErrors) ? (
                  <Alert
                    type="error"
                    content={nestedErrorFor(`conditionGroups[${groupIndex}]`, nestedErrors)}
                    style={{ marginBottom: 12 }}
                  />
                ) : null}
                <Form layout="vertical">
                  <Form.Item label="条件组标识" required>
                    <Input
                      aria-label="条件组标识"
                      value={group.groupKey}
                      disabled={saving || baseline.conditionGroups.some((item) => item.groupKey === group.groupKey)}
                      onChange={(value) => replaceGroup(groupIndex, { ...group, groupKey: value })}
                    />
                  </Form.Item>
                  <Form.Item label="条件组名称" required>
                    <Input
                      aria-label="条件组名称"
                      value={group.name}
                      disabled={saving}
                      maxLength={100}
                      onChange={(value) => replaceGroup(groupIndex, { ...group, name: value })}
                    />
                  </Form.Item>
                  <Form.Item label="排序" required>
                    <Input
                      aria-label="条件组排序"
                      value={group.sortOrder}
                      disabled={saving}
                      onChange={(value) => replaceGroup(groupIndex, { ...group, sortOrder: value })}
                    />
                  </Form.Item>
                </Form>
                <div>{groupConditionSummary(group) || '—'}</div>
                {sortConditionDrafts(group.conditions).map((condition, conditionIndex) => (
                  <div key={condition.conditionKey}>
                    {conditionIndex > 0 ? <div>{SKILL_TRIGGER_GROUP_AND_LABEL}</div> : null}
                    <Space>
                      <span>{conditionSummary(condition)}</span>
                      <Button
                        size="mini"
                        disabled={saving}
                        onClick={() => void openConditionEditor('edit', groupIndex, conditionIndex, condition)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="mini"
                        status="danger"
                        disabled={saving}
                        onClick={() => replaceGroup(groupIndex, {
                          ...group,
                          conditions: group.conditions.filter((item) => item.conditionKey !== condition.conditionKey)
                        })}
                      >
                        删除
                      </Button>
                    </Space>
                  </div>
                ))}
              </Card>
            </div>
          ))}

          <Typography.Title heading={6}>有序动作</Typography.Title>
          {fieldErrors.actions ? <Alert type="error" content={fieldErrors.actions} /> : null}
          <Space>
            <Button
              disabled={saving}
              onClick={() => void openActionEditor(
                'create',
                null,
                createEmptyActionDraft(draft.actions.map((item) => item.actionKey))
              )}
            >
              新增动作
            </Button>
          </Space>
          {sortedActions.map((action, actionIndex) => (
            <Card
              key={action.actionKey}
              title={`${actionIndex + 1}. ${action.name || action.actionKey}`}
              extra={
                <Space size="mini">
                  <Button
                    size="mini"
                    disabled={saving || actionIndex === 0}
                    onClick={() => moveAction(actionIndex, -1)}
                  >
                    上移
                  </Button>
                  <Button
                    size="mini"
                    disabled={saving || actionIndex === sortedActions.length - 1}
                    onClick={() => moveAction(actionIndex, 1)}
                  >
                    下移
                  </Button>
                  <Button
                    size="mini"
                    disabled={saving}
                    onClick={() => void openActionEditor('edit', actionIndex, action)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="mini"
                    status="danger"
                    disabled={saving}
                    onClick={() => confirmRemoveAction(actionIndex)}
                  >
                    删除
                  </Button>
                </Space>
              }
            >
              {nestedErrorFor(`actions[${actionIndex}]`, nestedErrors) ? (
                <Alert type="error" content={nestedErrorFor(`actions[${actionIndex}]`, nestedErrors)} />
              ) : null}
              <div>{actionSummary(action)}</div>
              <div>{SKILL_TRIGGER_ACTION_TYPE_LABELS[action.actionType]}</div>
            </Card>
          ))}

          <Typography.Title heading={6}>触发保护</Typography.Title>
          {cycle ? (
            <Alert
              type="error"
              content={`${cycle.message}：${formatCyclePath(cycle.pathItems, ruleNames).join(' → ') || SKILL_TRIGGER_CYCLE_MESSAGE}。${cycle.hint || SKILL_TRIGGER_CYCLE_HINT} ${SKILL_TRIGGER_RESULT_EVENT_GRAPH_HINT}`}
            />
          ) : null}
          <Form layout="vertical">
            <Form.Item
              label="每目标冷却"
              validateStatus={fieldErrors.perTargetCooldown ? 'error' : undefined}
              help={fieldErrors.perTargetCooldown || nestedErrorFor('perTargetCooldown', nestedErrors)}
            >
              <Switch
                aria-label="每目标冷却"
                checked={draft.perTargetCooldownEnabled}
                disabled={saving}
                onChange={(value) => patchDraft({
                  ...draft,
                  perTargetCooldownEnabled: value,
                  perTargetCooldownTargetContext: hasEventSource
                    ? draft.perTargetCooldownTargetContext
                    : 'CURRENT_TARGET'
                })}
              />
            </Form.Item>
            {draft.perTargetCooldownEnabled ? (
              <>
                <Form.Item label="时长取值" required extra="结果按毫秒解释，必须大于 0；允许小数。">
                  <NumericValueField aria-label="每目标冷却取值"
                  value={draft.perTargetCooldownDurationValue}
                  onChange={(value) => patchDraft({
                      ...draft,
                      perTargetCooldownDurationValue: value!
                    })}
                  parameters={parameters}
        formulas={formulas}
                  disabled={saving} />
                </Form.Item>
                <Form.Item label="目标对象" required>
                  <Select
                    aria-label="每目标冷却对象"
                    value={draft.perTargetCooldownTargetContext}
                    disabled={saving}
                    options={targetOptions.map((value) => ({
                      value,
                      label: SKILL_TRIGGER_TARGET_CONTEXT_LABELS[value]
                    }))}
                    onChange={(value) => patchDraft({
                      ...draft,
                      perTargetCooldownTargetContext: value as SkillTriggerTargetContext
                    })}
                  />
                </Form.Item>
              </>
            ) : null}
            {draft.eventSource.eventType === 'PROCESS_MOMENT' ? (
              <>
                <Form.Item
                  label="单次过程最大触发次数"
                  extra={MAX_TRIGGERS_SCOPE_HINT}
                  validateStatus={fieldErrors.maxTriggersPerProcess ? 'error' : undefined}
                  help={fieldErrors.maxTriggersPerProcess || nestedErrorFor('maxTriggersPerProcess', nestedErrors)}
                >
                  <Switch
                    aria-label="单次过程最大触发次数"
                    checked={draft.maxTriggersPerProcessEnabled}
                    disabled={saving}
                    onChange={(value) => patchDraft({
                      ...draft,
                      maxTriggersPerProcessEnabled: value
                    })}
                  />
                </Form.Item>
                {draft.maxTriggersPerProcessEnabled ? (
                  <>
                    <Form.Item label="过程">
                      <Input
                        aria-label="次数保护过程"
                        value={draft.eventSource.detail.processKey}
                        disabled
                      />
                    </Form.Item>
                    <Form.Item label="次数取值" required>
                      <NumericValueField aria-label="次数取值"
                  value={draft.maxTriggersLimitValue}
                  onChange={(value) => patchDraft({
                          ...draft,
                          maxTriggersLimitValue: value!
                        })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={saving} />
                    </Form.Item>
                  </>
                ) : null}
              </>
            ) : null}
          </Form>
          </Space>
          ) : !loadError ? <Alert type="info" content="正在加载规则详情…" /> : null}
        </Space>
      </Modal>

      <SkillTriggerConditionEditorModal
        skillKey={skill.skillKey}
        effectsLoadState={catalogStates.effects}
        onRetryLifecycleEffects={retryLifecycleConditionEffects}
        originalConditionType={conditionEditor ? baseline.conditionGroups.find((group) => group.groupKey === sortedGroups[conditionEditor.groupIndex]?.groupKey)?.conditions.find((condition) => condition.conditionKey === conditionEditor.draft.conditionKey)?.conditionType : undefined}
        parameters={parameters}
        parametersLoadState={catalogStates.parameters === 'error' ? 'failed' : catalogStates.parameters === 'ready' ? 'ready' : undefined}
        visible={conditionEditor !== null}
        mode={conditionEditor?.mode ?? 'create'}
        draft={conditionEditor?.draft ?? null}
        existingKeys={
          conditionEditor
            ? sortedGroups[conditionEditor.groupIndex]?.conditions.map((item) => item.conditionKey) ?? []
            : []
        }
        eventSource={draft.eventSource}
        attributes={attributes}
        statuses={statuses}
        formulas={formulas}
        internalStates={[...stateByKey.values()]}
        effects={[...effectByKey.values()]}
        fieldErrors={nestedErrors}
        disabled={saving}
        onClose={() => setConditionEditor(null)}
        focusField={conditionEditor?.focusField ?? null}
        locateMessage={conditionEditor?.locateMessage ?? null}
        onConfirm={(nextCondition) => {
          if (!conditionEditor) return;
          const group = sortedGroups[conditionEditor.groupIndex];
          if (!group) return;
          const conditions = conditionEditor.mode === 'edit' && conditionEditor.conditionIndex !== null
            ? sortConditionDrafts(group.conditions).map((item, index) => (
                index === conditionEditor.conditionIndex ? nextCondition : item
              ))
            : [...group.conditions, nextCondition];
          replaceGroup(conditionEditor.groupIndex, { ...group, conditions });
          setConditionEditor(null);
        }}
      />

      <SkillTriggerActionEditorModal
        originalBindings={baseline.actions.find((item) => item.actionKey === actionEditor?.draft?.actionKey)?.runtimeInputBindings ?? []}
        attributes={attributes}
        attributesLoadState={catalogStates.attributes}
        onRetryAttributes={loadAttributesCatalog}
        visible={actionEditor !== null}
        mode={actionEditor?.mode ?? 'create'}
        draft={actionEditor?.draft ?? null}
        existingKeys={draft.actions.map((item) => item.actionKey)}
        eventSource={draft.eventSource}
        actions={sortedActions}
        currentActionIndex={actionEditor?.index ?? sortedActions.length}
        effects={effects}
        effectDetails={effectByKey}
        processes={processes}
        processesLoadState={catalogStates.processes}
        processDetails={processByKey}
        onEnsureProcess={ensureProcess}
        skillKey={skill.skillKey}
        internalStates={[...stateByKey.values()]}
        statuses={statuses}
        reachableParameters={reachableParameters}
        fieldErrors={nestedErrors}
        disabled={saving}
        onTargetChange={(next) => refreshActionReferences(next)}
        onEnsureEffect={ensureEffect}
        onClose={() => setActionEditor(null)}
        focusField={actionEditor?.focusField ?? null}
        locateMessage={actionEditor?.locateMessage ?? null}
        focusBindingKey={actionEditor?.focusBindingKey ?? null}
        onConfirm={(nextAction) => {
          const nextActions = actionEditor?.mode === 'edit' && actionEditor.index !== null
            ? sortedActions.map((item, index) => (index === actionEditor.index ? nextAction : item))
            : [...draft.actions, nextAction];
          const normalized = ensureFailProcessLast(nextActions);
          const impact = findStalePriorResultBindings(normalized, effectByKeyRef.current);
          const apply = () => {
            patchDraft({
              ...draft,
              actions: ensureFailProcessLast(
                removeBindingsByKeys(nextActions, impact.flatMap((item) => item.bindingKeys))
              )
            });
            setActionEditor(null);
          };
          if (impact.length === 0) {
            patchDraft({ ...draft, actions: normalized });
            setActionEditor(null);
            return;
          }
          Modal.confirm({
            content: `将删除失效绑定：${impact.flatMap((item) => item.summaries).join('；')}`,
            okText: '确定',
            cancelText: '取消',
            onOk: apply
          });
        }}
      />
    </>
  );
}

type EventSourceFieldProps = {
  eventSource: SkillTriggerEventSource;
  disabled: boolean;
  skills: (currentKey: string | null) => CatalogOption[];
  attributes: (currentKey: string) => CatalogOption[];
  damageTypes: (currentKey: string | null) => CatalogOption[];
  statuses: (currentKey: string) => CatalogOption[];
  formulas: CatalogOption[];
  numericFormulas: readonly SkillFormulaSummary[];
  parameters: readonly SkillParameter[];
  effects: readonly SkillEffectSummary[];
  effectDetails: ReadonlyMap<string, SkillEffect>;
  spellShieldCatalogState: CatalogLoadState;
  processes: readonly SkillProcessSummary[];
  internalStates: readonly SkillInternalStateSummary[];
  selectedProcess: SkillProcess | null;
  selectedResultEffect: SkillEffect | null;
  onChange: (next: SkillTriggerEventSource) => void;
  onSelectProcess: (processKey: string) => void;
  onSelectEffect: (effectKey: string) => void;
};

function renderEventSourceFields(props: EventSourceFieldProps) {
  const { eventSource, disabled, onChange } = props;
  switch (eventSource.eventType) {
    case 'SKILL_USED':
      return (
        <>
          <Form.Item label="来源技能">
            <Select
              aria-label="来源技能"
              showSearch
              filterOption={matchesSelectOptionSearch}
              value={eventSource.detail.sourceSkillKey ?? ''}
              disabled={disabled}
              options={props.skills(eventSource.detail.sourceSkillKey)}
              onChange={(value) => {
                const key = String(value ?? '');
                onChange({
                  eventType: 'SKILL_USED',
                  detail: {
                    sourceSkillKey: key === '' ? null : key,
                    useKind: eventSource.detail.useKind,
                    castPhase: eventSource.detail.castPhase
                  }
                });
              }}
            />
          </Form.Item>
          <Form.Item label="使用种类" required>
            <Select
              aria-label="使用种类"
              value={eventSource.detail.useKind}
              disabled={disabled}
              options={(Object.keys(SKILL_TRIGGER_USE_KIND_LABELS) as SkillTriggerEventUseKind[]).map((value) => ({
                value,
                label: SKILL_TRIGGER_USE_KIND_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'SKILL_USED',
                detail: {
                  sourceSkillKey: eventSource.detail.sourceSkillKey,
                  useKind: value as SkillTriggerEventUseKind,
                  castPhase: eventSource.detail.castPhase
                }
              })}
            />
          </Form.Item>
          <Form.Item
            label="使用阶段"
            required
            extra={eventSource.detail.castPhase === null ? SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL : undefined}
            help={eventSource.detail.castPhase === null ? SKILL_TRIGGER_CAST_PHASE_REQUIRED_MESSAGE : undefined}
          >
            <Select
              aria-label="使用阶段"
              value={eventSource.detail.castPhase ?? undefined}
              disabled={disabled}
              placeholder={SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL}
              options={SKILL_TRIGGER_CAST_PHASES.map((value) => ({
                value,
                label: SKILL_TRIGGER_CAST_PHASE_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'SKILL_USED',
                detail: {
                  sourceSkillKey: eventSource.detail.sourceSkillKey,
                  useKind: eventSource.detail.useKind,
                  castPhase: value as SkillTriggerCastPhase
                }
              })}
            />
          </Form.Item>
        </>
      );
    case 'SKILL_HIT':
      return (
        <Form.Item label="来源技能">
          <Select
            aria-label="命中来源技能"
            showSearch
            filterOption={matchesSelectOptionSearch}
            value={eventSource.detail.sourceSkillKey ?? ''}
            disabled={disabled}
            options={props.skills(eventSource.detail.sourceSkillKey)}
            onChange={(value) => {
              const key = String(value ?? '');
              onChange({
                eventType: 'SKILL_HIT',
                detail: { sourceSkillKey: key === '' ? null : key }
              });
            }}
          />
        </Form.Item>
      );
    case 'HIT_LINK_APPLIED':
    case 'ATTACK_LINK_APPLIED':
      return (
        <Form.Item label="来源技能" help={SKILL_TRIGGER_SOURCE_SKILL_FILTER_HINT}>
            <Select
              aria-label="联动来源技能"
              showSearch
              filterOption={matchesSelectOptionSearch}
              value={eventSource.detail.sourceSkillKey ?? ''}
              disabled={disabled}
              options={props.skills(eventSource.detail.sourceSkillKey)}
              onChange={(value) => {
                const key = String(value ?? '');
                onChange({
                  eventType: eventSource.eventType,
                  detail: { sourceSkillKey: key === '' ? null : key }
                });
              }}
            />
          </Form.Item>
      );
    case 'PROCESS_MOMENT':
      return (
        <>
          <Form.Item label="过程" required>
            <Select
              aria-label="事件过程"
              value={eventSource.detail.processKey || undefined}
              disabled={disabled}
              options={props.processes.map((item) => ({
                value: item.processKey,
                label: item.name || item.processKey
              }))}
              onChange={(value) => {
                const processKey = String(value ?? '');
                props.onSelectProcess(processKey);
                onChange({
                  eventType: 'PROCESS_MOMENT',
                  detail: {
                    processKey,
                    moment: eventSource.detail.moment
                  }
                });
              }}
            />
          </Form.Item>
          <Form.Item label="过程时点" required>
            <Select
              aria-label="过程时点"
              value={eventSource.detail.moment.momentType}
              disabled={disabled}
              options={SKILL_PROCESS_MOMENT_TYPES.map((value) => ({
                value,
                label: SKILL_PROCESS_MOMENT_TYPE_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'PROCESS_MOMENT',
                detail: {
                  processKey: eventSource.detail.processKey,
                  moment: processMomentFrom(
                    value as SkillProcessMomentType,
                    eventSource.detail.moment.stepKey ?? '',
                    eventSource.detail.moment.failureReason ?? ''
                  )
                }
              })}
            />
          </Form.Item>
          {!isProcessLevelMoment(eventSource.detail.moment.momentType) ? (
            <Form.Item label="步骤" required>
              <Select
                aria-label="过程步骤"
                value={eventSource.detail.moment.stepKey || undefined}
                disabled={disabled}
                options={(props.selectedProcess?.steps ?? []).map((item) => ({
                  value: item.stepKey,
                  label: item.name || item.stepKey
                }))}
                onChange={(value) => onChange({
                  eventType: 'PROCESS_MOMENT',
                  detail: {
                    processKey: eventSource.detail.processKey,
                    moment: processMomentFrom(
                      eventSource.detail.moment.momentType,
                      String(value ?? ''),
                      eventSource.detail.moment.failureReason ?? ''
                    )
                  }
                })}
              />
            </Form.Item>
          ) : null}
          {eventSource.detail.moment.momentType === 'PROCESS_FAILURE' ? (
            <Form.Item label="失败原因">
              <Select
                aria-label="失败原因"
                allowClear
                value={eventSource.detail.moment.failureReason ?? undefined}
                disabled={disabled}
                placeholder={PROCESS_FAILURE_REASON_ANY_LABEL}
                options={PROCESS_FAILURE_REASONS.map((value) => ({
                  value,
                  label: PROCESS_FAILURE_REASON_LABELS[value]
                }))}
                onChange={(value) => onChange({
                  eventType: 'PROCESS_MOMENT',
                  detail: {
                    processKey: eventSource.detail.processKey,
                    moment: processMomentFrom(
                      eventSource.detail.moment.momentType,
                      eventSource.detail.moment.stepKey ?? '',
                      value ? value as SkillProcessFailureReason : ''
                    )
                  }
                })}
              />
            </Form.Item>
          ) : null}
        </>
      );
    case 'RESULT_AVAILABLE':
      return (
        <>
          <Form.Item label="效果" required>
            <Select
              aria-label="结果事件效果"
              value={eventSource.detail.effectKey || undefined}
              disabled={disabled}
              options={props.effects
                .filter((item) => !item.lifecycleEnabled || item.effectKey === eventSource.detail.effectKey)
                .map((item) => ({
                  value: item.effectKey,
                  label: item.name || item.effectKey,
                  disabled: item.lifecycleEnabled && item.effectKey !== eventSource.detail.effectKey
                }))}
              onChange={(value) => {
                const effectKey = String(value ?? '');
                props.onSelectEffect(effectKey);
                onChange({
                  eventType: 'RESULT_AVAILABLE',
                  detail: { effectKey, resultKey: '' }
                });
              }}
            />
          </Form.Item>
          <Form.Item label="结果" required>
            <Select
              aria-label="结果事件结果"
              value={eventSource.detail.resultKey || undefined}
              disabled={disabled}
              options={(props.selectedResultEffect?.results ?? []).map((item) => ({
                value: item.resultKey,
                label: item.name || item.resultKey
              }))}
              onChange={(value) => onChange({
                eventType: 'RESULT_AVAILABLE',
                detail: {
                  effectKey: eventSource.detail.effectKey,
                  resultKey: String(value ?? '')
                }
              })}
            />
          </Form.Item>
        </>
      );
    case 'LIFECYCLE_MOMENT':
      return (
        <>
          <Form.Item label="效果" required>
            <Select
              aria-label="生命周期事件效果"
              value={eventSource.detail.effectKey || undefined}
              disabled={disabled}
              options={props.effects
                .filter((item) => item.lifecycleEnabled || item.effectKey === eventSource.detail.effectKey)
                .map((item) => ({
                  value: item.effectKey,
                  label: item.name || item.effectKey,
                  disabled: !item.lifecycleEnabled && item.effectKey !== eventSource.detail.effectKey
                }))}
              onChange={(value) => {
                const effectKey = String(value ?? '');
                props.onSelectEffect(effectKey);
                onChange({
                  eventType: 'LIFECYCLE_MOMENT',
                  detail: { effectKey, moment: eventSource.detail.moment }
                });
              }}
            />
          </Form.Item>
          <Form.Item label="生命周期时点" required>
            <Select
              aria-label="生命周期时点"
              value={eventSource.detail.moment}
              disabled={disabled}
              options={SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS.map((value) => ({
                value,
                label: SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENT_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'LIFECYCLE_MOMENT',
                detail: {
                  effectKey: eventSource.detail.effectKey,
                  moment: value as SkillTriggerLifecycleEventMoment
                }
              })}
            />
          </Form.Item>
        </>
      );
    case 'DAMAGE_PENDING':
    case 'DAMAGE_DEALT':
    case 'DAMAGE_TAKEN': {
      const eventType = eventSource.eventType;
      return (
        <>
          <Form.Item label="伤害类型">
            <Select
              aria-label="伤害事件伤害类型"
              value={eventSource.detail.damageTypeKey ?? ''}
              disabled={disabled}
              options={props.damageTypes(eventSource.detail.damageTypeKey)}
              onChange={(value) => {
                const key = String(value ?? '');
                onChange({
                  eventType,
                  detail: {
                    ...eventSource.detail,
                    damageTypeKey: key === '' ? null : key
                  }
                });
              }}
            />
          </Form.Item>
          <Form.Item label="伤害产生方式" required>
            <Select
              aria-label="伤害事件产生方式"
              value={eventSource.detail.deliveryKind}
              disabled={disabled}
              options={(Object.keys(
                SKILL_TRIGGER_DAMAGE_DELIVERY_KIND_LABELS
              ) as SkillTriggerDamageDeliveryKind[]).map((value) => ({
                value,
                label: SKILL_TRIGGER_DAMAGE_DELIVERY_KIND_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType,
                detail: {
                  ...eventSource.detail,
                  deliveryKind: value as SkillTriggerDamageDeliveryKind
                }
              })}
            />
          </Form.Item>
          <Form.Item label="伤害来源性质" required>
            <Select
              aria-label="伤害事件来源性质"
              value={eventSource.detail.originKind}
              disabled={disabled}
              options={(Object.keys(
                SKILL_TRIGGER_DAMAGE_ORIGIN_KIND_LABELS
              ) as SkillTriggerDamageOriginKind[]).map((value) => ({
                value,
                label: SKILL_TRIGGER_DAMAGE_ORIGIN_KIND_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType,
                detail: {
                  ...eventSource.detail,
                  originKind: value as SkillTriggerDamageOriginKind
                }
              })}
            />
          </Form.Item>
        </>
      );
    }
    case 'STATUS_CHANGED':
      return (
        <>
          <Form.Item label="对象" required>
            <Select
              aria-label="状态变化对象"
              value={eventSource.detail.subject}
              disabled={disabled}
              options={(['SOURCE', 'CURRENT_TARGET'] as const).map((value) => ({
                value,
                label: SKILL_TRIGGER_SUBJECT_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'STATUS_CHANGED',
                detail: {
                  ...eventSource.detail,
                  subject: value as 'SOURCE' | 'CURRENT_TARGET'
                }
              })}
            />
          </Form.Item>
          <Form.Item label="状态" required>
            <Select
              aria-label="状态变化状态"
              value={eventSource.detail.statusKey || undefined}
              disabled={disabled}
              options={props.statuses(eventSource.detail.statusKey)}
              onChange={(value) => onChange({
                eventType: 'STATUS_CHANGED',
                detail: { ...eventSource.detail, statusKey: String(value ?? '') }
              })}
            />
          </Form.Item>
          <Form.Item label="变化" required>
            <Select
              aria-label="状态变化种类"
              value={eventSource.detail.change}
              disabled={disabled}
              options={(Object.keys(SKILL_TRIGGER_STATUS_CHANGE_LABELS) as SkillTriggerStatusChangeKind[]).map((value) => ({
                value,
                label: SKILL_TRIGGER_STATUS_CHANGE_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'STATUS_CHANGED',
                detail: {
                  ...eventSource.detail,
                  change: value as SkillTriggerStatusChangeKind
                }
              })}
            />
          </Form.Item>
        </>
      );
    case 'HEALTH_THRESHOLD_CROSSED':
      return (
        <>
          <Form.Item label="对象" required>
            <Select
              aria-label="生命阈值对象"
              value={eventSource.detail.subject}
              disabled={disabled}
              options={(['SOURCE', 'CURRENT_TARGET'] as const).map((value) => ({
                value,
                label: SKILL_TRIGGER_SUBJECT_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'HEALTH_THRESHOLD_CROSSED',
                detail: {
                  ...eventSource.detail,
                  subject: value as 'SOURCE' | 'CURRENT_TARGET'
                }
              })}
            />
          </Form.Item>
          <Form.Item label="属性" required>
            <Select
              aria-label="生命阈值属性"
              value={eventSource.detail.attributeKey || undefined}
              disabled={disabled}
              options={props.attributes(eventSource.detail.attributeKey)}
              onChange={(value) => onChange({
                eventType: 'HEALTH_THRESHOLD_CROSSED',
                detail: { ...eventSource.detail, attributeKey: String(value ?? '') }
              })}
            />
          </Form.Item>
          <Form.Item label="阈值取值" required>
            <NumericValueField aria-label="阈值取值"
                  value={eventSource.detail.thresholdValue}
                  onChange={(value) => onChange({
                eventType: 'HEALTH_THRESHOLD_CROSSED',
                detail: { ...eventSource.detail, thresholdValue: value! }
              })}
                  parameters={props.parameters}
                  formulas={props.numericFormulas}
                  disabled={disabled} />
          </Form.Item>
          <Form.Item label="方向" required>
            <Select
              aria-label="生命阈值方向"
              value={eventSource.detail.direction}
              disabled={disabled}
              options={(Object.keys(SKILL_TRIGGER_HEALTH_DIRECTION_LABELS) as SkillTriggerHealthDirection[]).map((value) => ({
                value,
                label: SKILL_TRIGGER_HEALTH_DIRECTION_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'HEALTH_THRESHOLD_CROSSED',
                detail: {
                  ...eventSource.detail,
                  direction: value as SkillTriggerHealthDirection
                }
              })}
            />
          </Form.Item>
        </>
      );
    case 'INTERNAL_STATE_CHANGED': {
      const selected = props.internalStates.find((item) => item.stateKey === eventSource.detail.stateKey);
      const kinds = changeKindsForInternalState(selected?.stateType ?? null);
      return (
        <>
          <Form.Item label="内部状态" required>
            <Select
              aria-label="内部状态变化状态"
              value={eventSource.detail.stateKey || undefined}
              disabled={disabled}
              options={props.internalStates.map((item) => ({
                value: item.stateKey,
                label: item.name || item.stateKey
              }))}
              onChange={(value) => {
                const stateKey = String(value ?? '');
                const nextState = props.internalStates.find((item) => item.stateKey === stateKey);
                const nextKinds = changeKindsForInternalState(nextState?.stateType ?? null);
                onChange({
                  eventType: 'INTERNAL_STATE_CHANGED',
                  detail: {
                    stateKey,
                    changeKind: nextKinds[0] ?? 'VALUE_CHANGED'
                  }
                });
              }}
            />
          </Form.Item>
          <Form.Item label="变化种类" required>
            <Select
              aria-label="内部状态变化种类"
              value={eventSource.detail.changeKind}
              disabled={disabled}
              options={kinds.map((value) => ({
                value,
                label: SKILL_TRIGGER_INTERNAL_STATE_CHANGE_LABELS[value]
              }))}
              onChange={(value) => onChange({
                eventType: 'INTERNAL_STATE_CHANGED',
                detail: {
                  stateKey: eventSource.detail.stateKey,
                  changeKind: value as SkillTriggerInternalStateChangeKind
                }
              })}
            />
          </Form.Item>
        </>
      );
    }
    case 'ENTITY_DIED':
      return (
        <Form.Item label="对象" required>
          <Select
            aria-label="对象"
            value={eventSource.detail.subject}
            disabled={disabled}
            options={(['SOURCE', 'CURRENT_TARGET'] as const).map((value) => ({
              value,
              label: SKILL_TRIGGER_SUBJECT_LABELS[value]
            }))}
            onChange={(value) => onChange({
              eventType: 'ENTITY_DIED',
              detail: { subject: value as 'SOURCE' | 'CURRENT_TARGET' }
            })}
          />
        </Form.Item>
      );
    case 'ENTITY_UNTARGETABLE':
      return (
        <Form.Item label="对象" required>
          <Select
            aria-label="对象"
            value={eventSource.detail.subject}
            disabled={disabled}
            options={(['SOURCE', 'CURRENT_TARGET'] as const).map((value) => ({
              value,
              label: SKILL_TRIGGER_SUBJECT_LABELS[value]
            }))}
            onChange={(value) => onChange({
              eventType: 'ENTITY_UNTARGETABLE',
              detail: { subject: value as 'SOURCE' | 'CURRENT_TARGET' }
            })}
          />
        </Form.Item>
      );
    case 'PROCESS_CANCEL_REQUESTED':
      return (
        <Form.Item label="过程" required>
          <Select
            aria-label="取消过程"
            value={eventSource.detail.processKey || undefined}
            disabled={disabled}
            options={props.processes.map((item) => ({
              value: item.processKey,
              label: item.name || item.processKey
            }))}
            onChange={(value) => onChange({
              eventType: 'PROCESS_CANCEL_REQUESTED',
              detail: { processKey: String(value ?? '') }
            })}
          />
        </Form.Item>
      );
    case 'SPELL_SHIELD_BLOCKED': {
      const currentKey = eventSource.detail.shieldEffectKey;
      const options = props.effects
        .filter((item) => {
          const effect = props.effectDetails.get(item.effectKey);
          return item.effectKey === currentKey || (effect ? isSpellShieldEventEffect(effect) : false);
        })
        .map((item) => {
          const effect = props.effectDetails.get(item.effectKey);
          const eligible = effect ? isSpellShieldEventEffect(effect) : false;
          return {
            value: item.effectKey,
            label: eligible
              ? item.name || item.effectKey
              : `${item.name || item.effectKey}（已失去法术护盾资格）`,
            disabled: !eligible
          };
        });
      if (currentKey && !props.effects.some((item) => item.effectKey === currentKey)) {
        options.unshift({
          value: currentKey,
          label: `${currentKey}（${MISSING_CATALOG_LABEL}）`,
          disabled: true
        });
      }
      return (
        <Form.Item
          label="法术护盾效果"
          required
          validateStatus={props.spellShieldCatalogState === 'error' ? 'error' : undefined}
          help={props.spellShieldCatalogState === 'error' ? INCOMPLETE_CATALOG_MESSAGE : undefined}
        >
          <Select
            aria-label="法术护盾效果"
            value={currentKey || undefined}
            loading={props.spellShieldCatalogState === 'loading'}
            disabled={disabled || props.spellShieldCatalogState !== 'ready'}
            options={options}
            onChange={(value) => onChange({
              eventType: 'SPELL_SHIELD_BLOCKED',
              detail: { shieldEffectKey: String(value ?? '') }
            })}
          />
        </Form.Item>
      );
    }
    default:
      return null;
  }
}
