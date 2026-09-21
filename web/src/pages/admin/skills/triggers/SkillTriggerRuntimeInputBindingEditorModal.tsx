import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Attribute } from '../../../../types/attribute';
import { allowsSourceCastResourceCost, sourceCastResourceCostError } from './sourceCastResourceCost';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter, SkillParameterValueType } from '../../../../types/skillParameter';
import type { GameStatus } from '../../../../types/status';
import type {
  SkillTriggerCombatStatusValueKind,
  SkillTriggerEventSource,
  SkillTriggerEventValueKey,
  SkillTriggerInternalStateValueKind,
  SkillTriggerPriorResultBinding,
  SkillTriggerPriorResultOutputKind,
  SkillTriggerRuntimeInputBinding,
  SkillTriggerRuntimeInputSourceType,
  SkillTriggerSubject
} from '../../../../types/skillTriggerRule';
import {
  SKILL_TRIGGER_COMBAT_STATUS_VALUE_LABELS,
  SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS,
  SKILL_TRIGGER_PRIOR_BOOLEAN_OUTPUT_HINT,
  SKILL_TRIGGER_SOURCE_EFFECT_LOAD_MESSAGE,
  SKILL_TRIGGER_SOURCE_TYPE_LABELS,
  SKILL_TRIGGER_SOURCE_TYPES,
  SKILL_TRIGGER_SUBJECT_LABELS,
  SKILL_TRIGGER_VALUE_TYPE_LABELS,
  allowedEventValuesFor,
  bindingSummary,
  createEmptyBinding,
  eventValueHint,
  eventValueOptionLabel,
  evaluateBindingCompleteness,
  filterPriorResultOutputsForParameter,
  isAllowedPriorResultOutputKind,
  isBindingTypeCompatible,
  isBooleanPriorResultOutput,
  listAvailablePriorResultOutputs,
  listEarlierExecuteEffectActions,
  listImmediateSourceResults,
  patchCombatStatusBinding,
  patchCombatStatusMeasuredFields,
  patchCombatStatusValueKind,
  patchInternalStateBindingDetail,
  patchPriorResultBinding,
  persistentStatusApplyResults,
  priorResultOutputDomain,
  priorResultOutputLabel,
  subjectOptionsForEvent,
  switchBindingSourceType,
  valueKindsForInternalState,
  type PriorSourceActionOption,
  type CatalogLoadState,
  type SkillTriggerActionDraft
} from './triggerRuleForm';

export type SkillTriggerRuntimeInputBindingEditorMode = 'create' | 'edit';

export type PriorResultOutputSelection = SkillTriggerPriorResultOutputKind | null;

export function initialPriorResultOutputSelection(
  mode: SkillTriggerRuntimeInputBindingEditorMode,
  binding: SkillTriggerRuntimeInputBinding | null
): PriorResultOutputSelection {
  if (mode !== 'edit' || binding?.sourceType !== 'PRIOR_ACTION_RESULT') return null;
  return binding.detail.outputKind;
}

export function retainPriorResultOutputSelection(
  selected: PriorResultOutputSelection,
  legalOptions: readonly SkillTriggerPriorResultOutputKind[],
  options: {
    canEvaluateAvailability: boolean;
    parameterValueType?: SkillParameterValueType | null;
  }
): PriorResultOutputSelection {
  if (selected === null) return null;
  const parameterType = options.parameterValueType;
  if (parameterType === 'INTEGER' || parameterType === 'DECIMAL') {
    if (!isBindingTypeCompatible(priorResultOutputDomain(selected), parameterType)) {
      return null;
    }
  }
  if (!options.canEvaluateAvailability) return selected;
  return legalOptions.includes(selected) ? selected : null;
}

