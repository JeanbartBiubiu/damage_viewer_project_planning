import { assertNumericUses } from './numericValue';
import { isNumericValue } from '../types/numericValue';
import { SKILL_TRIGGER_TARGET_CATEGORIES } from '../types/skillTriggerRule';
import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillTriggerRuleRequest,
  SkillTriggerAction,
  SkillTriggerCondition,
  SkillTriggerConditionGroup,
  SkillTriggerEventSource,
  SkillTriggerEventType,
  SkillTriggerRuleDetail,
  SkillTriggerRuleSummary,
  SkillTriggerRuntimeInputBinding,
  UpdateSkillTriggerRuleRequest
} from '../types/skillTriggerRule';

const EVENT_TYPES = new Set<SkillTriggerEventType>([
  'SKILL_USED',
  'BASIC_ATTACK_START',
  'BASIC_ATTACK_HIT',
  'SKILL_HIT',
  'PROCESS_MOMENT',
  'RESULT_AVAILABLE',
  'LIFECYCLE_MOMENT',
  'DAMAGE_PENDING',
  'DAMAGE_DEALT',
  'DAMAGE_TAKEN',
  'STATUS_CHANGED',
  'HEALTH_THRESHOLD_CROSSED',
  'INTERNAL_STATE_CHANGED',
  'CONTROL_RECEIVED',
  'ENTITY_DIED',
  'ENTITY_UNTARGETABLE',
  'KILL',
  'PROCESS_CANCEL_REQUESTED',
  'SPELL_SHIELD_BLOCKED',
  'HIT_LINK_APPLIED',
  'ATTACK_LINK_APPLIED'
]);

const CONDITION_TYPES = new Set([
  'ATTRIBUTE_COMPARE',
  'STATUS_CHECK',
  'LIFECYCLE_CHECK',
  'TARGET_CATEGORY_CHECK',
  'INTERNAL_STATE_CHECK',
  'EVENT_VALUE_COMPARE'
]);

const ACTION_TYPES = new Set(['EXECUTE_EFFECT', 'START_PROCESS', 'FAIL_PROCESS']);

const SOURCE_TYPES = new Set([
  'INTERNAL_STATE',
  'COMBAT_STATUS',
  'EVENT_VALUE',
  'SOURCE_CAST_RESOURCE_COST',
  'PRIOR_ACTION_RESULT'
]);

const EVENT_VALUE_KEYS = new Set([
  'STEP_EXECUTION_INDEX',
  'CHARGE_DURATION_MS',
  'RECAST_COUNT',
  'HIT_INDEX',
  'LIFECYCLE_STACKS',
  'PERIOD_INDEX',
  'REMAINING_MS',
  'STATE_BEFORE',
  'STATE_AFTER',
  'ATTRIBUTE_BEFORE',
  'ATTRIBUTE_AFTER',
  'THRESHOLD_VALUE',
  'RAW_DAMAGE',
  'POST_DEFENSE_DAMAGE',
  'HEALTH_BEFORE',
  'PROJECTED_HEALTH_AFTER',
  'SHIELD_ABSORBED',
  'ACTUAL_HP_LOSS',
  'BLOCKED',
  'IMMUNE',
  'KILLED',
  'LINK_INDEX',
  'LINK_COUNT'
]);

const PRIOR_RESULT_OUTPUT_KINDS = new Set([
  'CONFIGURED_VALUE',
  'RAW_DAMAGE',
  'POST_DEFENSE_DAMAGE',
  'SHIELD_ABSORBED',
  'ACTUAL_HP_LOSS',
  'ACTUAL_HEALING',
  'BLOCKED',
  'IMMUNE',
  'STATUS_APPLIED',
  'KILLED'
]);

const PRIOR_RESULT_DETAIL_KEYS = new Set(['sourceActionKey', 'sourceResultKey', 'outputKind']);

const DAMAGE_DELIVERY_KINDS = new Set(['ANY', 'SKILL', 'BASIC_ATTACK']);
const DAMAGE_ORIGIN_KINDS = new Set(['ANY', 'DIRECT', 'REFLECTED']);

