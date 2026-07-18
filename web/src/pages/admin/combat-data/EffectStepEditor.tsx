import { Form, Input, InputNumber, Select, Typography } from '@arco-design/web-react';
import type { ReactNode } from 'react';
import {
  EFFECT_STEP_DETAIL_KEYS,
  type EffectStepDetailKey,
  assertExactlyOneEffectDetail,
  buildEffectStepPutBody
} from '../../../services/adminPayload';
import type { ProviderFormula } from '../../../types/combatData';
import {
  buildReferenceOptions,
  type ResourceFormValues
} from './resourceRegistry';

/** Detail families whose amountFormulaKey is eligible for provider-scoped Select assistance. */
const AMOUNT_FORMULA_ASSISTANCE_FAMILIES = new Set<EffectStepDetailKey>([
  'damageDetail',
  'healDetail',
  'resourceDetail',
  'attributeDetail',
  'shieldDetail',
  'abilityControlDetail',
  'stateDetail'
]);

/**
 * Pure eligibility for provider-scoped formula Select assistance on Effect Step Setup.
 * Does NOT treat every *FormulaKey as eligible — durationFormulaKey fields stay raw Inputs.
 */
export function isEffectStepProviderFormulaAssistanceEligible(
  location: 'common' | EffectStepDetailKey,
  fieldName: string
): boolean {
  if (location === 'common') {
    return fieldName === 'conditionFormulaKey';
  }
  if (fieldName === 'amountFormulaKey') {
    return AMOUNT_FORMULA_ASSISTANCE_FAMILIES.has(location);
  }
  if (fieldName === 'stacksFormulaKey') {
    return location === 'providerDetail';
  }
  return false;
}

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
  /** When set, friendly semantic mode can supply typeKey options for this field. */
  semanticTypeField?: string;
};

