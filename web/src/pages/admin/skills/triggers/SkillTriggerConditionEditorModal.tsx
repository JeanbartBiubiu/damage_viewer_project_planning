import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch
} from '@arco-design/web-react';
import { useEffect, useMemo, useState } from 'react';
import type { Attribute } from '../../../../types/attribute';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { GameStatus } from '../../../../types/status';
import type {
  SkillTriggerConditionType,
  SkillTriggerEventSource,
  SkillTriggerInternalStateValueKind,
  SkillTriggerStatusCheckKind,
  SkillTriggerSubject
} from '../../../../types/skillTriggerRule';
import {
  DISABLED_CATALOG_LABEL,
  SKILL_TRIGGER_COMPARATOR_LABELS,
  SKILL_TRIGGER_COMPARATORS,
  SKILL_TRIGGER_CONDITION_TYPE_LABELS,
  SKILL_TRIGGER_CONDITION_TYPES,
  SKILL_TRIGGER_EVENT_VALUE_LABELS,
  SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS,
  SKILL_TRIGGER_STATUS_CHECK_LABELS,
  SKILL_TRIGGER_SUBJECT_LABELS,
  allowedEventValuesFor,
  attributeValueKinds,
  createEmptyConditionDraft,
  patchAttributeCompareDetail,
  patchEventValueCompareDetail,
  patchInternalStateCheckStateKey,
  patchInternalStateCheckValueKind,
  patchInternalStateCompareFields,
  patchInternalStateExpectedBoolean,
  patchInternalStateOptionKey,
  patchStatusCheckKind,
  patchStatusCheckStatusKey,
  patchStatusCheckSubject,
  patchStatusCompareFields,
  persistentStatusApplyResults,
  subjectOptionsForEvent,
  switchConditionType,
  valueKindsForInternalState,
  type NestedFieldError,
  type SkillTriggerConditionDraft
} from './triggerRuleForm';
import { attributeValueKindLabel } from '../formulaExpression';

export type SkillTriggerConditionEditorMode = 'create' | 'edit';

type CatalogOption = { label: string; value: string; disabled?: boolean };

type SkillTriggerConditionEditorModalProps = {
  visible: boolean;
  mode: SkillTriggerConditionEditorMode;
  draft: SkillTriggerConditionDraft | null;
  existingKeys: readonly string[];
  eventSource: SkillTriggerEventSource;
  attributes: readonly Attribute[];
  statuses: readonly GameStatus[];
  formulas: readonly SkillFormulaSummary[];
  internalStates: readonly SkillInternalState[];
  effects: readonly SkillEffect[];
  fieldErrors: readonly NestedFieldError[];
  disabled?: boolean;
  onClose: () => void;
  onConfirm: (draft: SkillTriggerConditionDraft) => void;
};

function titleFor(mode: SkillTriggerConditionEditorMode): string {
  return mode === 'create' ? '新增条件' : '编辑条件';
}

function formulaOptions(formulas: readonly SkillFormulaSummary[]): CatalogOption[] {
  return formulas.map((item) => ({ value: item.formulaKey, label: item.name || item.formulaKey }));
}

function disabledLabel(name: string, disabled: boolean): string {
  return disabled ? `${name}（${DISABLED_CATALOG_LABEL}）` : name;
}