export class SkillTriggerRuleProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillTriggerRuleProtocolError';
  }
}

function triggerRulesPath(gameId: string, skillKey: string, ruleKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/trigger-rules`;
  return ruleKey === undefined ? base : `${base}/${encodePathSegment(ruleKey)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(path: string): never {
  throw new SkillTriggerRuleProtocolError(`触发规则响应与固定联合类型不匹配：${path}`);
}

function shouldValidateShape(): boolean {
  return import.meta.env.DEV === true;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string') protocolError(path);
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) protocolError(path);
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') protocolError(path);
  return value;
}

function assertNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return assertString(value, path);
}

function assertEventSource(value: unknown, path: string): SkillTriggerEventSource {
  if (!isRecord(value)) protocolError(path);
  const eventType = value.eventType;
  if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType as SkillTriggerEventType)) {
    protocolError(`${path}.eventType`);
  }
  if (!isRecord(value.detail)) protocolError(`${path}.detail`);
  const detail = value.detail;
  switch (eventType) {
    case 'SKILL_USED':
      if (typeof detail.useKind !== 'string') protocolError(`${path}.detail.useKind`);
      if (detail.sourceSkillKey !== null && typeof detail.sourceSkillKey !== 'string') {
        protocolError(`${path}.detail.sourceSkillKey`);
      }
      break;
    case 'SKILL_HIT':
      if (detail.sourceSkillKey !== null && typeof detail.sourceSkillKey !== 'string') {
        protocolError(`${path}.detail.sourceSkillKey`);
      }
      break;
    case 'HIT_LINK_APPLIED':
    case 'ATTACK_LINK_APPLIED':
      if (detail.sourceSkillKey !== null && typeof detail.sourceSkillKey !== 'string') {
        protocolError(`${path}.detail.sourceSkillKey`);
      }
      if (Object.keys(detail).some((key) => key !== 'sourceSkillKey')) {
        protocolError(`${path}.detail`);
      }
      break;
    case 'PROCESS_MOMENT':
      if (typeof detail.processKey !== 'string' || !isRecord(detail.moment)) {
        protocolError(`${path}.detail`);
      }
      break;
    case 'RESULT_AVAILABLE':
      if (typeof detail.effectKey !== 'string' || typeof detail.resultKey !== 'string') {
        protocolError(`${path}.detail`);
      }
      break;
    case 'LIFECYCLE_MOMENT':
      if (typeof detail.effectKey !== 'string' || typeof detail.moment !== 'string') {
        protocolError(`${path}.detail`);
      }
      break;
    case 'DAMAGE_PENDING':
    case 'DAMAGE_DEALT':
    case 'DAMAGE_TAKEN':
      if (detail.damageTypeKey !== null && typeof detail.damageTypeKey !== 'string') {
        protocolError(`${path}.detail.damageTypeKey`);
      }
      if (
        typeof detail.deliveryKind !== 'string'
        || !DAMAGE_DELIVERY_KINDS.has(detail.deliveryKind)
      ) {
        protocolError(`${path}.detail.deliveryKind`);
      }
      if (
        typeof detail.originKind !== 'string'
        || !DAMAGE_ORIGIN_KINDS.has(detail.originKind)
      ) {
        protocolError(`${path}.detail.originKind`);
      }
      break;
    case 'STATUS_CHANGED':
      if (
        typeof detail.subject !== 'string'
        || typeof detail.statusKey !== 'string'
        || typeof detail.change !== 'string'
      ) {
        protocolError(`${path}.detail`);
      }
      break;
    case 'HEALTH_THRESHOLD_CROSSED':
      if (
        typeof detail.subject !== 'string'
        || typeof detail.attributeKey !== 'string'
        || !isNumericValue(detail.thresholdValue)
        || typeof detail.direction !== 'string'
      ) {
        protocolError(`${path}.detail`);
      }
      break;
    case 'INTERNAL_STATE_CHANGED':
      if (typeof detail.stateKey !== 'string' || typeof detail.changeKind !== 'string') {
        protocolError(`${path}.detail`);
      }
      break;
    case 'ENTITY_DIED':
    case 'ENTITY_UNTARGETABLE':
      if (typeof detail.subject !== 'string') protocolError(`${path}.detail.subject`);
      break;
    case 'PROCESS_CANCEL_REQUESTED':
      if (typeof detail.processKey !== 'string') protocolError(`${path}.detail.processKey`);
      break;
    case 'SPELL_SHIELD_BLOCKED':
      if (typeof detail.shieldEffectKey !== 'string') {
        protocolError(`${path}.detail.shieldEffectKey`);
      }
      break;
    default:
      break;
  }
  return value as SkillTriggerEventSource;
}

