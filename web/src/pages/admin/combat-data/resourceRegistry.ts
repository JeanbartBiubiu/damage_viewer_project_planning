import type { JsonObject } from '../../../types/api';
import {
  COMBAT_TYPE_RELATION_TARGET_CATEGORIES,
  type CombatDataEnvelope
} from '../../../types/combatData';
import { ApiRequestError, type ApiResult } from '../../../services/apiClient';
import {
  getAbilities,
  getAbilityCooldowns,
  getAbilityCosts,
  getAbilityParameters,
  getAbilityPhaseEffectSequences,
  getAbilityPhases,
  getAbilityStateFields,
  getAttributeDefinitions,
  getEffectSequences,
  getEffectSteps,
  getExecuteEffectDetails,
  getEntities,
  getEntityAttributeStages,
  getEntityAttributes,
  getEntityProviderMounts,
  getEntityResourceStages,
  getEntityResources,
  getListenerEffectSequences,
  getListenerMatchTypes,
  getProgressionSchema,
  getProviderFormulas,
  getProviderLifecycles,
  getProviderListeners,
  getProviderModifiers,
  getProviderStateFields,
  getProviderTickSequences,
  getProviders,
  getResourceDefinitions,
  getTypeRelations,
  getTypes,
  putAbility,
  putAbilityCooldown,
  putAbilityCost,
  putAbilityParameter,
  putAbilityPhase,
  putAbilityPhaseEffectSequence,
  putAbilityStateField,
  putAttributeDefinition,
  putEffectSequence,
  putEffectStep,
  putExecuteEffectDetail,
  putEntity,
  putEntityAttribute,
  putEntityAttributeStage,
  putEntityProviderMount,
  putEntityResource,
  putEntityResourceStage,
  putListenerEffectSequence,
  putListenerMatchType,
  putProgressionSchema,
  putProvider,
  putProviderFormula,
  putProviderLifecycle,
  putProviderListener,
  putProviderModifier,
  putProviderStateField,
  putProviderTickSequence,
  putResourceDefinition,
  putType,
  putTypeRelation
} from '../../../services/combatDataClient';

export type FieldKind = 'text' | 'number' | 'boolean' | 'json' | 'select' | 'textarea';

export type FieldOption = {
  label: string;
  value: string;
};

export type FieldDef = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Locked after create (path / identity fields). */
  lockedOnEdit?: boolean;
  options?: FieldOption[];
  helper?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean;
};

export type ReferenceDef = {
  field: string;
  resourceId: string;
  valueKey: string;
  labelKey?: string;
};

export type ResourceListResult = {
  records: Record<string, unknown>[];
  currentRevision?: number;
};

export type ResourceFormValues = Record<string, string | number | boolean>;

export type ResourceKind = 'table' | 'singleton' | 'effect-step';

export type ResourceGroup = {
  id: string;
  label: string;
};

export type CombatDataResourceConfig = {
  id: string;
  label: string;
  summary: string;
  groupId: string;
  list: (apiBaseUrl: string, gameId: string) => Promise<ResourceListResult>;
  put: (
    apiBaseUrl: string,
    gameId: string,
    token: string,
    form: ResourceFormValues
  ) => Promise<{ currentRevision: number }>;
  fields: FieldDef[];
  pathKeys: string[];
  references?: ReferenceDef[];
  kind?: ResourceKind;
};

export const RESOURCE_GROUPS: ResourceGroup[] = [
  { id: 'basics', label: '基础定义' },
  { id: 'entities', label: '实体' },
  { id: 'providers', label: 'Provider' },
  { id: 'abilities', label: 'Ability' },
  { id: 'effects', label: 'Effect' }
];

const TARGET_CATEGORY_LABELS: Record<(typeof COMBAT_TYPE_RELATION_TARGET_CATEGORIES)[number], string> = {
  entity: '实体 (entity)',
  attribute: '属性 (attribute)',
  resource: '资源 (resource)',
  provider: 'Provider (provider)',
  ability: 'Ability (ability)',
  ability_phase: '技能阶段 (ability_phase)',
  modifier: '修饰器 (modifier)',
  listener: '监听器 (listener)',
  effect_step: '效果步骤 (effect_step)',
  type: '类型 (type)'
};

export const TARGET_CATEGORY_OPTIONS: FieldOption[] = COMBAT_TYPE_RELATION_TARGET_CATEGORIES.map((value) => ({
  value,
  label: TARGET_CATEGORY_LABELS[value]
}));

