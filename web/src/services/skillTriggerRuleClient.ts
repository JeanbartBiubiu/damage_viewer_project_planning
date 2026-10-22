import {
  SKILL_TRIGGER_EVENT_TYPES,
  SKILL_TRIGGER_CONDITION_TYPES,
  SKILL_TRIGGER_ACTION_TYPES,
  SKILL_TRIGGER_CAST_PHASES,
  SKILL_TRIGGER_SOURCE_TYPES,
  SKILL_TRIGGER_EVENT_VALUE_KEYS,
  SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS,
  SKILL_TRIGGER_ONCE_PER_USE_SCOPES,
  SKILL_TRIGGER_DAMAGE_DELIVERY_KINDS,
  SKILL_TRIGGER_DAMAGE_ORIGIN_KINDS,
  SKILL_TRIGGER_SUBJECTS,
  SKILL_TRIGGER_COMPARATORS,
  SKILL_TRIGGER_RECENT_DAMAGE_OUTPUT_KINDS
} from '../types/skillSystemEnums.generated';
import { assertNumericUses } from './numericValue';
import { isNumericValue } from '../types/numericValue';
import { SKILL_TRIGGER_TARGET_CATEGORIES } from '../types/skillTriggerRule';
import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import { parseSkillProcessMoment } from './skillProcessMoment';
import type {
  CreateSkillTriggerRuleRequest,
  SkillTriggerAction,
  SkillTriggerCastPhase,
  SkillTriggerCondition,
  SkillTriggerConditionGroup,
  SkillTriggerEventSource,
  SkillTriggerEventType,
  SkillTriggerEventUseKind,
  SkillTriggerOncePerUse,
  SkillTriggerOncePerUseScope,
  SkillTriggerRuleDetail,
  SkillTriggerRuleSummary,
  SkillTriggerRuntimeInputBinding,
  UpdateSkillTriggerRuleRequest
} from '../types/skillTriggerRule';

const EVENT_TYPES = new Set<string>(SKILL_TRIGGER_EVENT_TYPES);

const CONDITION_TYPES = new Set<string>(SKILL_TRIGGER_CONDITION_TYPES);

const ACTION_TYPES = new Set<string>(SKILL_TRIGGER_ACTION_TYPES);
const CAST_PHASES = new Set<string>(SKILL_TRIGGER_CAST_PHASES);
const SKILL_USED_DETAIL_KEYS = new Set(['sourceSkillKey', 'useKind', 'castPhase']);
const ADVANCE_PROCESS_DETAIL_KEYS = new Set(['processKey', 'stepKey']);

const SOURCE_TYPES = new Set<string>(SKILL_TRIGGER_SOURCE_TYPES);

const EVENT_VALUE_KEYS = new Set<string>(SKILL_TRIGGER_EVENT_VALUE_KEYS);

const PRIOR_RESULT_OUTPUT_KINDS = new Set<string>(SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS);

const PRIOR_RESULT_DETAIL_KEYS = new Set(['sourceActionKey', 'sourceResultKey', 'outputKind']);
const ONCE_PER_USE_SCOPES = new Set<string>(SKILL_TRIGGER_ONCE_PER_USE_SCOPES);
const ONCE_PER_USE_KEYS = new Set(['groupKey', 'scope']);
const TRIGGER_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const DAMAGE_DELIVERY_KINDS = new Set<string>(SKILL_TRIGGER_DAMAGE_DELIVERY_KINDS);
const DAMAGE_ORIGIN_KINDS = new Set<string>(SKILL_TRIGGER_DAMAGE_ORIGIN_KINDS);
const SUBJECTS = new Set<string>(SKILL_TRIGGER_SUBJECTS);
const COMPARATORS = new Set<string>(SKILL_TRIGGER_COMPARATORS);
const RECENT_DAMAGE_OUTPUT_KINDS = new Set<string>(SKILL_TRIGGER_RECENT_DAMAGE_OUTPUT_KINDS);
const RUNTIME_BINDING_KEYS = new Set(['bindingKey', 'parameterKey', 'sourceType', 'detail']);
const RECENT_DAMAGE_DETAIL_KEYS = new Set(['subject', 'windowValue', 'outputKind', 'sourceSkillKey', 'damageTypeKey', 'deliveryKind', 'originKind']);

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