function assertCondition(value: unknown, path: string): SkillTriggerCondition {
  if (!isRecord(value)) protocolError(path);
  const conditionType = value.conditionType;
  if (typeof conditionType !== 'string' || !CONDITION_TYPES.has(conditionType)) {
    protocolError(`${path}.conditionType`);
  }
  if (!isRecord(value.detail)) protocolError(`${path}.detail`);
  const detail = value.detail;
  switch (conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      if (Object.keys(detail).length !== 1 || !Array.isArray(detail.categories) || detail.categories.length === 0
        || new Set(detail.categories).size !== detail.categories.length
        || detail.categories.some((category) => typeof category !== 'string' || !(SKILL_TRIGGER_TARGET_CATEGORIES as readonly string[]).includes(category))) {
        protocolError(`${path}.detail`);
      }
      break;
    case 'ATTRIBUTE_COMPARE':
      if (
        typeof detail.subject !== 'string'
        || typeof detail.attributeKey !== 'string'
        || typeof detail.attributeValueKind !== 'string'
        || typeof detail.comparator !== 'string'
        || !isNumericValue(detail.comparisonValue)
      ) {
        protocolError(`${path}.detail`);
      }
      break;
    case 'LIFECYCLE_CHECK': {
      const allowed = ['effectKey', 'subject', 'checkKind', 'comparator', 'comparisonValue'];
      if (Object.keys(detail).length !== allowed.length || Object.keys(detail).some((key) => !allowed.includes(key))) protocolError(`${path}.detail`);
      if (typeof detail.effectKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.effectKey)) protocolError(`${path}.detail.effectKey`);
      if (detail.subject !== null && (typeof detail.subject !== 'string' || !['SOURCE', 'CURRENT_TARGET', 'EVENT_SOURCE'].includes(detail.subject))) protocolError(`${path}.detail.subject`);
      if (detail.checkKind === 'STACKS_COMPARE') {
        if (typeof detail.comparator !== 'string' || !['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE'].includes(detail.comparator) || !isNumericValue(detail.comparisonValue)) protocolError(`${path}.detail`);
        if (detail.comparisonValue.kind === 'FIXED' && (!Number.isInteger(detail.comparisonValue.value) || detail.comparisonValue.value < 0)) protocolError(`${path}.detail.comparisonValue`);
      } else if ((detail.checkKind !== 'PRESENT' && detail.checkKind !== 'ABSENT') || detail.comparator !== null || detail.comparisonValue !== null) protocolError(`${path}.detail`);
      break;
    }
    case 'STATUS_CHECK':
      if (typeof detail.checkKind !== 'string' || typeof detail.statusKey !== 'string') {
        protocolError(`${path}.detail`);
      }
      break;
    case 'INTERNAL_STATE_CHECK':
      if (typeof detail.stateKey !== 'string' || typeof detail.valueKind !== 'string') {
        protocolError(`${path}.detail`);
      }
      break;
    case 'EVENT_VALUE_COMPARE':
      if (
        typeof detail.eventValueKey !== 'string'
        || !EVENT_VALUE_KEYS.has(detail.eventValueKey)
        || typeof detail.comparator !== 'string'
        || !isNumericValue(detail.comparisonValue)
      ) {
        protocolError(`${path}.detail`);
      }
      break;
    default:
      protocolError(`${path}.conditionType`);
  }
  return value as SkillTriggerCondition;
}

