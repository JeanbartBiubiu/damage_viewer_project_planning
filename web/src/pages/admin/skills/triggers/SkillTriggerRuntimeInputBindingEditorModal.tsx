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
import { useEffect, useMemo, useState } from 'react';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { GameStatus } from '../../../../types/status';
import type {
  SkillTriggerCombatStatusValueKind,
  SkillTriggerEventSource,
  SkillTriggerEventValueKey,
  SkillTriggerInternalStateValueKind,
  SkillTriggerRuntimeInputBinding,
  SkillTriggerRuntimeInputSourceType,
  SkillTriggerSubject
} from '../../../../types/skillTriggerRule';
import {
  PRIOR_RESULT_OUTPUT_LABEL,
  SKILL_TRIGGER_COMBAT_STATUS_VALUE_LABELS,
  SKILL_TRIGGER_EVENT_VALUE_LABELS,
  SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS,
  SKILL_TRIGGER_SOURCE_TYPE_LABELS,
  SKILL_TRIGGER_SOURCE_TYPES,
  SKILL_TRIGGER_SUBJECT_LABELS,
  SKILL_TRIGGER_VALUE_TYPE_LABELS,
  allowedEventValuesFor,
  bindingSummary,
  createEmptyBinding,
  evaluateBindingCompleteness,
  listImmediatePriorResults,
  patchCombatStatusBinding,
  patchCombatStatusMeasuredFields,
  patchCombatStatusValueKind,
  patchInternalStateBindingDetail,
  persistentStatusApplyResults,
  subjectOptionsForEvent,
  switchBindingSourceType,
  valueKindsForInternalState,
  type ImmediatePriorResult,
  type SkillTriggerActionDraft
} from './triggerRuleForm';

export type SkillTriggerRuntimeInputBindingEditorMode = 'create' | 'edit';

type SkillTriggerRuntimeInputBindingEditorModalProps = {
  visible: boolean;
  mode: SkillTriggerRuntimeInputBindingEditorMode;
  binding: SkillTriggerRuntimeInputBinding | null;
  existingBindingKeys: readonly string[];
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
  onConfirm
}: SkillTriggerRuntimeInputBindingEditorModalProps) {
  const [current, setCurrent] = useState<SkillTriggerRuntimeInputBinding>(
    binding ?? emptyBinding(existingBindingKeys)
  );
  const allowedValues = allowedEventValuesFor(eventSource);
  const subjectOptions = subjectOptionsForEvent(eventSource.eventType);
  const priorResults = useMemo(
    () => listImmediatePriorResults(actions, currentActionIndex, effectsByKey),
    [actions, currentActionIndex, effectsByKey]
  );
  const completeness = evaluateBindingCompleteness(reachableParameters, currentBindings);
  const selectedState = current.sourceType === 'INTERNAL_STATE'
    ? internalStates.find((item) => item.stateKey === current.detail.stateKey) ?? null
    : null;

  useEffect(() => {
    if (!visible) return;
    setCurrent(binding ?? emptyBinding(existingBindingKeys));
  }, [binding, visible]);

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
          <Button type="primary" disabled={disabled} onClick={() => onConfirm(current)}>确定</Button>
        </Space>
      }
    >
      <Space direction="vertical" size="medium" style={{ width: '100%' }}>
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
                label: `${item.name}（${item.parameterKey} / ${SKILL_TRIGGER_VALUE_TYPE_LABELS[item.valueType]}）`
              }))}
              onChange={(value) => setCurrent({ ...current, parameterKey: String(value ?? '') })}
            />
          </Form.Item>
          <Form.Item label="来源种类" required>
            <Select
              aria-label="来源种类"
              value={current.sourceType}
              disabled={disabled}
              options={SKILL_TRIGGER_SOURCE_TYPES
                .filter((value) => value !== 'EVENT_VALUE' || allowedValues.length > 0)
                .filter((value) => value !== 'PRIOR_ACTION_RESULT' || priorResults.length > 0)
                .map((value) => ({ value, label: SKILL_TRIGGER_SOURCE_TYPE_LABELS[value] }))}
              onChange={(value) => setCurrent(
                switchBindingSourceType(current, value as SkillTriggerRuntimeInputSourceType)
              )}
            />
          </Form.Item>

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
            <Form.Item label="当前事件值" required>
              <Select
                aria-label="绑定事件值"
                value={current.detail.eventValueKey}
                disabled={disabled}
                options={allowedValues.map((value: SkillTriggerEventValueKey) => ({
                  value,
                  label: SKILL_TRIGGER_EVENT_VALUE_LABELS[value]
                }))}
                onChange={(value) => setCurrent({
                  ...current,
                  detail: { eventValueKey: value }
                })}
              />
            </Form.Item>
          ) : null}

          {current.sourceType === 'PRIOR_ACTION_RESULT' ? (
            <Form.Item label="更早动作基础结果" required extra={PRIOR_RESULT_OUTPUT_LABEL}>
              <Select
                aria-label="前序基础结果"
                value={
                  current.detail.sourceActionKey && current.detail.sourceResultKey
                    ? `${current.detail.sourceActionKey}::${current.detail.sourceResultKey}`
                    : undefined
                }
                disabled={disabled}
                options={priorResults.map((item: ImmediatePriorResult) => ({
                  value: `${item.sourceActionKey}::${item.sourceResultKey}`,
                  label: `${item.sourceActionName} / ${item.sourceResultName} / ${PRIOR_RESULT_OUTPUT_LABEL}`
                }))}
                onChange={(value) => {
                  const [sourceActionKey, sourceResultKey] = String(value ?? '').split('::');
                  setCurrent({
                    ...current,
                    detail: {
                      sourceActionKey: sourceActionKey ?? '',
                      sourceResultKey: sourceResultKey ?? '',
                      outputKind: 'CONFIGURED_VALUE'
                    }
                  });
                }}
              />
            </Form.Item>
          ) : null}
        </Form>
        {current.sourceType ? (
          <Alert type="info" content={bindingSummary(current)} />
        ) : null}
      </Space>
    </Modal>
  );
}