export function isPriorResultEditorConfirmReady(input: {
  selectedSourceAction: PriorSourceActionOption | null;
  sourceEffect: SkillEffect | null | undefined;
  sourceEffectLoading: boolean;
  sourceEffectError: string | null;
  sourceResultKey: string;
  immediateSourceResults: readonly { resultKey: string }[];
  selectedOutputKind: PriorResultOutputSelection;
  legalOutputOptions: readonly SkillTriggerPriorResultOutputKind[];
  parameterValueType?: SkillParameterValueType | null;
}): boolean {
  if (input.sourceEffectLoading || input.sourceEffectError) return false;
  if (!input.selectedSourceAction) return false;
  if (!input.sourceEffect) return false;
  if (!input.sourceResultKey) return false;
  if (!input.immediateSourceResults.some((item) => item.resultKey === input.sourceResultKey)) {
    return false;
  }
  if (input.parameterValueType !== 'INTEGER' && input.parameterValueType !== 'DECIMAL') {
    return false;
  }
  if (input.selectedOutputKind === null) return false;
  return input.legalOutputOptions.includes(input.selectedOutputKind);
}

export function confirmedPriorResultBinding(
  current: SkillTriggerPriorResultBinding,
  selectedOutputKind: PriorResultOutputSelection
): SkillTriggerPriorResultBinding | null {
  if (selectedOutputKind === null || !isAllowedPriorResultOutputKind(selectedOutputKind)) {
    return null;
  }
  return patchPriorResultBinding(current, { outputKind: selectedOutputKind });
}

export function priorResultDraftSummary(
  binding: SkillTriggerPriorResultBinding,
  selectedOutputKind: PriorResultOutputSelection
): string {
  return [
    SKILL_TRIGGER_SOURCE_TYPE_LABELS.PRIOR_ACTION_RESULT,
    binding.detail.sourceActionKey,
    binding.detail.sourceResultKey,
    selectedOutputKind ? priorResultOutputLabel(selectedOutputKind) : ''
  ].filter(Boolean).join(' / ');
}

type SkillTriggerRuntimeInputBindingEditorModalProps = {
  visible: boolean;
  mode: SkillTriggerRuntimeInputBindingEditorMode;
  binding: SkillTriggerRuntimeInputBinding | null;
  existingBindingKeys: readonly string[];
  originalSourceType?: SkillTriggerRuntimeInputSourceType;
  attributes: readonly Attribute[];
  attributesLoadState?: CatalogLoadState;
  onRetryAttributes: () => Promise<void>;
  reachableParameters: readonly SkillParameter[];
  currentBindings: readonly SkillTriggerRuntimeInputBinding[];
  eventSource: SkillTriggerEventSource;
  actions: readonly SkillTriggerActionDraft[];
  currentActionIndex: number;
  internalStates: readonly SkillInternalState[];
  statuses: readonly GameStatus[];
  effects: readonly SkillEffect[];
  effectsByKey: ReadonlyMap<string, SkillEffect>;
  disabled?: boolean;
  onClose: () => void;
  onConfirm: (binding: SkillTriggerRuntimeInputBinding) => void;
  onEnsureEffect?: (effectKey: string) => Promise<SkillEffect | null>;
};

function titleFor(mode: SkillTriggerRuntimeInputBindingEditorMode): string {
  return mode === 'create' ? '新增绑定' : '编辑绑定';
}

function emptyBinding(existingKeys: readonly string[]): SkillTriggerRuntimeInputBinding {
  return createEmptyBinding(existingKeys, 'INTERNAL_STATE');
}

