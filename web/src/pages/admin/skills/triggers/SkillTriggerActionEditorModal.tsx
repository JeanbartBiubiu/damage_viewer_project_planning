import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import type { SkillEffect, SkillEffectSummary } from '../../../../types/skillEffect';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillProcessSummary } from '../../../../types/skillProcess';
import type { GameStatus } from '../../../../types/status';
import type {
  SkillTriggerActionType,
  SkillTriggerEventSource,
  SkillTriggerProcessFailureReason,
  SkillTriggerResultModifier,
  SkillTriggerRuntimeInputBinding,
  SkillTriggerTargetContext
} from '../../../../types/skillTriggerRule';
import { SKILL_PROCESS_ACTIVATION_TYPE_LABELS } from '../processes/processForm';
import {
  RESULT_MODIFIER_ORDER_HINT,
  SKILL_TRIGGER_ACTION_TYPE_LABELS,
  SKILL_TRIGGER_ACTION_TYPES,
  SKILL_TRIGGER_FAILURE_REASON_LABELS,
  SKILL_TRIGGER_TARGET_CONTEXT_LABELS,
  actionSummary,
  bindingSummary,
  createEmptyActionDraft,
  evaluateBindingCompleteness,
  hasNumericValueRule,
  switchActionType,
  targetContextOptionsForEvent,
  validateResultModifier,
  type NestedFieldError,
  type SkillTriggerActionDraft
} from './triggerRuleForm';
import { SkillTriggerRuntimeInputBindingEditorModal } from './SkillTriggerRuntimeInputBindingEditorModal';

export type SkillTriggerActionEditorMode = 'create' | 'edit';

type BindingEditorState = {
  mode: 'create' | 'edit';
  index: number | null;
  binding: SkillTriggerRuntimeInputBinding | null;
};

type SkillTriggerActionEditorModalProps = {
  visible: boolean;
  mode: SkillTriggerActionEditorMode;
  draft: SkillTriggerActionDraft | null;
  existingKeys: readonly string[];
  eventSource: SkillTriggerEventSource;
  actions: readonly SkillTriggerActionDraft[];
  currentActionIndex: number;
  effects: readonly SkillEffectSummary[];
  effectDetails: ReadonlyMap<string, SkillEffect>;
  processes: readonly SkillProcessSummary[];
  internalStates: readonly SkillInternalState[];
  statuses: readonly GameStatus[];
  reachableParameters: readonly SkillParameter[];
  fieldErrors: readonly NestedFieldError[];
  disabled?: boolean;
  onClose: () => void;
  onConfirm: (draft: SkillTriggerActionDraft) => void;
  onTargetChange?: (draft: SkillTriggerActionDraft) => void | Promise<void>;
  onEnsureEffect?: (effectKey: string) => Promise<SkillEffect | null>;
};

function titleFor(mode: SkillTriggerActionEditorMode): string {
  return mode === 'create' ? '新增动作' : '编辑动作';
}

