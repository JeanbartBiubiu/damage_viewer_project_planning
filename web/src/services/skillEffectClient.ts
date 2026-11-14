import { assertNumericUses } from './numericValue';
import { momentSlowLifecycleIssue } from './momentSlowLifecycle';
import { isNumericValue } from '../types/numericValue';
import { isCappedReductionResultShape } from './cappedPhysicalReductionContract';
import { isCooldownRatioOperation, isValidCooldownReductionRatio } from '../types/cooldownRatio';
import { isValidCooldownRemainingDuration } from '../types/cooldownRemaining';
import { isValidCooldownDurationValueRule } from '../types/cooldownDuration';
import { isValidLifecycleExtensionDuration } from '../types/lifecycleExtension';
import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillEffectRequest,
  SkillEffect,
  SkillEffectResult,
  SkillEffectResultType,
  SkillEffectSummary,
  SkillEffectValueRule,
  UpdateSkillEffectRequest
} from '../types/skillEffect';

const RESULT_TYPES = new Set<SkillEffectResultType>([
  'DAMAGE',
  'DIRECT_HEAL',
  'NORMAL_SHIELD',
  'ATTRIBUTE_CHANGE',
  'RESOURCE_CHANGE',
  'COOLDOWN_CHANGE',
  'COOLDOWN_DURATION_MODIFIER',
  'STATUS_OPERATION',
  'LIFECYCLE_OPERATION',
  'DAMAGE_MODIFIER',
  'HEALING_MODIFIER',
  'SHIELD_RECEIVED_MODIFIER',
  'ATTACK_TIMER_RESET',
  'DAMAGE_IMMUNITY',
  'HEALTH_FLOOR',
  'SPELL_SHIELD',
  'EXECUTE',
  'HIT_LINK_APPLICATION',
  'ATTACK_LINK_APPLICATION',
  'SKILL_HASTE_MODIFIER'
]);
const AFFECTED_SKILL_SCOPE_MODES = new Set(['ALL', 'SKILLS', 'CATEGORIES']);

const DAMAGE_DELIVERY_KINDS = new Set(['SKILL', 'BASIC_ATTACK']);
const DAMAGE_ORIGIN_KINDS = new Set(['DIRECT', 'REFLECTED']);
const CRITICAL_MODES = new Set(['DISALLOWED', 'SOURCE_CRIT_CHANCE', 'FORCED']);
const VAMP_TYPES = new Set(['LIFE_STEAL', 'OMNIVAMP', 'PHYSICAL_VAMP', 'SPELL_VAMP']);
const VAMP_BASIS_OUTPUT_KINDS = new Set(['POST_DEFENSE_DAMAGE', 'ACTUAL_HP_LOSS']);
const SHIELD_DECAY_MODES = new Set(['NONE', 'LINEAR_TO_ZERO']);
const MODIFIER_OPERATIONS = new Set(['INCREASE', 'DECREASE']);
const DAMAGE_MODIFIER_DIRECTIONS = new Set(['DEALT', 'TAKEN']);
const HEALING_MODIFIER_DIRECTIONS = new Set(['DONE', 'RECEIVED']);
const DAMAGE_FILTER_DELIVERY_KINDS = new Set(['ANY', 'SKILL', 'BASIC_ATTACK']);
const DAMAGE_FILTER_ORIGIN_KINDS = new Set(['ANY', 'DIRECT', 'REFLECTED']);
const CRITICAL_FILTERS = new Set(['ANY', 'CRITICAL_ONLY', 'NON_CRITICAL_ONLY']);
const HEALING_KINDS = new Set(['ANY', 'DIRECT', 'VAMP']);
const SPELL_SHIELD_BLOCK_SCOPES = new Set(['SKILL', 'EFFECT', 'DAMAGE_INSTANCE', 'RESULT']);

export class SkillEffectProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillEffectProtocolError';
  }
}

function effectsPath(gameId: string, skillKey: string, effectKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/effects`;
  return effectKey === undefined ? base : `${base}/${encodePathSegment(effectKey)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(path: string): never {
  throw new SkillEffectProtocolError(`技能效果响应与固定联合类型不匹配：${path}`);
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string') protocolError(path);
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) protocolError(path);
  return value;
}

function assertNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return assertString(value, path);
}

function assertEnum(value: unknown, allowed: ReadonlySet<string>, path: string): string {
  if (typeof value !== 'string' || !allowed.has(value)) protocolError(path);
  return value;
}

function assertValueRule(value: unknown, path: string): void {
  if (!isRecord(value)) protocolError(path);
  if (!isNumericValue(value.value)) protocolError(`${path}.value`);
  assertNumber(value.fixedMultiplier, `${path}.fixedMultiplier`);
  if (value.fixedMinValue !== null) assertNumber(value.fixedMinValue, `${path}.fixedMinValue`);
  if (value.fixedMaxValue !== null) assertNumber(value.fixedMaxValue, `${path}.fixedMaxValue`);
}

