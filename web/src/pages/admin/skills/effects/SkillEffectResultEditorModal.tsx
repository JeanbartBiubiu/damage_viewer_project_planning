import { numericFormulaKey } from '../../../../types/numericValue';
import { usesNumericValueKind } from '../numericValueForm';
import type { SkillParameter } from '../../../../types/skillParameter';
import { NumericValueField } from '../NumericValueField';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space
} from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getErrorMessage } from '../../../../services/apiClient';
import { listAttributes } from '../../../../services/attributeClient';
import { listDamageTypes } from '../../../../services/damageTypeClient';
import { listModifierZones } from '../../../../services/modifierZoneClient';
import { listSkills } from '../../../../services/skillClient';
import { listSkillCategories } from '../../../../services/skillCategoryClient';
import { listStatuses } from '../../../../services/statusClient';
import type { Attribute } from '../../../../types/attribute';
import type { DamageType } from '../../../../types/damageType';
import type { ModifierZone } from '../../../../types/modifierZone';
import type { Skill } from '../../../../types/skill';
import type { SkillCategory } from '../../../../types/skillCategory';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  AttributeChangeOperation,
  CooldownChangeOperation,
  ResourceChangeOperation,
  SkillEffectCriticalFilter,
  SkillEffectCriticalMode,
  SkillEffectDamageFilterDeliveryKind,
  SkillEffectDamageFilterOriginKind,
  SkillEffectDamageDeliveryKind,
  SkillEffectDamageModifierDirection,
  SkillEffectDamageOriginKind,
  SkillEffectHealingKind,
  SkillEffectHealingModifierDirection,
  SkillEffectLifecycleMoment,
  SkillEffectLifecycleOperation,
  SkillEffectModifierOperation,
  SkillEffectPeriodicExecutionMode,
  SkillEffectReapplicationValueMode,
  SkillEffectResultType,
  SkillEffectNormalShieldDecayMode,
  SkillEffectStackValueMode,
  SkillEffectSpellShieldBlockScope,
  SkillEffectSummary,
  SkillEffectTarget,
  SkillEffectValueReadMode,
  SkillEffectVampBasisOutputKind,
  SkillEffectVampType,
  StatusOperation
} from '../../../../types/skillEffect';
import type { GameStatus } from '../../../../types/status';
import {
  ATTRIBUTE_CHANGE_OPERATION_LABELS,
  COOLDOWN_CHANGE_OPERATION_LABELS,
  DISABLED_CATALOG_LABEL,
  DISABLED_PARENT_SKILL_LABEL,
  INCOMPLETE_CATALOG_MESSAGE,
  RESOURCE_CHANGE_OPERATION_LABELS,
  SKILL_EFFECT_CRITICAL_MODE_LABELS,
  SKILL_EFFECT_CRITICAL_FILTER_LABELS,
  SKILL_EFFECT_DAMAGE_DELIVERY_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_FILTER_DELIVERY_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_FILTER_ORIGIN_KIND_LABELS,
  SKILL_EFFECT_DAMAGE_MODIFIER_DIRECTION_LABELS,
  SKILL_EFFECT_DAMAGE_ORIGIN_KIND_LABELS,
  SKILL_EFFECT_HEALING_KIND_LABELS,
  SKILL_EFFECT_HEALING_MODIFIER_DIRECTION_LABELS,
  SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS,
  SKILL_EFFECT_LIFECYCLE_OPERATION_LABELS,
  LIFECYCLE_EXTENSION_HINT,
  SKILL_EFFECT_MODIFIER_OPERATION_LABELS,
  SKILL_EFFECT_LIFECYCLE_OPERATIONS,
  SKILL_EFFECT_NORMAL_SHIELD_DECAY_MODE_LABELS,
  SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS,
  SKILL_EFFECT_REAPPLICATION_VALUE_MODE_LABELS,
  SKILL_EFFECT_RESULT_TYPES,
  SKILL_EFFECT_RESULT_TYPE_LABELS,
  SKILL_EFFECT_STACK_VALUE_MODE_LABELS,
  SKILL_EFFECT_SPELL_SHIELD_BLOCK_SCOPE_LABELS,
  SKILL_EFFECT_TARGET_LABELS,
  SKILL_EFFECT_VALUE_READ_MODE_LABELS,
  SKILL_EFFECT_VAMP_BASIS_OUTPUT_KIND_LABELS,
  SKILL_EFFECT_VAMP_TYPE_LABELS,
  SKILL_EFFECT_VAMP_TYPES,
  SKILL_HASTE_MODIFIER_OPERATION_LABELS,
  STATUS_OPERATION_LABELS,
  UNKNOWN_LIFECYCLE_TARGET_LABEL,
  EXECUTE_RESULT_HINT,
  LINK_APPLICATION_RESULT_HINT,
  applyCooldownOperationChange,
  applyCriticalModeChange,
  applyLifecycleMomentChange,
  applyLifecycleOperationChange,
  applyResultTypeChange,
  applyStackValueModeChange,
  clearHiddenLifecycleBehaviorFields,
  cooldownChangeAmountHint,
  isCatalogOptionSelectable,
  isFixedPersistentSnapshotResult,
  isModifierZoneRequired,
  isPeriodicExecutionModeVisible,
  isPersistentOnlyResultType,
  isReapplicationValueModeVisible,
  isSharedOnlyPersistentResult,
  isSpellShieldBlockScopeVisible,
  isStackValueModeVisible,
  isValueReadModeFixed,
  isValueReadModeVisible,
  isValueRuleVisible,
  listAffectedSkillCategoryOptions,
  listAffectedSkillOptions,
  listAllowedLifecycleMoments,
  listAttributeOptions,
  listDamageTypeOptions,
  listFormulaOptions,
  listLifecycleTargetOptions,
  listModifierZoneOptions,
  listSpellShieldBlockScopeOptions,
  modifierZoneDomainForDraft,
  listStatusOptions,
  sortVampRuleDrafts,
  usesAffectedSkillScope,
  validateSkillEffectDraft,
  valueFormulaLabelFor,
  isMovementSlowApply,
  applyStatusSelection,
  resolveResultStatusKind,
  type CatalogRefOption,
  type EffectCatalogLoadState,
  type EffectFormCatalog,
  type SkillEffectDraft,
  type SkillEffectResultDraft,
  type SkillEffectResultDraftErrors
} from './effectForm';
import { SkillEffectAffectedSkillScopeFields } from './SkillEffectAffectedSkillScopeFields';
import { ModifierZoneEditorModal } from '../../modifier-zones/ModifierZoneEditorModal';
import { SkillCategoryEditorModal } from '../../skill-categories/SkillCategoryEditorModal';

export type SkillEffectResultEditorMode = 'create' | 'view' | 'edit';

type SkillEffectResultEditorModalProps = {
  visible: boolean;
  mode: SkillEffectResultEditorMode;
  resultDraft: SkillEffectResultDraft;
  siblingResults: SkillEffectResultDraft[];
  resultIndex: number | null;
  fieldErrors: SkillEffectResultDraftErrors;
  parameters: readonly SkillParameter[];
  parametersLoadState?: 'ready' | 'failed';
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey' | 'name'>>;
  formulasLoadState?: 'ready' | 'failed';
  onRetryFormulas: () => void;
  parentSkill: Skill;
  parentDraft: SkillEffectDraft;
  effectSummaries: ReadonlyArray<Pick<SkillEffectSummary, 'effectKey' | 'name' | 'lifecycleEnabled'>>;
  effectsLoadState?: 'ready' | 'failed';
  effectsError?: string | null;
  onRetryEffects?: () => void;
  onEnableLifecycle: () => void;
  apiBaseUrl: string;
  selectedGameId: string;
  adminToken: string;
  onClose: () => void;
  onConfirm: (draft: SkillEffectResultDraft) => void;
};

function titleFor(mode: SkillEffectResultEditorMode): string {
  if (mode === 'create') return '新增结果';
  if (mode === 'edit') return '编辑结果';
  return '查看结果';
}

function namesFrom<T>(items: readonly T[], keyOf: (item: T) => string, nameOf: (item: T) => string): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items) {
    names.set(keyOf(item), nameOf(item));
  }
  return names;
}

function catalogLabel(
  option: CatalogRefOption,
  names: Map<string, string>,
  parentSkill?: Skill
): string {
  const name = names.get(option.key) ?? option.key;
  if (option.source === 'unknown') {
    return option.key;
  }
  if (option.source === 'parent-skill-self-ref' && option.status === 'DISABLED') {
    const parentName = parentSkill?.name ?? name;
    return `${parentName}（${DISABLED_PARENT_SKILL_LABEL}）`;
  }
  if (option.source === 'retained-disabled' || option.status === 'DISABLED') {
    return `${name}（${DISABLED_CATALOG_LABEL}）`;
  }
  return name;
}

function toSelectOptions(
  options: CatalogRefOption[],
  names: Map<string, string>,
  parentSkill?: Skill
): Array<{ label: string; value: string; disabled: boolean }> {
  return options.map((option) => ({
    value: option.key,
    label: catalogLabel(option, names, parentSkill),
    disabled: !isCatalogOptionSelectable(option)
  }));
}

function toLifecycleTargetSelectOptions(
  options: CatalogRefOption[],
  names: Map<string, string>
): Array<{ label: string; value: string; disabled: boolean }> {
  return options.map((option) => {
    const name = names.get(option.key) ?? option.key;
    const label = option.source === 'unknown'
      ? `${option.key}（${UNKNOWN_LIFECYCLE_TARGET_LABEL}）`
      : name;
    return {
      value: option.key,
      label,
      disabled: !isCatalogOptionSelectable(option)
    };
  });
}

function hasUnknownOption(options: CatalogRefOption[], currentKey: string): boolean {
  const trimmed = currentKey.trim();
  if (!trimmed) return false;
  return options.some((item) => item.key === trimmed && item.source === 'unknown');
}