export function SkillTriggerRuntimeInputBindingEditorModal({
  visible,
  mode,
  binding,
  existingBindingKeys,
  originalSourceType,
  attributes,
  attributesLoadState,
  onRetryAttributes,
  reachableParameters,
  currentBindings,
  eventSource,
  actions,
  currentActionIndex,
  internalStates,
  statuses,
  effects,
  effectsByKey,
  disabled,
  onClose,
  onConfirm,
  onEnsureEffect
}: SkillTriggerRuntimeInputBindingEditorModalProps) {
  const [current, setCurrent] = useState<SkillTriggerRuntimeInputBinding>(
    binding ?? emptyBinding(existingBindingKeys)
  );
  const [selectedOutputKind, setSelectedOutputKind] = useState<PriorResultOutputSelection>(
    initialPriorResultOutputSelection(mode, binding)
  );
  const [sourceEffectLoading, setSourceEffectLoading] = useState(false);
  const [sourceEffectError, setSourceEffectError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const sourceCostError = current.sourceType === 'SOURCE_CAST_RESOURCE_COST'
    ? sourceCastResourceCostError(current, eventSource, reachableParameters, attributes, attributesLoadState)
    : null;
  const allowedValues = allowedEventValuesFor(eventSource);
  const subjectOptions = subjectOptionsForEvent(eventSource.eventType);
  const earlierActions = useMemo(
    () => listEarlierExecuteEffectActions(actions, currentActionIndex),
    [actions, currentActionIndex]
  );
  const selectedParameter = reachableParameters.find((item) => item.parameterKey === current.parameterKey);
  const selectedSourceAction = current.sourceType === 'PRIOR_ACTION_RESULT'
    ? earlierActions.find((item) => item.sourceActionKey === current.detail.sourceActionKey) ?? null
    : null;
  const sourceEffect = selectedSourceAction
    ? effectsByKey.get(selectedSourceAction.sourceEffectKey) ?? null
    : null;
  const sourceResults = useMemo(
    () => listImmediateSourceResults(sourceEffect),
    [sourceEffect]
  );
  const outputOptions = useMemo(() => {
    if (current.sourceType !== 'PRIOR_ACTION_RESULT') return [];
    const result = sourceResults.find((item) => item.resultKey === current.detail.sourceResultKey);
    if (!result) return [];
    return filterPriorResultOutputsForParameter(
      listAvailablePriorResultOutputs(result),
      selectedParameter?.valueType
    );
  }, [current, selectedParameter, sourceResults]);
  const completeness = evaluateBindingCompleteness(reachableParameters, currentBindings);
  const selectedState = current.sourceType === 'INTERNAL_STATE'
    ? internalStates.find((item) => item.stateKey === current.detail.stateKey) ?? null
    : null;
  const canEvaluateOutputAvailability = Boolean(sourceEffect) && Boolean(
    current.sourceType === 'PRIOR_ACTION_RESULT' && current.detail.sourceResultKey
  );
  const effectiveOutputKind = current.sourceType === 'PRIOR_ACTION_RESULT'
    ? retainPriorResultOutputSelection(selectedOutputKind, outputOptions, {
      canEvaluateAvailability: canEvaluateOutputAvailability,
      parameterValueType: selectedParameter?.valueType
    })
    : null;
  const priorResultConfirmReady = current.sourceType !== 'PRIOR_ACTION_RESULT' || isPriorResultEditorConfirmReady({
    selectedSourceAction,
    sourceEffect,
    sourceEffectLoading,
    sourceEffectError,
    sourceResultKey: current.detail.sourceResultKey,
    immediateSourceResults: sourceResults,
    selectedOutputKind: effectiveOutputKind,
    legalOutputOptions: outputOptions,
    parameterValueType: selectedParameter?.valueType
  });

  useEffect(() => {
    if (!visible) return;
    setCurrent(binding ?? emptyBinding(existingBindingKeys));
    setSelectedOutputKind(initialPriorResultOutputSelection(mode, binding));
    setSourceEffectError(null);
    setSourceEffectLoading(false);
    setLocalError(null);
  }, [binding, mode, visible]);

  useEffect(() => {
    if (selectedOutputKind === effectiveOutputKind) return;
    setSelectedOutputKind(effectiveOutputKind);
  }, [effectiveOutputKind, selectedOutputKind]);

  const loadSourceEffect = useCallback(async (effectKey: string) => {
    if (!effectKey.trim() || !onEnsureEffect) return;
    if (effectsByKey.has(effectKey)) {
      setSourceEffectError(null);
      return;
    }
    setSourceEffectLoading(true);
    setSourceEffectError(null);
    const loaded = await onEnsureEffect(effectKey);
    setSourceEffectLoading(false);
    if (!loaded) {
      setSourceEffectError(SKILL_TRIGGER_SOURCE_EFFECT_LOAD_MESSAGE);
    }
  }, [effectsByKey, onEnsureEffect]);

  useEffect(() => {
    if (!visible || current.sourceType !== 'PRIOR_ACTION_RESULT') return;
    const effectKey = selectedSourceAction?.sourceEffectKey ?? '';
    if (!effectKey) return;
    void loadSourceEffect(effectKey);
  }, [current.sourceType, loadSourceEffect, selectedSourceAction, visible]);

  const confirmSourceActionChange = (nextAction: PriorSourceActionOption | undefined) => {
    if (current.sourceType !== 'PRIOR_ACTION_RESULT') return;
    const apply = () => {
      setSelectedOutputKind(null);
      setCurrent(patchPriorResultBinding(current, {
        sourceActionKey: nextAction?.sourceActionKey ?? '',
        sourceResultKey: ''
      }));
      if (nextAction?.sourceEffectKey) void loadSourceEffect(nextAction.sourceEffectKey);
    };
    if (!current.detail.sourceResultKey && effectiveOutputKind === null) {
      apply();
      return;
    }
    const outputLabel = effectiveOutputKind ? priorResultOutputLabel(effectiveOutputKind) : '';
    Modal.confirm({
      content: outputLabel
        ? `将清除来源结果和输出：${current.detail.sourceResultKey} / ${outputLabel}`
        : `将清除来源结果：${current.detail.sourceResultKey}`,
      okText: '确定',
      cancelText: '取消',
      onOk: apply
    });
  };

  const confirmSourceResultChange = (nextResultKey: string) => {
    if (current.sourceType !== 'PRIOR_ACTION_RESULT') return;
    if (current.detail.sourceResultKey === nextResultKey) return;
    const apply = () => {
      setSelectedOutputKind(null);
      setCurrent(patchPriorResultBinding(current, {
        sourceResultKey: nextResultKey
      }));
    };
    if (!effectiveOutputKind) {
      apply();
      return;
    }
    Modal.confirm({
      content: `将清除结果输出：${priorResultOutputLabel(effectiveOutputKind)}`,
      okText: '确定',
      cancelText: '取消',
      onOk: apply
    });
  };

  const confirmBinding = () => {
    if (mode === 'create' && existingBindingKeys.includes(current.bindingKey)) {
      setLocalError('绑定标识已使用；更换来源请使用新标识。');
      return;
    }
    if (originalSourceType && originalSourceType !== current.sourceType) {
      setLocalError('已有绑定不能更改来源种类；请删除后以新标识新增。');
      return;
    }
    if (sourceCostError) return;
    if (current.sourceType === 'PRIOR_ACTION_RESULT') {
      const confirmed = confirmedPriorResultBinding(current, effectiveOutputKind);
      if (!confirmed) return;
      onConfirm(confirmed);
      return;
    }
    onConfirm(current);
  };

  const columns: TableColumnProps[] = [
    { title: '参数', dataIndex: 'name' },
    { title: '稳定标识', dataIndex: 'parameterKey' },
    {
      title: '类型',
      dataIndex: 'valueType',
      width: 80,
      render: (value: SkillParameter['valueType']) => SKILL_TRIGGER_VALUE_TYPE_LABELS[value]
    },
    { title: '来源摘要', dataIndex: 'summary' },
    {
      title: '状态',
      render: (_value, record: (typeof completeness)[number]) => {
        if (record.missing) return '缺少绑定';
        if (record.duplicate) return '重复绑定';
        if (record.extra) return '未使用绑定';
        if (record.typeCompatible === false) return '值类型不兼容';
        return '完整';
      }
    }
  ];

  return (
    <Modal
      title={titleFor(mode)}
      visible={visible}
      maskClosable
      onCancel={onClose}
      style={{ width: 960 }}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            disabled={disabled || !priorResultConfirmReady || Boolean(sourceCostError)}
            onClick={confirmBinding}
          >
            确定
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
        {localError ? <Alert type="error" content={localError} /> : null}
        <Table
          size="small"
          pagination={false}
          rowKey={(record) => record.parameterKey + String(record.extra)}
          columns={columns}
          data={completeness}
          noDataElement={<Empty description="当前动作没有计算时传入参数" />}
        />
        <Form layout="vertical">
          <Form.Item label="绑定标识" required>
            <Input
              aria-label="绑定标识"
              value={current.bindingKey}
              disabled={disabled || mode === 'edit'}
              maxLength={64}
              onChange={(value) => setCurrent({ ...current, bindingKey: value })}
            />
          </Form.Item>
          <Form.Item label="参数" required>
            <Select
              aria-label="绑定参数"
              value={current.parameterKey || undefined}
              disabled={disabled}
              options={reachableParameters.map((item) => ({
                value: item.parameterKey,
                disabled: current.sourceType === 'SOURCE_CAST_RESOURCE_COST' && (item.valueType !== 'DECIMAL' || item.valueMode !== 'RUNTIME_INPUT'),
                label: `${item.name}（${item.parameterKey} / ${SKILL_TRIGGER_VALUE_TYPE_LABELS[item.valueType]}）`
              }))}
              onChange={(value) => setCurrent({ ...current, parameterKey: String(value ?? '') })}
            />
          </Form.Item>
          <Form.Item label="来源种类" required extra={originalSourceType ? '已有绑定不能更改来源种类；请删除后以新标识新增。' : undefined}>
            <Select
              aria-label="来源种类"
              value={current.sourceType}
              disabled={disabled || Boolean(originalSourceType)}
              options={SKILL_TRIGGER_SOURCE_TYPES
                .filter((value) => value !== 'SOURCE_CAST_RESOURCE_COST' || allowsSourceCastResourceCost(eventSource) || originalSourceType === value)
                .filter((value) => value !== 'EVENT_VALUE' || allowedValues.length > 0)
                .filter((value) => value !== 'PRIOR_ACTION_RESULT' || earlierActions.length > 0)
                .map((value) => ({ value, label: SKILL_TRIGGER_SOURCE_TYPE_LABELS[value] }))}
              onChange={(value) => {
                setSelectedOutputKind(null);
                setCurrent(switchBindingSourceType(current, value as SkillTriggerRuntimeInputSourceType));
              }}
            />
          </Form.Item>

          {current.sourceType === 'SOURCE_CAST_RESOURCE_COST' ? (
            <>
              <Alert type="info" content="读取本次命中所属原始施放的资源消耗，来源技能沿用事件选择；该值为非负十进制，真实零消耗与缺少上下文不同。" />
              {sourceCostError ? <Alert type="warning" content={sourceCostError} /> : null}
              <Form.Item label="消耗属性" required>
                <Select
                  aria-label="消耗属性"
                  value={current.detail.attributeKey || undefined}
                  disabled={disabled || attributesLoadState !== 'ready'}
                  options={attributes.map((item) => ({ value: item.attributeKey, label: `${item.name}（${item.attributeKey}）${item.status === 'DISABLED' ? '（已停用）' : ''}` }))}
                  onChange={(value) => setCurrent({ ...current, detail: { attributeKey: String(value ?? '') } })}
                />
              </Form.Item>
              <Button disabled={disabled || attributesLoadState === 'loading'} loading={attributesLoadState === 'loading'} onClick={() => void onRetryAttributes()}>刷新属性目录</Button>
            </>
          ) : null}

          {current.sourceType === 'INTERNAL_STATE' ? (
            <>
              <Form.Item label="内部状态" required>
                <Select
                  aria-label="绑定内部状态"
                  value={current.detail.stateKey || undefined}
                  disabled={disabled}
                  options={internalStates.map((item) => ({
                    value: item.stateKey,
                    label: item.name || item.stateKey
                  }))}
                  onChange={(value) => {
                    const nextState = internalStates.find((item) => item.stateKey === value);
                    const kinds = valueKindsForInternalState(nextState?.stateType ?? null);
                    if (current.sourceType !== 'INTERNAL_STATE') return;
                    setCurrent(patchInternalStateBindingDetail(current, {
                      stateKey: String(value ?? ''),
                      valueKind: kinds[0] ?? 'VALUE',
                      optionKey: null
                    }));
                  }}
                />
              </Form.Item>
              <Form.Item label="取值方式" required>
                <Select
                  aria-label="绑定内部状态取值"
                  value={current.detail.valueKind}
                  disabled={disabled}
                  options={valueKindsForInternalState(selectedState?.stateType ?? null).map((value) => ({
                    value,
                    label: SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS[value]
                  }))}
                  onChange={(value) => {
                    if (current.sourceType !== 'INTERNAL_STATE') return;
                    setCurrent(patchInternalStateBindingDetail(current, {
                      valueKind: value as SkillTriggerInternalStateValueKind,
                      optionKey: value === 'OPTION_SELECTED' ? current.detail.optionKey : null
                    }));
                  }}
                />
              </Form.Item>
              {current.detail.valueKind === 'OPTION_SELECTED' ? (
                <Form.Item label="模式选项" required>
                  <Select
                    aria-label="绑定模式选项"
                    value={current.detail.optionKey || undefined}
                    disabled={disabled}
                    options={(selectedState?.stateType === 'MODE' ? selectedState.detail.options : []).map((item) => ({
                      value: item.optionKey,
                      label: item.name || item.optionKey
                    }))}
                    onChange={(value) => {
                      if (current.sourceType !== 'INTERNAL_STATE') return;
                      setCurrent(patchInternalStateBindingDetail(current, {
                        optionKey: String(value ?? '')
                      }));
                    }}
                  />
                </Form.Item>
              ) : null}
            </>
          ) : null}

          {current.sourceType === 'COMBAT_STATUS' ? (
            <>
              <Form.Item label="对象" required>
                <Select
                  aria-label="战斗状态对象"
                  value={current.detail.subject}
                  disabled={disabled}
                  options={subjectOptions.map((value) => ({
                    value,
                    label: SKILL_TRIGGER_SUBJECT_LABELS[value]
                  }))}
                  onChange={(value) => {
                    if (current.sourceType !== 'COMBAT_STATUS') return;
                    setCurrent(patchCombatStatusBinding(current, {
                      subject: value as SkillTriggerSubject
                    }));
                  }}
                />
              </Form.Item>
              <Form.Item label="状态" required>
                <Select
                  aria-label="战斗状态"
                  value={current.detail.statusKey || undefined}
                  disabled={disabled}
                  options={statuses.map((item) => ({
                    value: item.statusKey,
                    label: item.name || item.statusKey
                  }))}
                  onChange={(value) => {
                    if (current.sourceType !== 'COMBAT_STATUS') return;
                    setCurrent(patchCombatStatusBinding(current, {
                      statusKey: String(value ?? '')
                    }));
                  }}
                />
              </Form.Item>
              <Form.Item label="取值" required>
                <Select
                  aria-label="战斗状态取值"
                  value={current.detail.valueKind}
                  disabled={disabled}
                  options={(['PRESENT', 'STACKS', 'REMAINING_MS'] as SkillTriggerCombatStatusValueKind[]).map((value) => ({
                    value,
                    label: SKILL_TRIGGER_COMBAT_STATUS_VALUE_LABELS[value]
                  }))}
                  onChange={(value) => {
                    if (current.sourceType !== 'COMBAT_STATUS') return;
                    setCurrent(patchCombatStatusValueKind(
                      current,
                      value as SkillTriggerCombatStatusValueKind
                    ));
                  }}
                />
              </Form.Item>
              {current.detail.valueKind !== 'PRESENT' ? (
                <>
                  <Form.Item label="生命周期效果" required>
                    <Select
                      aria-label="绑定生命周期效果"
                      value={current.detail.sourceEffectKey || undefined}
                      disabled={disabled}
                      options={effects.filter((item) => item.lifecycle !== null).map((item) => ({
                        value: item.effectKey,
                        label: item.name || item.effectKey
                      }))}
                      onChange={(value) => {
                        if (current.sourceType !== 'COMBAT_STATUS') return;
                        setCurrent(patchCombatStatusMeasuredFields(current, {
                          sourceEffectKey: String(value ?? ''),
                          sourceResultKey: ''
                        }));
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="状态施加结果" required>
                    <Select
                      aria-label="绑定状态施加结果"
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
                      onChange={(value) => {
                        if (current.sourceType !== 'COMBAT_STATUS') return;
                        setCurrent(patchCombatStatusMeasuredFields(current, {
                          sourceResultKey: String(value ?? '')
                        }));
                      }}
                    />
                  </Form.Item>
                </>
              ) : null}
            </>
          ) : null}

          {current.sourceType === 'EVENT_VALUE' ? (
            <Form.Item label="当前事件值" required extra={eventValueHint(current.detail.eventValueKey)}>
              <Select
                aria-label="绑定事件值"
                value={current.detail.eventValueKey}
                disabled={disabled}
                options={allowedValues.map((value: SkillTriggerEventValueKey) => ({
                  value,
                  label: eventValueOptionLabel(value)
                }))}
                onChange={(value) => setCurrent({
                  ...current,
                  detail: { eventValueKey: value }
                })}
              />
            </Form.Item>
          ) : null}

          {current.sourceType === 'PRIOR_ACTION_RESULT' ? (
            <>
              <Form.Item label="来源动作" required>
                <Select
                  aria-label="来源动作"
                  value={current.detail.sourceActionKey || undefined}
                  disabled={disabled || sourceEffectLoading}
                  options={earlierActions.map((item: PriorSourceActionOption) => ({
                    value: item.sourceActionKey,
                    label: `${item.sourceActionName}（${item.sourceActionKey}）`
                  }))}
                  onChange={(value) => {
                    const next = earlierActions.find((item) => item.sourceActionKey === String(value ?? ''));
                    confirmSourceActionChange(next);
                  }}
                />
              </Form.Item>
              <Form.Item label="来源结果" required>
                <Select
                  aria-label="来源结果"
                  value={current.detail.sourceResultKey || undefined}
                  disabled={disabled || sourceEffectLoading || !sourceEffect}
                  options={sourceResults.map((item) => ({
                    value: item.resultKey,
                    label: `${item.name || item.resultKey}（${item.resultKey}）`
                  }))}
                  onChange={(value) => confirmSourceResultChange(String(value ?? ''))}
                />
              </Form.Item>
              <Form.Item
                label="结果输出"
                required
                extra={
                  outputOptions.some((kind) => isBooleanPriorResultOutput(kind))
                    ? SKILL_TRIGGER_PRIOR_BOOLEAN_OUTPUT_HINT
                    : undefined
                }
              >
                <Select
                  aria-label="结果输出"
                  value={effectiveOutputKind ?? undefined}
                  disabled={disabled || sourceEffectLoading || !current.detail.sourceResultKey}
                  options={outputOptions.map((kind: SkillTriggerPriorResultOutputKind) => ({
                    value: kind,
                    label: priorResultOutputLabel(kind)
                  }))}
                  onChange={(value) => {
                    if (current.sourceType !== 'PRIOR_ACTION_RESULT') return;
                    const nextKind = value as SkillTriggerPriorResultOutputKind;
                    setSelectedOutputKind(nextKind);
                    setCurrent(patchPriorResultBinding(current, {
                      outputKind: nextKind
                    }));
                  }}
                />
              </Form.Item>
              {sourceEffectError ? (
                <Alert
                  type="error"
                  content={sourceEffectError}
                  action={
                    <Button
                      size="mini"
                      onClick={() => {
                        if (selectedSourceAction) void loadSourceEffect(selectedSourceAction.sourceEffectKey);
                      }}
                    >
                      重试
                    </Button>
                  }
                />
              ) : null}
            </>
          ) : null}
        </Form>
        {current.sourceType === 'PRIOR_ACTION_RESULT' ? (
          <Alert type="info" content={priorResultDraftSummary(current, effectiveOutputKind)} />
        ) : current.sourceType ? (
          <Alert type="info" content={bindingSummary(current)} />
        ) : null}
      </Space>
    </Modal>
  );
}
