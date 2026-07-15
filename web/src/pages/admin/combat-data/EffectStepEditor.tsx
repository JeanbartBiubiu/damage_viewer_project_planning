import { Form, Input, InputNumber, Select, Typography } from '@arco-design/web-react';
import {
  EFFECT_STEP_DETAIL_KEYS,
  type EffectStepDetailKey,
  assertExactlyOneEffectDetail,
  buildEffectStepPutBody
} from '../../../services/adminPayload';
import type { ResourceFormValues } from './resourceRegistry';

export const EFFECT_DETAIL_FAMILY_OPTIONS: { label: string; value: EffectStepDetailKey }[] = [
  { value: 'damageDetail', label: '伤害 (damageDetail)' },
  { value: 'healDetail', label: '治疗 (healDetail)' },
  { value: 'resourceDetail', label: '资源 (resourceDetail)' },
  { value: 'attributeDetail', label: '属性 (attributeDetail)' },
  { value: 'shieldDetail', label: '护盾 (shieldDetail)' },
  { value: 'providerDetail', label: 'Provider (providerDetail)' },
  { value: 'eventDetail', label: '事件 (eventDetail)' },
  { value: 'abilityControlDetail', label: '技能控制 (abilityControlDetail)' },
  { value: 'stateDetail', label: '状态 (stateDetail)' },
  { value: 'repeatDetail', label: '重复 (repeatDetail)' },
  { value: 'executeDetail', label: '处决阈值 (executeDetail)' }
];

type DetailFieldDef = {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'json';
  required?: boolean;
};

const DETAIL_FIELDS: Record<EffectStepDetailKey, DetailFieldDef[]> = {
  damageDetail: [
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'damageTypeId', label: '伤害类型 ID', kind: 'number', required: true },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true }
  ],
  healDetail: [
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true }
  ],
  resourceDetail: [
    { name: 'resourceKey', label: '资源 Key', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true }
  ],
  attributeDetail: [
    { name: 'attrKey', label: '属性 Key', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true }
  ],
  shieldDetail: [
    { name: 'shieldRef', label: '护盾引用', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text' },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true }
  ],
  providerDetail: [
    { name: 'actionTypeId', label: '动作类型 ID', kind: 'number', required: true },
    { name: 'targetProviderId', label: '目标 Provider ID', kind: 'text', required: true },
    { name: 'stacksFormulaKey', label: '层数公式 Key', kind: 'text' },
    { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text' }
  ],
  eventDetail: [
    { name: 'eventTypeId', label: '事件类型 ID', kind: 'number', required: true },
    { name: 'eventRef', label: '事件引用', kind: 'text' },
    { name: 'payload', label: 'Payload JSON', kind: 'json' }
  ],
  abilityControlDetail: [
    { name: 'actionTypeId', label: '动作类型 ID', kind: 'number', required: true },
    { name: 'targetAbilityId', label: '目标 Ability ID', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text' },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number' }
  ],
  stateDetail: [
    { name: 'stateScopeTypeId', label: '状态作用域类型 ID', kind: 'number', required: true },
    { name: 'stateKey', label: '状态 Key', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true }
  ],
  repeatDetail: [
    { name: 'repeatScopeTypeId', label: '重复作用域类型 ID', kind: 'number', required: true },
    { name: 'repeatCount', label: '重复次数', kind: 'number', required: true },
    { name: 'repeatTag', label: '重复标签', kind: 'text', required: true },
    { name: 'triggerStateKey', label: '触发状态 Key', kind: 'text', required: true },
    { name: 'threshold', label: '阈值', kind: 'number', required: true }
  ],
  executeDetail: [{ name: 'threshold', label: '生命比例阈值', kind: 'number', required: true }]
};

export type EffectStepEditorState = {
  common: ResourceFormValues;
  detailFamily: EffectStepDetailKey;
  detail: ResourceFormValues;
};

type EffectStepEditorProps = {
  value: EffectStepEditorState;
  readOnly?: boolean;
  lockPathKeys?: boolean;
  onChange: (next: EffectStepEditorState) => void;
};

function emptyDetail(family: EffectStepDetailKey): ResourceFormValues {
  const detail: ResourceFormValues = {};
  for (const field of DETAIL_FIELDS[family]) {
    detail[field.name] = field.kind === 'json' ? '{}' : '';
  }
  return detail;
}

export function createEmptyEffectStepEditorState(): EffectStepEditorState {
  return {
    common: {
      stepId: '',
      sequenceId: '',
      stepOrder: 0,
      operationTypeId: '',
      targetSelectorTypeId: '',
      conditionFormulaKey: ''
    },
    detailFamily: 'damageDetail',
    detail: emptyDetail('damageDetail')
  };
}

export function recordToEffectStepEditorState(record: Record<string, unknown>): EffectStepEditorState {
  const family =
    EFFECT_STEP_DETAIL_KEYS.find((key) => record[key] != null) ?? ('damageDetail' as EffectStepDetailKey);
  const detailSource =
    record[family] && typeof record[family] === 'object' && !Array.isArray(record[family])
      ? (record[family] as Record<string, unknown>)
      : {};
  const detail = emptyDetail(family);
  for (const field of DETAIL_FIELDS[family]) {
    const value = detailSource[field.name];
    if (value === undefined || value === null) {
      continue;
    }
    if (field.kind === 'json') {
      detail[field.name] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } else if (field.kind === 'number') {
      detail[field.name] = typeof value === 'number' ? value : String(value);
    } else {
      detail[field.name] = String(value);
    }
  }

  return {
    common: {
      stepId: String(record.stepId ?? ''),
      sequenceId: String(record.sequenceId ?? ''),
      stepOrder: typeof record.stepOrder === 'number' ? record.stepOrder : Number(record.stepOrder ?? 0),
      operationTypeId:
        typeof record.operationTypeId === 'number' ? record.operationTypeId : String(record.operationTypeId ?? ''),
      targetSelectorTypeId:
        typeof record.targetSelectorTypeId === 'number'
          ? record.targetSelectorTypeId
          : String(record.targetSelectorTypeId ?? ''),
      conditionFormulaKey: String(record.conditionFormulaKey ?? '')
    },
    detailFamily: family,
    detail
  };
}

function parseDetailValue(field: DetailFieldDef, raw: string | number | boolean): unknown {
  if (field.kind === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label} 必须是有效数字`);
    }
    return parsed;
  }
  if (field.kind === 'json') {
    const text = String(raw ?? '').trim();
    if (!text) {
      return undefined;
    }
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${field.label} 需要是 JSON 对象`);
    }
    return parsed;
  }
  return String(raw ?? '').trim();
}