export function SkillTriggerActionEditorModal({
  visible,
  mode,
  draft,
  existingKeys,
  eventSource,
  actions,
  currentActionIndex,
  effects,
  effectDetails,
  processes,
  internalStates,
  statuses,
  reachableParameters,
  fieldErrors,
  disabled,
  onClose,
  onConfirm,
  onTargetChange,
  onEnsureEffect
}: SkillTriggerActionEditorModalProps) {
  const [current, setCurrent] = useState<SkillTriggerActionDraft>(
    draft ?? createEmptyActionDraft(existingKeys)
  );
  const [bindingEditor, setBindingEditor] = useState<BindingEditorState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resolvingTarget, setResolvingTarget] = useState(false);
  const targetOptions = targetContextOptionsForEvent(eventSource.eventType);
  const selectedEffect = current.actionType === 'EXECUTE_EFFECT'
    ? effectDetails.get(current.detail.effectKey) ?? null
    : null;
  const selectedProcess = current.actionType !== 'EXECUTE_EFFECT'
    ? processes.find((item) => item.processKey === current.detail.processKey) ?? null
    : null;
  const completeness = evaluateBindingCompleteness(reachableParameters, current.runtimeInputBindings);
  const numericResults = selectedEffect
    ? selectedEffect.results.filter(hasNumericValueRule)
    : [];

  useEffect(() => {
    if (!visible) return;
    setCurrent(draft ?? createEmptyActionDraft(existingKeys));
    setBindingEditor(null);
    setLocalError(null);
    setResolvingTarget(false);
  }, [draft, visible]);

  const errorFor = (suffix: string): string | undefined => (
    fieldErrors.find((item) => item.path.endsWith(suffix))?.message
  );

  const resolveTarget = async (next: SkillTriggerActionDraft) => {
    if (!onTargetChange) return;
    setResolvingTarget(true);
    try {
      await onTargetChange(next);
    } finally {
      setResolvingTarget(false);
    }
  };

  const patchType = (nextType: SkillTriggerActionType) => {
    const next = switchActionType(current, nextType);
    setCurrent(next);
    setLocalError(null);
    void resolveTarget(next);
  };

  const replaceModifiers = (modifiers: SkillTriggerResultModifier[]) => {
    if (current.actionType !== 'EXECUTE_EFFECT') return;
    setCurrent({ ...current, resultModifiers: modifiers });
  };

  const confirm = () => {
    if (current.actionType === 'EXECUTE_EFFECT') {
      for (const modifier of current.resultModifiers) {
        const error = validateResultModifier(modifier);
        if (error) {
          setLocalError(error);
          return;
        }
      }
    }
    onConfirm(current);
  };

  const bindingColumns: TableColumnProps[] = [
    { title: '参数', dataIndex: 'parameterKey' },
    {
      title: '来源',
      render: (_value, record: SkillTriggerRuntimeInputBinding) => bindingSummary(record)
    },
    {
      title: '操作',
      width: 140,
      render: (_value, record: SkillTriggerRuntimeInputBinding, index: number) => (
        <Space size="mini">
          <Button
            size="mini"
            disabled={disabled}
            onClick={() => setBindingEditor({ mode: 'edit', index, binding: record })}
          >
            编辑
          </Button>
          <Button
            size="mini"
            status="danger"
            disabled={disabled}
            onClick={() => setCurrent({
              ...current,
              runtimeInputBindings: current.runtimeInputBindings.filter((_, itemIndex) => itemIndex !== index)
            })}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <>
      <Modal
        title={titleFor(mode)}
        visible={visible}
        maskClosable={!bindingEditor}
        onCancel={onClose}
        style={{ width: 1080 }}
        footer={
          <Space>
            <Button onClick={onClose} disabled={Boolean(bindingEditor)}>取消</Button>
            <Button type="primary" disabled={disabled || Boolean(bindingEditor) || resolvingTarget} onClick={confirm}>确定</Button>
          </Space>
        }
      >
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          {localError ? <Alert type="error" content={localError} /> : null}
          <Alert type="info" content={actionSummary(current)} />
          <Form layout="vertical">
            <Form.Item label="动作种类" required>
              <Select
                aria-label="动作种类"
                value={current.actionType}
                disabled={disabled}
                options={SKILL_TRIGGER_ACTION_TYPES.map((value) => ({
                  value,
                  label: SKILL_TRIGGER_ACTION_TYPE_LABELS[value]
                }))}
                onChange={(value) => patchType(value as SkillTriggerActionType)}
              />
            </Form.Item>
            <Form.Item
              label="动作标识"
              required
              validateStatus={errorFor('actionKey') ? 'error' : undefined}
              help={errorFor('actionKey')}
            >
              <Input
                aria-label="动作标识"
                value={current.actionKey}
                disabled={disabled || mode === 'edit'}
                maxLength={64}
                onChange={(value) => setCurrent({ ...current, actionKey: value })}
              />
            </Form.Item>
            <Form.Item label="动作名称" required>
              <Input
                aria-label="动作名称"
                value={current.name}
                disabled={disabled}
                maxLength={100}
                onChange={(value) => setCurrent({ ...current, name: value })}
              />
            </Form.Item>
            <Form.Item label="排序" required>
              <Input
                aria-label="动作排序"
                value={current.sortOrder}
                disabled={disabled}
                onChange={(value) => setCurrent({ ...current, sortOrder: value })}
              />
            </Form.Item>

            {current.actionType !== 'FAIL_PROCESS' ? (
              <Form.Item label="目标对象" required>
                <Select
                  aria-label="目标对象"
                  value={current.targetContext ?? undefined}
                  disabled={disabled}
                  options={targetOptions.map((value) => ({
                    value,
                    label: SKILL_TRIGGER_TARGET_CONTEXT_LABELS[value]
                  }))}
                  onChange={(value) => setCurrent({
                    ...current,
                    targetContext: value as SkillTriggerTargetContext
                  })}
                />
              </Form.Item>
            ) : null}

            {current.actionType === 'EXECUTE_EFFECT' ? (
              <Form.Item label="目标效果" required>
                <Select
                  aria-label="目标效果"
                  value={current.detail.effectKey || undefined}
                  disabled={disabled}
                  options={effects.map((item) => ({
                    value: item.effectKey,
                    label: item.name || item.effectKey
                  }))}
                  onChange={(value) => {
                    const next = {
                      ...current,
                      detail: { effectKey: String(value ?? '') },
                      runtimeInputBindings: [],
                      resultModifiers: []
                    };
                    setCurrent(next);
                    void resolveTarget(next);
                  }}
                />
              </Form.Item>
            ) : null}

            {current.actionType === 'START_PROCESS' ? (
              <Form.Item
                label="目标过程"
                required
                extra={
                  selectedProcess
                    ? `启动方式：${SKILL_PROCESS_ACTIVATION_TYPE_LABELS[selectedProcess.activationType]}`
                    : undefined
                }
              >
                <Select
                  aria-label="目标过程"
                  value={current.detail.processKey || undefined}
                  disabled={disabled}
                  options={processes.map((item) => ({
                    value: item.processKey,
                    label: item.name || item.processKey
                  }))}
                  onChange={(value) => {
                    const next = {
                      ...current,
                      detail: { processKey: String(value ?? '') },
                      runtimeInputBindings: []
                    };
                    setCurrent(next);
                    void resolveTarget(next);
                  }}
                />
              </Form.Item>
            ) : null}

            {current.actionType === 'FAIL_PROCESS' ? (
              <>
                <Form.Item
                  label="目标过程"
                  required
                  extra={
                    selectedProcess
                      ? `启动方式：${SKILL_PROCESS_ACTIVATION_TYPE_LABELS[selectedProcess.activationType]}`
                      : undefined
                  }
                >
                  <Select
                    aria-label="目标过程"
                    value={current.detail.processKey || undefined}
                    disabled={disabled}
                    options={processes.map((item) => ({
                      value: item.processKey,
                      label: item.name || item.processKey
                    }))}
                    onChange={(value) => setCurrent({
                      ...current,
                      detail: {
                        processKey: String(value ?? ''),
                        failureReason: current.detail.failureReason
                      }
                    })}
                  />
                </Form.Item>
                <Form.Item label="失败原因" required>
                  <Select
                    aria-label="失败原因"
                    value={current.detail.failureReason}
                    disabled={disabled}
                    options={(Object.keys(SKILL_TRIGGER_FAILURE_REASON_LABELS) as SkillTriggerProcessFailureReason[])
                      .map((value) => ({
                        value,
                        label: SKILL_TRIGGER_FAILURE_REASON_LABELS[value]
                      }))}
                    onChange={(value) => setCurrent({
                      ...current,
                      detail: {
                        processKey: current.detail.processKey,
                        failureReason: value as SkillTriggerProcessFailureReason
                      }
                    })}
                  />
                </Form.Item>
              </>
            ) : null}
          </Form>

          {current.actionType !== 'FAIL_PROCESS' ? (
            <>
              <Space>
                <span>动态输入来源绑定</span>
                <Button
                  size="mini"
                  disabled={disabled || resolvingTarget}
                  onClick={() => setBindingEditor({ mode: 'create', index: null, binding: null })}
                >
                  新增绑定
                </Button>
              </Space>
              {completeness.some((item) => item.missing || item.extra || item.duplicate || item.typeCompatible === false)
                ? <Alert type="warning" content="绑定与可达参数不一致。" />
                : null}
              <Table
                size="small"
                pagination={false}
                rowKey={(record: SkillTriggerRuntimeInputBinding) => record.bindingKey}
                columns={bindingColumns}
                data={current.runtimeInputBindings}
              />
            </>
          ) : null}

          {current.actionType === 'EXECUTE_EFFECT' ? (
            <>
              <span>固定结果修正</span>
              <Table
                size="small"
                pagination={false}
                rowKey={(record: SkillTriggerResultModifier) => record.resultKey}
                data={current.resultModifiers}
                columns={[
                  {
                    title: '结果',
                    dataIndex: 'resultKey',
                    render: (value: string) => numericResults.find((item) => item.resultKey === value)?.name || value
                  },
                  {
                    title: '额外固定倍率',
                    render: (_value, record: SkillTriggerResultModifier, index: number) => (
                      <InputNumber
                        value={record.fixedMultiplier ?? undefined}
                        disabled={disabled}
                        min={0}
                        onChange={(value) => {
                          const next = [...current.resultModifiers];
                          next[index] = { ...record, fixedMultiplier: typeof value === 'number' ? value : null };
                          replaceModifiers(next);
                        }}
                      />
                    )
                  },
                  {
                    title: '额外固定最小值',
                    render: (_value, record: SkillTriggerResultModifier, index: number) => (
                      <InputNumber
                        value={record.fixedMinValue ?? undefined}
                        disabled={disabled}
                        onChange={(value) => {
                          const next = [...current.resultModifiers];
                          next[index] = { ...record, fixedMinValue: typeof value === 'number' ? value : null };
                          replaceModifiers(next);
                        }}
                      />
                    )
                  },
                  {
                    title: '额外固定最大值',
                    render: (_value, record: SkillTriggerResultModifier, index: number) => (
                      <InputNumber
                        value={record.fixedMaxValue ?? undefined}
                        disabled={disabled}
                        onChange={(value) => {
                          const next = [...current.resultModifiers];
                          next[index] = { ...record, fixedMaxValue: typeof value === 'number' ? value : null };
                          replaceModifiers(next);
                        }}
                      />
                    )
                  },
                  {
                    title: '操作',
                    width: 80,
                    render: (_value, _record, index: number) => (
                      <Button
                        size="mini"
                        status="danger"
                        disabled={disabled}
                        onClick={() => replaceModifiers(
                          current.resultModifiers.filter((_, itemIndex) => itemIndex !== index)
                        )}
                      >
                        删除
                      </Button>
                    )
                  }
                ]}
              />
              <Form.Item extra={RESULT_MODIFIER_ORDER_HINT}>
                <Select
                  aria-label="新增结果修正"
                  placeholder="选择具有数值规则的结果"
                  disabled={disabled}
                  value={undefined}
                  options={numericResults
                    .filter((item) => !current.resultModifiers.some((modifier) => modifier.resultKey === item.resultKey))
                    .map((item) => ({ value: item.resultKey, label: item.name || item.resultKey }))}
                  onChange={(value) => replaceModifiers([
                    ...current.resultModifiers,
                    {
                      resultKey: String(value ?? ''),
                      fixedMultiplier: null,
                      fixedMinValue: null,
                      fixedMaxValue: null
                    }
                  ])}
                />
              </Form.Item>
            </>
          ) : null}
        </Space>
      </Modal>

      <SkillTriggerRuntimeInputBindingEditorModal
        visible={bindingEditor !== null}
        mode={bindingEditor?.mode ?? 'create'}
        binding={bindingEditor?.binding ?? null}
        existingBindingKeys={current.runtimeInputBindings.map((item) => item.bindingKey)}
        reachableParameters={reachableParameters}
        currentBindings={current.runtimeInputBindings}
        eventSource={eventSource}
        actions={actions}
        currentActionIndex={currentActionIndex}
        internalStates={internalStates}
        statuses={statuses}
        effects={[...effectDetails.values()]}
        effectsByKey={effectDetails}
        disabled={disabled}
        onClose={() => setBindingEditor(null)}
        onEnsureEffect={onEnsureEffect}
        onConfirm={(nextBinding) => {
          if (bindingEditor?.mode === 'edit' && bindingEditor.index !== null) {
            setCurrent({
              ...current,
              runtimeInputBindings: current.runtimeInputBindings.map((item, index) => (
                index === bindingEditor.index ? nextBinding : item
              ))
            });
          } else {
            setCurrent({
              ...current,
              runtimeInputBindings: [...current.runtimeInputBindings, nextBinding]
            });
          }
          setBindingEditor(null);
        }}
      />
    </>
  );
}