function assertEmptyDetail(detail: Record<string, unknown>, path: string): void {
  if (Object.keys(detail).length !== 0) protocolError(`${path}.detail`);
}

function assertExactDetailKeys(
  detail: Record<string, unknown>,
  keys: readonly string[],
  path: string
): void {
  assertExactKeys(detail, keys, `${path}.detail`);
}

function assertExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string
): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some((key) => !(key in record))) {
    protocolError(path);
  }
}

function assertStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) protocolError(path);
  value.forEach((item, index) => {
    assertString(item, `${path}[${index}]`);
  });
}

function assertAffectedSkillScope(value: unknown, path: string): void {
  if (!isRecord(value)) protocolError(path);
  assertExactKeys(value, ['mode', 'skillKeys', 'skillCategoryKeys'], path);
  const mode = assertEnum(value.mode, AFFECTED_SKILL_SCOPE_MODES, `${path}.mode`);
  assertStringArray(value.skillKeys, `${path}.skillKeys`);
  assertStringArray(value.skillCategoryKeys, `${path}.skillCategoryKeys`);
  const skillKeys = value.skillKeys as unknown[];
  const skillCategoryKeys = value.skillCategoryKeys as unknown[];
  if (mode === 'ALL') {
    if (skillKeys.length !== 0) protocolError(`${path}.skillKeys`);
    if (skillCategoryKeys.length !== 0) protocolError(`${path}.skillCategoryKeys`);
    return;
  }
  if (mode === 'SKILLS') {
    if (skillKeys.length === 0) protocolError(`${path}.skillKeys`);
    if (skillCategoryKeys.length !== 0) protocolError(`${path}.skillCategoryKeys`);
    return;
  }
  if (skillCategoryKeys.length === 0) protocolError(`${path}.skillCategoryKeys`);
  if (skillKeys.length !== 0) protocolError(`${path}.skillKeys`);
}

function assertDiscreteLinkLifecycle(value: Record<string, unknown>, path: string): void {
  if (value.lifecycleBehavior === null) return;
  if (!isRecord(value.lifecycleBehavior)) protocolError(`${path}.lifecycleBehavior`);
  if (value.lifecycleBehavior.moment === 'PERSISTENT') {
    protocolError(`${path}.lifecycleBehavior`);
  }
  if (value.lifecycleBehavior.stackValueMode != null) {
    protocolError(`${path}.lifecycleBehavior.stackValueMode`);
  }
  if (value.lifecycleBehavior.reapplicationValueMode != null) {
    protocolError(`${path}.lifecycleBehavior.reapplicationValueMode`);
  }
}

