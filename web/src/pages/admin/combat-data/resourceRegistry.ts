import type { JsonObject } from '../../../types/api';
import {
  COMBAT_TYPE_RELATION_TARGET_CATEGORIES,
  type CombatDataEnvelope
} from '../../../types/combatData';
import { ApiRequestError, type ApiResult } from '../../../services/apiClient';
import {
  createCopiedImageReference,
  createUntouchedImageReference,
  isImageReferenceEditState,
  serializeImageUriPatch,
  type ImageReferenceEditState
} from '../../../services/combatDataImageReference';
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

export type FieldKind = 'text' | 'number' | 'boolean' | 'json' | 'select' | 'textarea' | 'image-reference';

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

/**
 * Image-reference edit state is stored as a JSON string in ResourceFormValues
 * (keeps the form value union compatible with existing Select/effect-step helpers).
 */
export const IMAGE_REFERENCE_FORM_PREFIX = '__imageRef__:';

export function encodeImageReferenceFormValue(state: ImageReferenceEditState): string {
  return `${IMAGE_REFERENCE_FORM_PREFIX}${JSON.stringify(state)}`;
}

export function decodeImageReferenceFormValue(value: unknown): ImageReferenceEditState {
  if (isImageReferenceEditState(value)) {
    return value;
  }
  if (typeof value === 'string' && value.startsWith(IMAGE_REFERENCE_FORM_PREFIX)) {
    try {
      const parsed = JSON.parse(value.slice(IMAGE_REFERENCE_FORM_PREFIX.length)) as unknown;
      if (isImageReferenceEditState(parsed)) {
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return createUntouchedImageReference(value);
  }
  return createUntouchedImageReference(null);
}

export type ResourceListResult = {
  records: Record<string, unknown>[];
  currentRevision?: number;
};

export type ResourceFormValues = Record<string, string | number | boolean>;

/** Optional candidate predicate on ReferenceDef (GUX-1). `present` ⇒ record[field] != null. */
export type ReferenceTargetPredicate = {
  field: string;
  operator: 'present';
};

export type ReferenceDef = {
  field: string;
  resourceId: string;
  valueKey: string;
  labelKey?: string;
  /**
   * When set, Select options are filtered to records matching a control on record[recordKey].
   * Direct: control = form[dependsOn].
   * ownerLookup: resolve form[dependsOn] via lookup resource matchKey → ownerKey, then filter on that owner.
   */
  scope?: {
    dependsOn: string;
    recordKey: string;
    ownerLookup?: { resourceId: string; matchKey: string; ownerKey: string };
  };
  /** Narrow candidates after scope; failure must not broaden the list. */
  targetPredicate?: ReferenceTargetPredicate;
};

export type ResourceWorkflowCompoundParent = {
  kind: 'compound-parent';
  targetResourceId: string;
  /** Ordered source/target field pairs (AND navigation + create-child prefill). */
  fieldPairs: Array<{ sourceField: string; targetField: string }>;
};

export type ResourceWorkflowSemanticContext = {
  kind: 'semantic-context';
  resourceId: string;
  /** Operator-facing note; not a Select filter or RI claim. */
  purpose: string;
};

export type ResourceWorkflowMultiHopAssistance = {
  kind: 'multi-hop-assistance';
  id: string;
  assistanceField: string;
  sourceField: string;
  hops: Array<{ resourceId: string; matchField: string; valueField: string }>;
  targetFilter: { resourceId: string; recordField: string };
};

export type ResourceWorkflowException =
  | ResourceWorkflowCompoundParent
  | ResourceWorkflowSemanticContext
  | ResourceWorkflowMultiHopAssistance;

/** Operator-facing workflow metadata required on every combat-data resource. */
export type ResourceWorkflow = {
  purpose: string;
  /** Declared direct upstream resource ids (orientation; graph also derived from refs). */
  upstream: string[];
  /** Suggested downstream / next-step resource ids. */
  downstream: string[];
  /** Optional guided static route hash segment (e.g. entity-setup). */
  guidedStaticRoute?: string;
  exceptions?: ResourceWorkflowException[];
};

/** Registry-only dependent reference: target field resolved from a controlling field value. */
export type DependentReferenceTarget = {
  resourceId: string;
  valueKey: string;
  labelKey?: string;
};

export type DependentReferenceDef = {
  field: string;
  dependsOn: string;
  byValue: Record<string, DependentReferenceTarget>;
};

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
  dependentReferences?: DependentReferenceDef[];
  kind?: ResourceKind;
  /** Mandatory GUX-1 workflow metadata. */
  workflow: ResourceWorkflow;
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
  if (typeof value === 'string' && value.startsWith(IMAGE_REFERENCE_FORM_PREFIX)) {
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

export function bodyFromFields(
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
    if (field.kind === 'image-reference') {
      const state = decodeImageReferenceFormValue(raw);
      Object.assign(body, serializeImageUriPatch(state));
      continue;
    }

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
    if (field.kind === 'image-reference') {
      form[field.name] = encodeImageReferenceFormValue(createUntouchedImageReference(null));
      continue;
    }
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
    if (field.kind === 'image-reference') {
      // Opening an existing record must not mark the field touched.
      form[field.name] = encodeImageReferenceFormValue(
        createUntouchedImageReference(
          typeof value === 'string' || value === null || value === undefined
            ? (value as string | null | undefined)
            : null
        )
      );
      continue;
    }
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

/**
 * Create-copy draft: path keys cleared; image-reference intentionally reuses binding when present.
 * Prefer this over resourceRelations.buildCopyForm for image-aware resources.
 */
export function buildResourceCopyForm(
  config: CombatDataResourceConfig,
  record: Record<string, unknown>
): ResourceFormValues {
  const form: ResourceFormValues = {};
  const pathKeySet = new Set(config.pathKeys);
  for (const field of config.fields) {
    if (pathKeySet.has(field.name) || field.lockedOnEdit) {
      if (field.kind === 'image-reference') {
        form[field.name] = encodeImageReferenceFormValue(createUntouchedImageReference(null));
      } else {
        form[field.name] = field.kind === 'boolean' ? false : '';
      }
      continue;
    }
    if (field.kind === 'image-reference') {
      const value = record[field.name];
      form[field.name] = encodeImageReferenceFormValue(
        createCopiedImageReference(
          typeof value === 'string' || value === null || value === undefined
            ? (value as string | null | undefined)
            : null
        )
      );
      continue;
    }
    const value = record[field.name];
    if (value === undefined || value === null) {
      form[field.name] =
        field.defaultValue !== undefined
          ? field.defaultValue
          : field.kind === 'boolean'
            ? false
            : field.kind === 'json'
              ? '{}'
              : '';
      continue;
    }
    if (field.kind === 'boolean') {
      form[field.name] = Boolean(value);
    } else if (field.kind === 'number') {
      form[field.name] = typeof value === 'number' ? value : Number(value);
    } else if (field.kind === 'json') {
      form[field.name] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } else {
      form[field.name] = String(value);
    }
  }
  return form;
}

/**
 * First field name that fails the same checks as `validateResourceForm` (registry order).
 * Used to focus the corresponding control in the generic modal on validation failure.
 */
export function getFirstInvalidResourceFieldName(
  config: CombatDataResourceConfig,
  form: ResourceFormValues
): string | null {
  for (const field of config.fields) {
    if (!field.required) {
      continue;
    }
    const value = form[field.name];
    if (field.kind === 'boolean' || field.kind === 'image-reference') {
      continue;
    }
    if (value === undefined || value === null || String(value).trim() === '') {
      return field.name;
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
      return field.name;
    }
  }

  if (config.id === 'types' || config.fields.some((field) => field.name === 'typeId' && field.required)) {
    const typeIdField = config.fields.find((field) => field.name === 'typeId');
    if (typeIdField) {
      const raw = form.typeId;
      if (raw !== undefined && String(raw).trim() !== '') {
        const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(parsed)) {
          return 'typeId';
        }
      }
    }
  }

  if (config.id === 'type-relations') {
    const category = str(form, 'targetCategory');
    if (!COMBAT_TYPE_RELATION_TARGET_CATEGORIES.includes(category as (typeof COMBAT_TYPE_RELATION_TARGET_CATEGORIES)[number])) {
      return 'targetCategory';
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
        return field.name;
      }
    } catch {
      return field.name;
    }
  }

  return null;
}

export function validateResourceForm(config: CombatDataResourceConfig, form: ResourceFormValues): string | null {
  for (const field of config.fields) {
    if (!field.required) {
      continue;
    }
    const value = form[field.name];
    if (field.kind === 'boolean' || field.kind === 'image-reference') {
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

/** Stable DOM id for generic combat-data modal fields (focus target). */
export function combatDataFieldDomId(fieldName: string): string {
  return `combat-data-field-${fieldName}`;
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
  { name: 'maxValue', label: '最大值', kind: 'number' },
  {
    name: 'imageUri',
    label: '图片关联',
    kind: 'image-reference',
    helper: '可选同游戏 images.uri；省略保留、null/空白清除。上传资产不会自动保存本关联。'
  }
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
  { name: 'description', label: '描述', kind: 'textarea' },
  {
    name: 'imageUri',
    label: '图片关联',
    kind: 'image-reference',
    helper: '可选同游戏 images.uri；省略保留、null/空白清除。上传资产不会自动保存本关联。'
  }
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
  { name: 'startDelayMs', label: '起始延迟(ms)', kind: 'number' },
  {
    name: 'tickAnchorScopeTypeId',
    label: 'Tick 锚点 Scope 类型 ID',
    kind: 'number',
    helper:
      '可选。与 Tick 锚点 State Key 成对配置；留空表示不使用锚点。当前仅支持 state_scope/provider_target。'
  },
  {
    name: 'tickAnchorStateKey',
    label: 'Tick 锚点 State Key',
    kind: 'text',
    helper: '可选。与 Tick 锚点 Scope 类型 ID 成对配置；留空表示不使用锚点。'
  }
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
  { name: 'displayName', label: '显示名', kind: 'text', required: true },
  {
    name: 'castConditionFormulaKey',
    label: '施放前置条件公式 Key',
    kind: 'text',
    helper: '可选；指向 Provider 公式，作为技能施放前置条件'
  }
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

const stageSemanticContext = (purpose: string): ResourceWorkflowSemanticContext => ({
  kind: 'semantic-context',
  resourceId: 'progression-schema',
  purpose
});

/** GUX-1 workflow metadata for all 30 combat-data resources. */
export const RESOURCE_WORKFLOWS: Record<string, ResourceWorkflow> = {
  'progression-schema': {
    purpose: '定义成长阶段区间，供属性/资源阶段表对齐语义（非外键）。',
    upstream: [],
    downstream: ['entity-attribute-stages', 'entity-resource-stages'],
    guidedStaticRoute: 'entity-growth'
  },
  'attribute-definitions': {
    purpose: '登记战斗属性键与值种类，供实体属性与修饰器引用。',
    upstream: [],
    downstream: ['entity-attributes', 'provider-modifiers'],
    guidedStaticRoute: 'entity-setup'
  },
  'resource-definitions': {
    purpose: '登记 HP/能量等资源键，供实体资源与消耗引用。',
    upstream: [],
    downstream: ['entity-resources', 'ability-costs'],
    guidedStaticRoute: 'entity-setup'
  },
  types: {
    purpose: '维护类型目录（typeId/typeKey），供各处类型字段选择。',
    upstream: [],
    downstream: ['type-relations', 'providers', 'abilities']
  },
  'type-relations': {
    purpose: '把类型挂接到实体/技能等目标，按 targetCategory 切换目标表。',
    upstream: ['types'],
    downstream: []
  },
  entities: {
    purpose: '维护战斗实体主档。',
    upstream: [],
    downstream: ['entity-attributes', 'entity-resources', 'entity-provider-mounts'],
    guidedStaticRoute: 'entity-setup'
  },
  'entity-attributes': {
    purpose: '为实体写入基础属性值；是属性阶段行的复合父行。',
    upstream: ['entities', 'attribute-definitions'],
    downstream: ['entity-attribute-stages'],
    guidedStaticRoute: 'entity-growth'
  },
  'entity-attribute-stages': {
    purpose: '按成长阶段填写实体属性；依赖复合父行与成长 Schema 语义。',
    upstream: ['entities', 'attribute-definitions', 'entity-attributes', 'progression-schema'],
    downstream: [],
    guidedStaticRoute: 'entity-growth',
    exceptions: [
      {
        kind: 'compound-parent',
        targetResourceId: 'entity-attributes',
        fieldPairs: [
          { sourceField: 'entityId', targetField: 'entityId' },
          { sourceField: 'attrKey', targetField: 'attrKey' }
        ]
      },
      stageSemanticContext('阶段上下限与标签来自成长 Schema，不作 Select 过滤。')
    ]
  },
  'entity-resources': {
    purpose: '为实体写入资源初值/上限；是资源阶段行的复合父行。',
    upstream: ['entities', 'resource-definitions'],
    downstream: ['entity-resource-stages'],
    guidedStaticRoute: 'entity-growth'
  },
  'entity-resource-stages': {
    purpose: '按成长阶段填写实体资源；依赖复合父行与成长 Schema 语义。',
    upstream: ['entities', 'resource-definitions', 'entity-resources', 'progression-schema'],
    downstream: [],
    guidedStaticRoute: 'entity-growth',
    exceptions: [
      {
        kind: 'compound-parent',
        targetResourceId: 'entity-resources',
        fieldPairs: [
          { sourceField: 'entityId', targetField: 'entityId' },
          { sourceField: 'resourceKey', targetField: 'resourceKey' }
        ]
      },
      stageSemanticContext('阶段上下限与标签来自成长 Schema，不作 Select 过滤。')
    ]
  },
  'entity-provider-mounts': {
    purpose: '把 Provider 挂到实体上。',
    upstream: ['entities', 'providers'],
    downstream: [],
    guidedStaticRoute: 'entity-provider-mount'
  },
  providers: {
    purpose: '维护 Provider 主档。',
    upstream: ['types'],
    downstream: [
      'provider-lifecycles',
      'provider-state-fields',
      'provider-formulas',
      'provider-modifiers',
      'provider-listeners',
      'abilities',
      'effect-sequences'
    ],
    guidedStaticRoute: 'provider-setup'
  },
  'provider-lifecycles': {
    purpose: '配置 Provider 持续、层数与刷新策略。',
    upstream: ['providers', 'types', 'provider-formulas'],
    downstream: [],
    guidedStaticRoute: 'provider-setup'
  },
  'provider-state-fields': {
    purpose: '定义 Provider 运行时状态键。',
    upstream: ['providers', 'types'],
    downstream: [],
    guidedStaticRoute: 'provider-setup'
  },
  'provider-formulas': {
    purpose: '维护 Provider 作用域公式，供生命周期/修饰器/技能引用。',
    upstream: ['providers'],
    downstream: ['provider-lifecycles', 'provider-modifiers', 'abilities', 'ability-phases'],
    guidedStaticRoute: 'provider-setup'
  },
  'provider-modifiers': {
    purpose: '配置属性修饰通道与公式。',
    upstream: ['providers', 'types', 'attribute-definitions', 'provider-formulas'],
    downstream: [],
    guidedStaticRoute: 'provider-setup'
  },
  'provider-listeners': {
    purpose: '配置事件监听；abilityId 受本行 providerId 约束。',
    upstream: ['providers', 'types', 'abilities'],
    downstream: ['listener-match-types', 'listener-effect-sequences'],
    guidedStaticRoute: 'provider-setup'
  },
  'listener-match-types': {
    purpose: '为监听器绑定匹配模式与类型。',
    upstream: ['provider-listeners', 'types'],
    downstream: [],
    guidedStaticRoute: 'provider-setup'
  },
  'provider-tick-sequences': {
    purpose: '把同 Provider 的效果序列挂到 Tick。',
    upstream: ['providers', 'effect-sequences'],
    downstream: [],
    guidedStaticRoute: 'provider-setup'
  },
  abilities: {
    purpose: '维护 Ability 主档及其所属 Provider。',
    upstream: ['providers', 'types', 'provider-formulas'],
    downstream: [
      'ability-parameters',
      'ability-state-fields',
      'ability-phases',
      'ability-costs',
      'ability-cooldowns'
    ],
    guidedStaticRoute: 'ability-setup'
  },
  'ability-parameters': {
    purpose: '为 Ability 写入数值参数。',
    upstream: ['abilities'],
    downstream: [],
    guidedStaticRoute: 'ability-setup'
  },
  'ability-state-fields': {
    purpose: '定义 Ability 运行时状态键。',
    upstream: ['abilities', 'types'],
    downstream: [],
    guidedStaticRoute: 'ability-setup'
  },
  'ability-phases': {
    purpose: '配置施放阶段顺序与类型。',
    upstream: ['abilities', 'types', 'provider-formulas'],
    downstream: ['ability-costs', 'ability-cooldowns', 'ability-phase-effect-sequences'],
    guidedStaticRoute: 'ability-setup'
  },
  'ability-costs': {
    purpose: '配置资源消耗；phaseId 受本行 abilityId 约束。',
    upstream: ['abilities', 'ability-phases', 'resource-definitions', 'provider-formulas'],
    downstream: [],
    guidedStaticRoute: 'ability-setup'
  },
  'ability-cooldowns': {
    purpose: '配置冷却；startsOnPhaseId 受本行 abilityId 约束。',
    upstream: ['abilities', 'ability-phases', 'provider-formulas'],
    downstream: [],
    guidedStaticRoute: 'ability-setup'
  },
  'effect-sequences': {
    purpose: '维护效果步骤容器序列及其所属 Provider。',
    upstream: ['providers'],
    downstream: [
      'effect-steps',
      'provider-tick-sequences',
      'ability-phase-effect-sequences',
      'listener-effect-sequences'
    ],
    guidedStaticRoute: 'effect-sequence-setup'
  },
  'effect-steps': {
    purpose: '编辑带判别 detail 的效果步骤（十一选一）。',
    upstream: ['effect-sequences'],
    downstream: ['execute-effect-details'],
    guidedStaticRoute: 'effect-step-setup'
  },
  'execute-effect-details': {
    purpose: '为处决步骤补充生命比例阈值；仅可选已含 executeDetail 的步骤。',
    upstream: ['effect-steps'],
    downstream: [],
    guidedStaticRoute: 'effect-step-setup'
  },
  'ability-phase-effect-sequences': {
    purpose: '把阶段触发挂到同 Provider 的效果序列（多跳辅助）。',
    upstream: ['ability-phases', 'types', 'effect-sequences'],
    downstream: [],
    guidedStaticRoute: 'effect-sequence-setup',
    exceptions: [
      {
        kind: 'multi-hop-assistance',
        id: 'phase-binding',
        assistanceField: 'sequenceId',
        sourceField: 'phaseId',
        hops: [
          { resourceId: 'ability-phases', matchField: 'phaseId', valueField: 'abilityId' },
          { resourceId: 'abilities', matchField: 'abilityId', valueField: 'providerId' }
        ],
        targetFilter: { resourceId: 'effect-sequences', recordField: 'providerId' }
      }
    ]
  },
  'listener-effect-sequences': {
    purpose: '把监听器挂到同 Provider 的效果序列（多跳辅助）。',
    upstream: ['provider-listeners', 'effect-sequences'],
    downstream: [],
    guidedStaticRoute: 'effect-sequence-setup',
    exceptions: [
      {
        kind: 'multi-hop-assistance',
        id: 'listener-binding',
        assistanceField: 'sequenceId',
        sourceField: 'listenerId',
        hops: [
          { resourceId: 'provider-listeners', matchField: 'listenerId', valueField: 'providerId' }
        ],
        targetFilter: { resourceId: 'effect-sequences', recordField: 'providerId' }
      }
    ]
  }
};

export const COMBAT_DATA_RESOURCE_LIST: CombatDataResourceConfig[] = (
  [  {
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
    references: [{ field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }],
    dependentReferences: [
      {
        field: 'targetId',
        dependsOn: 'targetCategory',
        byValue: {
          entity: { resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
          attribute: { resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' },
          resource: { resourceId: 'resource-definitions', valueKey: 'resourceKey', labelKey: 'displayName' },
          provider: { resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
          ability: { resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
          ability_phase: { resourceId: 'ability-phases', valueKey: 'phaseId' },
          modifier: { resourceId: 'provider-modifiers', valueKey: 'modifierId', labelKey: 'modifierKey' },
          listener: { resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
          effect_step: { resourceId: 'effect-steps', valueKey: 'stepId' },
          type: { resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
        }
      }
    ],
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
    references: [
      { field: 'entityId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
      { field: 'attrKey', resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' }
    ],
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
    references: [
      { field: 'entityId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
      { field: 'resourceKey', resourceId: 'resource-definitions', valueKey: 'resourceKey', labelKey: 'displayName' }
    ],
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
    references: [
      { field: 'entityId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
      { field: 'resourceKey', resourceId: 'resource-definitions', valueKey: 'resourceKey', labelKey: 'displayName' }
    ],
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
    references: [
      { field: 'entityId', resourceId: 'entities', valueKey: 'entityId', labelKey: 'displayName' },
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' }
    ],
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
    references: [{ field: 'providerKindTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }],
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
    references: [
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
      { field: 'refreshPolicyTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'tickAnchorScopeTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      {
        field: 'durationFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: { dependsOn: 'providerId', recordKey: 'providerId' }
      }
    ],
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
    references: [
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
      { field: 'valueTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ],
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
    references: [{ field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' }],
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
    references: [
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
      { field: 'modifierTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'targetSelectorTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'targetAttrKey', resourceId: 'attribute-definitions', valueKey: 'attrKey', labelKey: 'attrName' },
      { field: 'commandTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'channelTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'bucketTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'stageTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'valuePolicyTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      {
        field: 'valueFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: { dependsOn: 'providerId', recordKey: 'providerId' }
      },
      {
        field: 'conditionFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: { dependsOn: 'providerId', recordKey: 'providerId' }
      }
    ],
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
    references: [
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
      { field: 'eventTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      {
        field: 'abilityId',
        resourceId: 'abilities',
        valueKey: 'abilityId',
        labelKey: 'displayName',
        scope: { dependsOn: 'providerId', recordKey: 'providerId' }
      }
    ],
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
    references: [
      { field: 'listenerId', resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
      { field: 'matchModeTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'typeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ],
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
    references: [
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
      {
        field: 'sequenceId',
        resourceId: 'effect-sequences',
        valueKey: 'sequenceId',
        labelKey: 'displayName',
        scope: { dependsOn: 'providerId', recordKey: 'providerId' }
      }
    ],
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
    references: [
      { field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' },
      { field: 'abilityKindTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      {
        field: 'castConditionFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: { dependsOn: 'providerId', recordKey: 'providerId' }
      }
    ],
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
    references: [{ field: 'abilityId', resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' }],
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
    references: [
      { field: 'abilityId', resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
      { field: 'valueTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' }
    ],
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
    references: [
      { field: 'abilityId', resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
      { field: 'phaseTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      {
        field: 'durationFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: {
          dependsOn: 'abilityId',
          recordKey: 'providerId',
          ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
        }
      }
    ],
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
    references: [
      { field: 'abilityId', resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
      {
        field: 'phaseId',
        resourceId: 'ability-phases',
        valueKey: 'phaseId',
        scope: { dependsOn: 'abilityId', recordKey: 'abilityId' }
      },
      { field: 'resourceKey', resourceId: 'resource-definitions', valueKey: 'resourceKey', labelKey: 'displayName' },
      {
        field: 'amountFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: {
          dependsOn: 'abilityId',
          recordKey: 'providerId',
          ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
        }
      }
    ],
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
    references: [
      { field: 'abilityId', resourceId: 'abilities', valueKey: 'abilityId', labelKey: 'displayName' },
      {
        field: 'startsOnPhaseId',
        resourceId: 'ability-phases',
        valueKey: 'phaseId',
        scope: { dependsOn: 'abilityId', recordKey: 'abilityId' }
      },
      {
        field: 'durationFormulaKey',
        resourceId: 'provider-formulas',
        valueKey: 'formulaKey',
        scope: {
          dependsOn: 'abilityId',
          recordKey: 'providerId',
          ownerLookup: { resourceId: 'abilities', matchKey: 'abilityId', ownerKey: 'providerId' }
        }
      }
    ],
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
    references: [{ field: 'providerId', resourceId: 'providers', valueKey: 'providerId', labelKey: 'displayName' }],
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
    references: [
      { field: 'sequenceId', resourceId: 'effect-sequences', valueKey: 'sequenceId', labelKey: 'displayName' }
    ],
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
    references: [
      {
        field: 'stepId',
        resourceId: 'effect-steps',
        valueKey: 'stepId',
        targetPredicate: { field: 'executeDetail', operator: 'present' }
      }
    ],
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
    references: [
      { field: 'phaseId', resourceId: 'ability-phases', valueKey: 'phaseId' },
      { field: 'triggerTypeId', resourceId: 'types', valueKey: 'typeId', labelKey: 'name' },
      { field: 'sequenceId', resourceId: 'effect-sequences', valueKey: 'sequenceId', labelKey: 'displayName' }
    ],
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
    references: [
      { field: 'listenerId', resourceId: 'provider-listeners', valueKey: 'listenerId', labelKey: 'listenerKey' },
      { field: 'sequenceId', resourceId: 'effect-sequences', valueKey: 'sequenceId', labelKey: 'displayName' }
    ],
    list: (apiBaseUrl, gameId) => listFromEnvelope(() => getListenerEffectSequences(apiBaseUrl, gameId)),
    put: async (apiBaseUrl, gameId, token, form) =>
      revisionOf(await putListenerEffectSequence(apiBaseUrl, gameId, str(form, 'listenerId'), str(form, 'sequenceId'), token, {}))
  }
  ] as Omit<CombatDataResourceConfig, 'workflow'>[]
).map((config) => {
  const workflow = RESOURCE_WORKFLOWS[config.id];
  if (!workflow) {
    throw new Error(`Missing GUX-1 workflow metadata for combat-data resource: ${config.id}`);
  }
  return { ...config, workflow };
});

export const COMBAT_DATA_RESOURCES_BY_ID: Record<string, CombatDataResourceConfig> = Object.fromEntries(
  COMBAT_DATA_RESOURCE_LIST.map((resource) => [resource.id, resource])
);

export function getCombatDataResource(resourceId: string): CombatDataResourceConfig | undefined {
  return COMBAT_DATA_RESOURCES_BY_ID[resourceId];
}

export function getResourcesByGroup(groupId: string): CombatDataResourceConfig[] {
  return COMBAT_DATA_RESOURCE_LIST.filter((resource) => resource.groupId === groupId);
}

/** Client-side reference assistance outcome (not server referential enforcement). */
export type ReferenceAssistanceStatus = 'available' | 'failed' | 'self-suppressed';

function cellToOptionString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function controlValueKey(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

/**
 * Resolve static references plus only currently selected dependent references for a form.
 * Blank/unknown controlling values activate no dependent reference.
 * Pure registry helper — no page state or HTTP.
 */
export function resolveActiveReferences(
  config: Pick<CombatDataResourceConfig, 'references' | 'dependentReferences'>,
  form: ResourceFormValues
): ReferenceDef[] {
  const active: ReferenceDef[] = [...(config.references ?? [])];
  for (const dependent of config.dependentReferences ?? []) {
    const control = controlValueKey(form[dependent.dependsOn]);
    if (!control) {
      continue;
    }
    const target = dependent.byValue[control];
    if (!target) {
      continue;
    }
    active.push({
      field: dependent.field,
      resourceId: target.resourceId,
      valueKey: target.valueKey,
      ...(target.labelKey !== undefined ? { labelKey: target.labelKey } : {})
    });
  }
  return active;
}

/**
 * Dependent target fields that must be cleared when a controlling field transitions
 * between two different valid mapped values. Same value, blank, or unknown → none.
 * Pure registry helper — no page state or HTTP.
 */
export function listDependentFieldsToClear(
  dependentReferences: DependentReferenceDef[] | undefined,
  controlField: string,
  previousValue: unknown,
  nextValue: unknown
): string[] {
  if (!dependentReferences?.length) {
    return [];
  }
  const previous = controlValueKey(previousValue);
  const next = controlValueKey(nextValue);
  if (!previous || !next || previous === next) {
    return [];
  }

  const toClear: string[] = [];
  for (const dependent of dependentReferences) {
    if (dependent.dependsOn !== controlField) {
      continue;
    }
    if (
      !Object.prototype.hasOwnProperty.call(dependent.byValue, previous) ||
      !Object.prototype.hasOwnProperty.call(dependent.byValue, next)
    ) {
      continue;
    }
    toClear.push(dependent.field);
  }
  return toClear;
}

/**
 * Filter reference list records by optional ReferenceDef.scope then targetPredicate.
 * Unscoped → all records;
 * direct scope → blank control → []; otherwise match record[recordKey] to form[dependsOn];
 * ownerLookup → resolve form[dependsOn] via lookupRecordsByResource[resourceId][matchKey] → ownerKey,
 * then match record[recordKey] to that owner; blank/unavailable/unknown/blank-owner → [] (never unfiltered).
 * targetPredicate `present` ⇒ record[field] != null (narrows only; never broadens).
 * Pure registry helper — no page state or HTTP.
 */
export function filterReferenceRecords(
  records: Record<string, unknown>[],
  reference: ReferenceDef,
  form: ResourceFormValues,
  lookupRecordsByResource?: Record<string, Record<string, unknown>[]>
): Record<string, unknown>[] {
  let filtered: Record<string, unknown>[];

  if (!reference.scope) {
    filtered = records;
  } else {
    const control = controlValueKey(form[reference.scope.dependsOn]);
    if (!control) {
      return [];
    }

    const { recordKey, ownerLookup } = reference.scope;
    let filterControl = control;

    if (ownerLookup) {
      const lookupRecords = lookupRecordsByResource?.[ownerLookup.resourceId];
      if (!lookupRecords) {
        return [];
      }
      const ownerRecord = lookupRecords.find(
        (record) => cellToOptionString(record[ownerLookup.matchKey]) === control
      );
      if (!ownerRecord) {
        return [];
      }
      const owner = cellToOptionString(ownerRecord[ownerLookup.ownerKey]);
      if (!owner) {
        return [];
      }
      filterControl = owner;
    }

    filtered = records.filter((record) => cellToOptionString(record[recordKey]) === filterControl);
  }

  const predicate = reference.targetPredicate;
  if (!predicate) {
    return filtered;
  }
  if (predicate.operator === 'present') {
    return filtered.filter((record) => record[predicate.field] != null);
  }
  return filtered;
}

/**
 * Scoped reference fields that must be cleared when their controlling field changes.
 * Clears only when prior trimmed control is nonblank and differs from next (including clear to blank).
 * Same value, blank-to-value, or unrelated control → none.
 * Pure registry helper — no page state or HTTP.
 */
export function listScopedReferenceFieldsToClear(
  references: ReferenceDef[] | undefined,
  controlField: string,
  previousValue: unknown,
  nextValue: unknown
): string[] {
  if (!references?.length) {
    return [];
  }
  const previous = controlValueKey(previousValue);
  const next = controlValueKey(nextValue);
  if (!previous || previous === next) {
    return [];
  }

  const toClear: string[] = [];
  for (const reference of references) {
    if (reference.scope?.dependsOn === controlField) {
      toClear.push(reference.field);
    }
  }
  return toClear;
}

/**
 * Distinct referenced resource ids excluding self-references (same resource as the current page).
 * Includes each non-self ownerLookup.resourceId in addition to ordinary reference.resourceId values.
 * Order is stable (zh-CN sorted) for deterministic fetch scheduling.
 */
export function listDistinctNonSelfReferenceResourceIds(
  references: ReferenceDef[] | undefined,
  currentResourceId: string
): string[] {
  if (!references?.length) {
    return [];
  }
  const ids = new Set<string>();
  for (const reference of references) {
    if (reference.resourceId !== currentResourceId) {
      ids.add(reference.resourceId);
    }
    const ownerResourceId = reference.scope?.ownerLookup?.resourceId;
    if (ownerResourceId && ownerResourceId !== currentResourceId) {
      ids.add(ownerResourceId);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/**
 * Classify registered reference assistance for a form field.
 * - self-suppressed: reference.resourceId === current page resource — skip fetch and Select
 * - failed: non-self load failed — keep original FieldDef input; warning only
 * - available: non-self load succeeded — searchable Select assistance
 */
export function classifyReferenceAssistance(
  reference: ReferenceDef,
  currentResourceId: string,
  loadFailed: boolean
): ReferenceAssistanceStatus {
  if (reference.resourceId === currentResourceId) {
    return 'self-suppressed';
  }
  return loadFailed ? 'failed' : 'available';
}

/**
 * Build stable, deduplicated, sorted Select options from reference list records.
 * labelKey falls back to valueKey; blank labels fall back to the value string.
 * When currentValue is non-empty and absent from options, append an explicit missing option.
 */
export function buildReferenceOptions(
  records: Record<string, unknown>[],
  valueKey: string,
  labelKey: string | undefined,
  currentValue?: string | number | boolean
): FieldOption[] {
  const resolvedLabelKey = labelKey ?? valueKey;
  const byValue = new Map<string, FieldOption>();

  for (const record of records) {
    const value = cellToOptionString(record[valueKey]);
    if (!value || byValue.has(value)) {
      continue;
    }
    const labelRaw = cellToOptionString(record[resolvedLabelKey]);
    const label =
      labelRaw && labelRaw !== value ? `${value} / ${labelRaw}` : labelRaw || value;
    byValue.set(value, { value, label });
  }

  const options = [...byValue.values()].sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'));

  const current =
    currentValue === undefined || currentValue === null || currentValue === ''
      ? ''
      : String(currentValue).trim();

  if (current && !byValue.has(current)) {
    options.push({
      value: current,
      label: `${current}（缺失）`
    });
  }

  return options;
}