function assertBinding(value: unknown, path: string): SkillTriggerRuntimeInputBinding {
  if (!isRecord(value)) protocolError(path);
  const sourceType = value.sourceType;
  if (typeof sourceType !== 'string' || !SOURCE_TYPES.has(sourceType)) {
    protocolError(`${path}.sourceType`);
  }
  if (!isRecord(value.detail)) protocolError(`${path}.detail`);
  const detail = value.detail;
  if (sourceType === 'EVENT_VALUE') {
    if (typeof detail.eventValueKey !== 'string' || !EVENT_VALUE_KEYS.has(detail.eventValueKey)) {
      protocolError(`${path}.detail.eventValueKey`);
    }
  }
  if (sourceType === 'SOURCE_CAST_RESOURCE_COST') {
    if (Object.keys(detail).length !== 1 || typeof detail.attributeKey !== 'string'
      || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.attributeKey)) {
      protocolError(`${path}.detail`);
    }
  }
  if (sourceType === 'PRIOR_ACTION_RESULT') {
    if (
      typeof detail.sourceActionKey !== 'string'
      || typeof detail.sourceResultKey !== 'string'
      || typeof detail.outputKind !== 'string'
      || !PRIOR_RESULT_OUTPUT_KINDS.has(detail.outputKind)
    ) {
      protocolError(`${path}.detail`);
    }
    const extraKeys = Object.keys(detail).filter((key) => !PRIOR_RESULT_DETAIL_KEYS.has(key));
    if (extraKeys.length > 0) {
      protocolError(`${path}.detail`);
    }
  }
  return value as SkillTriggerRuntimeInputBinding;
}

function assertAction(value: unknown, path: string): SkillTriggerAction {
  if (!isRecord(value)) protocolError(path);
  const actionType = value.actionType;
  if (typeof actionType !== 'string' || !ACTION_TYPES.has(actionType)) {
    protocolError(`${path}.actionType`);
  }
  if (!isRecord(value.detail)) protocolError(`${path}.detail`);
  if (!Array.isArray(value.runtimeInputBindings) || !Array.isArray(value.resultModifiers)) {
    protocolError(path);
  }
  value.runtimeInputBindings.forEach((item, index) => {
    assertBinding(item, `${path}.runtimeInputBindings[${index}]`);
  });
  if (actionType === 'EXECUTE_EFFECT' && typeof value.detail.effectKey !== 'string') {
    protocolError(`${path}.detail.effectKey`);
  }
  if (actionType === 'START_PROCESS' && typeof value.detail.processKey !== 'string') {
    protocolError(`${path}.detail.processKey`);
  }
  if (
    actionType === 'FAIL_PROCESS'
    && (typeof value.detail.processKey !== 'string' || typeof value.detail.failureReason !== 'string')
  ) {
    protocolError(`${path}.detail`);
  }
  return value as SkillTriggerAction;
}

function assertGroup(value: unknown, path: string): SkillTriggerConditionGroup {
  if (!isRecord(value) || !Array.isArray(value.conditions)) protocolError(path);
  value.conditions.forEach((item, index) => {
    assertCondition(item, `${path}.conditions[${index}]`);
  });
  return value as SkillTriggerConditionGroup;
}

export function parseSkillTriggerRuleSummary(value: unknown): SkillTriggerRuleSummary {
  if (!isRecord(value)) protocolError('summary');
  const eventType = value.eventType;
  if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType as SkillTriggerEventType)) {
    protocolError('summary.eventType');
  }
  return {
    ruleKey: assertString(value.ruleKey, 'summary.ruleKey'),
    name: assertString(value.name, 'summary.name'),
    description: assertNullableString(value.description, 'summary.description'),
    eventType: eventType as SkillTriggerEventType,
    conditionGroupCount: assertNumber(value.conditionGroupCount, 'summary.conditionGroupCount'),
    actionCount: assertNumber(value.actionCount, 'summary.actionCount'),
    perTargetCooldownEnabled: assertBoolean(
      value.perTargetCooldownEnabled,
      'summary.perTargetCooldownEnabled'
    ),
    maxTriggersPerProcessEnabled: assertBoolean(
      value.maxTriggersPerProcessEnabled,
      'summary.maxTriggersPerProcessEnabled'
    ),
    sortOrder: assertNumber(value.sortOrder, 'summary.sortOrder'),
    updatedAt: assertString(value.updatedAt, 'summary.updatedAt')
  };
}