function DamageFilterFields({
  draft,
  errors,
  readOnly,
  showCritical,
  onChange
}: {
  draft: SkillEffectResultDraft;
  errors: SkillEffectResultDraftErrors;
  readOnly: boolean;
  showCritical: boolean;
  onChange: (next: SkillEffectResultDraft) => void;
}) {
  return (
    <>
      <Form.Item
        label="产生方式"
        required
        validateStatus={errors.damageFilterDeliveryKind ? 'error' : undefined}
        help={errors.damageFilterDeliveryKind}
      >
        <Radio.Group
          aria-label="伤害过滤产生方式"
          value={draft.damageFilterDeliveryKind}
          disabled={readOnly}
          onChange={(value) => onChange({
            ...draft,
            damageFilterDeliveryKind: value as SkillEffectDamageFilterDeliveryKind
          })}
        >
          {Object.entries(SKILL_EFFECT_DAMAGE_FILTER_DELIVERY_KIND_LABELS).map(([value, label]) => (
            <Radio key={value} value={value}>{label}</Radio>
          ))}
        </Radio.Group>
      </Form.Item>
      <Form.Item
        label="来源性质"
        required
        validateStatus={errors.damageFilterOriginKind ? 'error' : undefined}
        help={errors.damageFilterOriginKind}
      >
        <Radio.Group
          aria-label="伤害过滤来源性质"
          value={draft.damageFilterOriginKind}
          disabled={readOnly}
          onChange={(value) => onChange({
            ...draft,
            damageFilterOriginKind: value as SkillEffectDamageFilterOriginKind
          })}
        >
          {Object.entries(SKILL_EFFECT_DAMAGE_FILTER_ORIGIN_KIND_LABELS).map(([value, label]) => (
            <Radio key={value} value={value}>{label}</Radio>
          ))}
        </Radio.Group>
      </Form.Item>
      {showCritical ? (
        <Form.Item
          label="暴击过滤"
          required
          validateStatus={errors.criticalFilter ? 'error' : undefined}
          help={errors.criticalFilter}
        >
          <Radio.Group
            aria-label="暴击过滤"
            value={draft.criticalFilter}
            disabled={readOnly}
            onChange={(value) => onChange({
              ...draft,
              criticalFilter: value as SkillEffectCriticalFilter
            })}
          >
            {Object.entries(SKILL_EFFECT_CRITICAL_FILTER_LABELS).map(([value, label]) => (
              <Radio key={value} value={value}>{label}</Radio>
            ))}
          </Radio.Group>
        </Form.Item>
      ) : null}
    </>
  );
}