export function buildEffectStepPutFromEditor(state: EffectStepEditorState): {
  sequenceId: string;
  stepOrder: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  conditionFormulaKey?: string;
  [detailKey: string]: unknown;
} {
  const { common, detailFamily, detail } = state;

  const stepId = String(common.stepId ?? '').trim();
  const sequenceId = String(common.sequenceId ?? '').trim();
  if (!stepId) {
    throw new Error('请填写步骤 ID');
  }
  if (!sequenceId) {
    throw new Error('请填写序列 ID');
  }

  const stepOrder =
    typeof common.stepOrder === 'number' ? common.stepOrder : Number(String(common.stepOrder ?? '').trim());
  const operationTypeId =
    typeof common.operationTypeId === 'number'
      ? common.operationTypeId
      : Number(String(common.operationTypeId ?? '').trim());
  const targetSelectorTypeId =
    typeof common.targetSelectorTypeId === 'number'
      ? common.targetSelectorTypeId
      : Number(String(common.targetSelectorTypeId ?? '').trim());

  if (!Number.isFinite(stepOrder)) {
    throw new Error('步骤顺序必须是有效数字');
  }
  if (!Number.isFinite(operationTypeId)) {
    throw new Error('操作类型 ID 必须是有效数字');
  }
  if (!Number.isFinite(targetSelectorTypeId)) {
    throw new Error('目标选择器类型 ID 必须是有效数字');
  }

  const detailBody: Record<string, unknown> = {};
  for (const field of DETAIL_FIELDS[detailFamily]) {
    const raw = detail[field.name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (field.required) {
        throw new Error(`请填写 ${field.label}`);
      }
      continue;
    }
    const parsed = parseDetailValue(field, raw);
    if (parsed !== undefined) {
      detailBody[field.name] = parsed;
    }
  }

  const conditionFormulaKey = String(common.conditionFormulaKey ?? '').trim();
  const commonBody: Record<string, unknown> = {
    sequenceId,
    stepOrder,
    operationTypeId,
    targetSelectorTypeId,
    ...(conditionFormulaKey ? { conditionFormulaKey } : {})
  };

  const body = buildEffectStepPutBody(commonBody, detailFamily, detailBody);
  assertExactlyOneEffectDetail(body);
  return body as {
    sequenceId: string;
    stepOrder: number;
    operationTypeId: number;
    targetSelectorTypeId: number;
    conditionFormulaKey?: string;
    [detailKey: string]: unknown;
  };
}