function assertResult(value: unknown, path: string): SkillEffectResult {
  if (!isRecord(value)) protocolError(path);
  const resultType = value.resultType;
  if (typeof resultType !== 'string' || !RESULT_TYPES.has(resultType as SkillEffectResultType)) {
    protocolError(`${path}.resultType`);
  }
  assertString(value.resultKey, `${path}.resultKey`);
  assertString(value.name, `${path}.name`);
  assertEnum(value.target, new Set(['SOURCE', 'TARGET']), `${path}.target`);
  assertNullableString(value.description, `${path}.description`);
  assertNumber(value.sortOrder, `${path}.sortOrder`);
  if (value.spellShieldBlockScope !== null) {
    assertEnum(
      value.spellShieldBlockScope,
      SPELL_SHIELD_BLOCK_SCOPES,
      `${path}.spellShieldBlockScope`
    );
  }
  if (value.lifecycleBehavior !== null && !isRecord(value.lifecycleBehavior)) {
    protocolError(`${path}.lifecycleBehavior`);
  }
  if (!isRecord(value.detail)) protocolError(`${path}.detail`);
  const detail = value.detail;
  if (resultType !== 'DAMAGE_MODIFIER' && 'maximumReductionRatioValue' in detail) protocolError(`${path}.detail.maximumReductionRatioValue`);
  if (resultType !== 'DAMAGE' && 'attackDamageRole' in detail) protocolError(`${path}.detail.attackDamageRole`);
  const persistent = isRecord(value.lifecycleBehavior)
    && value.lifecycleBehavior.moment === 'PERSISTENT';
  const persistentStatusApplyBlockScope = value.target === 'TARGET'
    && persistent
    && resultType === 'STATUS_OPERATION'
    && detail.operation === 'APPLY';
  const blockScopeEligible = value.target === 'TARGET'
    && (
      persistentStatusApplyBlockScope
      || persistent && resultType === 'ATTRIBUTE_CHANGE' && detail.operation !== 'SET'
      || (
        !persistent
        && (
          resultType === 'DAMAGE'
          || resultType === 'ATTRIBUTE_CHANGE'
          || resultType === 'RESOURCE_CHANGE'
          || resultType === 'COOLDOWN_CHANGE'
          || resultType === 'STATUS_OPERATION'
          || resultType === 'LIFECYCLE_OPERATION'
          || resultType === 'EXECUTE'
          || resultType === 'HIT_LINK_APPLICATION'
          || resultType === 'ATTACK_LINK_APPLICATION'
        )
      )
    );
  if (value.spellShieldBlockScope !== null) {
    if (!blockScopeEligible) protocolError(`${path}.spellShieldBlockScope`);
    if (persistentStatusApplyBlockScope && value.spellShieldBlockScope !== 'RESULT') {
      protocolError(`${path}.spellShieldBlockScope`);
    }
    if (value.spellShieldBlockScope === 'DAMAGE_INSTANCE' && resultType !== 'DAMAGE') {
      protocolError(`${path}.spellShieldBlockScope`);
    }
  }

  if (resultType === 'ATTACK_TIMER_RESET') {
    assertExactDetailKeys(detail, [], path);
    if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    const behavior = value.lifecycleBehavior;
    if (isRecord(behavior)) {
      assertExactKeys(behavior, [
        'moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'
      ], `${path}.lifecycleBehavior`);
      assertEnum(behavior.moment, new Set([
        'APPLICATION', 'FULL_STACKS', 'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE'
      ]), `${path}.lifecycleBehavior.moment`);
      if (behavior.valueReadMode !== null || behavior.stackValueMode !== null
        || behavior.reapplicationValueMode !== null) {
        protocolError(`${path}.lifecycleBehavior`);
      }
      if (behavior.moment === 'PERIODIC') {
        assertEnum(behavior.periodicExecutionMode, new Set([
          'ONCE_PER_INSTANCE', 'ONCE_PER_ACTIVE_STACK'
        ]), `${path}.lifecycleBehavior.periodicExecutionMode`);
      } else if (behavior.periodicExecutionMode !== null) {
        protocolError(`${path}.lifecycleBehavior.periodicExecutionMode`);
      }
    }
    return value as SkillEffectResult;
  }
  if (resultType === 'SPELL_SHIELD') {
    if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    if (Object.keys(detail).length !== 0) protocolError(`${path}.detail`);
    if (!persistent) protocolError(`${path}.lifecycleBehavior`);
    return value as SkillEffectResult;
  }

  if (resultType === 'STATUS_OPERATION') {
    assertExactDetailKeys(detail, ['statusKey', 'operation'], path);
    assertString(detail.statusKey, `${path}.detail.statusKey`);
    assertEnum(detail.operation, new Set(['APPLY', 'REMOVE']), `${path}.detail.operation`);
    if (value.valueRule !== null) {
      if (detail.operation !== 'APPLY') protocolError(`${path}.valueRule`);
      assertValueRule(value.valueRule, `${path}.valueRule`);
      const rule = value.valueRule as Record<string, unknown>;
      const behavior = value.lifecycleBehavior;
      if (!isRecord(behavior) || behavior.moment !== 'PERSISTENT'
        || !['APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION'].includes(String(behavior.valueReadMode)) || behavior.stackValueMode !== 'SHARED'
        || behavior.reapplicationValueMode !== (behavior.valueReadMode === 'MOMENT_EVALUATION' ? null : 'REPLACE') || behavior.periodicExecutionMode !== null) {
        protocolError(`${path}.lifecycleBehavior`);
      }
      if (rule.fixedMinValue !== (behavior.valueReadMode === 'MOMENT_EVALUATION' ? null : 0)) protocolError(`${path}.valueRule.fixedMinValue`);
      if (rule.fixedMaxValue !== (behavior.valueReadMode === 'MOMENT_EVALUATION' ? null : 1)) protocolError(`${path}.valueRule.fixedMaxValue`);
      if (behavior.valueReadMode === 'MOMENT_EVALUATION' && (rule.fixedMultiplier as number) < 0) protocolError(`${path}.valueRule.fixedMultiplier`);
    }
    return value as SkillEffectResult;
  }
  if (resultType === 'DAMAGE_IMMUNITY') {
    if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    assertNullableString(detail.damageTypeKey, `${path}.detail.damageTypeKey`);
    assertEnum(
      detail.deliveryKind,
      DAMAGE_FILTER_DELIVERY_KINDS,
      `${path}.detail.deliveryKind`
    );
    assertEnum(detail.originKind, DAMAGE_FILTER_ORIGIN_KINDS, `${path}.detail.originKind`);
    return value as SkillEffectResult;
  }
  if (resultType === 'COOLDOWN_CHANGE') {
    if (!('affectedSkillScope' in detail)) protocolError(`${path}.detail.affectedSkillScope`);
    if ('affectedSkillKeys' in detail) protocolError(`${path}.detail.affectedSkillKeys`);
    assertExactDetailKeys(detail, ['operation', 'affectedSkillScope', ...('cumulativeLimit' in detail ? ['cumulativeLimit'] : [])], path);
    assertEnum(detail.operation, new Set(['REDUCE', 'INCREASE', 'RESET', 'REDUCE_REMAINING_RATIO', 'REDUCE_TOTAL_RATIO', 'SET_REMAINING']), `${path}.detail.operation`);
    assertAffectedSkillScope(detail.affectedSkillScope, `${path}.detail.affectedSkillScope`);
    if(Object.prototype.hasOwnProperty.call(detail,'cumulativeLimit')) {
      const limit=detail.cumulativeLimit;
      if(detail.operation!=='REDUCE_TOTAL_RATIO'||!limit||typeof limit!=='object'||Array.isArray(limit))protocolError(`${path}.detail.cumulativeLimit`);
      const row=limit as Record<string,unknown>;
      if(Object.keys(row).length!==2||Object.keys(row).some(key=>!['groupKey','maxRatio'].includes(key))
        ||typeof row.groupKey!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(row.groupKey)
        ||typeof row.maxRatio!=='number'||!Number.isFinite(row.maxRatio)||row.maxRatio<=0||row.maxRatio>1)protocolError(`${path}.detail.cumulativeLimit`);
    }
    if (detail.operation === 'RESET') {
      if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    } else {
      assertValueRule(value.valueRule, `${path}.valueRule`);
      const rule = value.valueRule as SkillEffectValueRule;
      if (isCooldownRatioOperation(detail.operation as string) && rule.value.kind === 'FIXED'
        && !isValidCooldownReductionRatio(rule.value.value, rule)) {
        protocolError(`${path}.valueRule`);
      }
      if (detail.operation === 'SET_REMAINING'
        && ((rule.fixedMaxValue !== null && rule.fixedMaxValue < 0)
          || (rule.value.kind === 'FIXED' && !isValidCooldownRemainingDuration(rule.value.value, rule)))) {
        protocolError(`${path}.valueRule`);
      }
    }
    return value as SkillEffectResult;
  }
  if (resultType === 'COOLDOWN_DURATION_MODIFIER') {
    assertExactDetailKeys(detail, ['affectedSkillScope'], path);
    assertAffectedSkillScope(detail.affectedSkillScope, `${path}.detail.affectedSkillScope`);
    const scope = detail.affectedSkillScope as Record<string, unknown>;
    if (scope.mode !== 'SKILLS' || !Array.isArray(scope.skillKeys) || !scope.skillKeys.length || new Set(scope.skillKeys).size !== scope.skillKeys.length
      || !Array.isArray(scope.skillCategoryKeys) || scope.skillCategoryKeys.length) protocolError(`${path}.detail.affectedSkillScope`);
    if (value.target !== 'SOURCE' || value.spellShieldBlockScope !== null || !isRecord(value.lifecycleBehavior)) protocolError(`${path}.lifecycleBehavior`);
    const behavior = value.lifecycleBehavior;
    assertExactKeys(behavior, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
    if (behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT' || behavior.stackValueMode !== 'SHARED'
      || behavior.reapplicationValueMode !== 'REPLACE' || behavior.periodicExecutionMode !== null) protocolError(`${path}.lifecycleBehavior`);
    assertValueRule(value.valueRule, `${path}.valueRule`);
    const rule = value.valueRule as SkillEffectValueRule;
    if (!isValidCooldownDurationValueRule(rule)) protocolError(`${path}.valueRule`);
    return value as SkillEffectResult;
  }
  if (resultType === 'SKILL_HASTE_MODIFIER') {
    if (value.spellShieldBlockScope !== null) protocolError(`${path}.spellShieldBlockScope`);
    if (!isRecord(value.lifecycleBehavior)) protocolError(`${path}.lifecycleBehavior`);
    if (value.lifecycleBehavior.moment !== 'PERSISTENT') {
      protocolError(`${path}.lifecycleBehavior.moment`);
    }
    if (value.lifecycleBehavior.valueReadMode !== 'APPLICATION_SNAPSHOT') {
      protocolError(`${path}.lifecycleBehavior.valueReadMode`);
    }
    if (value.lifecycleBehavior.stackValueMode !== 'SHARED') {
      protocolError(`${path}.lifecycleBehavior.stackValueMode`);
    }
    if (value.lifecycleBehavior.reapplicationValueMode !== 'KEEP') {
      protocolError(`${path}.lifecycleBehavior.reapplicationValueMode`);
    }
    if (value.lifecycleBehavior.periodicExecutionMode != null) {
      protocolError(`${path}.lifecycleBehavior.periodicExecutionMode`);
    }
    assertValueRule(value.valueRule, `${path}.valueRule`);
    if (!('affectedSkillScope' in detail)) protocolError(`${path}.detail.affectedSkillScope`);
    if ('affectedSkillKeys' in detail) protocolError(`${path}.detail.affectedSkillKeys`);
    if ('modifierZoneKey' in detail) protocolError(`${path}.detail.modifierZoneKey`);
    assertExactDetailKeys(detail, ['operation', 'affectedSkillScope'], path);
    assertEnum(detail.operation, MODIFIER_OPERATIONS, `${path}.detail.operation`);
    assertAffectedSkillScope(detail.affectedSkillScope, `${path}.detail.affectedSkillScope`);
    return value as SkillEffectResult;
  }
  if (resultType === 'LIFECYCLE_OPERATION') {
    assertString(detail.targetEffectKey, `${path}.detail.targetEffectKey`);
    const operation = assertEnum(
      detail.operation,
      new Set(['INCREASE', 'DECREASE', 'SET', 'REFRESH', 'EXTEND_DURATION', 'ENSURE_REMAINING', 'CONSUME', 'REMOVE']),
      `${path}.detail.operation`
    );
    if (operation === 'REFRESH' || operation === 'REMOVE') {
      if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    } else {
      assertValueRule(value.valueRule, `${path}.valueRule`);
      const rule = value.valueRule as SkillEffectValueRule;
      if ((operation === 'EXTEND_DURATION' || operation === 'ENSURE_REMAINING') && rule.value.kind === 'FIXED'
        && !isValidLifecycleExtensionDuration(rule.value.value, rule, operation === 'ENSURE_REMAINING')) {
        protocolError(`${path}.valueRule`);
      }
    }
    return value as SkillEffectResult;
  }

  assertValueRule(value.valueRule, `${path}.valueRule`);
  switch (resultType) {
    case 'DAMAGE': {
      assertExactDetailKeys(detail, ['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampQualification', 'vampOverrides',
        ...('attackDamageRole' in detail ? ['attackDamageRole'] : [])], path);
      if ('attackDamageRole' in detail) assertEnum(detail.attackDamageRole, new Set(['PRIMARY', 'REPLACE_PRIMARY']), `${path}.detail.attackDamageRole`);
      assertString(detail.damageTypeKey, `${path}.detail.damageTypeKey`);
      assertEnum(detail.deliveryKind, DAMAGE_DELIVERY_KINDS, `${path}.detail.deliveryKind`);
      assertEnum(detail.originKind, DAMAGE_ORIGIN_KINDS, `${path}.detail.originKind`);
      if (!isRecord(detail.critical)) protocolError(`${path}.detail.critical`);
      assertEnum(detail.critical.mode, CRITICAL_MODES, `${path}.detail.critical.mode`);
      if (detail.critical.multiplierValue !== null && !isNumericValue(detail.critical.multiplierValue)) protocolError(`${path}.detail.critical.multiplierValue`);
      assertEnum(detail.vampQualification, new Set(['RESOLVED', 'UNRESOLVED']), `${path}.detail.vampQualification`);
      if (!Array.isArray(detail.vampOverrides) || detail.vampOverrides.length > 4
        || (detail.vampQualification === 'UNRESOLVED' && detail.vampOverrides.length)) protocolError(`${path}.detail.vampOverrides`);
      const seenVampTypes = new Set<string>();
      detail.vampOverrides.forEach((rule, index) => {
        const rulePath = `${path}.detail.vampOverrides[${index}]`;
        if (!isRecord(rule)) protocolError(rulePath);
        assertEnum(rule.vampType, VAMP_TYPES, `${rulePath}.vampType`);
        if (seenVampTypes.has(String(rule.vampType))) protocolError(`${rulePath}.vampType`);
        seenVampTypes.add(String(rule.vampType));
        if (Object.keys(rule).length !== 4 || !['vampType', 'mode', 'basisOutputKind', 'efficiencyValue'].every((key) => key in rule)) protocolError(rulePath);
        assertEnum(rule.mode, new Set(['DISABLED', 'OVERRIDE']), `${rulePath}.mode`);
        if (rule.mode === 'DISABLED') {
          if (rule.basisOutputKind !== null || rule.efficiencyValue !== null) protocolError(rulePath);
          return;
        }
        assertEnum(rule.basisOutputKind, VAMP_BASIS_OUTPUT_KINDS, `${rulePath}.basisOutputKind`);
        if (!isNumericValue(rule.efficiencyValue)) protocolError(`${rulePath}.efficiencyValue`);
        if (rule.efficiencyValue.kind === 'FIXED' && rule.efficiencyValue.value < 0) protocolError(`${rulePath}.efficiencyValue`);
      });
      break;
    }
    case 'NORMAL_SHIELD':
      assertNullableString(detail.absorbedDamageTypeKey, `${path}.detail.absorbedDamageTypeKey`);
      assertEnum(detail.decayMode, SHIELD_DECAY_MODES, `${path}.detail.decayMode`);
      break;
    case 'ATTRIBUTE_CHANGE':
      assertExactDetailKeys(detail, ['attributeKey', 'operation', 'modifierZoneKey', ...('requiredShield' in detail ? ['requiredShield'] : [])], path);
      assertString(detail.attributeKey, `${path}.detail.attributeKey`);
      assertEnum(detail.operation, new Set(['INCREASE', 'DECREASE', 'SET']), `${path}.detail.operation`);
      if ('requiredShield' in detail) {
        const dependency = detail.requiredShield;
        const dependencyPath = `${path}.detail.requiredShield`;
        if (!isRecord(dependency)) protocolError(dependencyPath);
        assertExactKeys(dependency, ['skillKey', 'effectKey', 'resultKey'], dependencyPath);
        for (const key of ['skillKey', 'effectKey', 'resultKey']) if (!/^[a-z][a-z0-9_]{0,63}$/.test(assertString(dependency[key], `${dependencyPath}.${key}`))) protocolError(`${dependencyPath}.${key}`);
        if (value.target !== 'SOURCE' || !persistent || detail.operation === 'SET' || detail.attributeKey === 'hp') protocolError(dependencyPath);
      }
      break;
    case 'RESOURCE_CHANGE':
      assertString(detail.attributeKey, `${path}.detail.attributeKey`);
      assertEnum(detail.operation, new Set(['RESTORE', 'CONSUME', 'REFUND']), `${path}.detail.operation`);
      break;
    case 'DAMAGE_MODIFIER':
      if ('maximumReductionRatioValue' in detail) {
        assertExactKeys(value, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'valueRule', 'detail', 'lifecycleBehavior', 'spellShieldBlockScope'], path);
        if (isRecord(value.lifecycleBehavior)) assertExactKeys(value.lifecycleBehavior,
          ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
        assertExactDetailKeys(detail, ['modifierZoneKey', 'direction', 'operation', 'damageTypeKey', 'deliveryKind', 'originKind', 'criticalFilter',
          ...('condition' in detail ? ['condition'] : []), 'maximumReductionRatioValue'], path);
        const ratio = detail.maximumReductionRatioValue;
        if (!isNumericValue(ratio) || ratio.kind === 'FORMULA' || ratio.kind === 'FIXED' && (ratio.value < 0 || ratio.value > 1)
          || !isCappedReductionResultShape(value as SkillEffectResult)) protocolError(`${path}.detail.maximumReductionRatioValue`);
      }
      assertEnum(detail.direction, DAMAGE_MODIFIER_DIRECTIONS, `${path}.detail.direction`);
      assertEnum(detail.operation, MODIFIER_OPERATIONS, `${path}.detail.operation`);
      assertNullableString(detail.damageTypeKey, `${path}.detail.damageTypeKey`);
      assertEnum(
        detail.deliveryKind,
        DAMAGE_FILTER_DELIVERY_KINDS,
        `${path}.detail.deliveryKind`
      );
      assertEnum(detail.originKind, DAMAGE_FILTER_ORIGIN_KINDS, `${path}.detail.originKind`);
      assertEnum(detail.criticalFilter, CRITICAL_FILTERS, `${path}.detail.criticalFilter`);
      if (detail.condition !== undefined && detail.condition !== null) {
        const conditionPath = `${path}.detail.condition`;
        if (!isRecord(detail.condition)) protocolError(conditionPath);
        assertExactKeys(detail.condition,
          ['receiver', 'attributeKey', 'attributeValueKind', 'comparator', 'comparisonValue'],
          conditionPath);
        assertEnum(detail.condition.receiver, new Set(['ENEMY_CHAMPION']), `${conditionPath}.receiver`);
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(assertString(detail.condition.attributeKey, `${conditionPath}.attributeKey`))) {
          protocolError(`${conditionPath}.attributeKey`);
        }
        assertEnum(detail.condition.attributeValueKind, new Set(['CURRENT_RATIO']), `${conditionPath}.attributeValueKind`);
        assertEnum(detail.condition.comparator, new Set(['LT', 'GT']), `${conditionPath}.comparator`);
        if (!isNumericValue(detail.condition.comparisonValue)) protocolError(`${conditionPath}.comparisonValue`);
        if (value.target !== 'SOURCE') protocolError(`${path}.target`);
        if (detail.direction !== 'DEALT') protocolError(`${path}.detail.direction`);
        if (!isRecord(value.lifecycleBehavior) || value.lifecycleBehavior.moment !== 'PERSISTENT') {
          protocolError(`${path}.lifecycleBehavior.moment`);
        }
      }
      break;
    case 'SHIELD_RECEIVED_MODIFIER': {
      assertExactDetailKeys(detail, ['modifierZoneKey', 'operation'], path);
      assertString(detail.modifierZoneKey, path + '.detail.modifierZoneKey');
      assertEnum(detail.operation, MODIFIER_OPERATIONS, path + '.detail.operation');
      if (!persistent) protocolError(path + '.lifecycleBehavior');
      const behavior = value.lifecycleBehavior;
      if (!isRecord(behavior)) protocolError(path + '.lifecycleBehavior');
      assertEnum(behavior.valueReadMode, new Set(['APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION']), `${path}.lifecycleBehavior.valueReadMode`);
      assertEnum(behavior.stackValueMode, new Set(['SHARED', 'PER_STACK']), `${path}.lifecycleBehavior.stackValueMode`);
      if (behavior.periodicExecutionMode !== null) protocolError(`${path}.lifecycleBehavior.periodicExecutionMode`);
      if (behavior.valueReadMode === 'MOMENT_EVALUATION' || behavior.stackValueMode === 'PER_STACK') {
        if (behavior.reapplicationValueMode !== null) protocolError(`${path}.lifecycleBehavior.reapplicationValueMode`);
      } else {
        assertEnum(behavior.reapplicationValueMode, new Set(['KEEP', 'REPLACE', 'ADD']), `${path}.lifecycleBehavior.reapplicationValueMode`);
      }
      break;
    }
    case 'HEALING_MODIFIER':
      assertEnum(detail.direction, HEALING_MODIFIER_DIRECTIONS, `${path}.detail.direction`);
      assertEnum(detail.operation, MODIFIER_OPERATIONS, `${path}.detail.operation`);
      assertEnum(detail.healingKind, HEALING_KINDS, `${path}.detail.healingKind`);
      break;
    case 'HEALTH_FLOOR':
      assertString(detail.attributeKey, `${path}.detail.attributeKey`);
      break;
    case 'DIRECT_HEAL':
      break;
    case 'EXECUTE':
      if ('modifierZoneKey' in detail) protocolError(`${path}.detail.modifierZoneKey`);
      assertString(detail.attributeKey, `${path}.detail.attributeKey`);
      assertExactDetailKeys(detail, ['attributeKey'], path);
      assertDiscreteLinkLifecycle(value, path);
      break;
    case 'HIT_LINK_APPLICATION':
    case 'ATTACK_LINK_APPLICATION':
      if ('modifierZoneKey' in detail) protocolError(`${path}.detail.modifierZoneKey`);
      assertEmptyDetail(detail, path);
      assertDiscreteLinkLifecycle(value, path);
      break;
    default:
      protocolError(`${path}.resultType`);
  }
  return value as SkillEffectResult;
}