export function SkillEffectResultEditorModal({
  visible,
  mode,
  resultDraft,
  siblingResults,
  resultIndex,
  fieldErrors,
  parameters,
  parametersLoadState,
  formulas,
  formulasLoadState,
  onRetryFormulas,
  parentSkill,
  parentDraft,
  effectSummaries,
  effectsLoadState,
  effectsError,
  onRetryEffects,
  onEnableLifecycle,
  apiBaseUrl,
  selectedGameId,
  adminToken,
  onClose,
  onConfirm
}: SkillEffectResultEditorModalProps) {
  const [draft, setDraft] = useState<SkillEffectResultDraft>(resultDraft);
  const [errors, setErrors] = useState<SkillEffectResultDraftErrors>(fieldErrors);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [modifierZones, setModifierZones] = useState<ModifierZone[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillCategories, setSkillCategories] = useState<SkillCategory[]>([]);
  const [statuses, setStatuses] = useState<GameStatus[]>([]);
  const [catalogLoadState, setCatalogLoadState] = useState<EffectCatalogLoadState>({});
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<keyof EffectCatalogLoadState, string>>>({});
  const [catalogLoading, setCatalogLoading] = useState<Partial<Record<keyof EffectCatalogLoadState, boolean>>>({});
  const [modifierZoneEditorVisible, setModifierZoneEditorVisible] = useState(false);
  const [skillCategoryEditorVisible, setSkillCategoryEditorVisible] = useState(false);
  const damageTypeSerial = useRef(0);
  const modifierZoneSerial = useRef(0);
  const attributeSerial = useRef(0);
  const skillSerial = useRef(0);
  const skillCategorySerial = useRef(0);
  const statusSerial = useRef(0);
  const readOnly = mode === 'view';
  const existingResult = draft.originalResultType !== null;
  const showValueRule = isValueRuleVisible(draft);
  const cooldownHint = cooldownChangeAmountHint(draft);
  const ratioCooldown = draft.resultType === 'COOLDOWN_CHANGE' && draft.cooldownOperation === 'REDUCE_REMAINING_RATIO';
  const slowApply = isMovementSlowApply(draft);
  const valueFormulaLabel = draft.resultType === 'STATUS_OPERATION' ? '减速比例' : valueFormulaLabelFor(draft.resultType);

  const resetCatalogs = useCallback(() => {
    damageTypeSerial.current += 1;
    modifierZoneSerial.current += 1;
    attributeSerial.current += 1;
    skillSerial.current += 1;
    skillCategorySerial.current += 1;
    statusSerial.current += 1;
    setDamageTypes([]);
    setModifierZones([]);
    setAttributes([]);
    setSkills([]);
    setSkillCategories([]);
    setStatuses([]);
    setCatalogLoadState({});
    setCatalogErrors({});
    setCatalogLoading({});
    setModifierZoneEditorVisible(false);
    setSkillCategoryEditorVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      resetCatalogs();
      return;
    }
    setDraft(resultDraft);
    setErrors(fieldErrors);
    setSaveError(null);
  }, [fieldErrors, resetCatalogs, resultDraft, visible]);

  const loadDamageTypes = useCallback(async () => {
    const serial = damageTypeSerial.current + 1;
    damageTypeSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setDamageTypes([]);
      setCatalogLoadState((current) => ({ ...current, damageTypes: token ? current.damageTypes : undefined }));
      setCatalogLoading((current) => ({ ...current, damageTypes: false }));
      return;
    }
    setCatalogLoading((current) => ({ ...current, damageTypes: true }));
    try {
      const result = await listDamageTypes(apiBaseUrl, selectedGameId, token);
      if (damageTypeSerial.current !== serial) return;
      setDamageTypes(result.data.items);
      setCatalogLoadState((current) => ({ ...current, damageTypes: 'ready' }));
      setCatalogErrors((current) => ({ ...current, damageTypes: undefined }));
    } catch (error) {
      if (damageTypeSerial.current !== serial) return;
      setDamageTypes([]);
      setCatalogLoadState((current) => ({ ...current, damageTypes: 'failed' }));
      setCatalogErrors((current) => ({ ...current, damageTypes: getErrorMessage(error) }));
    } finally {
      if (damageTypeSerial.current === serial) {
        setCatalogLoading((current) => ({ ...current, damageTypes: false }));
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadModifierZones = useCallback(async () => {
    const serial = modifierZoneSerial.current + 1;
    modifierZoneSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setModifierZones([]);
      setCatalogLoadState((current) => ({ ...current, modifierZones: token ? current.modifierZones : undefined }));
      setCatalogLoading((current) => ({ ...current, modifierZones: false }));
      return;
    }
    setCatalogLoading((current) => ({ ...current, modifierZones: true }));
    try {
      const result = await listModifierZones(apiBaseUrl, selectedGameId, token);
      if (modifierZoneSerial.current !== serial) return;
      setModifierZones(result.data.items);
      setCatalogLoadState((current) => ({ ...current, modifierZones: 'ready' }));
      setCatalogErrors((current) => ({ ...current, modifierZones: undefined }));
    } catch (error) {
      if (modifierZoneSerial.current !== serial) return;
      setModifierZones([]);
      setCatalogLoadState((current) => ({ ...current, modifierZones: 'failed' }));
      setCatalogErrors((current) => ({ ...current, modifierZones: getErrorMessage(error) }));
    } finally {
      if (modifierZoneSerial.current === serial) {
        setCatalogLoading((current) => ({ ...current, modifierZones: false }));
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadAttributes = useCallback(async () => {
    const serial = attributeSerial.current + 1;
    attributeSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setAttributes([]);
      setCatalogLoadState((current) => ({ ...current, attributes: token ? current.attributes : undefined }));
      setCatalogLoading((current) => ({ ...current, attributes: false }));
      return;
    }
    setCatalogLoading((current) => ({ ...current, attributes: true }));
    try {
      const result = await listAttributes(apiBaseUrl, selectedGameId, token);
      if (attributeSerial.current !== serial) return;
      setAttributes(result.data.items);
      setCatalogLoadState((current) => ({ ...current, attributes: 'ready' }));
      setCatalogErrors((current) => ({ ...current, attributes: undefined }));
    } catch (error) {
      if (attributeSerial.current !== serial) return;
      setAttributes([]);
      setCatalogLoadState((current) => ({ ...current, attributes: 'failed' }));
      setCatalogErrors((current) => ({ ...current, attributes: getErrorMessage(error) }));
    } finally {
      if (attributeSerial.current === serial) {
        setCatalogLoading((current) => ({ ...current, attributes: false }));
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadSkillsCatalog = useCallback(async () => {
    const serial = skillSerial.current + 1;
    skillSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setSkills([]);
      setCatalogLoadState((current) => ({ ...current, skills: token ? current.skills : undefined }));
      setCatalogLoading((current) => ({ ...current, skills: false }));
      return;
    }
    setCatalogLoading((current) => ({ ...current, skills: true }));
    try {
      const result = await listSkills(apiBaseUrl, selectedGameId, token);
      if (skillSerial.current !== serial) return;
      setSkills(result.data.items);
      setCatalogLoadState((current) => ({ ...current, skills: 'ready' }));
      setCatalogErrors((current) => ({ ...current, skills: undefined }));
    } catch (error) {
      if (skillSerial.current !== serial) return;
      setSkills([]);
      setCatalogLoadState((current) => ({ ...current, skills: 'failed' }));
      setCatalogErrors((current) => ({ ...current, skills: getErrorMessage(error) }));
    } finally {
      if (skillSerial.current === serial) {
        setCatalogLoading((current) => ({ ...current, skills: false }));
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadSkillCategoriesCatalog = useCallback(async () => {
    const serial = skillCategorySerial.current + 1;
    skillCategorySerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setSkillCategories([]);
      setCatalogLoadState((current) => ({
        ...current,
        skillCategories: token ? current.skillCategories : undefined
      }));
      setCatalogLoading((current) => ({ ...current, skillCategories: false }));
      return;
    }
    setCatalogLoading((current) => ({ ...current, skillCategories: true }));
    try {
      const result = await listSkillCategories(apiBaseUrl, selectedGameId, token);
      if (skillCategorySerial.current !== serial) return;
      setSkillCategories(result.data.items);
      setCatalogLoadState((current) => ({ ...current, skillCategories: 'ready' }));
      setCatalogErrors((current) => ({ ...current, skillCategories: undefined }));
    } catch (error) {
      if (skillCategorySerial.current !== serial) return;
      setSkillCategories([]);
      setCatalogLoadState((current) => ({ ...current, skillCategories: 'failed' }));
      setCatalogErrors((current) => ({ ...current, skillCategories: getErrorMessage(error) }));
    } finally {
      if (skillCategorySerial.current === serial) {
        setCatalogLoading((current) => ({ ...current, skillCategories: false }));
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  const loadStatusesCatalog = useCallback(async () => {
    const serial = statusSerial.current + 1;
    statusSerial.current = serial;
    const token = adminToken.trim();
    if (!visible || !token) {
      setStatuses([]);
      setCatalogLoadState((current) => ({ ...current, statuses: token ? current.statuses : undefined }));
      setCatalogLoading((current) => ({ ...current, statuses: false }));
      return;
    }
    setCatalogLoading((current) => ({ ...current, statuses: true }));
    try {
      const result = await listStatuses(apiBaseUrl, selectedGameId, token);
      if (statusSerial.current !== serial) return;
      setStatuses(result.data.items);
      setCatalogLoadState((current) => ({ ...current, statuses: 'ready' }));
      setCatalogErrors((current) => ({ ...current, statuses: undefined }));
    } catch (error) {
      if (statusSerial.current !== serial) return;
      setStatuses([]);
      setCatalogLoadState((current) => ({ ...current, statuses: 'failed' }));
      setCatalogErrors((current) => ({ ...current, statuses: getErrorMessage(error) }));
    } finally {
      if (statusSerial.current === serial) {
        setCatalogLoading((current) => ({ ...current, statuses: false }));
      }
    }
  }, [adminToken, apiBaseUrl, selectedGameId, visible]);

  useEffect(() => {
    if (!visible) return;
    if (
      draft.resultType === 'DAMAGE'
      || draft.resultType === 'NORMAL_SHIELD'
      || draft.resultType === 'DAMAGE_MODIFIER'
      || draft.resultType === 'DAMAGE_IMMUNITY'
    ) {
      void loadDamageTypes();
    }
    if (
      draft.resultType === 'ATTRIBUTE_CHANGE'
      || draft.resultType === 'RESOURCE_CHANGE'
      || draft.resultType === 'HEALTH_FLOOR'
      || draft.resultType === 'EXECUTE'
    ) {
      void loadAttributes();
    }
    if (isModifierZoneRequired(draft)) void loadModifierZones();
    if (usesAffectedSkillScope(draft.resultType)) void loadSkillsCatalog();
    if (
      usesAffectedSkillScope(draft.resultType)
      && (
        draft.affectedSkillScope.mode === 'CATEGORIES'
        || draft.affectedSkillScope.skillCategoryKeys.length > 0
        || draft.originalSkillCategoryKeys.length > 0
      )
    ) {
      void loadSkillCategoriesCatalog();
    }
    if (draft.resultType === 'STATUS_OPERATION') void loadStatusesCatalog();
  }, [
    draft.affectedSkillScope.mode,
    draft.affectedSkillScope.skillCategoryKeys.length,
    draft.attributeOperation,
    draft.lifecycleBehavior.moment,
    draft.originalSkillCategoryKeys.length,
    draft.resultType,
    loadAttributes,
    loadDamageTypes,
    loadModifierZones,
    loadSkillCategoriesCatalog,
    loadSkillsCatalog,
    loadStatusesCatalog,
    visible
  ]);

  useEffect(() => {
    if (!visible || catalogLoadState.statuses !== 'ready') return;
    setDraft((current) => resolveResultStatusKind(current, statuses));
  }, [visible, resultDraft, draft.statusKey, draft.resultType, catalogLoadState.statuses, statuses]);

  const catalog = useMemo<EffectFormCatalog>(() => ({
    parentSkillKey: parentSkill.skillKey,
    parentEffectKey: parentDraft.effectKey.trim(),
    formulas,
    effects: effectSummaries,
    damageTypes,
    modifierZones,
    attributes,
    skills,
    skillCategories,
    statuses
  }), [attributes, damageTypes, effectSummaries, formulas, modifierZones, parentDraft.effectKey, parentSkill.skillKey, skillCategories, skills, statuses]);

  const validationCatalogState = useMemo<EffectCatalogLoadState>(() => ({
    ...catalogLoadState,
    formulas: formulasLoadState,
    effects: effectsLoadState
  }), [catalogLoadState, effectsLoadState, formulasLoadState]);

  const formulaOptions = useMemo(
    () => listFormulaOptions(catalog, draft.value),
    [catalog, draft.value]
  );
  const damageTypeOptions = useMemo(
    () => listDamageTypeOptions(catalog, draft.damageTypeKey, draft.originalDamageTypeKey),
    [catalog, draft.damageTypeKey, draft.originalDamageTypeKey]
  );
  const modifierZoneDomain = modifierZoneDomainForDraft(draft);
  const modifierZoneOptions = useMemo(
    () => modifierZoneDomain
      ? listModifierZoneOptions(
          catalog,
          modifierZoneDomain,
          draft.modifierZoneKey,
          draft.originalModifierZoneKey
        )
      : [],
    [catalog, draft.modifierZoneKey, draft.originalModifierZoneKey, modifierZoneDomain]
  );
  const absorbedDamageTypeOptions = useMemo(
    () => listDamageTypeOptions(
      catalog,
      draft.absorbedDamageTypeKey,
      draft.originalAbsorbedDamageTypeKey
    ),
    [catalog, draft.absorbedDamageTypeKey, draft.originalAbsorbedDamageTypeKey]
  );
  const criticalFormulaOptions = useMemo(
    () => listFormulaOptions(catalog, draft.criticalMultiplierValue),
    [catalog, draft.criticalMultiplierValue]
  );
  const attributeOptions = useMemo(
    () => listAttributeOptions(catalog, draft.attributeKey, draft.originalAttributeKey),
    [catalog, draft.attributeKey, draft.originalAttributeKey]
  );
  const skillOptions = useMemo(
    () => listAffectedSkillOptions(
      catalog,
      draft.affectedSkillScope.skillKeys,
      draft.originalAffectedSkillKeys
    ),
    [catalog, draft.affectedSkillScope.skillKeys, draft.originalAffectedSkillKeys]
  );
  const skillCategoryOptions = useMemo(
    () => listAffectedSkillCategoryOptions(
      catalog,
      draft.affectedSkillScope.skillCategoryKeys,
      draft.originalSkillCategoryKeys
    ),
    [catalog, draft.affectedSkillScope.skillCategoryKeys, draft.originalSkillCategoryKeys]
  );
  const statusOptions = useMemo(
    () => listStatusOptions(catalog, draft.statusKey, draft.originalStatusKey),
    [catalog, draft.originalStatusKey, draft.statusKey]
  );
  const lifecycleTargetOptions = useMemo(
    () => listLifecycleTargetOptions(catalog, draft.targetEffectKey, catalog.parentEffectKey),
    [catalog, draft.targetEffectKey]
  );
  const lifecycleTargetNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of effectSummaries) {
      names.set(item.effectKey, item.name);
    }
    return names;
  }, [effectSummaries]);
  const hasDuration = Boolean(parentDraft.lifecycle.durationValue);
  const allowedMoments = useMemo(
    () => {
      const values = listAllowedLifecycleMoments(draft, hasDuration);
      return draft.resultType === 'NORMAL_SHIELD' && draft.shieldDecayMode === 'LINEAR_TO_ZERO'
        ? values.filter((value) => value === 'PERSISTENT')
        : values;
    },
    [draft, hasDuration]
  );
  const damageTypeNames = useMemo(
    () => namesFrom(damageTypes, (item) => item.damageTypeKey, (item) => item.name),
    [damageTypes]
  );
  const modifierZoneNames = useMemo(
    () => namesFrom(modifierZones, (item) => item.modifierZoneKey, (item) => item.name),
    [modifierZones]
  );
  const attributeNames = useMemo(
    () => namesFrom(attributes, (item) => item.attributeKey, (item) => item.name),
    [attributes]
  );
  const skillNames = useMemo(
    () => namesFrom(skills, (item) => item.skillKey, (item) => item.name),
    [skills]
  );
  const skillCategoryNames = useMemo(
    () => namesFrom(skillCategories, (item) => item.skillCategoryKey, (item) => item.name),
    [skillCategories]
  );
  const statusNames = useMemo(
    () => namesFrom(statuses, (item) => item.statusKey, (item) => item.name),
    [statuses]
  );

  const unknownBlocking = useMemo(() => {
    if (showValueRule && hasUnknownOption(formulaOptions, numericFormulaKey(draft.value))) return true;
    if (
      (draft.resultType === 'DAMAGE'
        || draft.resultType === 'DAMAGE_MODIFIER'
        || draft.resultType === 'DAMAGE_IMMUNITY')
      && draft.damageTypeKey
      && hasUnknownOption(damageTypeOptions, draft.damageTypeKey)
    ) return true;
    if (
      draft.resultType === 'DAMAGE'
      && draft.criticalMultiplierValue
      && hasUnknownOption(criticalFormulaOptions, numericFormulaKey(draft.criticalMultiplierValue))
    ) return true;
    if (
      draft.resultType === 'DAMAGE'
      && draft.vampRules.some((rule) => (
        hasUnknownOption(listFormulaOptions(catalog, rule.efficiencyValue), numericFormulaKey(rule.efficiencyValue))
      ))
    ) return true;
    if (
      draft.resultType === 'NORMAL_SHIELD'
      && draft.absorbedDamageTypeKey
      && hasUnknownOption(absorbedDamageTypeOptions, draft.absorbedDamageTypeKey)
    ) return true;
    if (
      (draft.resultType === 'ATTRIBUTE_CHANGE'
        || draft.resultType === 'RESOURCE_CHANGE'
        || draft.resultType === 'HEALTH_FLOOR'
        || draft.resultType === 'EXECUTE')
      && hasUnknownOption(attributeOptions, draft.attributeKey)
    ) {
      return true;
    }
    if (isModifierZoneRequired(draft) && hasUnknownOption(modifierZoneOptions, draft.modifierZoneKey)) {
      return true;
    }
    if (
      usesAffectedSkillScope(draft.resultType)
      && draft.affectedSkillScope.mode === 'SKILLS'
      && draft.affectedSkillScope.skillKeys.some((skillKey) => hasUnknownOption(skillOptions, skillKey))
    ) {
      return true;
    }
    if (
      usesAffectedSkillScope(draft.resultType)
      && draft.affectedSkillScope.mode === 'CATEGORIES'
      && draft.affectedSkillScope.skillCategoryKeys.some((categoryKey) => (
        hasUnknownOption(skillCategoryOptions, categoryKey)
      ))
    ) {
      return true;
    }
    if (draft.resultType === 'STATUS_OPERATION' && hasUnknownOption(statusOptions, draft.statusKey)) {
      return true;
    }
    if (
      draft.resultType === 'LIFECYCLE_OPERATION'
      && hasUnknownOption(lifecycleTargetOptions, draft.targetEffectKey)
    ) {
      return true;
    }
    return false;
  }, [
    attributeOptions,
    absorbedDamageTypeOptions,
    catalog,
    criticalFormulaOptions,
    damageTypeOptions,
    draft.affectedSkillScope.mode,
    draft.affectedSkillScope.skillCategoryKeys,
    draft.affectedSkillScope.skillKeys,
    draft.attributeKey,
    draft.attributeOperation,
    draft.damageTypeKey,
    draft.absorbedDamageTypeKey,
    draft.criticalMultiplierValue,
    draft.value,
    draft.lifecycleBehavior.moment,
    draft.modifierZoneKey,
    draft.resultType,
    draft.vampRules,
    draft.statusKey,
    draft.targetEffectKey,
    formulaOptions,
    lifecycleTargetOptions,
    modifierZoneOptions,
    showValueRule,
    skillCategoryOptions,
    skillOptions,
    statusOptions
  ]);

  const needsFormulas = usesNumericValueKind(draft, 'FORMULA');
  const requiredCatalogLoading = useMemo(() => {
    if (needsFormulas && formulasLoadState !== 'ready' && formulasLoadState !== 'failed') {
      return formulasLoadState === undefined;
    }
    if (
      (draft.resultType === 'DAMAGE'
        || draft.resultType === 'NORMAL_SHIELD'
        || draft.resultType === 'DAMAGE_MODIFIER'
        || draft.resultType === 'DAMAGE_IMMUNITY')
      && (catalogLoading.damageTypes || catalogLoadState.damageTypes === undefined)
    ) return true;
    if (
      (draft.resultType === 'ATTRIBUTE_CHANGE'
        || draft.resultType === 'RESOURCE_CHANGE'
        || draft.resultType === 'HEALTH_FLOOR'
        || draft.resultType === 'EXECUTE')
      && (catalogLoading.attributes || catalogLoadState.attributes === undefined)
    ) {
      return true;
    }
    if (isModifierZoneRequired(draft) && (catalogLoading.modifierZones || catalogLoadState.modifierZones === undefined)) return true;
    if (usesAffectedSkillScope(draft.resultType) && (catalogLoading.skills || catalogLoadState.skills === undefined)) return true;
    if (
      usesAffectedSkillScope(draft.resultType)
      && draft.affectedSkillScope.mode === 'CATEGORIES'
      && (catalogLoading.skillCategories || catalogLoadState.skillCategories === undefined)
    ) return true;
    if (draft.resultType === 'STATUS_OPERATION' && (catalogLoading.statuses || catalogLoadState.statuses === undefined)) return true;
    if (draft.resultType === 'LIFECYCLE_OPERATION' && effectsLoadState !== 'ready' && effectsLoadState !== 'failed') {
      return effectsLoadState === undefined;
    }
    return false;
  }, [
    catalogLoadState,
    catalogLoading.attributes,
    catalogLoading.damageTypes,
    catalogLoading.modifierZones,
    catalogLoading.skillCategories,
    catalogLoading.skills,
    catalogLoading.statuses,
    draft.affectedSkillScope.mode,
    draft.attributeOperation,
    draft.lifecycleBehavior.moment,
    draft.resultType,
    effectsLoadState,
    formulasLoadState,
    needsFormulas
  ]);

  const catalogErrorMessages = useMemo(() => {
    const messages: string[] = [];
    if (needsFormulas && formulasLoadState === 'failed') {
      messages.push(INCOMPLETE_CATALOG_MESSAGE);
    }
    if (
      (draft.resultType === 'DAMAGE'
        || draft.resultType === 'NORMAL_SHIELD'
        || draft.resultType === 'DAMAGE_MODIFIER'
        || draft.resultType === 'DAMAGE_IMMUNITY')
      && catalogErrors.damageTypes
    ) {
      messages.push(catalogErrors.damageTypes);
    }
    if (
      (draft.resultType === 'ATTRIBUTE_CHANGE'
        || draft.resultType === 'RESOURCE_CHANGE'
        || draft.resultType === 'HEALTH_FLOOR'
        || draft.resultType === 'EXECUTE')
      && catalogErrors.attributes
    ) {
      messages.push(catalogErrors.attributes);
    }
    if (isModifierZoneRequired(draft) && catalogErrors.modifierZones) {
      messages.push(catalogErrors.modifierZones);
    }
    if (usesAffectedSkillScope(draft.resultType) && catalogErrors.skills) {
      messages.push(catalogErrors.skills);
    }
    if (
      usesAffectedSkillScope(draft.resultType)
      && draft.affectedSkillScope.mode === 'CATEGORIES'
      && catalogErrors.skillCategories
    ) {
      messages.push(catalogErrors.skillCategories);
    }
    if (draft.resultType === 'STATUS_OPERATION' && catalogErrors.statuses) {
      messages.push(catalogErrors.statuses);
    }
    if (draft.resultType === 'LIFECYCLE_OPERATION' && effectsError) {
      messages.push(effectsError);
    }
    return messages;
  }, [
    catalogErrors.attributes,
    catalogErrors.damageTypes,
    catalogErrors.modifierZones,
    catalogErrors.skillCategories,
    catalogErrors.skills,
    catalogErrors.statuses,
    draft.affectedSkillScope.mode,
    draft.attributeOperation,
    draft.lifecycleBehavior.moment,
    draft.resultType,
    effectsError,
    formulasLoadState,
    needsFormulas
  ]);

  const patchDraft = (next: SkillEffectResultDraft) => {
    setDraft(clearHiddenLifecycleBehaviorFields(next));
    setErrors({});
    setSaveError(null);
  };

  const patchDraftWithSpellShieldCleanup = (next: SkillEffectResultDraft) => {
    const normalized = clearHiddenLifecycleBehaviorFields(next);
    if (draft.spellShieldBlockScope && !normalized.spellShieldBlockScope) {
      Modal.confirm({
        title: '清除法术护盾阻挡粒度',
        content: '当前修改会使这个结果不再适用法术护盾阻挡粒度，已配置的值将被清除。',
        okText: '继续',
        cancelText: '取消',
        onOk: () => patchDraft(normalized)
      });
      return;
    }
    patchDraft(normalized);
  };

  const renderModifierZoneField = () => {
    if (!modifierZoneDomain || !isModifierZoneRequired(draft)) return null;
    return (
      <Form.Item
        label="乘区"
        required
        validateStatus={errors.modifierZoneKey ? 'error' : undefined}
        help={errors.modifierZoneKey}
      >
        <Space style={{ width: '100%' }}>
          <Select
            aria-label="乘区"
            value={draft.modifierZoneKey || undefined}
            disabled={readOnly}
            loading={Boolean(catalogLoading.modifierZones)}
            options={toSelectOptions(modifierZoneOptions, modifierZoneNames)}
            placeholder="请选择乘区"
            style={{ minWidth: 360 }}
            onChange={(value) => patchDraft({ ...draft, modifierZoneKey: String(value ?? '') })}
          />
          {!readOnly ? (
            <Button
              disabled={!selectedGameId || !adminToken.trim()}
              onClick={() => setModifierZoneEditorVisible(true)}
            >新增乘区</Button>
          ) : null}
        </Space>
      </Form.Item>
    );
  };

  const changeResultType = (nextType: SkillEffectResultType) => {
    const nextDraft = applyResultTypeChange(draft, nextType);
    if (isPersistentOnlyResultType(nextType) && !parentDraft.lifecycleEnabled) {
      const cleanupNotice = draft.spellShieldBlockScope && !nextDraft.spellShieldBlockScope
        ? '已配置的法术护盾阻挡粒度也会被清除。'
        : '';
      Modal.confirm({
        title: '启用效果生命周期',
        content: `该结果只能持续生效。启用后还需要在效果弹窗中补齐最大层数、每次施加层数和实例范围。${cleanupNotice}`,
        okText: '启用并继续',
        cancelText: '取消',
        onOk: () => {
          onEnableLifecycle();
          patchDraft(nextDraft);
        }
      });
      return;
    }
    patchDraftWithSpellShieldCleanup(nextDraft);
  };

  const changeShieldDecayMode = (nextMode: SkillEffectNormalShieldDecayMode) => {
    if (
      nextMode === 'LINEAR_TO_ZERO'
      && parentDraft.lifecycleEnabled
      && (
        draft.lifecycleBehavior.moment !== 'PERSISTENT'
        || draft.lifecycleBehavior.stackValueMode !== 'SHARED'
      )
    ) {
      Modal.confirm({
        title: '调整生命周期配置',
        content: `将当前结果的生命周期时点改为“持续生效”，层数值方式改为“整个实例共享数值”。${draft.spellShieldBlockScope ? '已配置的法术护盾阻挡粒度也会被清除。' : ''}是否继续？`,
        okText: '继续',
        cancelText: '取消',
        onOk: () => patchDraft(clearHiddenLifecycleBehaviorFields({
          ...draft,
          shieldDecayMode: nextMode,
          lifecycleBehavior: {
            ...draft.lifecycleBehavior,
            moment: 'PERSISTENT',
            valueReadMode: 'APPLICATION_SNAPSHOT',
            stackValueMode: 'SHARED'
          }
        }))
      });
      return;
    }
    patchDraft({ ...draft, shieldDecayMode: nextMode });
  };

  const close = () => {
    onClose();
  };

  const save = () => {
    const others = resultIndex === null
      ? siblingResults
      : siblingResults.filter((_, index) => index !== resultIndex);
    const validation = validateSkillEffectDraft(
      {
        ...parentDraft,
        results: [...others, draft]
      },
      {
        includeEffectKey: false,
      parameters, parametersLoadState,
        catalog,
        catalogLoadState: validationCatalogState,
        skipLifecycleShapeValidation: true,
        skipEffectMetadataValidation: true
      }
    );
    if (!validation.ok) {
      const current = validation.resultErrors.find((item) => item.index === others.length);
      if (current && Object.keys(current.fieldErrors).length > 0) {
        setErrors(current.fieldErrors);
        if (Object.keys(validation.fieldErrors).length > 0) {
          setSaveError(Object.values(validation.fieldErrors).filter(Boolean).join('；'));
        }
        return;
      }
      if (Object.keys(validation.fieldErrors).length > 0) {
        setSaveError(Object.values(validation.fieldErrors).filter(Boolean).join('；'));
        return;
      }
    }
    if (unknownBlocking) {
      setSaveError(INCOMPLETE_CATALOG_MESSAGE);
      return;
    }
    onConfirm(draft);
  };

  const retryNeededCatalog = () => {
    if (needsFormulas) onRetryFormulas();
    if (
      draft.resultType === 'DAMAGE'
      || draft.resultType === 'NORMAL_SHIELD'
      || draft.resultType === 'DAMAGE_MODIFIER'
      || draft.resultType === 'DAMAGE_IMMUNITY'
    ) {
      void loadDamageTypes();
    }
    if (
      draft.resultType === 'ATTRIBUTE_CHANGE'
      || draft.resultType === 'RESOURCE_CHANGE'
      || draft.resultType === 'HEALTH_FLOOR'
      || draft.resultType === 'EXECUTE'
    ) {
      void loadAttributes();
    }
    if (isModifierZoneRequired(draft)) void loadModifierZones();
    if (usesAffectedSkillScope(draft.resultType)) void loadSkillsCatalog();
    if (
      usesAffectedSkillScope(draft.resultType)
      && (
        draft.affectedSkillScope.mode === 'CATEGORIES'
        || draft.affectedSkillScope.skillCategoryKeys.length > 0
        || draft.originalSkillCategoryKeys.length > 0
      )
    ) {
      void loadSkillCategoriesCatalog();
    }
    if (draft.resultType === 'STATUS_OPERATION') void loadStatusesCatalog();
    if (draft.resultType === 'LIFECYCLE_OPERATION') onRetryEffects?.();
  };

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
          <Button onClick={close}>{readOnly ? '关闭' : '取消'}</Button>
          {!readOnly ? (
            <Button
              type="primary"
              disabled={unknownBlocking || requiredCatalogLoading}
              onClick={save}
            >
              保存
            </Button>
          ) : null}
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {saveError ? <Alert type="error" content={saveError} /> : null}
        {catalogErrorMessages.length > 0 ? (
          <Alert
            type="error"
            content={catalogErrorMessages.join('；')}
            action={
              readOnly ? null : (
                <Button size="mini" onClick={retryNeededCatalog}>重试</Button>
              )
            }
          />
        ) : null}
        {requiredCatalogLoading ? <Alert type="info" content="正在加载引用目录…" /> : null}
        {unknownBlocking && !requiredCatalogLoading ? <Alert type="error" content={INCOMPLETE_CATALOG_MESSAGE} /> : null}
        {(isPersistentOnlyResultType(draft.resultType) || slowApply) && !parentDraft.lifecycleEnabled ? (
          <Alert type="error" content="该结果需要先启用父效果生命周期。" />
        ) : null}
        {slowApply && parentDraft.lifecycleEnabled && !hasDuration ? (
          <Alert type="error" content="普通移动减速需要父效果填写持续时间。请先在父效果中配置，再保存减速结果。" />
        ) : null}
        <Form layout="vertical">
          <Form.Item
            label="结果标识"
            required
            validateStatus={errors.resultKey ? 'error' : undefined}
            help={errors.resultKey}
          >
            <Input
              aria-label="结果标识"
              value={draft.resultKey}
              disabled={readOnly}
              maxLength={64}
              onChange={(value) => patchDraft({ ...draft, resultKey: value })}
            />
          </Form.Item>
          <Form.Item
            label="结果名称"
            required
            validateStatus={errors.name ? 'error' : undefined}
            help={errors.name}
          >
            <Input
              aria-label="结果名称"
              value={draft.name}
              disabled={readOnly}
              maxLength={100}
              onChange={(value) => patchDraft({ ...draft, name: value })}
            />
          </Form.Item>
          <Form.Item
            label="结果种类"
            required
            validateStatus={errors.resultType ? 'error' : undefined}
            help={errors.resultType}
          >
            <Select
              aria-label="结果种类"
              value={draft.resultType}
              disabled={readOnly || existingResult}
              options={SKILL_EFFECT_RESULT_TYPES.map((value) => ({
                value,
                label: SKILL_EFFECT_RESULT_TYPE_LABELS[value]
              }))}
              onChange={(value) => changeResultType(value as SkillEffectResultType)}
            />
          </Form.Item>
          <Form.Item
            label="作用对象"
            required
            validateStatus={errors.target ? 'error' : undefined}
            help={errors.target}
          >
            <Radio.Group
              aria-label="作用对象"
              value={draft.target}
              disabled={readOnly}
              onChange={(value) => patchDraftWithSpellShieldCleanup({
                ...draft,
                target: value as SkillEffectTarget
              })}
            >
              <Radio value="SOURCE">{SKILL_EFFECT_TARGET_LABELS.SOURCE}</Radio>
              <Radio value="TARGET">{SKILL_EFFECT_TARGET_LABELS.TARGET}</Radio>
            </Radio.Group>
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
              disabled={readOnly}
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
              disabled={readOnly}
              maxLength={2000}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 8 }}
              onChange={(value) => patchDraft({ ...draft, description: value })}
            />
          </Form.Item>

          {draft.resultType === 'ATTACK_TIMER_RESET' ? (
            <Alert type="info" content="将作用对象普通攻击间隔的剩余等待归零；不会直接发起攻击，也不改变技能冷却。" />
          ) : null}
          {showValueRule ? (
            <>
              {ratioCooldown && cooldownHint ? <Alert type="info" content={cooldownHint} /> : null}
              {draft.resultType === 'LIFECYCLE_OPERATION' && draft.lifecycleOperation === 'EXTEND_DURATION'
                ? <Alert type="info" content={LIFECYCLE_EXTENSION_HINT} /> : null}
              {slowApply ? <Alert type="info" content="0.3 表示 30% 减速；百分数点参数使用固定倍率 0.01。上下界固定为 0 和 1。" /> : null}
              {draft.resultType === 'EXECUTE' ? (
                <Alert type="info" content={EXECUTE_RESULT_HINT} />
              ) : null}
              {draft.resultType === 'HIT_LINK_APPLICATION'
                || draft.resultType === 'ATTACK_LINK_APPLICATION' ? (
                <Alert type="info" content={LINK_APPLICATION_RESULT_HINT} />
              ) : null}
              <Form.Item
                label={valueFormulaLabel}
                required
                validateStatus={errors.value ? 'error' : undefined}
                help={errors.value}
              >
                <NumericValueField aria-label={valueFormulaLabel}
                  value={draft.value}
                  onChange={(value) => patchDraft({ ...draft, value: value! })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
              </Form.Item>
              <Form.Item
                label={cooldownHint && !ratioCooldown ? `固定倍率（${cooldownHint}）` : '固定倍率'}
                required
                validateStatus={errors.fixedMultiplier ? 'error' : undefined}
                help={errors.fixedMultiplier}
              >
                <InputNumber
                  aria-label="固定倍率"
                  value={draft.fixedMultiplier.trim() ? Number(draft.fixedMultiplier) : undefined}
                  disabled={readOnly}
                  min={0}
                  style={{ width: '100%' }}
                  onChange={(value) => patchDraft({
                    ...draft,
                    fixedMultiplier: value === undefined ? '' : String(value)
                  })}
                />
              </Form.Item>
              <Form.Item
                label="固定最小值"
                validateStatus={errors.fixedMinValue ? 'error' : undefined}
                help={errors.fixedMinValue}
              >
                <InputNumber
                  aria-label="固定最小值"
                  value={draft.fixedMinValue.trim() ? Number(draft.fixedMinValue) : undefined}
                  disabled={readOnly || slowApply}
                  style={{ width: '100%' }}
                  onChange={(value) => patchDraft({
                    ...draft,
                    fixedMinValue: value === undefined ? '' : String(value)
                  })}
                />
              </Form.Item>
              <Form.Item
                label="固定最大值"
                validateStatus={errors.fixedMaxValue ? 'error' : undefined}
                help={errors.fixedMaxValue}
              >
                <InputNumber
                  aria-label="固定最大值"
                  value={draft.fixedMaxValue.trim() ? Number(draft.fixedMaxValue) : undefined}
                  disabled={readOnly || slowApply}
                  style={{ width: '100%' }}
                  onChange={(value) => patchDraft({
                    ...draft,
                    fixedMaxValue: value === undefined ? '' : String(value)
                  })}
                />
              </Form.Item>
            </>
          ) : null}
          {errors.valueRule ? <Alert type="error" content={errors.valueRule} /> : null}

          {draft.resultType === 'DAMAGE' ? (
            <>
              <Form.Item
                label="伤害类型"
                required
                validateStatus={errors.damageTypeKey ? 'error' : undefined}
                help={errors.damageTypeKey}
              >
                <Select
                  aria-label="伤害类型"
                  value={draft.damageTypeKey || undefined}
                  disabled={readOnly}
                  options={toSelectOptions(damageTypeOptions, damageTypeNames)}
                  placeholder="请选择伤害类型"
                  onChange={(value) => patchDraft({ ...draft, damageTypeKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="伤害产生方式"
                required
                validateStatus={errors.damageDeliveryKind ? 'error' : undefined}
                help={errors.damageDeliveryKind}
              >
                <Radio.Group
                  aria-label="伤害产生方式"
                  value={draft.damageDeliveryKind}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    damageDeliveryKind: value as SkillEffectDamageDeliveryKind
                  })}
                >
                  {(Object.keys(
                    SKILL_EFFECT_DAMAGE_DELIVERY_KIND_LABELS
                  ) as SkillEffectDamageDeliveryKind[]).map((value) => (
                    <Radio key={value} value={value}>
                      {SKILL_EFFECT_DAMAGE_DELIVERY_KIND_LABELS[value]}
                    </Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label="伤害来源性质"
                required
                validateStatus={errors.damageOriginKind ? 'error' : undefined}
                help={errors.damageOriginKind}
              >
                <Radio.Group
                  aria-label="伤害来源性质"
                  value={draft.damageOriginKind}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    damageOriginKind: value as SkillEffectDamageOriginKind
                  })}
                >
                  {(Object.keys(
                    SKILL_EFFECT_DAMAGE_ORIGIN_KIND_LABELS
                  ) as SkillEffectDamageOriginKind[]).map((value) => (
                    <Radio key={value} value={value}>
                      {SKILL_EFFECT_DAMAGE_ORIGIN_KIND_LABELS[value]}
                    </Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              {draft.damageOriginKind === 'REFLECTED' ? (
                <Alert
                  type="info"
                  content="这里只标记伤害性质；受到伤害后的触发关系仍在条件与触发中维护。"
                />
              ) : null}
              <Form.Item
                label="暴击方式"
                required
                validateStatus={errors.criticalMode ? 'error' : undefined}
                help={errors.criticalMode}
              >
                <Radio.Group
                  aria-label="暴击方式"
                  value={draft.criticalMode}
                  disabled={readOnly}
                  onChange={(value) => patchDraft(
                    applyCriticalModeChange(draft, value as SkillEffectCriticalMode)
                  )}
                >
                  {(Object.keys(
                    SKILL_EFFECT_CRITICAL_MODE_LABELS
                  ) as SkillEffectCriticalMode[]).map((value) => (
                    <Radio key={value} value={value}>
                      {SKILL_EFFECT_CRITICAL_MODE_LABELS[value]}
                    </Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              {draft.criticalMode !== 'DISALLOWED' ? (
                <Form.Item
                  label="暴击倍率取值"
                  validateStatus={errors.criticalMultiplierValue ? 'error' : undefined}
                  help={errors.criticalMultiplierValue}
                >
                  <NumericValueField aria-label="暴击倍率取值"
                  value={draft.criticalMultiplierValue}
                  onChange={(value) => patchDraft({
                      ...draft,
                      criticalMultiplierValue: value!
                    })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly}
                  allowClear />
                </Form.Item>
              ) : null}
              <Form.Item
                label="吸血规则"
                validateStatus={errors.vampRules ? 'error' : undefined}
                help={errors.vampRules}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {draft.vampRules.map((rule, index) => {
                    const usedByOthers = new Set(
                      draft.vampRules
                        .filter((_, itemIndex) => itemIndex !== index)
                        .map((item) => item.vampType)
                    );
                    return (
                      <Space key={`${rule.vampType || 'new'}-${index}`} style={{ width: '100%' }}>
                        <Select
                          aria-label={`吸血种类 ${index + 1}`}
                          value={rule.vampType || undefined}
                          disabled={readOnly}
                          style={{ width: 220 }}
                          options={SKILL_EFFECT_VAMP_TYPES
                            .filter((value) => !usedByOthers.has(value))
                            .map((value) => ({
                              value,
                              label: SKILL_EFFECT_VAMP_TYPE_LABELS[value]
                            }))}
                          placeholder="吸血种类"
                          onChange={(value) => patchDraft({
                            ...draft,
                            vampRules: sortVampRuleDrafts(draft.vampRules.map((item, itemIndex) => (
                              itemIndex === index
                                ? { ...item, vampType: value as SkillEffectVampType }
                                : item
                            )))
                          })}
                        />
                        <Select
                          aria-label={`吸血计算基准 ${index + 1}`}
                          value={rule.basisOutputKind || undefined}
                          disabled={readOnly}
                          style={{ width: 220 }}
                          options={(Object.keys(
                            SKILL_EFFECT_VAMP_BASIS_OUTPUT_KIND_LABELS
                          ) as SkillEffectVampBasisOutputKind[]).map((value) => ({
                            value,
                            label: SKILL_EFFECT_VAMP_BASIS_OUTPUT_KIND_LABELS[value]
                          }))}
                          placeholder="计算基准"
                          onChange={(value) => patchDraft({
                            ...draft,
                            vampRules: draft.vampRules.map((item, itemIndex) => (
                              itemIndex === index
                                ? { ...item, basisOutputKind: value as SkillEffectVampBasisOutputKind }
                                : item
                            ))
                          })}
                        />
                        <NumericValueField aria-label={`吸血效率取值 ${index + 1}`}
                  value={rule.efficiencyValue}
                  onChange={(value) => patchDraft({
                            ...draft,
                            vampRules: draft.vampRules.map((item, itemIndex) => (
                              itemIndex === index
                                ? { ...item, efficiencyValue: value! }
                                : item
                            ))
                          })}
                  parameters={parameters}
                  formulas={formulas}
                  disabled={readOnly} />
                        <Button
                          status="danger"
                          disabled={readOnly}
                          onClick={() => patchDraft({
                            ...draft,
                            vampRules: draft.vampRules.filter((_, itemIndex) => itemIndex !== index)
                          })}
                        >
                          删除
                        </Button>
                      </Space>
                    );
                  })}
                  {!readOnly ? (
                    <Button
                      disabled={draft.vampRules.length >= SKILL_EFFECT_VAMP_TYPES.length}
                      onClick={() => {
                        const used = new Set(draft.vampRules.map((item) => item.vampType));
                        const vampType = SKILL_EFFECT_VAMP_TYPES.find((value) => !used.has(value));
                        if (!vampType) return;
                        patchDraft({
                          ...draft,
                          vampRules: sortVampRuleDrafts([
                            ...draft.vampRules,
                            {
                              vampType,
                              basisOutputKind: 'POST_DEFENSE_DAMAGE',
                              efficiencyValue: null
                            }
                          ])
                        });
                      }}
                    >
                      新增吸血规则
                    </Button>
                  ) : null}
                </Space>
              </Form.Item>
            </>
          ) : null}

          {draft.resultType === 'NORMAL_SHIELD' ? (
            <>
              <Form.Item
                label="吸收伤害类型"
                validateStatus={errors.absorbedDamageTypeKey ? 'error' : undefined}
                help={errors.absorbedDamageTypeKey}
              >
                <Select
                  aria-label="吸收伤害类型"
                  value={draft.absorbedDamageTypeKey}
                  disabled={readOnly}
                  options={[
                    { value: '', label: '全部伤害' },
                    ...toSelectOptions(absorbedDamageTypeOptions, damageTypeNames)
                  ]}
                  onChange={(value) => patchDraft({
                    ...draft,
                    absorbedDamageTypeKey: String(value ?? '')
                  })}
                />
              </Form.Item>
              <Form.Item
                label="护盾衰减"
                required
                validateStatus={errors.shieldDecayMode ? 'error' : undefined}
                help={errors.shieldDecayMode}
              >
                <Radio.Group
                  aria-label="护盾衰减"
                  value={draft.shieldDecayMode}
                  disabled={readOnly}
                  onChange={(value) => changeShieldDecayMode(
                    value as SkillEffectNormalShieldDecayMode
                  )}
                >
                  {(Object.keys(
                    SKILL_EFFECT_NORMAL_SHIELD_DECAY_MODE_LABELS
                  ) as SkillEffectNormalShieldDecayMode[]).map((value) => (
                    <Radio key={value} value={value}>
                      {SKILL_EFFECT_NORMAL_SHIELD_DECAY_MODE_LABELS[value]}
                    </Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}

          {draft.resultType === 'DAMAGE_MODIFIER' ? (
            <>
              {renderModifierZoneField()}
              <Form.Item
                label="作用方向"
                required
                validateStatus={errors.modifierDirection ? 'error' : undefined}
                help={errors.modifierDirection}
              >
                <Radio.Group
                  aria-label="伤害修正作用方向"
                  value={draft.modifierDirection}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    modifierDirection: value as SkillEffectDamageModifierDirection
                  })}
                >
                  {Object.entries(SKILL_EFFECT_DAMAGE_MODIFIER_DIRECTION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label="修正方式"
                required
                validateStatus={errors.modifierOperation ? 'error' : undefined}
                help={errors.modifierOperation}
              >
                <Radio.Group
                  aria-label="伤害修正方式"
                  value={draft.modifierOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    modifierOperation: value as SkillEffectModifierOperation
                  })}
                >
                  {Object.entries(SKILL_EFFECT_MODIFIER_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label="伤害类型"
                validateStatus={errors.damageTypeKey ? 'error' : undefined}
                help={errors.damageTypeKey}
              >
                <Select
                  aria-label="伤害修正伤害类型"
                  value={draft.damageTypeKey}
                  disabled={readOnly}
                  options={[
                    { value: '', label: '全部伤害' },
                    ...toSelectOptions(damageTypeOptions, damageTypeNames)
                  ]}
                  onChange={(value) => patchDraft({ ...draft, damageTypeKey: String(value ?? '') })}
                />
              </Form.Item>
              <DamageFilterFields
                draft={draft}
                errors={errors}
                readOnly={readOnly}
                showCritical
                onChange={patchDraft}
              />
            </>
          ) : null}

          {draft.resultType === 'SHIELD_RECEIVED_MODIFIER' ? (
            <>
              <Alert type="info" content="修正作用对象本次收到的普通护盾量；不创建护盾，不改变既有剩余量或法术护盾次数。" />
              {renderModifierZoneField()}
              <Form.Item label="修正方式" required
                validateStatus={errors.modifierOperation ? 'error' : undefined}
                help={errors.modifierOperation}>
                <Radio.Group aria-label="收到护盾修正方式" value={draft.modifierOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({ ...draft, modifierOperation: value as SkillEffectModifierOperation })}>
                  {Object.entries(SKILL_EFFECT_MODIFIER_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}

          {draft.resultType === 'HEALING_MODIFIER' ? (
            <>
              {renderModifierZoneField()}
              <Form.Item
                label="作用方向"
                required
                validateStatus={errors.healingModifierDirection ? 'error' : undefined}
                help={errors.healingModifierDirection}
              >
                <Radio.Group
                  aria-label="治疗修正作用方向"
                  value={draft.healingModifierDirection}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    healingModifierDirection: value as SkillEffectHealingModifierDirection
                  })}
                >
                  {Object.entries(SKILL_EFFECT_HEALING_MODIFIER_DIRECTION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label="修正方式"
                required
                validateStatus={errors.modifierOperation ? 'error' : undefined}
                help={errors.modifierOperation}
              >
                <Radio.Group
                  aria-label="治疗修正方式"
                  value={draft.modifierOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    modifierOperation: value as SkillEffectModifierOperation
                  })}
                >
                  {Object.entries(SKILL_EFFECT_MODIFIER_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              <Form.Item
                label="治疗种类"
                required
                validateStatus={errors.healingKind ? 'error' : undefined}
                help={errors.healingKind}
              >
                <Radio.Group
                  aria-label="治疗种类"
                  value={draft.healingKind}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    healingKind: value as SkillEffectHealingKind
                  })}
                >
                  {Object.entries(SKILL_EFFECT_HEALING_KIND_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}

          {draft.resultType === 'DAMAGE_IMMUNITY' ? (
            <>
              <Alert
                type="info"
                content="伤害免疫只处理匹配伤害，不等于法术护盾，也不会自动阻止其他结果。"
              />
              <Form.Item
                label="伤害类型"
                validateStatus={errors.damageTypeKey ? 'error' : undefined}
                help={errors.damageTypeKey}
              >
                <Select
                  aria-label="伤害免疫伤害类型"
                  value={draft.damageTypeKey}
                  disabled={readOnly}
                  options={[
                    { value: '', label: '全部伤害' },
                    ...toSelectOptions(damageTypeOptions, damageTypeNames)
                  ]}
                  onChange={(value) => patchDraft({ ...draft, damageTypeKey: String(value ?? '') })}
                />
              </Form.Item>
              <DamageFilterFields
                draft={draft}
                errors={errors}
                readOnly={readOnly}
                showCritical={false}
                onChange={patchDraft}
              />
            </>
          ) : null}

          {draft.resultType === 'HEALTH_FLOOR' || draft.resultType === 'EXECUTE' ? (
            <Form.Item
              label="生命属性"
              required
              validateStatus={errors.attributeKey ? 'error' : undefined}
              help={errors.attributeKey}
            >
              <Select
                aria-label="生命属性"
                value={draft.attributeKey || undefined}
                disabled={readOnly}
                options={toSelectOptions(attributeOptions, attributeNames)}
                placeholder="请选择生命属性"
                onChange={(value) => patchDraft({ ...draft, attributeKey: String(value ?? '') })}
              />
            </Form.Item>
          ) : null}

          {draft.resultType === 'ATTRIBUTE_CHANGE' ? (
            <>
              <Form.Item
                label="属性"
                required
                validateStatus={errors.attributeKey ? 'error' : undefined}
                help={errors.attributeKey}
              >
                <Select
                  aria-label="属性"
                  value={draft.attributeKey || undefined}
                  disabled={readOnly}
                  options={toSelectOptions(attributeOptions, attributeNames)}
                  placeholder="请选择属性"
                  onChange={(value) => patchDraft({ ...draft, attributeKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="操作"
                required
                validateStatus={errors.attributeOperation ? 'error' : undefined}
                help={errors.attributeOperation}
              >
                <Radio.Group
                  aria-label="属性变化操作"
                  value={draft.attributeOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    attributeOperation: value as AttributeChangeOperation
                  })}
                >
                  {Object.entries(ATTRIBUTE_CHANGE_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              {renderModifierZoneField()}
            </>
          ) : null}

          {draft.resultType === 'RESOURCE_CHANGE' ? (
            <>
              <Form.Item
                label="资源属性"
                required
                validateStatus={errors.attributeKey ? 'error' : undefined}
                help={errors.attributeKey}
              >
                <Select
                  aria-label="资源属性"
                  value={draft.attributeKey || undefined}
                  disabled={readOnly}
                  options={toSelectOptions(attributeOptions, attributeNames)}
                  placeholder="请选择资源属性"
                  onChange={(value) => patchDraft({ ...draft, attributeKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="操作"
                required
                validateStatus={errors.resourceOperation ? 'error' : undefined}
                help={errors.resourceOperation}
              >
                <Radio.Group
                  aria-label="资源变化操作"
                  value={draft.resourceOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    resourceOperation: value as ResourceChangeOperation
                  })}
                >
                  {Object.entries(RESOURCE_CHANGE_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}

          {draft.resultType === 'COOLDOWN_CHANGE' ? (
            <>
              <SkillEffectAffectedSkillScopeFields
                draft={draft}
                errors={errors}
                readOnly={readOnly}
                skillOptions={toSelectOptions(skillOptions, skillNames, parentSkill)}
                categoryOptions={toSelectOptions(skillCategoryOptions, skillCategoryNames)}
                skillsLoading={catalogLoading.skills}
                categoriesLoading={catalogLoading.skillCategories}
                onChange={patchDraft}
                onCreateCategory={() => setSkillCategoryEditorVisible(true)}
              />
              <Form.Item
                label="操作"
                required
                validateStatus={errors.cooldownOperation ? 'error' : undefined}
                help={errors.cooldownOperation}
              >
                <Radio.Group
                  aria-label="冷却变化操作"
                  value={draft.cooldownOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft(
                    applyCooldownOperationChange(draft, value as CooldownChangeOperation)
                  )}
                >
                  {Object.entries(COOLDOWN_CHANGE_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}

          {draft.resultType === 'SKILL_HASTE_MODIFIER' ? (
            <>
              <Form.Item
                label="操作"
                required
                validateStatus={errors.skillHasteOperation ? 'error' : undefined}
                help={errors.skillHasteOperation}
              >
                <Radio.Group
                  aria-label="技能急速操作"
                  value={draft.skillHasteOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraft({
                    ...draft,
                    skillHasteOperation: value as SkillEffectModifierOperation
                  })}
                >
                  {Object.entries(SKILL_HASTE_MODIFIER_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
              <SkillEffectAffectedSkillScopeFields
                draft={draft}
                errors={errors}
                readOnly={readOnly}
                skillOptions={toSelectOptions(skillOptions, skillNames, parentSkill)}
                categoryOptions={toSelectOptions(skillCategoryOptions, skillCategoryNames)}
                skillsLoading={catalogLoading.skills}
                categoriesLoading={catalogLoading.skillCategories}
                onChange={patchDraft}
                onCreateCategory={() => setSkillCategoryEditorVisible(true)}
              />
            </>
          ) : null}

          {draft.resultType === 'STATUS_OPERATION' ? (
            <>
              <Form.Item
                label="状态"
                required
                validateStatus={errors.statusKey ? 'error' : undefined}
                help={errors.statusKey}
              >
                <Select
                  aria-label="状态"
                  value={draft.statusKey || undefined}
                  disabled={readOnly}
                  options={toSelectOptions(statusOptions, statusNames)}
                  placeholder="请选择状态"
                  onChange={(value) => {
                    const key = String(value ?? '');
                    patchDraftWithSpellShieldCleanup(applyStatusSelection(
                      draft, key, statuses.find((item) => item.statusKey === key)?.statusKind ?? null
                    ));
                  }}
                />
              </Form.Item>
              <Form.Item
                label="操作"
                required
                validateStatus={errors.statusOperation ? 'error' : undefined}
                help={errors.statusOperation}
              >
                <Radio.Group
                  aria-label="状态操作"
                  value={draft.statusOperation}
                  disabled={readOnly}
                  onChange={(value) => patchDraftWithSpellShieldCleanup(applyStatusSelection(
                    draft, draft.statusKey, draft.statusKind, value as StatusOperation
                  ))}
                >
                  {Object.entries(STATUS_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}
          {errors.detail ? <Alert type="error" content={errors.detail} /> : null}

          {isSpellShieldBlockScopeVisible(draft) ? (
            <Form.Item
              label="法术护盾阻挡粒度"
              validateStatus={errors.spellShieldBlockScope ? 'error' : undefined}
              help={errors.spellShieldBlockScope}
            >
              <Select
                aria-label="法术护盾阻挡粒度"
                value={draft.spellShieldBlockScope}
                disabled={readOnly}
                options={[
                  { value: '', label: '不参与法术护盾阻挡' },
                  ...listSpellShieldBlockScopeOptions(draft).map((value) => ({
                    value,
                    label: SKILL_EFFECT_SPELL_SHIELD_BLOCK_SCOPE_LABELS[value]
                  }))
                ]}
                onChange={(value) => patchDraft({
                  ...draft,
                  spellShieldBlockScope: String(value ?? '') as SkillEffectSpellShieldBlockScope | ''
                })}
              />
            </Form.Item>
          ) : null}

          {parentDraft.lifecycleEnabled ? (
            <>
              <Form.Item
                label="生命周期时点"
                required
                validateStatus={errors.moment ? 'error' : undefined}
                help={errors.moment}
              >
                <Select
                  aria-label="生命周期时点"
                  value={draft.lifecycleBehavior.moment || undefined}
                  disabled={readOnly || slowApply || isPersistentOnlyResultType(draft.resultType)}
                  options={allowedMoments.map((value) => ({
                    value,
                    label: SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS[value]
                  }))}
                  placeholder="请选择生命周期时点"
                  onChange={(value) => patchDraftWithSpellShieldCleanup(
                    applyLifecycleMomentChange(draft, value as SkillEffectLifecycleMoment)
                  )}
                />
              </Form.Item>
              {isValueReadModeVisible(draft) ? (
                <Form.Item
                  label="数值读取"
                  required
                  validateStatus={errors.valueReadMode ? 'error' : undefined}
                  help={errors.valueReadMode}
                >
                  <Radio.Group
                    aria-label="数值读取"
                    value={draft.lifecycleBehavior.valueReadMode}
                    disabled={readOnly || isValueReadModeFixed(draft)}
                    onChange={(value) => patchDraft({
                      ...draft,
                      lifecycleBehavior: {
                        ...draft.lifecycleBehavior,
                        valueReadMode: value as SkillEffectValueReadMode
                      }
                    })}
                  >
                    {Object.entries(SKILL_EFFECT_VALUE_READ_MODE_LABELS)
                      .filter(([value]) => !(
                        isFixedPersistentSnapshotResult(draft) && value === 'MOMENT_EVALUATION'
                      ))
                      .map(([value, label]) => (
                        <Radio key={value} value={value}>{label}</Radio>
                      ))}
                  </Radio.Group>
                </Form.Item>
              ) : null}
              {isStackValueModeVisible(draft) ? (
                <Form.Item
                  label="层数值方式"
                  required
                  validateStatus={errors.stackValueMode ? 'error' : undefined}
                  help={errors.stackValueMode}
                >
                  <Radio.Group
                    aria-label="层数值方式"
                    value={draft.lifecycleBehavior.stackValueMode}
                    disabled={readOnly || slowApply || isSharedOnlyPersistentResult(draft) || isFixedPersistentSnapshotResult(draft)}
                    onChange={(value) => patchDraft(
                      applyStackValueModeChange(draft, value as SkillEffectStackValueMode)
                    )}
                  >
                    {Object.entries(SKILL_EFFECT_STACK_VALUE_MODE_LABELS)
                      .filter(([value]) => !(
                        value === 'PER_STACK'
                        && (
                          isSharedOnlyPersistentResult(draft)
                          || isFixedPersistentSnapshotResult(draft)
                          || (
                            draft.resultType === 'NORMAL_SHIELD'
                            && draft.shieldDecayMode === 'LINEAR_TO_ZERO'
                          )
                        )
                      ))
                      .map(([value, label]) => (
                        <Radio key={value} value={value}>{label}</Radio>
                      ))}
                  </Radio.Group>
                </Form.Item>
              ) : null}
              {isReapplicationValueModeVisible(draft) ? (
                <Form.Item
                  label="重复值方式"
                  required
                  validateStatus={errors.reapplicationValueMode ? 'error' : undefined}
                  help={errors.reapplicationValueMode}
                >
                  <Radio.Group
                    aria-label="重复值方式"
                    value={draft.lifecycleBehavior.reapplicationValueMode}
                    disabled={readOnly || slowApply || isFixedPersistentSnapshotResult(draft)}
                    onChange={(value) => patchDraft({
                      ...draft,
                      lifecycleBehavior: {
                        ...draft.lifecycleBehavior,
                        reapplicationValueMode: value as SkillEffectReapplicationValueMode
                      }
                    })}
                  >
                    {Object.entries(SKILL_EFFECT_REAPPLICATION_VALUE_MODE_LABELS)
                      .filter(([value]) => !(
                        (isSharedOnlyPersistentResult(draft) && value === 'ADD')
                        || (isFixedPersistentSnapshotResult(draft) && value !== 'KEEP')
                        || (slowApply && value !== 'REPLACE')
                      ))
                      .map(([value, label]) => (
                        <Radio key={value} value={value}>{label}</Radio>
                      ))}
                  </Radio.Group>
                </Form.Item>
              ) : null}
              {isPeriodicExecutionModeVisible(draft) ? (
                <Form.Item
                  label="周期执行次数"
                  required
                  validateStatus={errors.periodicExecutionMode ? 'error' : undefined}
                  help={errors.periodicExecutionMode}
                >
                  <Radio.Group
                    aria-label="周期执行次数"
                    value={draft.lifecycleBehavior.periodicExecutionMode}
                    disabled={readOnly}
                    onChange={(value) => patchDraft({
                      ...draft,
                      lifecycleBehavior: {
                        ...draft.lifecycleBehavior,
                        periodicExecutionMode: value as SkillEffectPeriodicExecutionMode
                      }
                    })}
                  >
                    {Object.entries(SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS).map(([value, label]) => (
                      <Radio key={value} value={value}>{label}</Radio>
                    ))}
                  </Radio.Group>
                </Form.Item>
              ) : null}
              {errors.lifecycleBehavior ? <Alert type="error" content={errors.lifecycleBehavior} /> : null}
            </>
          ) : null}

          {draft.resultType === 'LIFECYCLE_OPERATION' ? (
            <>
              <Form.Item
                label="目标效果"
                required
                validateStatus={errors.targetEffectKey ? 'error' : undefined}
                help={errors.targetEffectKey}
              >
                <Select
                  aria-label="目标效果"
                  value={draft.targetEffectKey || undefined}
                  disabled={readOnly}
                  options={toLifecycleTargetSelectOptions(lifecycleTargetOptions, lifecycleTargetNames)}
                  placeholder="请选择目标效果"
                  onChange={(value) => patchDraft({ ...draft, targetEffectKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label="操作"
                required
                validateStatus={errors.lifecycleOperation ? 'error' : undefined}
                help={errors.lifecycleOperation}
              >
                <Select
                  aria-label="生命周期操作"
                  value={draft.lifecycleOperation || undefined}
                  disabled={readOnly}
                  options={SKILL_EFFECT_LIFECYCLE_OPERATIONS.map((value) => ({
                    value,
                    label: SKILL_EFFECT_LIFECYCLE_OPERATION_LABELS[value]
                  }))}
                  placeholder="请选择操作"
                  onChange={(value) => patchDraft(
                    applyLifecycleOperationChange(draft, value as SkillEffectLifecycleOperation)
                  )}
                />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Space>
    </Modal>
    <ModifierZoneEditorModal
      visible={modifierZoneEditorVisible}
      mode="create"
      modifierZone={null}
      initialDomain={modifierZoneDomain ?? undefined}
      apiBaseUrl={apiBaseUrl}
      selectedGameId={selectedGameId}
      adminToken={adminToken}
      onClose={() => setModifierZoneEditorVisible(false)}
      onSaved={(saved) => {
        setModifierZones((current) => [
          ...current.filter((item) => item.modifierZoneKey !== saved.modifierZoneKey),
          saved
        ]);
        setCatalogLoadState((current) => ({ ...current, modifierZones: 'ready' }));
        setModifierZoneEditorVisible(false);
        patchDraft({ ...draft, modifierZoneKey: saved.modifierZoneKey });
      }}
      onDirtyChange={() => {}}
    />
    <SkillCategoryEditorModal
      visible={skillCategoryEditorVisible}
      mode="create"
      category={null}
      apiBaseUrl={apiBaseUrl}
      selectedGameId={selectedGameId}
      adminToken={adminToken}
      onClose={() => setSkillCategoryEditorVisible(false)}
      onSaved={async (saved) => {
        setSkillCategoryEditorVisible(false);
        await loadSkillCategoriesCatalog();
        const selected = draft.affectedSkillScope.skillCategoryKeys;
        patchDraft({
          ...draft,
          affectedSkillScope: {
            ...draft.affectedSkillScope,
            mode: 'CATEGORIES',
            skillKeys: [],
            skillCategoryKeys: selected.includes(saved.skillCategoryKey)
              ? selected
              : [...selected, saved.skillCategoryKey]
          }
        });
      }}
      onDirtyChange={() => {}}
    />
    </>
  );
}