export function SkillTriggerConditionEditorModal({
  visible,
  mode,
  draft,
  existingKeys,
  eventSource,
  attributes,
  statuses,
  formulas,
  internalStates,
  effects,
  fieldErrors,
  disabled,
  onClose,
  onConfirm
}: SkillTriggerConditionEditorModalProps) {
  const [current, setCurrent] = useState<SkillTriggerConditionDraft>(
    draft ?? createEmptyConditionDraft(existingKeys)
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const allowedValues = allowedEventValuesFor(eventSource);
  const subjectOptions = subjectOptionsForEvent(eventSource.eventType);
  const conditionTypes = SKILL_TRIGGER_CONDITION_TYPES.filter(
    (value) => value !== 'EVENT_VALUE_COMPARE' || allowedValues.length > 0
  );

  useEffect(() => {
    if (!visible) return;
    setCurrent(draft ?? createEmptyConditionDraft(existingKeys));
    setLocalError(null);
  }, [draft, visible]);

  const selectedState = useMemo(
    () => (
      current.conditionType === 'INTERNAL_STATE_CHECK'
        ? internalStates.find((item) => item.stateKey === current.detail.stateKey) ?? null
        : null
    ),
    [current, internalStates]
  );

  const errorFor = (suffix: string): string | undefined => (
    fieldErrors.find((item) => item.path.endsWith(suffix))?.message
  );

  const patchType = (nextType: SkillTriggerConditionType) => {
    setCurrent(switchConditionType(current, nextType));
    setLocalError(null);
  };

  const confirm = () => {
    if (current.conditionType === 'EVENT_VALUE_COMPARE' && allowedValues.length === 0) {
      setLocalError('当前事件没有可比较的事件值。');
      return;
    }
    onConfirm(current);
  };

  const attributeOptions: CatalogOption[] = attributes.map((item) => ({
    value: item.attributeKey,
    label: disabledLabel(item.name || item.attributeKey, item.status === 'DISABLED'),
    disabled: item.status === 'DISABLED' && item.attributeKey !== (
      current.conditionType === 'ATTRIBUTE_COMPARE' ? current.detail.attributeKey : ''
    )
  }));

  const statusOptions: CatalogOption[] = statuses.map((item) => ({
    value: item.statusKey,
    label: disabledLabel(item.name || item.statusKey, item.status === 'DISABLED'),
    disabled: item.status === 'DISABLED' && item.statusKey !== (
      current.conditionType === 'STATUS_CHECK' ? current.detail.statusKey : ''
    )
  }));

  const stateOptions: CatalogOption[] = internalStates.map((item) => ({
    value: item.stateKey,
    label: item.name || item.stateKey
  }));

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={onClose}
      style={{ width: 720 }}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={disabled} onClick={confirm}>确定</Button>
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {localError ? <Alert type="error" content={localError} /> : null}
        <Form layout="vertical">
          <Form.Item label="条件种类" required>
            <Select
              aria-label="条件种类"
              value={current.conditionType}
              disabled={disabled}
              options={conditionTypes.map((value) => ({
                value,
                label: SKILL_TRIGGER_CONDITION_TYPE_LABELS[value]
              }))}
              onChange={(value) => patchType(value as SkillTriggerConditionType)}
            />
          </Form.Item>
          <Form.Item
            label="条件标识"
            required
            validateStatus={errorFor('conditionKey') ? 'error' : undefined}
            help={errorFor('conditionKey')}
          >
            <Input
              aria-label="条件标识"
              value={current.conditionKey}
              disabled={disabled || mode === 'edit'}
              maxLength={64}
              onChange={(value) => setCurrent({ ...current, conditionKey: value })}
            />
          </Form.Item>
          <Form.Item label="排序" required>
            <Input
              aria-label="条件排序"
              value={current.sortOrder}
              disabled={disabled}
              onChange={(value) => setCurrent({ ...current, sortOrder: value })}
            />
          </Form.Item>

          {current.conditionType === 'ATTRIBUTE_COMPARE' ? (
            <>
              <Form.Item label="对象" required>
                <Select
                  aria-label="属性比较对象"
                  value={current.detail.subject}
                  disabled={disabled}
                  options={subjectOptions.map((value) => ({
                    value,
                    label: SKILL_TRIGGER_SUBJECT_LABELS[value]
                  }))}
                  onChange={(value) => setCurrent(patchAttributeCompareDetail(
                    current,
                    { subject: value as SkillTriggerSubject }
                  ))}
                />
              </Form.Item>
              <Form.Item label="属性" required>
                <Select
                  aria-label="属性"
                  value={current.detail.attributeKey || undefined}
                  disabled={disabled}
                  options={attributeOptions}
                  onChange={(value) => setCurrent(patchAttributeCompareDetail(
                    current,
                    { attributeKey: String(value ?? '') }
                  ))}
                />
              </Form.Item>
              <Form.Item label="属性取值" required>
                <Select
                  aria-label="属性取值"
                  value={current.detail.attributeValueKind}
                  disabled={disabled}
                  options={attributeValueKinds().map((value) => ({
                    value,
                    label: attributeValueKindLabel(value)
                  }))}
                  onChange={(value) => setCurrent(patchAttributeCompareDetail(
                    current,
                    { attributeValueKind: value }
                  ))}
                />
              </Form.Item>
              <Form.Item label="比较符" required>
                <Select
                  aria-label="比较符"
                  value={current.detail.comparator}
                  disabled={disabled}
                  options={SKILL_TRIGGER_COMPARATORS.map((value) => ({
                    value,
                    label: SKILL_TRIGGER_COMPARATOR_LABELS[value]
                  }))}
                  onChange={(value) => setCurrent(patchAttributeCompareDetail(
                    current,
                    { comparator: value }
                  ))}
                />
              </Form.Item>
              <Form.Item label="比较公式" required>
                <Select
                  aria-label="比较公式"
                  value={current.detail.comparisonFormulaKey || undefined}
                  disabled={disabled}
                  options={formulaOptions(formulas)}
                  onChange={(value) => setCurrent(patchAttributeCompareDetail(
                    current,
                    { comparisonFormulaKey: String(value ?? '') }
                  ))}
                />
              </Form.Item>
            </>
          ) : null}

          {current.conditionType === 'STATUS_CHECK' ? (
            <>
              <Form.Item label="对象" required>
                <Select
                  aria-label="状态检查对象"
                  value={current.detail.subject}
                  disabled={disabled}
                  options={subjectOptions.map((value) => ({
                    value,
                    label: SKILL_TRIGGER_SUBJECT_LABELS[value]
                  }))}
                  onChange={(value) => setCurrent(patchStatusCheckSubject(
                    current,
                    value as SkillTriggerSubject
                  ))}
                />
              </Form.Item>
              <Form.Item label="状态" required>
                <Select
                  aria-label="状态"
                  value={current.detail.statusKey || undefined}
                  disabled={disabled}
                  options={statusOptions}
                  onChange={(value) => setCurrent(patchStatusCheckStatusKey(
                    current,
                    String(value ?? '')
                  ))}
                />
              </Form.Item>
              <Form.Item label="存在方式" required>
                <Select
                  aria-label="存在方式"
                  value={current.detail.checkKind}
                  disabled={disabled}
                  options={(['PRESENT', 'ABSENT', 'STACKS_COMPARE', 'REMAINING_MS_COMPARE'] as SkillTriggerStatusCheckKind[])
                    .map((value) => ({ value, label: SKILL_TRIGGER_STATUS_CHECK_LABELS[value] }))}
                  onChange={(value) => setCurrent(patchStatusCheckKind(
                    current,
                    value as SkillTriggerStatusCheckKind
                  ))}
                />
              </Form.Item>
              {current.detail.checkKind === 'STACKS_COMPARE' || current.detail.checkKind === 'REMAINING_MS_COMPARE' ? (
                <>
                  <Form.Item label="生命周期效果" required>
                    <Select
                      aria-label="生命周期效果"
                      value={current.detail.sourceEffectKey || undefined}
                      disabled={disabled}
                      options={effects
                        .filter((item) => item.lifecycle !== null)
                        .map((item) => ({ value: item.effectKey, label: item.name || item.effectKey }))}
                      onChange={(value) => setCurrent(patchStatusCompareFields(current, {
                        sourceEffectKey: String(value ?? ''),
                        sourceResultKey: ''
                      }))}
                    />
                  </Form.Item>
                  <Form.Item label="状态施加结果" required>
                    <Select
                      aria-label="状态施加结果"
                      value={current.detail.sourceResultKey || undefined}
                      disabled={disabled}
                      options={(() => {
                        const sourceEffect = effects.find((item) => (
                          item.effectKey === current.detail.sourceEffectKey
                        ));
                        return sourceEffect
                          ? persistentStatusApplyResults(sourceEffect, current.detail.statusKey)
                          : [];
                      })().map((item) => ({ value: item.resultKey, label: item.name || item.resultKey }))}
                      onChange={(value) => setCurrent(patchStatusCompareFields(current, {
                        sourceResultKey: String(value ?? '')
                      }))}
                    />
                  </Form.Item>
                  <Form.Item label="比较符" required>
                    <Select
                      aria-label="状态比较符"
                      value={current.detail.comparator ?? undefined}
                      disabled={disabled}
                      options={SKILL_TRIGGER_COMPARATORS.map((value) => ({
                        value,
                        label: SKILL_TRIGGER_COMPARATOR_LABELS[value]
                      }))}
                      onChange={(value) => setCurrent(patchStatusCompareFields(current, {
                        comparator: value
                      }))}
                    />
                  </Form.Item>
                  <Form.Item label="比较公式" required>
                    <Select
                      aria-label="状态比较公式"
                      value={current.detail.comparisonFormulaKey || undefined}
                      disabled={disabled}
                      options={formulaOptions(formulas)}
                      onChange={(value) => setCurrent(patchStatusCompareFields(current, {
                        comparisonFormulaKey: String(value ?? '')
                      }))}
                    />
                  </Form.Item>
                </>
              ) : null}
            </>
          ) : null}

          {current.conditionType === 'INTERNAL_STATE_CHECK' ? (
            <>
              <Form.Item label="内部状态" required>
                <Select
                  aria-label="内部状态"
                  value={current.detail.stateKey || undefined}
                  disabled={disabled}
                  options={stateOptions}
                  onChange={(value) => {
                    const nextState = internalStates.find((item) => item.stateKey === value);
                    const kinds = valueKindsForInternalState(nextState?.stateType ?? null);
                    setCurrent(patchInternalStateCheckStateKey(
                      current,
                      String(value ?? ''),
                      kinds[0] ?? 'VALUE'
                    ));
                  }}
                />
              </Form.Item>
              <Form.Item label="取值方式" required>
                <Select
                  aria-label="内部状态取值方式"
                  value={current.detail.valueKind}
                  disabled={disabled}
                  options={valueKindsForInternalState(selectedState?.stateType ?? null).map((value) => ({
                    value,
                    label: SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS[value]
                  }))}
                  onChange={(value) => setCurrent(patchInternalStateCheckValueKind(
                    current,
                    value as SkillTriggerInternalStateValueKind
                  ))}
                />
              </Form.Item>
              {current.detail.valueKind === 'OPTION_SELECTED' ? (
                <Form.Item label="模式选项" required>
                  <Select
                    aria-label="模式选项"
                    value={current.detail.optionKey || undefined}
                    disabled={disabled}
                    options={(selectedState?.stateType === 'MODE' ? selectedState.detail.options : []).map((item) => ({
                      value: item.optionKey,
                      label: item.name || item.optionKey
                    }))}
                    onChange={(value) => setCurrent(patchInternalStateOptionKey(
                      current,
                      String(value ?? '')
                    ))}
                  />
                </Form.Item>
              ) : null}
              {current.detail.valueKind === 'ENABLED' ? (
                <Form.Item label="期望值" required>
                  <Switch
                    checked={Boolean(current.detail.expectedBoolean)}
                    disabled={disabled}
                    onChange={(value) => setCurrent(patchInternalStateExpectedBoolean(current, value))}
                  />
                </Form.Item>
              ) : null}
              {current.detail.valueKind === 'VALUE' || current.detail.valueKind === 'REMAINING_MS' ? (
                <>
                  <Form.Item label="比较符" required>
                    <Select
                      aria-label="内部状态比较符"
                      value={current.detail.comparator ?? undefined}
                      disabled={disabled}
                      options={SKILL_TRIGGER_COMPARATORS.map((value) => ({
                        value,
                        label: SKILL_TRIGGER_COMPARATOR_LABELS[value]
                      }))}
                      onChange={(value) => setCurrent(patchInternalStateCompareFields(current, {
                        comparator: value
                      }))}
                    />
                  </Form.Item>
                  <Form.Item label="比较公式" required>
                    <Select
                      aria-label="内部状态比较公式"
                      value={current.detail.comparisonFormulaKey || undefined}
                      disabled={disabled}
                      options={formulaOptions(formulas)}
                      onChange={(value) => setCurrent(patchInternalStateCompareFields(current, {
                        comparisonFormulaKey: String(value ?? '')
                      }))}
                    />
                  </Form.Item>
                </>
              ) : null}
            </>
          ) : null}

          {current.conditionType === 'EVENT_VALUE_COMPARE' ? (
            allowedValues.length === 0 ? (
              <Alert type="warning" content="当前事件没有可比较的事件值。" />
            ) : (
              <>
                <Form.Item label="事件值" required>
                  <Select
                    aria-label="事件值"
                    value={current.detail.eventValueKey}
                    disabled={disabled}
                    options={allowedValues.map((value) => ({
                      value,
                      label: SKILL_TRIGGER_EVENT_VALUE_LABELS[value]
                    }))}
                    onChange={(value) => setCurrent(patchEventValueCompareDetail(current, {
                      eventValueKey: value
                    }))}
                  />
                </Form.Item>
                <Form.Item label="比较符" required>
                  <Select
                    aria-label="事件值比较符"
                    value={current.detail.comparator}
                    disabled={disabled}
                    options={SKILL_TRIGGER_COMPARATORS.map((value) => ({
                      value,
                      label: SKILL_TRIGGER_COMPARATOR_LABELS[value]
                    }))}
                    onChange={(value) => setCurrent(patchEventValueCompareDetail(current, {
                      comparator: value
                    }))}
                  />
                </Form.Item>
                <Form.Item label="比较公式" required>
                  <Select
                    aria-label="事件值比较公式"
                    value={current.detail.comparisonFormulaKey || undefined}
                    disabled={disabled}
                    options={formulaOptions(formulas)}
                    onChange={(value) => setCurrent(patchEventValueCompareDetail(current, {
                      comparisonFormulaKey: String(value ?? '')
                    }))}
                  />
                </Form.Item>
              </>
            )
          ) : null}
        </Form>
      </Space>
    </Modal>
  );
}
