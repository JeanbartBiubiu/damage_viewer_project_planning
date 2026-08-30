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
import { listSkills } from '../../../../services/skillClient';
import { listStatuses } from '../../../../services/statusClient';
import type { Attribute } from '../../../../types/attribute';
import type { DamageType } from '../../../../types/damageType';
import type { Skill } from '../../../../types/skill';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  AttributeChangeOperation,
  CooldownChangeOperation,
  ResourceChangeOperation,
  SkillEffectLifecycleMoment,
  SkillEffectLifecycleOperation,
  SkillEffectPeriodicExecutionMode,
  SkillEffectReapplicationValueMode,
  SkillEffectResultType,
  SkillEffectStackValueMode,
  SkillEffectSummary,
  SkillEffectTarget,
  SkillEffectValueReadMode,
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
  SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS,
  SKILL_EFFECT_LIFECYCLE_OPERATION_LABELS,
  SKILL_EFFECT_LIFECYCLE_OPERATIONS,
  SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS,
  SKILL_EFFECT_REAPPLICATION_VALUE_MODE_LABELS,
  SKILL_EFFECT_RESULT_TYPES,
  SKILL_EFFECT_RESULT_TYPE_LABELS,
  SKILL_EFFECT_STACK_VALUE_MODE_LABELS,
  SKILL_EFFECT_TARGET_LABELS,
  SKILL_EFFECT_VALUE_READ_MODE_LABELS,
  STATUS_OPERATION_LABELS,
  UNKNOWN_LIFECYCLE_TARGET_LABEL,
  applyCooldownOperationChange,
  applyLifecycleMomentChange,
  applyLifecycleOperationChange,
  applyResultTypeChange,
  applyStackValueModeChange,
  clearHiddenLifecycleBehaviorFields,
  cooldownChangeAmountHint,
  isAttributeSetPersistent,
  isCatalogOptionSelectable,
  isPeriodicExecutionModeVisible,
  isReapplicationValueModeVisible,
  isStackValueModeVisible,
  isValueReadModeFixed,
  isValueReadModeVisible,
  isValueRuleVisible,
  listAffectedSkillOptions,
  listAllowedLifecycleMoments,
  listAttributeOptions,
  listDamageTypeOptions,
  listFormulaOptions,
  listLifecycleTargetOptions,
  listStatusOptions,
  validateSkillEffectDraft,
  type CatalogRefOption,
  type EffectCatalogLoadState,
  type EffectFormCatalog,
  type SkillEffectDraft,
  type SkillEffectResultDraft,
  type SkillEffectResultDraftErrors
} from './effectForm';

export type SkillEffectResultEditorMode = 'create' | 'view' | 'edit';

