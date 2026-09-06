import { assertNumericUses } from './numericValue';
import { isNumericValue } from '../types/numericValue';
import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillEffectRequest,
  SkillEffect,
  SkillEffectResult,
  SkillEffectResultType,
  SkillEffectSummary,
  UpdateSkillEffectRequest
} from '../types/skillEffect';

const RESULT_TYPES = new Set<SkillEffectResultType>([
  'DAMAGE',
  'DIRECT_HEAL',
  'NORMAL_SHIELD',
  'ATTRIBUTE_CHANGE',
  'RESOURCE_CHANGE',
  'COOLDOWN_CHANGE',
  'STATUS_OPERATION',
  'LIFECYCLE_OPERATION',
  'DAMAGE_MODIFIER',
  'HEALING_MODIFIER',
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
  const persistent = isRecord(value.lifecycleBehavior)
    && value.lifecycleBehavior.moment === 'PERSISTENT';
  const blockScopeEligible = value.target === 'TARGET'
    && !persistent
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
    );
  if (value.spellShieldBlockScope !== null) {
    if (!blockScopeEligible) protocolError(`${path}.spellShieldBlockScope`);
    if (value.spellShieldBlockScope === 'DAMAGE_INSTANCE' && resultType !== 'DAMAGE') {
      protocolError(`${path}.spellShieldBlockScope`);
    }
  }

  if (resultType === 'SPELL_SHIELD') {
    if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    if (Object.keys(detail).length !== 0) protocolError(`${path}.detail`);
    if (!persistent) protocolError(`${path}.lifecycleBehavior`);
    return value as SkillEffectResult;
  }

  if (resultType === 'STATUS_OPERATION') {
    if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    assertString(detail.statusKey, `${path}.detail.statusKey`);
    assertEnum(detail.operation, new Set(['APPLY', 'REMOVE']), `${path}.detail.operation`);
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
    assertExactDetailKeys(detail, ['operation', 'affectedSkillScope'], path);
    assertEnum(detail.operation, new Set(['REDUCE', 'INCREASE', 'RESET']), `${path}.detail.operation`);
    assertAffectedSkillScope(detail.affectedSkillScope, `${path}.detail.affectedSkillScope`);
    if (detail.operation === 'RESET') {
      if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    } else {
      assertValueRule(value.valueRule, `${path}.valueRule`);
    }
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
      new Set(['INCREASE', 'DECREASE', 'SET', 'REFRESH', 'CONSUME', 'REMOVE']),
      `${path}.detail.operation`
    );
    if (operation === 'REFRESH' || operation === 'REMOVE') {
      if (value.valueRule !== null) protocolError(`${path}.valueRule`);
    } else {
      assertValueRule(value.valueRule, `${path}.valueRule`);
    }
    return value as SkillEffectResult;
  }

  assertValueRule(value.valueRule, `${path}.valueRule`);
  switch (resultType) {
    case 'DAMAGE': {
      assertString(detail.damageTypeKey, `${path}.detail.damageTypeKey`);
      assertEnum(detail.deliveryKind, DAMAGE_DELIVERY_KINDS, `${path}.detail.deliveryKind`);
      assertEnum(detail.originKind, DAMAGE_ORIGIN_KINDS, `${path}.detail.originKind`);
      if (!isRecord(detail.critical)) protocolError(`${path}.detail.critical`);
      assertEnum(detail.critical.mode, CRITICAL_MODES, `${path}.detail.critical.mode`);
      if (detail.critical.multiplierValue !== null && !isNumericValue(detail.critical.multiplierValue)) protocolError(`${path}.detail.critical.multiplierValue`);
      if (!Array.isArray(detail.vampRules)) protocolError(`${path}.detail.vampRules`);
      detail.vampRules.forEach((rule, index) => {
        const rulePath = `${path}.detail.vampRules[${index}]`;
        if (!isRecord(rule)) protocolError(rulePath);
        assertEnum(rule.vampType, VAMP_TYPES, `${rulePath}.vampType`);
        assertEnum(rule.basisOutputKind, VAMP_BASIS_OUTPUT_KINDS, `${rulePath}.basisOutputKind`);
        if (!isNumericValue(rule.efficiencyValue)) protocolError(`${rulePath}.efficiencyValue`);
      });
      break;
    }
    case 'NORMAL_SHIELD':
      assertNullableString(detail.absorbedDamageTypeKey, `${path}.detail.absorbedDamageTypeKey`);
      assertEnum(detail.decayMode, SHIELD_DECAY_MODES, `${path}.detail.decayMode`);
      break;
    case 'ATTRIBUTE_CHANGE':
      assertString(detail.attributeKey, `${path}.detail.attributeKey`);
      assertEnum(detail.operation, new Set(['INCREASE', 'DECREASE', 'SET']), `${path}.detail.operation`);
      break;
    case 'RESOURCE_CHANGE':
      assertString(detail.attributeKey, `${path}.detail.attributeKey`);
      assertEnum(detail.operation, new Set(['RESTORE', 'CONSUME', 'REFUND']), `${path}.detail.operation`);
      break;
    case 'DAMAGE_MODIFIER':
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
      break;
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
  assertString(value.gameId, 'effect.gameId');
  assertString(value.skillKey, 'effect.skillKey');
  assertString(value.effectKey, 'effect.effectKey');
  assertString(value.name, 'effect.name');
  assertNullableString(value.description, 'effect.description');
  assertNumber(value.sortOrder, 'effect.sortOrder');
  if (value.lifecycle !== null && !isRecord(value.lifecycle)) protocolError('effect.lifecycle');
  if (
    value.results.some((item) => (
      isRecord(item)
      && (item.resultType === 'SPELL_SHIELD' || item.resultType === 'SKILL_HASTE_MODIFIER')
    ))
    && value.lifecycle === null
  ) {
    protocolError('effect.lifecycle');
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
    if (shouldValidateShape()) protocolError('list');
    return [];
  }
  return shouldValidateShape()
    ? value.map((item) => parseSkillEffectSummary(item))
    : value as SkillEffectSummary[];
}

export function listSkillEffects(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillEffectSummary[]>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey), { token })
    .then((result) => ({ ...result, data: maybeParseSummaries(result.data) }));
}

export function getSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  token: string
): Promise<ApiResult<SkillEffect>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), { token })
    .then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function createSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function updateSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  token: string,
  body: UpdateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function deleteSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'DELETE',
    token
  });
}