const DETAIL_FIELDS: Record<EffectStepDetailKey, DetailFieldDef[]> = {
  damageDetail: [
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    {
      name: 'damageTypeId',
      label: '伤害类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'damageType'
    },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'valuePolicy'
    }
  ],
  healDetail: [
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'valuePolicy'
    }
  ],
  resourceDetail: [
    { name: 'resourceKey', label: '资源 Key', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'valuePolicy'
    }
  ],
  attributeDetail: [
    { name: 'attrKey', label: '属性 Key', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'valuePolicy'
    }
  ],
  shieldDetail: [
    { name: 'shieldRef', label: '护盾引用', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text' },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'valuePolicy'
    }
  ],
  providerDetail: [
    {
      name: 'actionTypeId',
      label: 'Provider 动作',
      kind: 'number',
      required: true,
      semanticTypeField: 'providerAction'
    },
    { name: 'targetProviderId', label: '目标 Provider ID', kind: 'text', required: true },
    { name: 'stacksFormulaKey', label: '层数公式 Key', kind: 'text' },
    { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text' }
  ],
  eventDetail: [
    {
      name: 'eventTypeId',
      label: '事件类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'eventType'
    },
    { name: 'eventRef', label: '事件引用', kind: 'text' },
    { name: 'payload', label: 'Payload JSON', kind: 'json' }
  ],
  abilityControlDetail: [
    {
      name: 'actionTypeId',
      label: '技能控制动作',
      kind: 'number',
      required: true,
      semanticTypeField: 'abilityControlAction'
    },
    { name: 'targetAbilityId', label: '目标 Ability ID', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text' },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      semanticTypeField: 'valuePolicy'
    }
  ],
  stateDetail: [
    {
      name: 'stateScopeTypeId',
      label: '状态作用域',
      kind: 'number',
      required: true,
      semanticTypeField: 'stateScope'
    },
    { name: 'stateKey', label: '状态 Key', kind: 'text', required: true },
    { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
    {
      name: 'valuePolicyTypeId',
      label: '值策略类型',
      kind: 'number',
      required: true,
      semanticTypeField: 'valuePolicy'
    }
  ],
  repeatDetail: [
    {
      name: 'repeatScopeTypeId',
      label: '重复作用域',
      kind: 'number',
      required: true,
      semanticTypeField: 'repeatScope'
    },
    { name: 'repeatCount', label: '重复次数', kind: 'number', required: true },
    { name: 'repeatTag', label: '重复标签', kind: 'text', required: true },
    { name: 'triggerStateKey', label: '触发状态 Key', kind: 'text', required: true },
    { name: 'threshold', label: '阈值', kind: 'number', required: true }
  ],
  executeDetail: [{ name: 'threshold', label: '生命比例阈值', kind: 'number', required: true }]
};

/** Semantic typeKey option for friendly Effect Step Setup. */
export type EffectStepSemanticTypeOption = {
  typeKey: string;
  typeId: number;
  label: string;
};

/**
 * Optional type catalogs for friendly mode. When present for a field, the editor
 * stores typeKey strings and resolves to typeId only in PUT body construction.
 * Raw resource-table path omits this and keeps numeric InputNumber inputs.
 */
export type EffectStepSemanticTypeOptions = {
  operation?: EffectStepSemanticTypeOption[];
  targetSelector?: EffectStepSemanticTypeOption[];
  damageType?: EffectStepSemanticTypeOption[];
  valuePolicy?: EffectStepSemanticTypeOption[];
  providerAction?: EffectStepSemanticTypeOption[];
  eventType?: EffectStepSemanticTypeOption[];
  abilityControlAction?: EffectStepSemanticTypeOption[];
  stateScope?: EffectStepSemanticTypeOption[];
  repeatScope?: EffectStepSemanticTypeOption[];
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
  /** Hide path-key / sequence / order fields when the parent page owns them. */
  hideIdentityFields?: boolean;
  /**
   * Sequence Select options (reuse setup-page choices). When set, sequenceId uses Select
   * instead of raw Input. Advanced/raw mode may omit this to expose numeric/text IDs.
   */
  sequenceOptions?: Array<{ label: string; value: string }>;
  semanticTypeOptions?: EffectStepSemanticTypeOptions;
  /**
   * Provider-scoped formula records for Select assistance on eligible fields.
   * undefined = loading / unavailable / failed → keep existing Input controls.
   * Defined (including []) = successful scoped lookup → searchable Select.
   */
  providerFormulaRecords?: ProviderFormula[];
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

/**
 * Convert a loaded numeric-ID record into semantic typeKey selections using catalogs.
 * Unresolvable IDs leave blank typeKeys (validation surfaces the error later).
 */
export function recordToSemanticEffectStepEditorState(
  record: Record<string, unknown>,
  options: EffectStepSemanticTypeOptions
): EffectStepEditorState {
  const base = recordToEffectStepEditorState(record);
  const operationTypeKey = resolveTypeKeyFromId(base.common.operationTypeId, options.operation);
  const targetSelectorTypeKey = resolveTypeKeyFromId(
    base.common.targetSelectorTypeId,
    options.targetSelector
  );

  const detail: ResourceFormValues = { ...base.detail };
  for (const field of DETAIL_FIELDS[base.detailFamily]) {
    if (!field.semanticTypeField) {
      continue;
    }
    const catalog = options[field.semanticTypeField as keyof EffectStepSemanticTypeOptions];
    detail[field.name] = resolveTypeKeyFromId(detail[field.name], catalog) ?? '';
  }

  return {
    ...base,
    common: {
      ...base.common,
      operationTypeId: operationTypeKey ?? '',
      targetSelectorTypeId: targetSelectorTypeKey ?? ''
    },
    detail
  };
}

function resolveTypeKeyFromId(
  raw: string | number | boolean | undefined,
  catalog: EffectStepSemanticTypeOption[] | undefined
): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const typeId = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(typeId)) {
    return null;
  }
  const found = catalog?.find((item) => item.typeId === typeId);
  return found ? found.typeKey : null;
}