type SkillEffectResultEditorModalProps = {
  visible: boolean;
  mode: SkillEffectResultEditorMode;
  resultDraft: SkillEffectResultDraft;
  siblingResults: SkillEffectResultDraft[];
  resultIndex: number | null;
  fieldErrors: SkillEffectResultDraftErrors;
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey' | 'name'>>;
  formulasLoadState?: 'ready' | 'failed';
  parentSkill: Skill;
  parentDraft: SkillEffectDraft;
  effectSummaries: ReadonlyArray<Pick<SkillEffectSummary, 'effectKey' | 'name' | 'lifecycleEnabled'>>;
  effectsLoadState?: 'ready' | 'failed';
  effectsError?: string | null;
  onRetryEffects?: () => void;
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

export function SkillEffectResultEditorModal({
  visible,
  mode,
  resultDraft,
  siblingResults,
  resultIndex,
  fieldErrors,
  formulas,
  formulasLoadState,
  parentSkill,
  parentDraft,
  effectSummaries,
  effectsLoadState,
  effectsError,
  onRetryEffects,
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
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [statuses, setStatuses] = useState<GameStatus[]>([]);
  const [catalogLoadState, setCatalogLoadState] = useState<EffectCatalogLoadState>({});
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<keyof EffectCatalogLoadState, string>>>({});
  const [catalogLoading, setCatalogLoading] = useState<Partial<Record<keyof EffectCatalogLoadState, boolean>>>({});
  const damageTypeSerial = useRef(0);
  const attributeSerial = useRef(0);
  const skillSerial = useRef(0);
  const statusSerial = useRef(0);
  const readOnly = mode === 'view';
  const existingResult = draft.originalResultType !== null;
  const showValueRule = isValueRuleVisible(draft);
  const cooldownHint = cooldownChangeAmountHint(draft);

  const resetCatalogs = useCallback(() => {
    damageTypeSerial.current += 1;
    attributeSerial.current += 1;
    skillSerial.current += 1;
    statusSerial.current += 1;
    setDamageTypes([]);
    setAttributes([]);
    setSkills([]);
    setStatuses([]);
    setCatalogLoadState({});
    setCatalogErrors({});
    setCatalogLoading({});
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
    if (draft.resultType === 'DAMAGE') void loadDamageTypes();
    if (draft.resultType === 'ATTRIBUTE_CHANGE' || draft.resultType === 'RESOURCE_CHANGE') {
      void loadAttributes();
    }
    if (draft.resultType === 'COOLDOWN_CHANGE') void loadSkillsCatalog();
    if (draft.resultType === 'STATUS_OPERATION') void loadStatusesCatalog();
  }, [
    draft.resultType,
    loadAttributes,
    loadDamageTypes,
    loadSkillsCatalog,
    loadStatusesCatalog,
    visible
  ]);

  const catalog = useMemo<EffectFormCatalog>(() => ({
    parentSkillKey: parentSkill.skillKey,
    parentEffectKey: parentDraft.effectKey.trim(),
    formulas,
    effects: effectSummaries,
    damageTypes,
    attributes,
    skills,
    statuses
  }), [attributes, damageTypes, effectSummaries, formulas, parentDraft.effectKey, parentSkill.skillKey, skills, statuses]);

  const validationCatalogState = useMemo<EffectCatalogLoadState>(() => ({
    ...catalogLoadState,
    formulas: formulasLoadState,
    effects: effectsLoadState
  }), [catalogLoadState, effectsLoadState, formulasLoadState]);

  const formulaOptions = useMemo(
    () => listFormulaOptions(catalog, draft.formulaKey),
    [catalog, draft.formulaKey]
  );
  const damageTypeOptions = useMemo(
    () => listDamageTypeOptions(catalog, draft.damageTypeKey, draft.originalDamageTypeKey),
    [catalog, draft.damageTypeKey, draft.originalDamageTypeKey]
  );
  const attributeOptions = useMemo(
    () => listAttributeOptions(catalog, draft.attributeKey, draft.originalAttributeKey),
    [catalog, draft.attributeKey, draft.originalAttributeKey]
  );
  const skillOptions = useMemo(
    () => listAffectedSkillOptions(catalog, draft.affectedSkillKeys, draft.originalAffectedSkillKeys),
    [catalog, draft.affectedSkillKeys, draft.originalAffectedSkillKeys]
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
  const hasDuration = Boolean(parentDraft.lifecycle.durationFormulaKey.trim());
  const allowedMoments = useMemo(
    () => listAllowedLifecycleMoments(draft, hasDuration),
    [draft, hasDuration]
  );

  const formulaNames = useMemo(
    () => namesFrom(formulas, (item) => item.formulaKey, (item) => item.name),
    [formulas]
  );
  const damageTypeNames = useMemo(
    () => namesFrom(damageTypes, (item) => item.damageTypeKey, (item) => item.name),
    [damageTypes]
  );
  const attributeNames = useMemo(
    () => namesFrom(attributes, (item) => item.attributeKey, (item) => item.name),
    [attributes]
  );
  const skillNames = useMemo(
    () => namesFrom(skills, (item) => item.skillKey, (item) => item.name),
    [skills]
  );
  const statusNames = useMemo(
    () => namesFrom(statuses, (item) => item.statusKey, (item) => item.name),
    [statuses]
  );

  const unknownBlocking = useMemo(() => {
    if (showValueRule && hasUnknownOption(formulaOptions, draft.formulaKey)) return true;
    if (draft.resultType === 'DAMAGE' && hasUnknownOption(damageTypeOptions, draft.damageTypeKey)) return true;
    if (
      (draft.resultType === 'ATTRIBUTE_CHANGE' || draft.resultType === 'RESOURCE_CHANGE')
      && hasUnknownOption(attributeOptions, draft.attributeKey)
    ) {
      return true;
    }
    if (
      draft.resultType === 'COOLDOWN_CHANGE'
      && draft.affectedSkillKeys.some((skillKey) => hasUnknownOption(skillOptions, skillKey))
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
    damageTypeOptions,
    draft.affectedSkillKeys,
    draft.attributeKey,
    draft.damageTypeKey,
    draft.formulaKey,
    draft.resultType,
    draft.statusKey,
    draft.targetEffectKey,
    formulaOptions,
    lifecycleTargetOptions,
    showValueRule,
    skillOptions,
    statusOptions
  ]);

  const requiredCatalogLoading = useMemo(() => {
    if (showValueRule && formulasLoadState !== 'ready' && formulasLoadState !== 'failed') {
      return formulasLoadState === undefined;
    }
    if (draft.resultType === 'DAMAGE' && catalogLoading.damageTypes) return true;
    if (
      (draft.resultType === 'ATTRIBUTE_CHANGE' || draft.resultType === 'RESOURCE_CHANGE')
      && catalogLoading.attributes
    ) {
      return true;
    }
    if (draft.resultType === 'COOLDOWN_CHANGE' && catalogLoading.skills) return true;
    if (draft.resultType === 'STATUS_OPERATION' && catalogLoading.statuses) return true;
    if (draft.resultType === 'LIFECYCLE_OPERATION' && effectsLoadState !== 'ready' && effectsLoadState !== 'failed') {
      return effectsLoadState === undefined;
    }
    return false;
  }, [
    catalogLoading.attributes,
    catalogLoading.damageTypes,
    catalogLoading.skills,
    catalogLoading.statuses,
    draft.resultType,
    effectsLoadState,
    formulasLoadState,
    showValueRule
  ]);

  const catalogErrorMessages = useMemo(() => {
    const messages: string[] = [];
    if (showValueRule && formulasLoadState === 'failed') {
      messages.push(INCOMPLETE_CATALOG_MESSAGE);
    }
    if (draft.resultType === 'DAMAGE' && catalogErrors.damageTypes) {
      messages.push(catalogErrors.damageTypes);
    }
    if (
      (draft.resultType === 'ATTRIBUTE_CHANGE' || draft.resultType === 'RESOURCE_CHANGE')
      && catalogErrors.attributes
    ) {
      messages.push(catalogErrors.attributes);
    }
    if (draft.resultType === 'COOLDOWN_CHANGE' && catalogErrors.skills) {
      messages.push(catalogErrors.skills);
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
    catalogErrors.skills,
    catalogErrors.statuses,
    draft.resultType,
    effectsError,
    formulasLoadState,
    showValueRule
  ]);

  const patchDraft = (next: SkillEffectResultDraft) => {
    setDraft(clearHiddenLifecycleBehaviorFields(next));
    setErrors({});
    setSaveError(null);
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
        catalog,
        catalogLoadState: validationCatalogState,
        skipLifecycleShapeValidation: true
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
    if (draft.resultType === 'DAMAGE') void loadDamageTypes();
    if (draft.resultType === 'ATTRIBUTE_CHANGE' || draft.resultType === 'RESOURCE_CHANGE') {
      void loadAttributes();
    }
    if (draft.resultType === 'COOLDOWN_CHANGE') void loadSkillsCatalog();
    if (draft.resultType === 'STATUS_OPERATION') void loadStatusesCatalog();
    if (draft.resultType === 'LIFECYCLE_OPERATION') onRetryEffects?.();
  };

  return (
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
        {unknownBlocking ? <Alert type="error" content={INCOMPLETE_CATALOG_MESSAGE} /> : null}
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
              disabled={readOnly || existingResult}
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
              onChange={(value) => patchDraft(applyResultTypeChange(draft, value as SkillEffectResultType))}
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
              onChange={(value) => patchDraft({ ...draft, target: value as SkillEffectTarget })}
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

          {showValueRule ? (
            <>
              <Form.Item
                label="数值公式"
                required
                validateStatus={errors.formulaKey ? 'error' : undefined}
                help={errors.formulaKey}
              >
                <Select
                  aria-label="数值公式"
                  value={draft.formulaKey || undefined}
                  disabled={readOnly}
                  options={toSelectOptions(formulaOptions, formulaNames)}
                  placeholder="请选择数值公式"
                  onChange={(value) => patchDraft({ ...draft, formulaKey: String(value ?? '') })}
                />
              </Form.Item>
              <Form.Item
                label={cooldownHint ? `固定倍率（${cooldownHint}）` : '固定倍率'}
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
                  disabled={readOnly}
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
                  disabled={readOnly}
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
              <Form.Item
                label="受影响技能"
                required
                validateStatus={errors.affectedSkillKeys ? 'error' : undefined}
                help={errors.affectedSkillKeys}
              >
                <Select
                  aria-label="受影响技能"
                  mode="multiple"
                  value={draft.affectedSkillKeys}
                  disabled={readOnly}
                  options={toSelectOptions(skillOptions, skillNames, parentSkill)}
                  placeholder="请选择一个或多个受影响技能"
                  renderFormat={(_option, value) => {
                    const key = typeof value === 'object' && value !== null && 'value' in value
                      ? String(value.value)
                      : String(value);
                    const catalogOption = skillOptions.find((item) => item.key === key);
                    return catalogOption ? catalogLabel(catalogOption, skillNames, parentSkill) : key;
                  }}
                  onChange={(value) => patchDraft({
                    ...draft,
                    affectedSkillKeys: Array.isArray(value) ? value.map(String) : []
                  })}
                />
              </Form.Item>
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
                  onChange={(value) => patchDraft({ ...draft, statusKey: String(value ?? '') })}
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
                  onChange={(value) => patchDraft({
                    ...draft,
                    statusOperation: value as StatusOperation
                  })}
                >
                  {Object.entries(STATUS_OPERATION_LABELS).map(([value, label]) => (
                    <Radio key={value} value={value}>{label}</Radio>
                  ))}
                </Radio.Group>
              </Form.Item>
            </>
          ) : null}
          {errors.detail ? <Alert type="error" content={errors.detail} /> : null}

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
                  disabled={readOnly}
                  options={allowedMoments.map((value) => ({
                    value,
                    label: SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS[value]
                  }))}
                  placeholder="请选择生命周期时点"
                  onChange={(value) => patchDraft(
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
                    {Object.entries(SKILL_EFFECT_VALUE_READ_MODE_LABELS).map(([value, label]) => (
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
                    disabled={readOnly || isAttributeSetPersistent(draft)}
                    onChange={(value) => patchDraft(
                      applyStackValueModeChange(draft, value as SkillEffectStackValueMode)
                    )}
                  >
                    {Object.entries(SKILL_EFFECT_STACK_VALUE_MODE_LABELS)
                      .filter(([value]) => !(isAttributeSetPersistent(draft) && value === 'PER_STACK'))
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
                    disabled={readOnly}
                    onChange={(value) => patchDraft({
                      ...draft,
                      lifecycleBehavior: {
                        ...draft.lifecycleBehavior,
                        reapplicationValueMode: value as SkillEffectReapplicationValueMode
                      }
                    })}
                  >
                    {Object.entries(SKILL_EFFECT_REAPPLICATION_VALUE_MODE_LABELS)
                      .filter(([value]) => !(isAttributeSetPersistent(draft) && value === 'ADD'))
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
  );
}