export function EffectStepEditor({ value, readOnly = false, lockPathKeys = false, onChange }: EffectStepEditorProps) {
  const updateCommon = (name: string, nextValue: string | number) => {
    onChange({
      ...value,
      common: {
        ...value.common,
        [name]: nextValue
      }
    });
  };

  const updateDetail = (name: string, nextValue: string | number) => {
    onChange({
      ...value,
      detail: {
        ...value.detail,
        [name]: nextValue
      }
    });
  };

  const switchFamily = (family: EffectStepDetailKey) => {
    onChange({
      ...value,
      detailFamily: family,
      detail: emptyDetail(family)
    });
  };

  return (
    <Form layout="vertical">
      <Form.Item label="步骤 ID" required>
        <Input
          value={String(value.common.stepId ?? '')}
          disabled={readOnly || lockPathKeys}
          onChange={(next) => updateCommon('stepId', next)}
          placeholder="step_..."
        />
      </Form.Item>
      <Form.Item label="序列 ID" required>
        <Input
          value={String(value.common.sequenceId ?? '')}
          disabled={readOnly}
          onChange={(next) => updateCommon('sequenceId', next)}
          placeholder="seq_..."
        />
      </Form.Item>
      <Form.Item label="步骤顺序" required>
        <InputNumber
          value={
            value.common.stepOrder === '' || value.common.stepOrder === undefined
              ? undefined
              : Number(value.common.stepOrder)
          }
          disabled={readOnly}
          onChange={(next) => updateCommon('stepOrder', next ?? 0)}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="操作类型 ID" required>
        <InputNumber
          value={
            value.common.operationTypeId === '' || value.common.operationTypeId === undefined
              ? undefined
              : Number(value.common.operationTypeId)
          }
          disabled={readOnly}
          onChange={(next) => updateCommon('operationTypeId', next ?? '')}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="目标选择器类型 ID" required>
        <InputNumber
          value={
            value.common.targetSelectorTypeId === '' || value.common.targetSelectorTypeId === undefined
              ? undefined
              : Number(value.common.targetSelectorTypeId)
          }
          disabled={readOnly}
          onChange={(next) => updateCommon('targetSelectorTypeId', next ?? '')}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="条件公式 Key">
        <Input
          value={String(value.common.conditionFormulaKey ?? '')}
          disabled={readOnly}
          onChange={(next) => updateCommon('conditionFormulaKey', next)}
          placeholder="可选"
        />
      </Form.Item>

      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        Detail 家族（十一选一，切换时会清空其他 detail）
      </Typography.Text>
      <Form.Item label="Detail 家族" required>
        <Select
          value={value.detailFamily}
          disabled={readOnly}
          options={EFFECT_DETAIL_FAMILY_OPTIONS}
          onChange={(next) => switchFamily(next as EffectStepDetailKey)}
        />
      </Form.Item>

      {DETAIL_FIELDS[value.detailFamily].map((field) => (
        <Form.Item key={field.name} label={field.label} required={field.required}>
          {field.kind === 'number' ? (
            <InputNumber
              value={
                value.detail[field.name] === '' || value.detail[field.name] === undefined
                  ? undefined
                  : Number(value.detail[field.name])
              }
              disabled={readOnly}
              onChange={(next) => updateDetail(field.name, next ?? '')}
              style={{ width: '100%' }}
            />
          ) : field.kind === 'json' ? (
            <Input.TextArea
              value={String(value.detail[field.name] ?? '')}
              disabled={readOnly}
              autoSize={{ minRows: 3, maxRows: 8 }}
              onChange={(next) => updateDetail(field.name, next)}
              placeholder="{}"
            />
          ) : (
            <Input
              value={String(value.detail[field.name] ?? '')}
              disabled={readOnly}
              onChange={(next) => updateDetail(field.name, next)}
            />
          )}
        </Form.Item>
      ))}
    </Form>
  );
}