function resolveTypeIdFromKey(
  typeKeyRaw: string,
  catalog: EffectStepSemanticTypeOption[] | undefined,
  label: string
): number {
  const typeKey = typeKeyRaw.trim();
  if (!typeKey) {
    throw new Error(`请选择 ${label}`);
  }
  if (!catalog || catalog.length === 0) {
    throw new Error(`未加载可用的 ${label} 类型选项，无法解析「${typeKey}」。`);
  }
  const found = catalog.find((item) => item.typeKey === typeKey);
  if (!found) {
    throw new Error(`所选 ${label}「${typeKey}」不在可用列表中，无法解析为 typeId。`);
  }
  return found.typeId;
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

export type EffectStepPutBodyFromEditor = {
  sequenceId: string;
  stepOrder: number;
  operationTypeId: number;
  targetSelectorTypeId: number;
  conditionFormulaKey?: string;
  [detailKey: string]: unknown;
};

/**
 * Build PUT body. Without semanticTypeOptions, type fields are numeric (raw page).
 * With semanticTypeOptions, type fields are typeKeys resolved to typeIds here.
 */
export function buildEffectStepPutFromEditor(
  state: EffectStepEditorState,
  semanticTypeOptions?: EffectStepSemanticTypeOptions
): EffectStepPutBodyFromEditor {
  const { common, detailFamily, detail } = state;
  const semantic = Boolean(semanticTypeOptions);

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
  if (!Number.isFinite(stepOrder)) {
    throw new Error('步骤顺序必须是有效数字');
  }

  let operationTypeId: number;
  let targetSelectorTypeId: number;
  if (semantic && semanticTypeOptions) {
    operationTypeId = resolveTypeIdFromKey(
      String(common.operationTypeId ?? ''),
      semanticTypeOptions.operation,
      '操作类型'
    );
    targetSelectorTypeId = resolveTypeIdFromKey(
      String(common.targetSelectorTypeId ?? ''),
      semanticTypeOptions.targetSelector,
      '目标选择器'
    );
  } else {
    operationTypeId =
      typeof common.operationTypeId === 'number'
        ? common.operationTypeId
        : Number(String(common.operationTypeId ?? '').trim());
    targetSelectorTypeId =
      typeof common.targetSelectorTypeId === 'number'
        ? common.targetSelectorTypeId
        : Number(String(common.targetSelectorTypeId ?? '').trim());
    if (!Number.isFinite(operationTypeId)) {
      throw new Error('操作类型 ID 必须是有效数字');
    }
    if (!Number.isFinite(targetSelectorTypeId)) {
      throw new Error('目标选择器类型 ID 必须是有效数字');
    }
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

    if (semantic && semanticTypeOptions && field.semanticTypeField) {
      const catalog =
        semanticTypeOptions[field.semanticTypeField as keyof EffectStepSemanticTypeOptions];
      detailBody[field.name] = resolveTypeIdFromKey(String(raw), catalog, field.label);
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
  return body as EffectStepPutBodyFromEditor;
}

function selectOptionsFromCatalog(catalog: EffectStepSemanticTypeOption[] | undefined) {
  return (catalog ?? []).map((item) => ({ value: item.typeKey, label: item.label }));
}

function filterFormulaSelectOption(inputValue: string, option: unknown): boolean {
  const needle = inputValue.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  if (!option || typeof option !== 'object') {
    return false;
  }
  const record = option as {
    value?: unknown;
    children?: unknown;
    label?: unknown;
    props?: { value?: unknown; children?: unknown; label?: unknown };
  };
  const candidates = [
    record.value,
    record.label,
    record.children,
    record.props?.value,
    record.props?.label,
    record.props?.children
  ];
  return candidates.some((item) => String(item ?? '').toLowerCase().includes(needle));
}

export function EffectStepEditor({
  value,
  readOnly = false,
  lockPathKeys = false,
  hideIdentityFields = false,
  sequenceOptions,
  semanticTypeOptions,
  providerFormulaRecords,
  onChange
}: EffectStepEditorProps) {
  const semantic = Boolean(semanticTypeOptions);

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

  const renderSemanticSelect = (
    fieldLabel: string,
    fieldValue: string,
    catalog: EffectStepSemanticTypeOption[] | undefined,
    onSelect: (next: string) => void
  ) => (
    <Select
      showSearch
      allowClear
      placeholder={`选择 ${fieldLabel}`}
      value={fieldValue || undefined}
      options={selectOptionsFromCatalog(catalog)}
      disabled={readOnly || !catalog || catalog.length === 0}
      onChange={(next) => onSelect(typeof next === 'string' ? next : '')}
    />
  );

  const renderProviderFormulaControl = (
    location: 'common' | EffectStepDetailKey,
    fieldName: string,
    fieldLabel: string,
    fieldValue: string,
    required: boolean | undefined,
    onSelect: (next: string) => void,
    fallback: ReactNode
  ) => {
    if (
      providerFormulaRecords === undefined ||
      !isEffectStepProviderFormulaAssistanceEligible(location, fieldName)
    ) {
      return fallback;
    }
    const options = buildReferenceOptions(
      providerFormulaRecords as unknown as Record<string, unknown>[],
      'formulaKey',
      'formulaKey',
      fieldValue
    );
    return (
      <Select
        showSearch
        allowClear={!required}
        placeholder={`选择 ${fieldLabel}`}
        value={fieldValue || undefined}
        options={options}
        disabled={readOnly}
        filterOption={filterFormulaSelectOption}
        onChange={(next) => onSelect(typeof next === 'string' ? next : '')}
      />
    );
  };

  return (
    <Form layout="vertical">
      {!hideIdentityFields ? (
        <>
          <Form.Item label="步骤 ID" required>
            <Input
              value={String(value.common.stepId ?? '')}
              disabled={readOnly || lockPathKeys}
              onChange={(next) => updateCommon('stepId', next)}
              placeholder="step_..."
            />
          </Form.Item>
          <Form.Item label="序列 ID" required>
            {sequenceOptions ? (
              <Select
                showSearch
                allowClear
                placeholder="选择效果序列"
                value={String(value.common.sequenceId ?? '') || undefined}
                options={sequenceOptions}
                disabled={readOnly}
                filterOption={filterFormulaSelectOption}
                onChange={(next) => updateCommon('sequenceId', typeof next === 'string' ? next : '')}
              />
            ) : (
              <Input
                value={String(value.common.sequenceId ?? '')}
                disabled={readOnly}
                onChange={(next) => updateCommon('sequenceId', next)}
                placeholder="seq_..."
              />
            )}
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
        </>
      ) : null}

      <Form.Item label={semantic ? '操作类型' : '操作类型 ID'} required>
        {semantic ? (
          renderSemanticSelect(
            '操作类型',
            String(value.common.operationTypeId ?? ''),
            semanticTypeOptions?.operation,
            (next) => updateCommon('operationTypeId', next)
          )
        ) : (
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
        )}
      </Form.Item>
      <Form.Item label={semantic ? '目标选择器' : '目标选择器类型 ID'} required>
        {semantic ? (
          renderSemanticSelect(
            '目标选择器',
            String(value.common.targetSelectorTypeId ?? ''),
            semanticTypeOptions?.targetSelector,
            (next) => updateCommon('targetSelectorTypeId', next)
          )
        ) : (
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
        )}
      </Form.Item>
      <Form.Item label="条件公式 Key">
        {renderProviderFormulaControl(
          'common',
          'conditionFormulaKey',
          '条件公式 Key',
          String(value.common.conditionFormulaKey ?? ''),
          false,
          (next) => updateCommon('conditionFormulaKey', next),
          <Input
            value={String(value.common.conditionFormulaKey ?? '')}
            disabled={readOnly}
            onChange={(next) => updateCommon('conditionFormulaKey', next)}
            placeholder="可选"
          />
        )}
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

      {DETAIL_FIELDS[value.detailFamily].map((field) => {
        const useSemantic =
          semantic &&
          field.semanticTypeField &&
          semanticTypeOptions?.[field.semanticTypeField as keyof EffectStepSemanticTypeOptions];

        return (
          <Form.Item key={field.name} label={field.label} required={field.required}>
            {useSemantic ? (
              renderSemanticSelect(
                field.label,
                String(value.detail[field.name] ?? ''),
                semanticTypeOptions?.[field.semanticTypeField as keyof EffectStepSemanticTypeOptions],
                (next) => updateDetail(field.name, next)
              )
            ) : field.kind === 'number' ? (
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
              renderProviderFormulaControl(
                value.detailFamily,
                field.name,
                field.label,
                String(value.detail[field.name] ?? ''),
                field.required,
                (next) => updateDetail(field.name, next),
                <Input
                  value={String(value.detail[field.name] ?? '')}
                  disabled={readOnly}
                  onChange={(next) => updateDetail(field.name, next)}
                />
              )
            )}
          </Form.Item>
        );
      })}
    </Form>
  );
}