export function parseSkillEffect(value: unknown): SkillEffect {
  assertNumericUses(value, 'effect', protocolError);
  if (!isRecord(value) || !Array.isArray(value.results)) protocolError('effect');
  value.results.forEach((item, index) => assertResult(item, `effect.results[${index}]`));
  if (value.results.some(item => isRecord(item) && isRecord(item.detail) && 'maximumReductionRatioValue' in item.detail)) {
    const life = value.lifecycle;
    if (value.results.length !== 1 || !isRecord(life) || life.instanceScope !== 'SOURCE' || life.expiryMode !== 'EXPLICIT_ONLY'
      || life.durationValue !== null || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null
      || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null || life.endWhenShieldEndsResultKey != null) protocolError('effect.lifecycle');
    assertExactKeys(life, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode', 'reapplicationDurationMode',
      'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', ...('endWhenShieldEndsResultKey' in life ? ['endWhenShieldEndsResultKey'] : [])], 'effect.lifecycle');
  }
  if (value.lifecycle === null && value.results.some((item) => (
    isRecord(item) && item.resultType === 'DAMAGE_MODIFIER'
      && isRecord(item.detail) && item.detail.condition != null
  ))) protocolError('effect.lifecycle');
  assertString(value.gameId, 'effect.gameId');
  assertString(value.skillKey, 'effect.skillKey');
  assertString(value.effectKey, 'effect.effectKey');
  assertString(value.name, 'effect.name');
  assertNullableString(value.description, 'effect.description');
  assertNumber(value.sortOrder, 'effect.sortOrder');
  if (value.lifecycle !== null && !isRecord(value.lifecycle)) protocolError('effect.lifecycle');
  value.results.forEach((item, index) => {
    if (!isRecord(item) || item.resultType !== 'ATTACK_TIMER_RESET') return;
    const behavior = item.lifecycleBehavior;
    if ((value.lifecycle === null) !== (behavior === null)) {
      protocolError(`effect.results[${index}].lifecycleBehavior`);
    }
    if (!isRecord(behavior) || !isRecord(value.lifecycle)) return;
    if (behavior.moment === 'NATURAL_END' && !isNumericValue(value.lifecycle.durationValue)) {
      protocolError('effect.lifecycle.durationValue');
    }
    if (behavior.moment === 'PERIODIC'
      && (!isNumericValue(value.lifecycle.periodicIntervalValue) || value.lifecycle.firstPeriodicExecution == null)) {
      protocolError('effect.lifecycle.periodicIntervalValue');
    }
    if (behavior.moment === 'PERIODIC') {
      assertEnum(value.lifecycle.firstPeriodicExecution, new Set(['IMMEDIATE', 'AFTER_INTERVAL']),
        'effect.lifecycle.firstPeriodicExecution');
    }
  });
  if (value.results.some((item) => isRecord(item) && item.resultType === 'STATUS_OPERATION' && item.valueRule !== null)
    && (!isRecord(value.lifecycle) || !isNumericValue(value.lifecycle.durationValue))) {
    protocolError('effect.lifecycle.durationValue');
  }
  if (value.results.some(item => isRecord(item) && item.resultType === 'STATUS_OPERATION'
    && isRecord(item.lifecycleBehavior) && item.lifecycleBehavior.valueReadMode === 'MOMENT_EVALUATION')) {
    if (value.results.length !== 1) protocolError('effect.results');
    const issue = momentSlowLifecycleIssue(value.lifecycle);
    if (issue) protocolError(`effect.lifecycle.${issue}`);
  }
  if (
    value.results.some((item) => (
      isRecord(item)
      && (item.resultType === 'SPELL_SHIELD' || item.resultType === 'SKILL_HASTE_MODIFIER' || item.resultType === 'COOLDOWN_DURATION_MODIFIER'
        || item.resultType === 'SHIELD_RECEIVED_MODIFIER')
    ))
    && value.lifecycle === null
  ) {
    protocolError('effect.lifecycle');
  }
  if (value.results.some(item => isRecord(item) && item.resultType === 'COOLDOWN_DURATION_MODIFIER')
  ) {
    const life = value.lifecycle;
    if (!isRecord(life) || !isNumericValue(life.durationValue)) protocolError('effect.lifecycle.durationValue');
    if (value.results.length !== 1 || life.instanceScope !== 'SOURCE' || life.expiryMode !== 'ALL_AT_ONCE'
      || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== 'REFRESH_ALL'
      || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null || life.endWhenShieldEndsResultKey !== null) protocolError('effect.lifecycle');
    for (const key of ['maxStacksValue', 'applicationStacksValue']) {
      const count = life[key];
      if (!isNumericValue(count) || count.kind === 'FIXED' && count.value !== 1) protocolError(`effect.lifecycle.${key}`);
    }
    if (life.durationValue.kind === 'FIXED' && (!Number.isSafeInteger(life.durationValue.value) || life.durationValue.value <= 0)) protocolError('effect.lifecycle.durationValue');
  }
  assertString(value.createdAt, 'effect.createdAt');
  assertString(value.updatedAt, 'effect.updatedAt');
  return value as SkillEffect;
}