const META_KEYS = new Set([
  'gameId',
  'changeRevision',
  'updatedAt',
  'currentRevision',
  'publishedRevision'
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Adapt Public combat-data envelope `data` into workbench table rows.
 * - Array endpoints keep array contract (each element → one row).
 * - Object endpoints (progression-schema / state / entity-by-id) → single-row list.
 * Never coerce a non-empty array into a singleton object row.
 */
export function adaptEnvelopeDataToRecords(data: unknown): Record<string, unknown>[] {
  if (data == null) {
    return [];
  }
  if (Array.isArray(data)) {
    return data
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null);
  }
  const record = asRecord(data);
  if (!record) {
    return [];
  }
  // Defensive: if a caller accidentally passed the full envelope, unwrap nested object `data`.
  if (
    'data' in record &&
    ('gameId' in record || 'currentRevision' in record) &&
    record.data !== null &&
    typeof record.data === 'object' &&
    !Array.isArray(record.data)
  ) {
    const nested = asRecord(record.data);
    return nested ? [nested] : [];
  }
  return [record];
}

async function listFromEnvelope<T>(
  fetcher: () => Promise<ApiResult<CombatDataEnvelope<T>>>
): Promise<ResourceListResult> {
  const result = await fetcher();
  return {
    records: adaptEnvelopeDataToRecords(result.data.data),
    currentRevision: result.data.currentRevision
  };
}

async function listSingletonOptional<T>(
  fetcher: () => Promise<ApiResult<CombatDataEnvelope<T>>>
): Promise<ResourceListResult> {
  try {
    return await listFromEnvelope(fetcher);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return { records: [] };
    }
    throw error;
  }
}

function str(form: ResourceFormValues, key: string): string {
  const value = form[key];
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function num(form: ResourceFormValues, key: string): number {
  const value = form[key];
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} 必须是有效数字`);
  }
  return parsed;
}

function parseJsonObject(form: ResourceFormValues, key: string, required = false): JsonObject | undefined {
  const raw = str(form, key);
  if (!raw) {
    if (required) {
      throw new Error(`${key} 不能为空`);
    }
    return undefined;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${key} 需要是 JSON 对象`);
  }
  return parsed as JsonObject;
}

function revisionOf(result: { data: { currentRevision: number } }): { currentRevision: number } {
  return { currentRevision: result.data.currentRevision };
}

function bodyFromFields(
  fields: FieldDef[],
  pathKeys: string[],
  form: ResourceFormValues,
  extraOmit: string[] = []
): JsonObject {
  const omit = new Set([...pathKeys, ...extraOmit]);
  const body: JsonObject = {};

  for (const field of fields) {
    if (omit.has(field.name)) {
      continue;
    }

    const raw = form[field.name];
    if (raw === undefined || raw === null || raw === '') {
      if (field.kind === 'boolean') {
        body[field.name] = false;
      }
      continue;
    }

    switch (field.kind) {
      case 'number': {
        const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(parsed)) {
          throw new Error(`${field.label} 必须是有效数字`);
        }
        body[field.name] = parsed;
        break;
      }
      case 'boolean':
        body[field.name] = typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true';
        break;
      case 'json': {
        const parsed = parseJsonObject(form, field.name, !!field.required);
        if (parsed !== undefined) {
          body[field.name] = parsed;
        }
        break;
      }
      default:
        body[field.name] = String(raw).trim();
        break;
    }
  }

  return body;
}

export function createEmptyForm(fields: FieldDef[]): ResourceFormValues {
  const form: ResourceFormValues = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      form[field.name] = field.defaultValue;
      continue;
    }
    if (field.kind === 'boolean') {
      form[field.name] = false;
    } else if (field.kind === 'json') {
      form[field.name] = '{}';
    } else {
      form[field.name] = '';
    }
  }
  return form;
}

export function recordToForm(record: Record<string, unknown>, fields: FieldDef[]): ResourceFormValues {
  const form = createEmptyForm(fields);
  for (const field of fields) {
    const value = record[field.name];
    if (value === undefined || value === null) {
      continue;
    }
    switch (field.kind) {
      case 'boolean':
        form[field.name] = Boolean(value);
        break;
      case 'json':
        form[field.name] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        break;
      case 'number':
        form[field.name] = typeof value === 'number' ? value : String(value);
        break;
      default:
        form[field.name] = String(value);
        break;
    }
  }
  return form;
}