export function parseSkillTriggerRuleDetail(value: unknown): SkillTriggerRuleDetail {
  assertNumericUses(value, 'trigger', protocolError);
  if (!isRecord(value)) protocolError('detail');
  if (!Array.isArray(value.conditionGroups) || !Array.isArray(value.actions)) {
    protocolError('detail');
  }
  const eventSource = assertEventSource(value.eventSource, 'detail.eventSource');
  const conditionGroups = value.conditionGroups.map((item, index) => (
    assertGroup(item, `detail.conditionGroups[${index}]`)
  ));
  const actions = value.actions.map((item, index) => assertAction(item, `detail.actions[${index}]`));
  return {
    ruleKey: assertString(value.ruleKey, 'detail.ruleKey'),
    name: assertString(value.name, 'detail.name'),
    description: assertNullableString(value.description, 'detail.description'),
    sortOrder: assertNumber(value.sortOrder, 'detail.sortOrder'),
    eventSource,
    conditionGroups,
    actions,
    perTargetCooldown: value.perTargetCooldown === null || isRecord(value.perTargetCooldown)
      ? (value.perTargetCooldown as SkillTriggerRuleDetail['perTargetCooldown'])
      : protocolError('detail.perTargetCooldown'),
    maxTriggersPerProcess: value.maxTriggersPerProcess === null || isRecord(value.maxTriggersPerProcess)
      ? (value.maxTriggersPerProcess as SkillTriggerRuleDetail['maxTriggersPerProcess'])
      : protocolError('detail.maxTriggersPerProcess')
  };
}

function maybeParseDetail(data: unknown): SkillTriggerRuleDetail {
  return parseSkillTriggerRuleDetail(data);
}

function maybeParseSummaries(data: unknown): SkillTriggerRuleSummary[] {
  if (!Array.isArray(data)) {
    if (shouldValidateShape()) protocolError('list');
    return [];
  }
  if (!shouldValidateShape()) {
    return data as SkillTriggerRuleSummary[];
  }
  return data.map((item, index) => {
    try {
      return parseSkillTriggerRuleSummary(item);
    } catch (error) {
      if (error instanceof SkillTriggerRuleProtocolError) {
        throw new SkillTriggerRuleProtocolError(`${error.message}（index=${index}）`);
      }
      throw error;
    }
  });
}

export function listSkillTriggerRules(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillTriggerRuleSummary[]>> {
  return requestJson<unknown>(apiBaseUrl, triggerRulesPath(gameId, skillKey), { token })
    .then((result) => ({ ...result, data: maybeParseSummaries(result.data) }));
}

export function getSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  ruleKey: string,
  token: string
): Promise<ApiResult<SkillTriggerRuleDetail>> {
  return requestJson<unknown>(apiBaseUrl, triggerRulesPath(gameId, skillKey, ruleKey), { token })
    .then((result) => ({ ...result, data: maybeParseDetail(result.data) }));
}

export function createSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillTriggerRuleRequest
): Promise<ApiResult<SkillTriggerRuleDetail>> {
  return requestJson<unknown>(apiBaseUrl, triggerRulesPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseDetail(result.data) }));
}

export function updateSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  ruleKey: string,
  token: string,
  body: UpdateSkillTriggerRuleRequest
): Promise<ApiResult<SkillTriggerRuleDetail>> {
  return requestJson<unknown>(apiBaseUrl, triggerRulesPath(gameId, skillKey, ruleKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseDetail(result.data) }));
}

export function deleteSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  ruleKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, triggerRulesPath(gameId, skillKey, ruleKey), {
    method: 'DELETE',
    token
  });
}