export function parseSkillEffectSummary(value: unknown): SkillEffectSummary {
  if (!isRecord(value)) protocolError('summary');
  return {
    gameId: assertString(value.gameId, 'summary.gameId'),
    skillKey: assertString(value.skillKey, 'summary.skillKey'),
    effectKey: assertString(value.effectKey, 'summary.effectKey'),
    name: assertString(value.name, 'summary.name'),
    description: assertNullableString(value.description, 'summary.description'),
    sortOrder: assertNumber(value.sortOrder, 'summary.sortOrder'),
    resultCount: assertNumber(value.resultCount, 'summary.resultCount'),
    lifecycleEnabled: typeof value.lifecycleEnabled === 'boolean'
      ? value.lifecycleEnabled
      : protocolError('summary.lifecycleEnabled'),
    createdAt: assertString(value.createdAt, 'summary.createdAt'),
    updatedAt: assertString(value.updatedAt, 'summary.updatedAt')
  };
}

function maybeParseEffect(value: unknown): SkillEffect {
  return parseSkillEffect(value);
}

function maybeParseSummaries(value: unknown): SkillEffectSummary[] {
  if (!Array.isArray(value)) {
    protocolError('list');
  }
  return value.map((item) => parseSkillEffectSummary(item));
}

export function listSkillEffects(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string
): Promise<ApiResult<SkillEffectSummary[]>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey))
    .then((result) => ({ ...result, data: maybeParseSummaries(result.data) }));
}

export function getSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string
): Promise<ApiResult<SkillEffect>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey))
    .then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function createSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function updateSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  body: UpdateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function deleteSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'DELETE'
  });
}