export function validateResourceForm(config: CombatDataResourceConfig, form: ResourceFormValues): string | null {
  for (const field of config.fields) {
    if (!field.required) {
      continue;
    }
    const value = form[field.name];
    if (field.kind === 'boolean') {
      continue;
    }
    if (value === undefined || value === null || String(value).trim() === '') {
      return `请填写 ${field.label}`;
    }
  }

  for (const field of config.fields) {
    if (field.kind !== 'number') {
      continue;
    }
    const raw = form[field.name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      continue;
    }
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(parsed)) {
      return `${field.label} 必须是有效数字`;
    }
  }

  if (config.id === 'types' || config.fields.some((field) => field.name === 'typeId' && field.required)) {
    const typeIdField = config.fields.find((field) => field.name === 'typeId');
    if (typeIdField) {
      const raw = form.typeId;
      if (raw !== undefined && String(raw).trim() !== '') {
        const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(parsed)) {
          return 'typeId 必须是有效数字';
        }
      }
    }
  }

  if (config.id === 'type-relations') {
    const category = str(form, 'targetCategory');
    if (!COMBAT_TYPE_RELATION_TARGET_CATEGORIES.includes(category as (typeof COMBAT_TYPE_RELATION_TARGET_CATEGORIES)[number])) {
      return `targetCategory 必须是：${COMBAT_TYPE_RELATION_TARGET_CATEGORIES.join(', ')}`;
    }
  }

  for (const field of config.fields) {
    if (field.kind !== 'json') {
      continue;
    }
    const raw = str(form, field.name);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return `${field.label} 需要是 JSON 对象`;
      }
    } catch {
      return `${field.label} JSON 格式无效`;
    }
  }

  return null;
}

export function getRecordRowKey(record: Record<string, unknown>, pathKeys: string[], index: number): string {
  if (pathKeys.length === 0) {
    return `row-${index}`;
  }
  const parts = pathKeys.map((key) => String(record[key] ?? ''));
  const joined = parts.join('|');
  return joined || `row-${index}`;
}

export function pickDisplayColumns(fields: FieldDef[], pathKeys: string[]): FieldDef[] {
  const preferred = [...pathKeys];
  for (const field of fields) {
    if (!preferred.includes(field.name) && !META_KEYS.has(field.name)) {
      preferred.push(field.name);
    }
  }
  const byName = new Map(fields.map((field) => [field.name, field]));
  return preferred
    .map((name) => byName.get(name))
    .filter((field): field is FieldDef => !!field)
    .slice(0, 6);
}

// --- Field definitions ---

const progressionSchemaFields: FieldDef[] = [
  {
    name: 'progressionKind',
    label: '成长种类',
    kind: 'select',
    required: true,
    options: [
      { label: 'LEVEL', value: 'LEVEL' },
      { label: 'STAR', value: 'STAR' }
    ],
    defaultValue: 'LEVEL'
  },
  { name: 'stageMin', label: '最小阶段', kind: 'number', required: true, defaultValue: 1 },
  { name: 'stageMax', label: '最大阶段', kind: 'number', required: true, defaultValue: 18 },
  { name: 'stageLabel', label: '阶段标签', kind: 'text', required: true, defaultValue: '等级' },
  { name: 'requireAllStages', label: '要求全阶段', kind: 'boolean', defaultValue: true }
];