function assertOncePerUse(value: unknown, path: string): SkillTriggerOncePerUse | null {
  if (value === null) return null;
  if (!isRecord(value)) protocolError(path);
  const keys = Object.keys(value);
  if (keys.length !== ONCE_PER_USE_KEYS.size || keys.some((key) => !ONCE_PER_USE_KEYS.has(key))) {
    protocolError(path);
  }
  const groupKey = assertString(value.groupKey, `${path}.groupKey`);
  if (!TRIGGER_KEY_PATTERN.test(groupKey)) protocolError(`${path}.groupKey`);
  const scope = value.scope;
  if (typeof scope !== 'string' || !ONCE_PER_USE_SCOPES.has(scope as SkillTriggerOncePerUseScope)) {
    protocolError(`${path}.scope`);
  }
  return { groupKey, scope: scope as SkillTriggerOncePerUseScope };
}

function assertEventSource(value: unknown, path: string): SkillTriggerEventSource {
  if (!isRecord(value)) protocolError(path);
  const eventType = value.eventType;
  if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType as SkillTriggerEventType)) {
    protocolError(`${path}.eventType`);
  }
  if (!isRecord(value.detail)) protocolError(`${path}.detail`);
  const detail = value.detail;
  if (eventType !== 'SKILL_USED' && detail.castPhase !== null && detail.castPhase !== undefined) {
    protocolError(`${path}.detail.castPhase`);
  }
  switch (eventType) {
    case 'BASIC_ATTACK_RECEIVED':
    case 'SOURCE_INITIALIZED':
    case 'TAKEDOWN':
      if (Object.keys(detail).length !== 0) protocolError(`${path}.detail`);
      break;
    case 'SKILL_USED': {
      if (Object.keys(detail).some((key) => !SKILL_USED_DETAIL_KEYS.has(key))) {
        protocolError(`${path}.detail`);
      }
      if (typeof detail.useKind !== 'string') protocolError(`${path}.detail.useKind`);
      if (detail.sourceSkillKey !== null && typeof detail.sourceSkillKey !== 'string') {
        protocolError(`${path}.detail.sourceSkillKey`);
      }
      let castPhase: SkillTriggerCastPhase | null = null;
      if ('castPhase' in detail && detail.castPhase !== null && detail.castPhase !== undefined) {
        if (typeof detail.castPhase !== 'string' || !CAST_PHASES.has(detail.castPhase as SkillTriggerCastPhase)) {
          protocolError(`${path}.detail.castPhase`);
        }
        castPhase = detail.castPhase as SkillTriggerCastPhase;
      }
      value.detail = {
        sourceSkillKey: detail.sourceSkillKey as string | null,
        useKind: detail.useKind as SkillTriggerEventUseKind,
        castPhase
      };
      break;
    }
    case 'SKILL_HIT':
      if (detail.sourceSkillKey !== null && typeof detail.sourceSkillKey !== 'string') {
        protocolError(`${path}.detail.sourceSkillKey`);
      }
      if (Object.keys(detail).some(key => !['sourceSkillKey', 'processMoment'].includes(key))) protocolError(`${path}.detail`);
      if (Object.prototype.hasOwnProperty.call(detail, 'processMoment')) {
        const phase = detail.processMoment;
        if (typeof detail.sourceSkillKey !== 'string' || !TRIGGER_KEY_PATTERN.test(detail.sourceSkillKey)
          || !isRecord(phase) || Object.keys(phase).length !== 3
          || Object.keys(phase).some(key => !['processKey', 'moment', 'requiresPriorStepKey'].includes(key))
          || typeof phase.processKey !== 'string' || !TRIGGER_KEY_PATTERN.test(phase.processKey)
          || !isRecord(phase.moment) || Object.keys(phase.moment).length !== 2
          || Object.keys(phase.moment).some(key => !['momentType', 'stepKey'].includes(key))
          || phase.moment.momentType !== 'STEP_EXECUTION' || typeof phase.moment.stepKey !== 'string' || !TRIGGER_KEY_PATTERN.test(phase.moment.stepKey)
          || phase.requiresPriorStepKey !== null && (typeof phase.requiresPriorStepKey !== 'string' || !TRIGGER_KEY_PATTERN.test(phase.requiresPriorStepKey))) {
          protocolError(`${path}.detail.processMoment`);
        }
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
    case 'PROCESS_RESOLVED':
      if (Object.keys(detail).length !== 2 || Object.keys(detail).some(key => !['sourceSkillKey', 'processKey'].includes(key))
        || typeof detail.sourceSkillKey !== 'string' || !TRIGGER_KEY_PATTERN.test(detail.sourceSkillKey)
        || typeof detail.processKey !== 'string' || !TRIGGER_KEY_PATTERN.test(detail.processKey)) protocolError(`${path}.detail`);
      break;
    case 'PROCESS_MOMENT':
      if (typeof detail.processKey !== 'string' || !isRecord(detail.moment)) {
        protocolError(`${path}.detail`);
      }
      detail.moment = parseSkillProcessMoment(detail.moment, `${path}.detail.moment`, protocolError);
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
    case 'EXPLICIT_TARGET_IS_SOURCE':
    case 'SKILL_HIT_TARGET_IS_ENEMY':
      if (Object.keys(detail).length !== 0) protocolError(`${path}.detail`);
      break;
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
      if (allowed.some(key => !(key in detail)) || Object.keys(detail).some((key) => !allowed.includes(key) && key !== 'effectSkillKey')) protocolError(`${path}.detail`);
      if (detail.effectSkillKey !== undefined && detail.effectSkillKey !== null
        && (typeof detail.effectSkillKey !== 'string' || !TRIGGER_KEY_PATTERN.test(detail.effectSkillKey))) protocolError(`${path}.detail.effectSkillKey`);
      if (typeof detail.effectKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.effectKey)) protocolError(`${path}.detail.effectKey`);
      if (detail.subject !== null && (typeof detail.subject !== 'string' || !SUBJECTS.has(detail.subject))) protocolError(`${path}.detail.subject`);
      if (detail.checkKind === 'STACKS_COMPARE') {
        if (typeof detail.comparator !== 'string' || !COMPARATORS.has(detail.comparator) || !isNumericValue(detail.comparisonValue)) protocolError(`${path}.detail`);
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
      if (detail.valueKind === 'DAMAGE_BEFORE_VALUE' && (Object.keys(detail).length !== 7
        || Object.keys(detail).some(key => !['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'].includes(key))
        || typeof detail.stateSkillKey !== 'string' || !TRIGGER_KEY_PATTERN.test(detail.stateSkillKey)
        || !TRIGGER_KEY_PATTERN.test(detail.stateKey as string) || detail.optionKey !== null || detail.expectedBoolean !== null
        || typeof detail.comparator !== 'string' || !COMPARATORS.has(detail.comparator)
        || !isNumericValue(detail.comparisonValue) || detail.comparisonValue.kind === 'FIXED'
          && (!Number.isSafeInteger(detail.comparisonValue.value) || detail.comparisonValue.value < 0))) protocolError(`${path}.detail`);
      break;
    case 'EVENT_VALUE_COMPARE':
      if (
        Object.keys(detail).some(key => !['eventValueKey', 'comparator', 'comparisonValue', 'shieldResult'].includes(key))
        || typeof detail.eventValueKey !== 'string'
        || !EVENT_VALUE_KEYS.has(detail.eventValueKey)
        || typeof detail.comparator !== 'string'
        || !COMPARATORS.has(detail.comparator)
        || !isNumericValue(detail.comparisonValue)
      ) {
        protocolError(`${path}.detail`);
      }
      if (Object.prototype.hasOwnProperty.call(detail, 'shieldResult')) {
        const selected = detail.shieldResult;
        if (detail.eventValueKey !== 'SHIELD_ABSORBED' || !isRecord(selected)
          || Object.keys(selected).length !== 3
          || Object.keys(selected).some(key => !['skillKey', 'effectKey', 'resultKey'].includes(key))
          || ['skillKey', 'effectKey', 'resultKey'].some(key => typeof selected[key] !== 'string'
            || !TRIGGER_KEY_PATTERN.test(selected[key] as string))) protocolError(`${path}.detail.shieldResult`);
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
  if (sourceType === 'COMBAT_ELAPSED_TIME' || sourceType === 'RECENT_DAMAGE_SUM') {
    if (Object.keys(value).length !== RUNTIME_BINDING_KEYS.size || Object.keys(value).some(key => !RUNTIME_BINDING_KEYS.has(key))) protocolError(path);
    for (const key of ['bindingKey', 'parameterKey'] as const) {
      if (typeof value[key] !== 'string' || !TRIGGER_KEY_PATTERN.test(value[key])) protocolError(`${path}.${key}`);
    }
    if (typeof detail.subject !== 'string' || !SUBJECTS.has(detail.subject)) protocolError(`${path}.detail.subject`);
    if (sourceType === 'COMBAT_ELAPSED_TIME') {
      if (Object.keys(detail).length !== 1) protocolError(`${path}.detail`);
    } else {
      if (Object.keys(detail).length !== RECENT_DAMAGE_DETAIL_KEYS.size || Object.keys(detail).some(key => !RECENT_DAMAGE_DETAIL_KEYS.has(key))) protocolError(`${path}.detail`);
      if (!isNumericValue(detail.windowValue)) protocolError(`${path}.detail.windowValue`);
      if (typeof detail.outputKind !== 'string' || !RECENT_DAMAGE_OUTPUT_KINDS.has(detail.outputKind)) protocolError(`${path}.detail.outputKind`);
      for (const key of ['sourceSkillKey', 'damageTypeKey'] as const) {
        if (detail[key] !== null && (typeof detail[key] !== 'string' || !TRIGGER_KEY_PATTERN.test(detail[key]))) protocolError(`${path}.detail.${key}`);
      }
      if (typeof detail.deliveryKind !== 'string' || !DAMAGE_DELIVERY_KINDS.has(detail.deliveryKind)) protocolError(`${path}.detail.deliveryKind`);
      if (typeof detail.originKind !== 'string' || !DAMAGE_ORIGIN_KINDS.has(detail.originKind)) protocolError(`${path}.detail.originKind`);
    }
  }
  if (sourceType === 'EVENT_VALUE') {
    if (Object.keys(detail).length !== 1 || typeof detail.eventValueKey !== 'string' || !EVENT_VALUE_KEYS.has(detail.eventValueKey)) {
      protocolError(`${path}.detail.eventValueKey`);
    }
  }
  if (sourceType === 'SOURCE_CAST_RESOURCE_COST') {
    if (Object.keys(detail).length !== 1 || typeof detail.attributeKey !== 'string'
      || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.attributeKey)) {
      protocolError(`${path}.detail`);
    }
  }
  if (sourceType === 'SCENE_ATTRIBUTE_SNAPSHOT') {
    if (Object.keys(value).length !== RUNTIME_BINDING_KEYS.size || Object.keys(value).some(key => !RUNTIME_BINDING_KEYS.has(key))) protocolError(path);
    for (const key of ['bindingKey', 'parameterKey'] as const) {
      if (typeof value[key] !== 'string' || !TRIGGER_KEY_PATTERN.test(value[key])) protocolError(`${path}.${key}`);
    }
    if (Object.keys(detail).length !== 3 || Object.keys(detail).some(key => !['subject', 'attributeKey', 'sources'].includes(key))
      || !['SOURCE', 'TARGET'].includes(String(detail.subject)) || typeof detail.attributeKey !== 'string'
      || !TRIGGER_KEY_PATTERN.test(detail.attributeKey) || !Array.isArray(detail.sources) || !detail.sources.length
      || new Set(detail.sources).size !== detail.sources.length
      || detail.sources.some(source => source !== 'CHARACTER_LEVEL' && source !== 'EQUIPMENT_DIRECT')) protocolError(`${path}.detail`);
  }
  if (sourceType === 'SCENE_INITIAL_PARAMETER') {
    if (Object.keys(value).length !== RUNTIME_BINDING_KEYS.size || Object.keys(value).some(key => !RUNTIME_BINDING_KEYS.has(key))) protocolError(path);
    for (const key of ['bindingKey', 'parameterKey'] as const) {
      if (typeof value[key] !== 'string' || !TRIGGER_KEY_PATTERN.test(value[key])) protocolError(`${path}.${key}`);
    }
    if (Object.keys(detail).some(key => !['minValue', 'maxValue', 'sharedInputKey'].includes(key))
      || typeof detail.minValue !== 'number' || !Number.isFinite(detail.minValue)
      || typeof detail.maxValue !== 'number' || !Number.isFinite(detail.maxValue)
      || detail.minValue > detail.maxValue || Object.prototype.hasOwnProperty.call(detail, 'sharedInputKey')
      && (typeof detail.sharedInputKey !== 'string' || !TRIGGER_KEY_PATTERN.test(detail.sharedInputKey))) protocolError(`${path}.detail`);
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
  if (actionType === 'MODIFY_INTERNAL_STATE') {
    const ensure = value.detail.operation === 'ENSURE_REMAINING' || value.detail.operation === 'ENSURE_REMAINING_PRESERVE_PHASE';
    if (value.targetContext !== (ensure ? 'CURRENT_TARGET' : 'EVENT_SOURCE') || value.resultModifiers.length !== 0 || value.runtimeInputBindings.length !== 0
      || Object.keys(value.detail).length !== 4 || Object.keys(value.detail).some(key => !['stateSkillKey', 'stateKey', 'operation', 'value'].includes(key))
      || typeof value.detail.stateSkillKey !== 'string' || typeof value.detail.stateKey !== 'string'
      || !['REDUCE_RECOVERY', 'ENSURE_REMAINING', 'ENSURE_REMAINING_PRESERVE_PHASE'].includes(String(value.detail.operation))) protocolError(`${path}.detail`);
    if (ensure && (!isNumericValue(value.detail.value) || value.detail.value.kind === 'FIXED'
      && (!Number.isSafeInteger(value.detail.value.value) || value.detail.value.value <= 0))) protocolError(`${path}.detail.value`);
    if (ensure && (!TRIGGER_KEY_PATTERN.test(String(value.detail.stateSkillKey))
      || !TRIGGER_KEY_PATTERN.test(String(value.detail.stateKey)))) protocolError(`${path}.detail`);
  }
  if (
    actionType === 'FAIL_PROCESS'
    && (typeof value.detail.processKey !== 'string' || typeof value.detail.failureReason !== 'string')
  ) {
    protocolError(`${path}.detail`);
  }
  if (actionType === 'ADVANCE_PROCESS') {
    if (value.targetContext !== null) protocolError(`${path}.targetContext`);
    if (value.runtimeInputBindings.length !== 0) protocolError(`${path}.runtimeInputBindings`);
    if (value.resultModifiers.length !== 0) protocolError(`${path}.resultModifiers`);
    if (
      Object.keys(value.detail).some((key) => !ADVANCE_PROCESS_DETAIL_KEYS.has(key))
      || typeof value.detail.processKey !== 'string'
      || typeof value.detail.stepKey !== 'string'
      || !/^[a-z][a-z0-9_]{0,63}$/.test(value.detail.processKey)
      || !/^[a-z][a-z0-9_]{0,63}$/.test(value.detail.stepKey)
    ) {
      protocolError(`${path}.detail`);
    }
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
    oncePerUseEnabled: assertBoolean(value.oncePerUseEnabled, 'summary.oncePerUseEnabled'),
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
  conditionGroups.forEach((group, groupIndex) => group.conditions.forEach((condition, conditionIndex) => {
    if (condition.conditionType === 'INTERNAL_STATE_CHECK' && condition.detail.valueKind === 'DAMAGE_BEFORE_VALUE'
      && eventSource.eventType !== 'DAMAGE_DEALT') protocolError(`detail.conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.valueKind`);
    if (condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY' && eventSource.eventType !== 'SKILL_HIT') {
      protocolError(`detail.conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail`);
    }
    if (condition.conditionType === 'EVENT_VALUE_COMPARE' && condition.detail.shieldResult !== undefined
      && eventSource.eventType !== 'DAMAGE_TAKEN') {
      protocolError(`detail.conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.shieldResult`);
    }
  }));
  const actions = value.actions.map((item, index) => assertAction(item, `detail.actions[${index}]`));
  actions.forEach((action, index) => {
    if (action.actionType === 'MODIFY_INTERNAL_STATE' && action.detail.operation === 'ENSURE_REMAINING_PRESERVE_PHASE'
      && (eventSource.eventType !== 'SKILL_HIT' || !eventSource.detail.sourceSkillKey
        || !TRIGGER_KEY_PATTERN.test(eventSource.detail.sourceSkillKey))) protocolError(`detail.actions[${index}].detail`);
    if (action.actionType === 'MODIFY_INTERNAL_STATE' && action.detail.operation === 'ENSURE_REMAINING'
      && (eventSource.eventType !== 'SKILL_USED' || eventSource.detail.useKind !== 'ACTIVE'
        || eventSource.detail.castPhase !== 'INITIAL' || !eventSource.detail.sourceSkillKey
        || !TRIGGER_KEY_PATTERN.test(eventSource.detail.sourceSkillKey))) protocolError(`detail.actions[${index}].detail`);
  });
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
      : protocolError('detail.maxTriggersPerProcess'),
    oncePerUse: assertOncePerUse(value.oncePerUse, 'detail.oncePerUse')
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