const attributeDefinitionFields: FieldDef[] = [
  { name: 'attrKey', label: '属性 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'attrName', label: '属性名称', kind: 'text' },
  { name: 'attrType', label: '属性类型', kind: 'text', placeholder: 'number', defaultValue: 'number' },
  { name: 'valueKind', label: '值种类', kind: 'text', required: true, placeholder: 'scalar', defaultValue: 'scalar' },
  { name: 'sortOrder', label: '排序', kind: 'number', required: true, defaultValue: 0 },
  { name: 'defaultValue', label: '默认值', kind: 'number' },
  { name: 'rateTargetAttrKey', label: '比率目标属性', kind: 'text' },
  { name: 'minValue', label: '最小值', kind: 'number' },
  { name: 'maxValue', label: '最大值', kind: 'number' }
];

const resourceDefinitionFields: FieldDef[] = [
  { name: 'resourceKey', label: '资源 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'displayName', label: '显示名', kind: 'text', required: true },
  { name: 'defaultInitialValue', label: '默认初始值', kind: 'number', required: true, defaultValue: 0 },
  { name: 'defaultMaxValue', label: '默认最大值', kind: 'number', required: true, defaultValue: 0 }
];

const typeFields: FieldDef[] = [
  { name: 'typeId', label: '类型 ID', kind: 'number', required: true, lockedOnEdit: true },
  { name: 'typeKey', label: '类型 Key', kind: 'text', required: true },
  { name: 'name', label: '名称', kind: 'text' },
  { name: 'description', label: '描述', kind: 'textarea' },
  { name: 'reservedTypeId', label: '保留类型 ID', kind: 'number' }
];

const typeRelationFields: FieldDef[] = [
  { name: 'typeId', label: '类型 ID', kind: 'number', required: true, lockedOnEdit: true },
  {
    name: 'targetCategory',
    label: '目标类别',
    kind: 'select',
    required: true,
    lockedOnEdit: true,
    options: TARGET_CATEGORY_OPTIONS
  },
  { name: 'targetId', label: '目标 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'extend', label: '扩展 JSON', kind: 'json', helper: '可选扩展对象' }
];

const entityFields: FieldDef[] = [
  { name: 'entityId', label: '实体 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'displayName', label: '显示名', kind: 'text', required: true },
  { name: 'description', label: '描述', kind: 'textarea' }
];

const entityAttributeFields: FieldDef[] = [
  { name: 'entityId', label: '实体 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'attrKey', label: '属性 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'baseValue', label: '基础值', kind: 'number', required: true, defaultValue: 0 }
];

const entityAttributeStageFields: FieldDef[] = [
  { name: 'entityId', label: '实体 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'attrKey', label: '属性 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'stage', label: '阶段', kind: 'number', required: true, lockedOnEdit: true },
  { name: 'value', label: '值', kind: 'number', required: true, defaultValue: 0 }
];

const entityResourceFields: FieldDef[] = [
  { name: 'entityId', label: '实体 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'resourceKey', label: '资源 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'initialValue', label: '初始值', kind: 'number', required: true, defaultValue: 0 },
  { name: 'maxValue', label: '最大值', kind: 'number', required: true, defaultValue: 0 }
];

const entityResourceStageFields: FieldDef[] = [
  { name: 'entityId', label: '实体 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'resourceKey', label: '资源 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'stage', label: '阶段', kind: 'number', required: true, lockedOnEdit: true },
  { name: 'initialValue', label: '初始值', kind: 'number', required: true, defaultValue: 0 },
  { name: 'maxValue', label: '最大值', kind: 'number', required: true, defaultValue: 0 }
];

const entityProviderMountFields: FieldDef[] = [
  { name: 'entityId', label: '实体 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true, lockedOnEdit: true }
];

const providerFields: FieldDef[] = [
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'providerKindTypeId', label: '种类类型 ID', kind: 'number', required: true },
  { name: 'displayName', label: '显示名', kind: 'text', required: true }
];

const providerLifecycleFields: FieldDef[] = [
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text' },
  { name: 'maxStacks', label: '最大层数', kind: 'number', required: true, defaultValue: 1 },
  { name: 'refreshPolicyTypeId', label: '刷新策略类型 ID', kind: 'number' },
  { name: 'tickIntervalMs', label: 'Tick 间隔(ms)', kind: 'number' },
  { name: 'startDelayMs', label: '起始延迟(ms)', kind: 'number' }
];

const providerStateFieldFields: FieldDef[] = [
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'stateKey', label: '状态 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'valueTypeId', label: '值类型 ID', kind: 'number', required: true }
];

const providerFormulaFields: FieldDef[] = [
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'formulaKey', label: '公式 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'expression', label: '表达式 JSON', kind: 'json', required: true, helper: '保持对象结构，勿字符串化' }
];

const providerModifierFields: FieldDef[] = [
  { name: 'modifierId', label: '修饰器 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true },
  { name: 'modifierKey', label: '修饰器 Key', kind: 'text', required: true },
  { name: 'modifierTypeId', label: '修饰器类型 ID', kind: 'number' },
  { name: 'targetSelectorTypeId', label: '目标选择器类型 ID', kind: 'number', required: true },
  { name: 'targetAttrKey', label: '目标属性 Key', kind: 'text', required: true },
  { name: 'commandTypeId', label: '命令类型 ID', kind: 'number' },
  { name: 'channelTypeId', label: '通道类型 ID', kind: 'number' },
  { name: 'bucketTypeId', label: '乘区类型 ID', kind: 'number' },
  { name: 'stageTypeId', label: '阶段类型 ID', kind: 'number' },
  { name: 'priority', label: '优先级', kind: 'number', required: true, defaultValue: 0 },
  { name: 'valuePolicyTypeId', label: '值策略类型 ID', kind: 'number', required: true },
  { name: 'valueFormulaKey', label: '值公式 Key', kind: 'text', required: true },
  { name: 'conditionFormulaKey', label: '条件公式 Key', kind: 'text' }
];

const providerListenerFields: FieldDef[] = [
  { name: 'listenerId', label: '监听器 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true },
  { name: 'listenerKey', label: '监听器 Key', kind: 'text', required: true },
  { name: 'eventTypeId', label: '事件类型 ID', kind: 'number', required: true },
  { name: 'abilityId', label: 'Ability ID', kind: 'text' },
  { name: 'maxTriggersPerEvent', label: '每事件最大触发', kind: 'number' },
  { name: 'chainLimitKey', label: '链式限制 Key', kind: 'text' }
];

const listenerMatchTypeFields: FieldDef[] = [
  { name: 'listenerId', label: '监听器 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'matchModeTypeId', label: '匹配模式类型 ID', kind: 'number', required: true, lockedOnEdit: true },
  { name: 'typeId', label: '类型 ID', kind: 'number', required: true, lockedOnEdit: true }
];

const providerTickSequenceFields: FieldDef[] = [
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'sequenceId', label: '序列 ID', kind: 'text', required: true, lockedOnEdit: true }
];

const abilityFields: FieldDef[] = [
  { name: 'abilityId', label: 'Ability ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true },
  { name: 'abilityKey', label: 'Ability Key', kind: 'text', required: true },
  { name: 'abilityKindTypeId', label: '种类类型 ID', kind: 'number', required: true },
  { name: 'displayName', label: '显示名', kind: 'text', required: true }
];

const abilityParameterFields: FieldDef[] = [
  { name: 'abilityId', label: 'Ability ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'paramKey', label: '参数 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'numericValue', label: '数值', kind: 'number', required: true, defaultValue: 0 }
];

const abilityStateFieldFields: FieldDef[] = [
  { name: 'abilityId', label: 'Ability ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'stateKey', label: '状态 Key', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'valueTypeId', label: '值类型 ID', kind: 'number', required: true }
];

const abilityPhaseFields: FieldDef[] = [
  { name: 'phaseId', label: '阶段 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'abilityId', label: 'Ability ID', kind: 'text', required: true },
  { name: 'phaseOrder', label: '阶段顺序', kind: 'number', required: true, defaultValue: 0 },
  { name: 'phaseTypeId', label: '阶段类型 ID', kind: 'number', required: true },
  { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text' },
  { name: 'interruptible', label: '可打断', kind: 'boolean', defaultValue: true }
];

const abilityCostFields: FieldDef[] = [
  { name: 'costId', label: '消耗 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'abilityId', label: 'Ability ID', kind: 'text', required: true },
  { name: 'phaseId', label: '阶段 ID', kind: 'text' },
  { name: 'resourceKey', label: '资源 Key', kind: 'text', required: true },
  { name: 'amountFormulaKey', label: '数量公式 Key', kind: 'text', required: true },
  { name: 'allowPartial', label: '允许部分消耗', kind: 'boolean', defaultValue: false }
];

const abilityCooldownFields: FieldDef[] = [
  { name: 'cooldownId', label: '冷却 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'abilityId', label: 'Ability ID', kind: 'text', required: true },
  { name: 'durationFormulaKey', label: '持续公式 Key', kind: 'text', required: true },
  { name: 'startsOnPhaseId', label: '起始阶段 ID', kind: 'text' },
  { name: 'groupKey', label: '分组 Key', kind: 'text' }
];

const effectSequenceFields: FieldDef[] = [
  { name: 'sequenceId', label: '序列 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'providerId', label: 'Provider ID', kind: 'text', required: true },
  { name: 'sequenceKey', label: '序列 Key', kind: 'text', required: true },
  { name: 'displayName', label: '显示名', kind: 'text' }
];

const effectStepFields: FieldDef[] = [
  { name: 'stepId', label: '步骤 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'sequenceId', label: '序列 ID', kind: 'text', required: true },
  { name: 'stepOrder', label: '步骤顺序', kind: 'number', required: true, defaultValue: 0 },
  { name: 'operationTypeId', label: '操作类型 ID', kind: 'number', required: true },
  { name: 'targetSelectorTypeId', label: '目标选择器类型 ID', kind: 'number', required: true },
  { name: 'conditionFormulaKey', label: '条件公式 Key', kind: 'text' }
];

const executeEffectDetailFields: FieldDef[] = [
  { name: 'stepId', label: '步骤 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'threshold', label: '生命比例阈值', kind: 'number', required: true }
];

const abilityPhaseEffectSequenceFields: FieldDef[] = [
  { name: 'phaseId', label: '阶段 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'triggerTypeId', label: '触发类型 ID', kind: 'number', required: true, lockedOnEdit: true },
  { name: 'sequenceId', label: '序列 ID', kind: 'text', required: true, lockedOnEdit: true }
];

const listenerEffectSequenceFields: FieldDef[] = [
  { name: 'listenerId', label: '监听器 ID', kind: 'text', required: true, lockedOnEdit: true },
  { name: 'sequenceId', label: '序列 ID', kind: 'text', required: true, lockedOnEdit: true }
];

export const COMBAT_DATA_RESOURCE_LIST: CombatDataResourceConfig[] = [
  {
    id: 'progression-schema',
    label: '成长 Schema',
    summary: '配置等级/星级等成长阶段区间',
    groupId: 'basics',
    kind: 'singleton',
    pathKeys: [],
    fields: progressionSchemaFields,
    list: (apiBaseUrl, gameId) => listSingletonOptional(() => getProgressionSchema(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putProgressionSchema(apiBaseUrl, gameId, token, bodyFromFields(progressionSchemaFields, [], form)))
  },
  {
    id: 'attribute-definitions',
    label: '属性定义',
    summary: '战斗属性键、值种类与边界',
    groupId: 'basics',
    pathKeys: ['attrKey'],
    fields: attributeDefinitionFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAttributeDefinitions(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putAttributeDefinition(apiBaseUrl, gameId, str(form, 'attrKey'), token, bodyFromFields(attributeDefinitionFields, ['attrKey'], form))
      )
  },
  {
    id: 'resource-definitions',
    label: '资源定义',
    summary: 'HP/能量等资源键与默认上下限',
    groupId: 'basics',
    pathKeys: ['resourceKey'],
    fields: resourceDefinitionFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getResourceDefinitions(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putResourceDefinition(
          apiBaseUrl,
          gameId,
          str(form, 'resourceKey'),
          token,
          bodyFromFields(resourceDefinitionFields, ['resourceKey'], form)
        )
      )
  },
  {
    id: 'types',
    label: '类型定义',
    summary: '战斗类型目录（typeId / typeKey）',
    groupId: 'basics',
    pathKeys: ['typeId'],
    fields: typeFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getTypes(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putType(apiBaseUrl, gameId, num(form, 'typeId'), token, bodyFromFields(typeFields, ['typeId'], form)))
  },
  {
    id: 'type-relations',
    label: '类型关系',
    summary: '类型与目标（entity/ability/…）的挂接',
    groupId: 'basics',
    pathKeys: ['typeId', 'targetCategory', 'targetId'],
    fields: typeRelationFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getTypeRelations(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) => {
      const extend = parseJsonObject(form, 'extend');
      return revisionOf(
        await putTypeRelation(
          apiBaseUrl,
          gameId,
          num(form, 'typeId'),
          str(form, 'targetCategory'),
          str(form, 'targetId'),
          token,
          extend ?? {}
        )
      );
    }
  },
  {
    id: 'entities',
    label: '实体',
    summary: '战斗实体主档',
    groupId: 'entities',
    pathKeys: ['entityId'],
    fields: entityFields,
    references: [{ field: 'entityId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' }],
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEntities(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putEntity(apiBaseUrl, gameId, str(form, 'entityId'), token, bodyFromFields(entityFields, ['entityId'], form)))
  },
  {
    id: 'entity-attributes',
    label: '实体属性',
    summary: '实体基础属性值',
    groupId: 'entities',
    pathKeys: ['entityId', 'attrKey'],
    fields: entityAttributeFields,
    references: [
      { field: 'entityId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
      { field: 'attrKey', resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' }
    ],
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEntityAttributes(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putEntityAttribute(
          apiBaseUrl,
          gameId,
          str(form, 'entityId'),
          str(form, 'attrKey'),
          token,
          bodyFromFields(entityAttributeFields, ['entityId', 'attrKey'], form)
        )
      )
  },
  {
    id: 'entity-attribute-stages',
    label: '实体属性阶段',
    summary: '实体属性按成长阶段取值',
    groupId: 'entities',
    pathKeys: ['entityId', 'attrKey', 'stage'],
    fields: entityAttributeStageFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEntityAttributeStages(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putEntityAttributeStage(
          apiBaseUrl,
          gameId,
          str(form, 'entityId'),
          str(form, 'attrKey'),
          num(form, 'stage'),
          token,
          bodyFromFields(entityAttributeStageFields, ['entityId', 'attrKey', 'stage'], form)
        )
      )
  },
  {
    id: 'entity-resources',
    label: '实体资源',
    summary: '实体资源初始值与上限',
    groupId: 'entities',
    pathKeys: ['entityId', 'resourceKey'],
    fields: entityResourceFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEntityResources(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putEntityResource(
          apiBaseUrl,
          gameId,
          str(form, 'entityId'),
          str(form, 'resourceKey'),
          token,
          bodyFromFields(entityResourceFields, ['entityId', 'resourceKey'], form)
        )
      )
  },
  {
    id: 'entity-resource-stages',
    label: '实体资源阶段',
    summary: '实体资源按成长阶段取值',
    groupId: 'entities',
    pathKeys: ['entityId', 'resourceKey', 'stage'],
    fields: entityResourceStageFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEntityResourceStages(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putEntityResourceStage(
          apiBaseUrl,
          gameId,
          str(form, 'entityId'),
          str(form, 'resourceKey'),
          num(form, 'stage'),
          token,
          bodyFromFields(entityResourceStageFields, ['entityId', 'resourceKey', 'stage'], form)
        )
      )
  },
  {
    id: 'entity-provider-mounts',
    label: '实体 Provider 挂载',
    summary: '实体与 Provider 的挂载关系',
    groupId: 'entities',
    pathKeys: ['entityId', 'providerId'],
    fields: entityProviderMountFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEntityProviderMounts(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putEntityProviderMount(apiBaseUrl, gameId, str(form, 'entityId'), str(form, 'providerId'), token, {}))
  },
  {
    id: 'providers',
    label: 'Providers',
    summary: 'Provider 主档',
    groupId: 'providers',
    pathKeys: ['providerId'],
    fields: providerFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviders(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putProvider(apiBaseUrl, gameId, str(form, 'providerId'), token, bodyFromFields(providerFields, ['providerId'], form)))
  },
  {
    id: 'provider-lifecycles',
    label: 'Provider 生命周期',
    summary: '持续、层数、Tick 与刷新策略',
    groupId: 'providers',
    pathKeys: ['providerId'],
    fields: providerLifecycleFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviderLifecycles(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putProviderLifecycle(
          apiBaseUrl,
          gameId,
          str(form, 'providerId'),
          token,
          bodyFromFields(providerLifecycleFields, ['providerId'], form)
        )
      )
  },
  {
    id: 'provider-state-fields',
    label: 'Provider 状态字段',
    summary: 'Provider 运行时状态键定义',
    groupId: 'providers',
    pathKeys: ['providerId', 'stateKey'],
    fields: providerStateFieldFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviderStateFields(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putProviderStateField(
          apiBaseUrl,
          gameId,
          str(form, 'providerId'),
          str(form, 'stateKey'),
          token,
          bodyFromFields(providerStateFieldFields, ['providerId', 'stateKey'], form)
        )
      )
  },
  {
    id: 'provider-formulas',
    label: 'Provider 公式',
    summary: 'Provider 公式表达式（JSON 对象）',
    groupId: 'providers',
    pathKeys: ['providerId', 'formulaKey'],
    fields: providerFormulaFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviderFormulas(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putProviderFormula(
          apiBaseUrl,
          gameId,
          str(form, 'providerId'),
          str(form, 'formulaKey'),
          token,
          bodyFromFields(providerFormulaFields, ['providerId', 'formulaKey'], form)
        )
      )
  },
  {
    id: 'provider-modifiers',
    label: 'Provider 修饰器',
    summary: '属性修饰通道与公式',
    groupId: 'providers',
    pathKeys: ['modifierId'],
    fields: providerModifierFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviderModifiers(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putProviderModifier(apiBaseUrl, gameId, str(form, 'modifierId'), token, bodyFromFields(providerModifierFields, ['modifierId'], form))
      )
  },
  {
    id: 'provider-listeners',
    label: 'Provider 监听器',
    summary: '事件监听与触发配置',
    groupId: 'providers',
    pathKeys: ['listenerId'],
    fields: providerListenerFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviderListeners(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putProviderListener(apiBaseUrl, gameId, str(form, 'listenerId'), token, bodyFromFields(providerListenerFields, ['listenerId'], form))
      )
  },
  {
    id: 'listener-match-types',
    label: '监听匹配类型',
    summary: '监听器匹配模式与类型绑定',
    groupId: 'providers',
    pathKeys: ['listenerId', 'matchModeTypeId', 'typeId'],
    fields: listenerMatchTypeFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getListenerMatchTypes(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putListenerMatchType(
          apiBaseUrl,
          gameId,
          str(form, 'listenerId'),
          num(form, 'matchModeTypeId'),
          num(form, 'typeId'),
          token,
          {}
        )
      )
  },
  {
    id: 'provider-tick-sequences',
    label: 'Provider Tick 序列',
    summary: 'Provider 周期 Tick 效果序列挂接',
    groupId: 'providers',
    pathKeys: ['providerId', 'sequenceId'],
    fields: providerTickSequenceFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getProviderTickSequences(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putProviderTickSequence(apiBaseUrl, gameId, str(form, 'providerId'), str(form, 'sequenceId'), token, {}))
  },
  {
    id: 'abilities',
    label: 'Abilities',
    summary: 'Ability 主档',
    groupId: 'abilities',
    pathKeys: ['abilityId'],
    fields: abilityFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilities(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putAbility(apiBaseUrl, gameId, str(form, 'abilityId'), token, bodyFromFields(abilityFields, ['abilityId'], form)))
  },
  {
    id: 'ability-parameters',
    label: 'Ability 参数',
    summary: 'Ability 数值参数',
    groupId: 'abilities',
    pathKeys: ['abilityId', 'paramKey'],
    fields: abilityParameterFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilityParameters(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putAbilityParameter(
          apiBaseUrl,
          gameId,
          str(form, 'abilityId'),
          str(form, 'paramKey'),
          token,
          bodyFromFields(abilityParameterFields, ['abilityId', 'paramKey'], form)
        )
      )
  },
  {
    id: 'ability-state-fields',
    label: 'Ability 状态字段',
    summary: 'Ability 运行时状态键定义',
    groupId: 'abilities',
    pathKeys: ['abilityId', 'stateKey'],
    fields: abilityStateFieldFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilityStateFields(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putAbilityStateField(
          apiBaseUrl,
          gameId,
          str(form, 'abilityId'),
          str(form, 'stateKey'),
          token,
          bodyFromFields(abilityStateFieldFields, ['abilityId', 'stateKey'], form)
        )
      )
  },
  {
    id: 'ability-phases',
    label: 'Ability 阶段',
    summary: '施放阶段顺序与类型',
    groupId: 'abilities',
    pathKeys: ['phaseId'],
    fields: abilityPhaseFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilityPhases(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putAbilityPhase(apiBaseUrl, gameId, str(form, 'phaseId'), token, bodyFromFields(abilityPhaseFields, ['phaseId'], form)))
  },
  {
    id: 'ability-costs',
    label: 'Ability 消耗',
    summary: '资源消耗公式与部分消耗策略',
    groupId: 'abilities',
    pathKeys: ['costId'],
    fields: abilityCostFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilityCosts(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putAbilityCost(apiBaseUrl, gameId, str(form, 'costId'), token, bodyFromFields(abilityCostFields, ['costId'], form)))
  },
  {
    id: 'ability-cooldowns',
    label: 'Ability 冷却',
    summary: '冷却公式与分组',
    groupId: 'abilities',
    pathKeys: ['cooldownId'],
    fields: abilityCooldownFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilityCooldowns(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putAbilityCooldown(apiBaseUrl, gameId, str(form, 'cooldownId'), token, bodyFromFields(abilityCooldownFields, ['cooldownId'], form))
      )
  },
  {
    id: 'effect-sequences',
    label: '效果序列',
    summary: '效果步骤容器序列',
    groupId: 'effects',
    pathKeys: ['sequenceId'],
    fields: effectSequenceFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEffectSequences(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putEffectSequence(apiBaseUrl, gameId, str(form, 'sequenceId'), token, bodyFromFields(effectSequenceFields, ['sequenceId'], form))
      )
  },
  {
    id: 'effect-steps',
    label: '效果步骤',
    summary: '带判别 detail 的效果步骤（十一选一）',
    groupId: 'effects',
    kind: 'effect-step',
    pathKeys: ['stepId'],
    fields: effectStepFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getEffectSteps(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) => {
      // Generic put is unused for effect-steps; EffectStepEditor builds the body.
      const body = bodyFromFields(effectStepFields, ['stepId'], form);
      return revisionOf(await putEffectStep(apiBaseUrl, gameId, str(form, 'stepId'), token, body));
    }
  },
  {
    id: 'execute-effect-details',
    label: '处决效果明细',
    summary: '处决步骤生命比例阈值明细（按 stepId）',
    groupId: 'effects',
    pathKeys: ['stepId'],
    fields: executeEffectDetailFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getExecuteEffectDetails(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putExecuteEffectDetail(
          apiBaseUrl,
          gameId,
          str(form, 'stepId'),
          token,
          bodyFromFields(executeEffectDetailFields, ['stepId'], form)
        )
      )
  },
  {
    id: 'ability-phase-effect-sequences',
    label: '阶段效果序列',
    summary: 'Ability 阶段触发挂接效果序列',
    groupId: 'effects',
    pathKeys: ['phaseId', 'triggerTypeId', 'sequenceId'],
    fields: abilityPhaseEffectSequenceFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getAbilityPhaseEffectSequences(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(
        await putAbilityPhaseEffectSequence(
          apiBaseUrl,
          gameId,
          str(form, 'phaseId'),
          num(form, 'triggerTypeId'),
          str(form, 'sequenceId'),
          token,
          {}
        )
      )
  },
  {
    id: 'listener-effect-sequences',
    label: '监听效果序列',
    summary: '监听器挂接效果序列',
    groupId: 'effects',
    pathKeys: ['listenerId', 'sequenceId'],
    fields: listenerEffectSequenceFields,
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getListenerEffectSequences(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putListenerEffectSequence(apiBaseUrl, gameId, str(form, 'listenerId'), str(form, 'sequenceId'), token, {}))
  }
];

export const COMBAT_DATA_RESOURCES_BY_ID: Record<string, CombatDataResourceConfig> = Object.fromEntries(
  COMBAT_DATA_RESOURCE_LIST.map((resource) => [resource.id, resource])
);

export function getCombatDataResource(resourceId: string): CombatDataResourceConfig | undefined {
  return COMBAT_DATA_RESOURCES_BY_ID[resourceId];
}

export function getResourcesByGroup(groupId: string): CombatDataResourceConfig[] {
  return COMBAT_DATA_RESOURCE_LIST.filter((resource) => resource.groupId === groupId);
}
