import type { GameVampRule } from '../types/gameVamp';
import type {
  SkillEffect, SkillEffectResult, SkillEffectSpellShieldBlockScope, SkillEffectStatusOperationResult,
  SkillEffectValueRule
} from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { GameStatus, StatusKind } from '../types/status';
import type { ModifierZone } from '../types/modifierZone';
import type { SkillTriggerCondition, SkillTriggerEventValueCompareCondition, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type {
  CompileRequest, GenericFormulaExpr, GenericVampRule, NamedFormula, OperationDefinition, ProviderDefinition,
  SkillHitCandidate, SkillHitComparator, SkillHitDefinition, SkillHitEventValueCondition,
  SkillHitFact, SkillHitSemantic, SkillHitSemanticTarget, SkillHitStatusKind, SkillHitValueKey,
  SkillUseFact, SpellShieldBlockScope
} from '../types/genericEngine';
import {
  compileNumericValue, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, type NumericCompileState, wrapValueRuleExpression
} from './numericAdapter';
import { compilePersistentResult, type AuthoredPersistentResult } from './persistentResultAdapter';
import { adaptDamageVamp, type AdaptedVampDamage, type AuthoredVampDamage } from './vampAdapter';

export class HitAdaptationError extends NumericAdaptationError {
  constructor(path: string, message: string) {
    super(path, message);
    this.name = 'HitAdaptationError';
  }
}

export type CombatantHostility = 'SELF' | 'ALLY' | 'ENEMY';
export type CombatantCategory = 'CHAMPION' | 'EPIC_MONSTER' | 'MINION' | 'NON_EPIC_MONSTER' | 'STRUCTURE';

export type CombatantIdentityFact = {
  category?: CombatantCategory;
  hostility?: CombatantHostility;
};

export type AuthoredHitProgram = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  rules: readonly SkillTriggerRuleDetail[];
  effects: readonly SkillEffect[];
  parameters?: readonly SkillParameter[];
  formulas?: readonly SkillFormula[];
  statuses: ReadonlyArray<Pick<GameStatus, 'statusKey' | 'statusKind' | 'status'>>;
  modifierZones?: ReadonlyArray<Pick<ModifierZone, 'modifierZoneKey' | 'domain' | 'calculationMode' | 'status'>>;
  identity: { source: CombatantIdentityFact; target: CombatantIdentityFact };
  skillCategoryKeys?: readonly string[];
  vampRules?: readonly GameVampRule[];
};

export type HitResolveKind = 'skill' | 'basic_attack';

export type AdaptedHitProgram = {
  skillHit: SkillHitDefinition;
  resolveKind: HitResolveKind;
  providers: ProviderDefinition[];
  params: Record<string, number>;
  formulas: NamedFormula[];
  requiredAttributes: string[];
  typeEntries: Array<{ key: string; domain: string }>;
  vampRules?: GenericVampRule[];
  abilityTypes: string[];
};

export type HitProgramBinding = {
  hitProviderKey: string;
  hitAbilityKey: string;
  authored: AuthoredHitProgram;
};

const COMPARATORS: Record<string, SkillHitComparator> = {
  LT: 'lt', LTE: 'lte', EQ: 'eq', NE: 'ne', GTE: 'gte', GT: 'gt'
};
const EVENT_VALUE_KEYS: Record<string, SkillHitValueKey> = {
  SKILL_HIT_FIRST_CONTACT: 'first_contact', SKILL_HIT_SPELL_SHIELD_BLOCKED: 'blocked'
};
const STATUS_KIND: Record<StatusKind, SkillHitStatusKind> = {
  STUN: 'stun', ROOT: 'root', SILENCE: 'silence', CHARM: 'charm', AIRBORNE: 'airborne', MOVEMENT_SLOW: 'movement_slow'
};
const CLOSED_PROVIDER_TYPE: Record<Exclude<SkillHitStatusKind, 'movement_slow'>, string> = {
  stun: 'provider/status_stun', root: 'provider/status_root', silence: 'provider/status_silence',
  charm: 'provider/status_charm', airborne: 'provider/status_airborne'
};

function fail(path: string, message: string): never {
  throw new HitAdaptationError(path, message);
}
const finite = (value: unknown, path: string): number => finiteNumber(value, path, fail);

function catalogKey(value: string, path: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要合法标识');
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableSorted<T>(items: readonly T[], order: (item: T) => number): T[] {
  return items.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const delta = order(left.item) - order(right.item);
      return delta !== 0 ? delta : left.index - right.index;
    })
    .map((row) => row.item);
}

function combine(op: 'min' | 'max', exprs: GenericFormulaExpr[]): GenericFormulaExpr {
  if (!exprs.length) return constExpr(1);
  return exprs.reduce((left, right) => ({ op, args: [left, right] }));
}

function semanticTarget(target: 'SOURCE' | 'TARGET' | 'SELF'): SkillHitSemanticTarget {
  return target;
}

function selectorFor(target: SkillHitSemanticTarget): 'source' | 'target' | 'self' {
  if (target === 'SOURCE') return 'source';
  if (target === 'TARGET') return 'target';
  return 'self';
}

function planPath(skillKey: string, extra: string): string {
  return `adapter.hitPlan.skills.${skillKey}.${extra}`;
}

function numericState(authored: AuthoredHitProgram): NumericCompileState {
  return createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `hit/${authored.skillKey}`, bindParameters: true, allowAttributeReads: true,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
}

function compileValue(rule: SkillEffectValueRule, path: string, state: NumericCompileState): GenericFormulaExpr {
  return wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.value`, state, fail), rule);
}

function compileLifecycleNumber(value: AuthoredPersistentResult['lifecycle']['maxStacksValue'], path: string, authored: AuthoredHitProgram, label: string): number {
  const expr = compileNumericValue(value, path, createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `hit/${authored.skillKey}/lifecycle`, bindParameters: false, allowAttributeReads: false,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  }), fail);
  if (expr.op !== 'const' || typeof expr.value !== 'number' || !Number.isInteger(expr.value) || expr.value <= 0) {
    return fail(path, `${label}必须是正整数`);
  }
  return expr.value;
}

function compileDuration(effect: SkillEffect, authored: AuthoredHitProgram, path: string, state: NumericCompileState): GenericFormulaExpr {
  const value = effect.lifecycle?.durationValue;
  if (!value) return fail(path, '生命周期必须有正整数时长，不能猜测数值');
  const foldedState = createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `hit/${authored.skillKey}/duration`, bindParameters: false, allowAttributeReads: false,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
  const expr = compileNumericValue(value, path, foldedState, fail);
  if (expr.op === 'const' && typeof expr.value === 'number') {
    if (!Number.isInteger(expr.value) || expr.value <= 0) return fail(path, '生命周期必须是正整数时长');
    return constExpr(expr.value);
  }
  return compileNumericValue(value, path, state, fail);
}

function assertStandardLifecycle(effect: SkillEffect, path: string, scope: 'SOURCE' | 'SOURCE_TARGET'): void {
  const lifecycle = effect.lifecycle;
  if (!lifecycle) return fail(path, '必须具备父效果生命周期');
  if (lifecycle.instanceScope !== scope) {
    return fail(`${path}.instanceScope`, scope === 'SOURCE'
      ? '只有 SOURCE 范围且全部 self 时可证明 definition/source/owner 与原身份等价，不放宽一般范围'
      : '本期只支持 SOURCE_TARGET');
  }
  if (lifecycle.reapplicationStackMode !== 'KEEP') fail(`${path}.reapplicationStackMode`, '本期只支持 KEEP');
  if (lifecycle.reapplicationDurationMode !== 'REFRESH_ALL') fail(`${path}.reapplicationDurationMode`, '本期只支持 REFRESH_ALL');
  if (lifecycle.expiryMode !== 'ALL_AT_ONCE') fail(`${path}.expiryMode`, '本期只支持 ALL_AT_ONCE');
  if (lifecycle.periodicIntervalValue !== null || lifecycle.firstPeriodicExecution !== null) {
    fail(`${path}.periodicIntervalValue`, '本期不支持周期');
  }
}

function eventValueFingerprint(
  condition: SkillTriggerEventValueCompareCondition,
  path: string,
  state: NumericCompileState,
  resolveKind: HitResolveKind
): {
  key: SkillHitValueKey; comparator: SkillHitComparator; value: GenericFormulaExpr; fingerprint: string;
} {
  const key = EVENT_VALUE_KEYS[condition.detail.eventValueKey];
  if (!key) return fail(`${path}.eventValueKey`, '未知命中值条件');
  if (resolveKind === 'basic_attack') {
    return fail(`${path}.eventValueKey`, '本期 basic_attack_hit 不提供 firstContact/blocked 公式路径');
  }
  const comparator = COMPARATORS[condition.detail.comparator];
  if (!comparator) return fail(`${path}.comparator`, '未知比较运算');
  const value = compileNumericValue(condition.detail.comparisonValue, `${path}.comparisonValue`, state, fail);
  return { key, comparator, value, fingerprint: JSON.stringify({ key, comparator, value }) };
}

function identityCategoryPredicate(
  condition: Extract<SkillTriggerCondition, { conditionType: 'TARGET_CATEGORY_CHECK' }>,
  path: string,
  authored: AuthoredHitProgram
): GenericFormulaExpr {
  const category = authored.identity.target.category;
  if (!category) return fail(path, '目录身份及真实类别需显式事实，未知不补英雄默认');
  return constExpr(condition.detail.categories.includes(category) ? 1 : 0);
}

function identityEnemyPredicate(path: string, authored: AuthoredHitProgram): GenericFormulaExpr {
  const hostility = authored.identity.target.hostility;
  if (!hostility) return fail(path, '目录身份及真实敌我需显式事实，未知不补敌方默认');
  return constExpr(hostility === 'ENEMY' ? 1 : 0);
}

function remainingPredicate(
  condition: SkillTriggerCondition,
  path: string,
  authored: AuthoredHitProgram
): GenericFormulaExpr {
  if (condition.conditionType === 'TARGET_CATEGORY_CHECK') return identityCategoryPredicate(condition, path, authored);
  if (condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY') return identityEnemyPredicate(path, authored);
  return fail(path, '未支持的过程、动作依赖、来源、目标或条件，按共享契约整体拒绝');
}

function convertRuleConditions(
  rule: SkillTriggerRuleDetail,
  authored: AuthoredHitProgram,
  state: NumericCompileState,
  resolveKind: HitResolveKind
): { eventValueConditions: SkillHitEventValueCondition[]; participation: GenericFormulaExpr | null } {
  const root = planPath(authored.skillKey, `rules.${rule.ruleKey}`);
  if (rule.perTargetCooldown || rule.maxTriggersPerProcess || ('oncePerUse' in rule && rule.oncePerUse)) {
    return fail(`${root}.limits`, '未支持的过程限制，按共享契约整体拒绝');
  }
  const groups = stableSorted(rule.conditionGroups, (group) => group.sortOrder);
  if (!groups.length) return { eventValueConditions: [], participation: null };
  const extracted: Array<{ event: SkillHitEventValueCondition[]; remaining: GenericFormulaExpr; fingerprints: string[] }> = [];
  for (const group of groups) {
    const groupPath = `${root}.conditionGroups.${group.groupKey}`;
    const conditions = stableSorted(group.conditions, (item) => item.sortOrder);
    const event: SkillHitEventValueCondition[] = [];
    const remaining: GenericFormulaExpr[] = [];
    const fingerprints: string[] = [];
    for (const condition of conditions) {
      const path = `${groupPath}.conditions.${condition.conditionKey}`;
      if (condition.conditionType === 'EVENT_VALUE_COMPARE') {
        const compiled = eventValueFingerprint(condition, path, state, resolveKind);
        event.push({ key: compiled.key, comparator: compiled.comparator, value: compiled.value });
        fingerprints.push(compiled.fingerprint);
        continue;
      }
      remaining.push(remainingPredicate(condition, path, authored));
    }
    extracted.push({ event, remaining: combine('min', remaining), fingerprints: fingerprints.slice().sort() });
  }
  const first = extracted[0]!;
  for (const row of extracted) {
    if (!sameJson(row.fingerprints, first.fingerprints)) {
      return fail(`${root}.conditionGroups`, 'OR组公共event value条件须key/comparator/右值语义相同，不能删notblocked条件或把一条规则条件套另一条');
    }
  }
  return {
    eventValueConditions: first.event,
    participation: extracted.every((row) => sameJson(row.remaining, constExpr(1)))
      ? null
      : combine('max', extracted.map((row) => row.remaining))
  };
}

function lookupEffect(authored: AuthoredHitProgram, effectKey: string, path: string): SkillEffect {
  const matches = authored.effects.filter((item) => item.effectKey === effectKey);
  if (matches.length !== 1) return fail(path, '效果目录缺失或重复');
  const effect = matches[0]!;
  if (effect.gameId !== authored.gameId || effect.skillKey !== authored.skillKey) return fail(path, '效果不属于当前游戏和技能');
  return effect;
}

function lookupStatus(authored: AuthoredHitProgram, statusKey: string, path: string): SkillHitStatusKind {
  const matches = authored.statuses.filter((item) => item.statusKey === statusKey);
  if (matches.length !== 1) return fail(path, '状态目录缺失或重复');
  if (matches[0]!.status !== 'ENABLED') return fail(path, '状态目录已停用');
  return STATUS_KIND[matches[0]!.statusKind];
}

function momentOf(result: SkillEffectResult): 'INSTANT' | 'PERSISTENT' {
  return result.lifecycleBehavior?.moment === 'PERSISTENT' ? 'PERSISTENT' : 'INSTANT';
}

function persistentAuthored(
  authored: AuthoredHitProgram,
  effect: SkillEffect,
  result: SkillEffectResult
): AuthoredPersistentResult {
  if (!effect.lifecycle) return fail(planPath(authored.skillKey, `effects.${effect.effectKey}.lifecycle`), '持续结果必须有父生命周期');
  return {
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, effectKey: effect.effectKey, lifecycle: effect.lifecycle,
    result, parameters: authored.parameters, formulas: authored.formulas, statuses: authored.statuses,
    modifierZones: authored.modifierZones ?? [], source: 'source', target: 'target'
  };
}

function mergeProvider(
  providers: Map<string, ProviderDefinition>,
  provider: ProviderDefinition,
  path: string
): void {
  const existing = providers.get(provider.providerKey);
  if (existing && !sameJson(existing, provider)) return fail(path, 'provider 与现有定义冲突');
  if (!existing) providers.set(provider.providerKey, provider);
}

function compileDamage(
  authored: AuthoredHitProgram,
  result: Extract<SkillEffectResult, { resultType: 'DAMAGE' }>,
  path: string,
  state: NumericCompileState,
  typeEntries: Map<string, string>,
  resolveKind: HitResolveKind
): { operation: OperationDefinition; vamp: AdaptedVampDamage } {
  if (result.target !== 'TARGET') return fail(`${path}.target`, '本期伤害只支持作用对象 TARGET');
  if (momentOf(result) !== 'INSTANT') return fail(`${path}.lifecycleBehavior`, 'DAMAGE moment must be INSTANT');
  const expectedDelivery = resolveKind === 'basic_attack' ? 'BASIC_ATTACK' : 'SKILL';
  if (result.detail.deliveryKind !== expectedDelivery) {
    return fail(
      `${path}.detail.deliveryKind`,
      resolveKind === 'basic_attack'
        ? '普攻命中入口要求显式 BASIC_ATTACK 产生方式，不能与技能口径混用'
        : '本期命中入口只接受技能伤害'
    );
  }
  if (result.detail.originKind !== 'DIRECT') return fail(`${path}.detail.originKind`, '未支持的来源性质');
  if (result.detail.critical.mode !== 'DISALLOWED') return fail(`${path}.detail.critical`, '未支持的暴击策略');
  const damageType = `damage/${catalogKey(result.detail.damageTypeKey, `${path}.detail.damageTypeKey`)}`;
  typeEntries.set(damageType, 'damage');
  const amount = compileValue(result.valueRule, `${path}.valueRule`, state);
  if (result.detail.vampQualification === 'UNRESOLVED') {
    return fail(`${path}.detail.vampQualification`, '吸血资格尚未核定，不能运行');
  }
  if (result.detail.vampQualification !== 'RESOLVED') return fail(`${path}.detail.vampQualification`, '未知吸血资格');
  if (!authored.vampRules?.length) return fail(`${path}.detail.vampQualification`, '已核定伤害缺少吸血规则，不能冒充完整正式伤害');
  const damage: AuthoredVampDamage = {
    gameId: authored.gameId, skillKey: authored.skillKey, skillCategoryKeys: [...(authored.skillCategoryKeys ?? [])],
    skillLevel: authored.skillLevel, characterLevel: authored.characterLevel, detail: result.detail,
    parameters: authored.parameters ? [...authored.parameters] : undefined,
    formulas: authored.formulas ? [...authored.formulas] : undefined
  };
  const adapted = adaptDamageVamp(authored.vampRules, damage);
  for (const [key, value] of Object.entries(adapted.params)) {
    if (key in state.params && state.params[key] !== value) fail(`${path}.params.${key}`, '参数与现有运行输入冲突');
    state.params[key] = value;
  }
  for (const formula of adapted.formulas) state.namedFormulas.set(formula.key, formula);
  for (const key of adapted.requiredAttributes) state.requiredAttributes.add(key);
  for (const entry of adapted.typeEntries) typeEntries.set(entry.key, entry.domain);
  return {
    operation: {
      operation: 'damage', target: 'target', damageType, amount, ref: result.resultKey, critEligible: false,
      ...adapted.operation
    },
    vamp: adapted
  };
}

function compileSlow(
  authored: AuthoredHitProgram,
  effect: SkillEffect,
  result: SkillEffectStatusOperationResult,
  providerKey: string,
  path: string,
  state: NumericCompileState,
  providers: Map<string, ProviderDefinition>
): OperationDefinition {
  const adapted = compilePersistentResult(persistentAuthored(authored, effect, result), providerKey);
  mergeProvider(providers, adapted.provider, `${path}.provider`);
  for (const [key, value] of Object.entries(adapted.params)) {
    if (key in state.params && state.params[key] !== value) fail(`${path}.params.${key}`, '参数与现有运行输入冲突');
    state.params[key] = value;
  }
  for (const formula of adapted.formulas) {
    const old = state.namedFormulas.get(formula.key);
    if (old && JSON.stringify(old.expression) !== JSON.stringify(formula.expression)) fail(`${path}.formulas`, '具名公式与现有输入冲突');
    if (!old) state.namedFormulas.set(formula.key, formula);
  }
  for (const key of adapted.requiredAttributes) state.requiredAttributes.add(key);
  return adapted.operation;
}

function compileClosedControl(
  authored: AuthoredHitProgram,
  effect: SkillEffect,
  result: SkillEffectStatusOperationResult,
  kind: Exclude<SkillHitStatusKind, 'movement_slow'>,
  providerKey: string,
  path: string,
  state: NumericCompileState,
  providers: Map<string, ProviderDefinition>,
  typeEntries: Map<string, string>
): OperationDefinition {
  if (result.detail.operation !== 'APPLY') return fail(`${path}.detail.operation`, '本期只支持 APPLY');
  if (result.target !== 'TARGET') return fail(`${path}.target`, '本期控制只支持作用对象 TARGET');
  assertStandardLifecycle(effect, `${planPath(authored.skillKey, `effects.${effect.effectKey}`)}.lifecycle`, 'SOURCE_TARGET');
  if (compileLifecycleNumber(effect.lifecycle!.maxStacksValue, `${path}.maxStacksValue`, authored, '层数') !== 1
    || compileLifecycleNumber(effect.lifecycle!.applicationStacksValue, `${path}.applicationStacksValue`, authored, '层数') !== 1) {
    return fail(`${path}.lifecycle`, '本期只支持单层和每次施加一层，不能丢弃层数配置');
  }
  const typeKey = CLOSED_PROVIDER_TYPE[kind];
  typeEntries.set(typeKey, 'provider');
  const provider: ProviderDefinition = {
    providerKey, kind: 'status', stableId: providerKey, types: [typeKey],
    lifecycle: {
      durationMs: compileDuration(effect, authored, `${planPath(authored.skillKey, `effects.${effect.effectKey}`)}.lifecycle.durationValue`, state),
      maxStacks: 1, refreshPolicy: 'replace'
    }
  };
  mergeProvider(providers, provider, `${path}.provider`);
  return { operation: 'apply_provider', target: 'target', providerDefinitionRef: providerKey };
}

function compileAttributeChange(
  result: Extract<SkillEffectResult, { resultType: 'ATTRIBUTE_CHANGE' }>,
  path: string,
  state: NumericCompileState
): OperationDefinition {
  if (result.detail.modifierZoneKey !== null) return fail(`${path}.detail.modifierZoneKey`, '本期属性增减不支持乘区，不能忽略配置');
  if (momentOf(result) !== 'INSTANT') return fail(`${path}.lifecycleBehavior`, '本期属性增减只支持即时结果');
  if (result.detail.operation !== 'INCREASE' && result.detail.operation !== 'DECREASE') {
    return fail(`${path}.detail.operation`, '未支持的属性操作');
  }
  const amount = compileValue(result.valueRule, `${path}.valueRule`, state);
  return {
    operation: 'attribute_change',
    target: selectorFor(semanticTarget(result.target)),
    attributeKey: catalogKey(result.detail.attributeKey, `${path}.detail.attributeKey`),
    valuePolicy: 'add',
    amount: result.detail.operation === 'DECREASE' ? { op: 'mul', args: [amount, constExpr(-1)] } : amount
  };
}

function compileResultOperations(
  authored: AuthoredHitProgram,
  effect: SkillEffect,
  result: SkillEffectResult,
  path: string,
  state: NumericCompileState,
  providers: Map<string, ProviderDefinition>,
  typeEntries: Map<string, string>,
  resolveKind: HitResolveKind
): { semantic: SkillHitSemantic; operations: OperationDefinition[]; vamp?: AdaptedVampDamage } {
  if (result.resultType === 'DAMAGE') {
    const compiled = compileDamage(authored, result, path, state, typeEntries, resolveKind);
    return {
      semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' },
      operations: [compiled.operation],
      vamp: compiled.vamp
    };
  }
  if (result.resultType === 'STATUS_OPERATION') {
    const kind = lookupStatus(authored, result.detail.statusKey, `${path}.detail.statusKey`);
    const providerKey = `status:${authored.skillKey}:${effect.effectKey}:${result.resultKey}`;
    const semantic: SkillHitSemantic = {
      resultType: 'STATUS_OPERATION', target: semanticTarget(result.target), moment: momentOf(result),
      statusOperation: result.detail.operation, statusKey: result.detail.statusKey, statusKind: kind
    };
    if (kind === 'movement_slow') {
      return {
        semantic,
        operations: [compileSlow(authored, effect, result, providerKey, path, state, providers)]
      };
    }
    return {
      semantic,
      operations: [compileClosedControl(authored, effect, result, kind, providerKey, path, state, providers, typeEntries)]
    };
  }
  if (result.resultType === 'ATTRIBUTE_CHANGE') {
    return {
      semantic: { resultType: 'ATTRIBUTE_CHANGE', target: semanticTarget(result.target), moment: momentOf(result) },
      operations: [compileAttributeChange(result, path, state)]
    };
  }
  return fail(`${path}.resultType`, '未支持的命中结果，按共享契约整体拒绝');
}

function compileHeal(result: Extract<SkillEffectResult, { resultType: 'DIRECT_HEAL' }>, path: string, state: NumericCompileState): OperationDefinition {
  if (result.target !== 'SOURCE') return fail(`${path}.target`, 'DIRECT_HEAL 只有 SOURCE 可译 self');
  return { operation: 'heal', target: 'self', amount: compileValue(result.valueRule, `${path}.valueRule`, state) };
}

function compileShieldProvider(
  authored: AuthoredHitProgram,
  effect: SkillEffect,
  result: Extract<SkillEffectResult, { resultType: 'SPELL_SHIELD' }>,
  path: string,
  state: NumericCompileState,
  typeEntries: Map<string, string>
): ProviderDefinition {
  if (result.target !== 'SOURCE') return fail(`${path}.target`, '只有 SOURCE 范围且全部 self 时可证明原身份等价');
  if (result.spellShieldBlockScope !== null) return fail(`${path}.spellShieldBlockScope`, 'SPELL_SHIELD 必须使用 null 粒度');
  assertStandardLifecycle(effect, `${planPath(authored.skillKey, `effects.${effect.effectKey}`)}.lifecycle`, 'SOURCE');
  if (compileLifecycleNumber(effect.lifecycle!.maxStacksValue, `${path}.maxStacksValue`, authored, '层数') !== 1
    || compileLifecycleNumber(effect.lifecycle!.applicationStacksValue, `${path}.applicationStacksValue`, authored, '层数') !== 1) {
    return fail(`${path}.lifecycle`, '本期只支持单层和每次施加一层，不能丢弃层数配置');
  }
  typeEntries.set('provider/spell_shield', 'provider');
  typeEntries.set('event/spell_shield_blocked', 'event');
  return {
    providerKey: spellShieldProviderKey(authored.skillKey, effect.effectKey), kind: 'status', stableId: spellShieldProviderKey(authored.skillKey, effect.effectKey),
    types: ['provider/spell_shield'],
    lifecycle: {
      durationMs: compileDuration(effect, authored, `${planPath(authored.skillKey, `effects.${effect.effectKey}`)}.lifecycle.durationValue`, state),
      maxStacks: 1, refreshPolicy: 'replace'
    },
    listeners: []
  };
}

function compileConsumeOperations(
  authored: AuthoredHitProgram,
  rule: SkillTriggerRuleDetail,
  shieldEffectKey: string,
  state: NumericCompileState
): OperationDefinition[] {
  const root = planPath(authored.skillKey, `rules.${rule.ruleKey}`);
  if (rule.eventSource.eventType !== 'SPELL_SHIELD_BLOCKED') return fail(`${root}.eventSource`, '消费监听器只接受真实 SPELL_SHIELD_BLOCKED');
  if (rule.eventSource.detail.shieldEffectKey !== shieldEffectKey) {
    return fail(`${root}.eventSource.detail.shieldEffectKey`, 'successful_spell_block 必须对应真实 shieldEffectKey');
  }
  if (rule.conditionGroups.length) return fail(`${root}.conditionGroups`, '本期消费监听器不支持额外条件');
  if (rule.perTargetCooldown || rule.maxTriggersPerProcess || ('oncePerUse' in rule && rule.oncePerUse)) {
    return fail(`${root}.limits`, '本期消费监听器不支持触发限制');
  }
  const actions = stableSorted(rule.actions, (item) => item.sortOrder);
  const operations: OperationDefinition[] = [];
  for (const action of actions) {
    const actionPath = `${root}.actions.${action.actionKey}`;
    if (action.actionType !== 'EXECUTE_EFFECT') return fail(`${actionPath}.actionType`, '未支持的过程或动作依赖，按共享契约整体拒绝');
    if (action.targetContext !== 'CURRENT_TARGET') return fail(`${actionPath}.targetContext`, '未支持的目标上下文');
    if (action.runtimeInputBindings.length || action.resultModifiers.length) {
      return fail(`${actionPath}.runtimeInputBindings`, '未支持的动作依赖、来源或目标，按共享契约整体拒绝');
    }
    const effect = lookupEffect(authored, action.detail.effectKey, `${actionPath}.detail.effectKey`);
    for (const result of stableSorted(effect.results, (item) => item.sortOrder)) {
      const resultPath = planPath(authored.skillKey, `effects.${effect.effectKey}.results.${result.resultKey}`);
      if (result.spellShieldBlockScope !== null || momentOf(result) !== 'INSTANT') {
        return fail(resultPath, '消费动作只支持无阻挡粒度的即时结果');
      }
      if (result.resultType === 'DIRECT_HEAL') {
        operations.push(compileHeal(result, resultPath, state));
        continue;
      }
      if (result.resultType === 'LIFECYCLE_OPERATION' && result.detail.operation === 'REMOVE') {
        if (result.detail.targetEffectKey !== shieldEffectKey) {
          return fail(`${resultPath}.detail.targetEffectKey`, 'LIFECYCLE REMOVE 必须指向本盾');
        }
        if (result.target !== 'SOURCE') return fail(`${resultPath}.target`, 'LIFECYCLE REMOVE 须译 self');
        operations.push({ operation: 'expire_provider', target: 'self', providerRefFromEvent: true });
        continue;
      }
      return fail(`${resultPath}.resultType`, '未支持的消费结果');
    }
  }
  if (!operations.length) return fail(root, '消费监听器没有可执行动作');
  return operations;
}

function assertHitRule(rule: SkillTriggerRuleDetail, authored: AuthoredHitProgram, resolveKind: HitResolveKind): void {
  const root = planPath(authored.skillKey, `rules.${rule.ruleKey}`);
  if (resolveKind === 'basic_attack') {
    if (rule.eventSource.eventType !== 'BASIC_ATTACK_HIT') {
      return fail(`${root}.eventSource.eventType`, '普攻命中计划只接受 BASIC_ATTACK_HIT');
    }
  } else if (rule.eventSource.eventType !== 'SKILL_HIT') {
    return fail(`${root}.eventSource.eventType`, '命中计划只接受 SKILL_HIT');
  }
  if (rule.eventSource.eventType === 'SKILL_HIT' && rule.eventSource.detail.sourceSkillKey
    && rule.eventSource.detail.sourceSkillKey !== authored.skillKey) {
    return fail(`${root}.eventSource.detail.sourceSkillKey`, '来源技能必须等于本次作者技能身份');
  }
  for (const action of rule.actions) {
    if (action.actionType !== 'EXECUTE_EFFECT') return fail(`${root}.actions.${action.actionKey}.actionType`, '未支持的过程或动作依赖，按共享契约整体拒绝');
    if (action.runtimeInputBindings.length || action.resultModifiers.length) {
      return fail(`${root}.actions.${action.actionKey}.runtimeInputBindings`, '未支持的动作依赖、来源或目标，按共享契约整体拒绝');
    }
    if (action.targetContext !== 'CURRENT_TARGET') {
      return fail(`${root}.actions.${action.actionKey}.targetContext`, '未支持的目标上下文');
    }
  }
}

export function provenSkillUseFact(input: {
  useKey: string; source: 'source' | 'target'; skillKey: string; priorQualifiedContacts?: string[];
}): SkillUseFact {
  catalogKey(input.useKey, 'skillUses.useKey');
  return {
    useKey: input.useKey, source: input.source, skillKey: input.skillKey, historyState: 'complete',
    ...(input.priorQualifiedContacts?.length ? { priorQualifiedContacts: [...input.priorQualifiedContacts] } : {})
  };
}

export function unknownSkillUseFact(input: {
  useKey: string; source: 'source' | 'target'; skillKey: string; priorQualifiedContacts?: string[];
}): SkillUseFact {
  catalogKey(input.useKey, 'skillUses.useKey');
  return {
    useKey: input.useKey, source: input.source, skillKey: input.skillKey, historyState: 'unknown',
    ...(input.priorQualifiedContacts?.length ? { priorQualifiedContacts: [...input.priorQualifiedContacts] } : {})
  };
}

export function skillHitFact(driverEntryKey: string, useRef: string | null, sequence: number | null = null): SkillHitFact {
  if (!driverEntryKey.trim()) fail('skillHitFacts.driverEntryKey', '需要明确的单次入口');
  return { driverEntryKey, useRef, sequence };
}

export function adaptHitProgram(authored: AuthoredHitProgram): AdaptedHitProgram {
  catalogKey(authored.gameId, 'gameId');
  catalogKey(authored.skillKey, 'skillKey');
  if (!Number.isInteger(authored.skillLevel) || authored.skillLevel < 1) fail('skillLevel', '本次等级必须明确且有效');
  if (!Number.isInteger(authored.characterLevel) || authored.characterLevel < 1) fail('characterLevel', '本次等级必须明确且有效');
  const state = numericState(authored);
  const providers = new Map<string, ProviderDefinition>();
  const skillHitRules = authored.rules.filter((rule) => rule.eventSource.eventType === 'SKILL_HIT');
  const basicHitRules = authored.rules.filter((rule) => rule.eventSource.eventType === 'BASIC_ATTACK_HIT');
  const consumeRules = stableSorted(
    authored.rules.filter((rule) => rule.eventSource.eventType === 'SPELL_SHIELD_BLOCKED'),
    (rule) => rule.sortOrder
  );
  if (skillHitRules.length && basicHitRules.length) {
    return fail(planPath(authored.skillKey, `rules.${basicHitRules[0]!.ruleKey}.eventSource`), '同一 resolve 不能同时入队 skill_hit 与 basic_attack_hit');
  }
  if (basicHitRules.length && consumeRules.length) {
    return fail(planPath(authored.skillKey, `rules.${consumeRules[0]!.ruleKey}.eventSource`), '普攻命中入口不接办法术护盾消费');
  }
  const resolveKind: HitResolveKind = basicHitRules.length ? 'basic_attack' : 'skill';
  const typeEntries = new Map<string, string>(resolveKind === 'basic_attack'
    ? [['event/basic_attack_hit', 'event'], ['ability/basic_attack', 'ability']]
    : [['event/skill_hit', 'event']]);
  const candidates: SkillHitCandidate[] = [];
  let vampRules: GenericVampRule[] | undefined;
  const abilityTypes = new Set<string>();
  const hitRules = stableSorted(resolveKind === 'basic_attack' ? basicHitRules : skillHitRules, (rule) => rule.sortOrder);
  const unknown = authored.rules.filter((rule) => rule.eventSource.eventType !== 'SKILL_HIT'
    && rule.eventSource.eventType !== 'BASIC_ATTACK_HIT'
    && rule.eventSource.eventType !== 'SPELL_SHIELD_BLOCKED');
  if (unknown.length) {
    return fail(planPath(authored.skillKey, `rules.${unknown[0]!.ruleKey}.eventSource`), '未支持的过程或事件，按共享契约整体拒绝');
  }
  for (const rule of hitRules) {
    assertHitRule(rule, authored, resolveKind);
    const converted = convertRuleConditions(rule, authored, state, resolveKind);
    for (const action of stableSorted(rule.actions, (item) => item.sortOrder)) {
      if (action.actionType !== 'EXECUTE_EFFECT') continue;
      const effect = lookupEffect(authored, action.detail.effectKey, planPath(authored.skillKey, `rules.${rule.ruleKey}.actions.${action.actionKey}.detail.effectKey`));
      const occurrence = `${rule.ruleKey}:${action.actionKey}`;
      for (const result of stableSorted(effect.results, (item) => item.sortOrder)) {
        const path = planPath(authored.skillKey, `effects.${effect.effectKey}.results.${result.resultKey}`);
        const compiled = compileResultOperations(authored, effect, result, path, state, providers, typeEntries, resolveKind);
        if (compiled.vamp) {
          if (vampRules && !sameJson(vampRules, compiled.vamp.rules)) fail(path, '同一命中计划的游戏吸血规则不一致');
          vampRules = compiled.vamp.rules;
          for (const key of compiled.vamp.abilityTypes) abilityTypes.add(key);
        }
        candidates.push({
          candidateKey: `${occurrence}:${result.resultKey}`,
          effectOccurrenceKey: occurrence,
          effectKey: effect.effectKey,
          resultKey: result.resultKey,
          semantic: compiled.semantic,
          spellShieldBlockScope: result.spellShieldBlockScope as SpellShieldBlockScope | null,
          ...(converted.participation ? { participationCondition: converted.participation } : {}),
          ...(converted.eventValueConditions.length ? { eventValueConditions: converted.eventValueConditions } : {}),
          operations: compiled.operations
        });
      }
    }
  }
  const seenCandidate = new Set<string>();
  for (const candidate of candidates) {
    if (seenCandidate.has(candidate.candidateKey)) fail(planPath(authored.skillKey, `candidates.${candidate.candidateKey}`), 'candidateKey 重复');
    seenCandidate.add(candidate.candidateKey);
  }
  for (const rule of consumeRules) {
    if (rule.eventSource.eventType !== 'SPELL_SHIELD_BLOCKED') continue;
    const shieldEffectKey = rule.eventSource.detail.shieldEffectKey;
    const effect = lookupEffect(authored, shieldEffectKey, planPath(authored.skillKey, `rules.${rule.ruleKey}.eventSource.detail.shieldEffectKey`));
    const shieldResults = effect.results.filter((item) => item.resultType === 'SPELL_SHIELD');
    if (shieldResults.length !== 1 || effect.results.length !== 1) return fail(planPath(authored.skillKey, `effects.${effect.effectKey}`), '法术护盾效果必须仅含一个 SPELL_SHIELD 结果');
    const shieldPath = planPath(authored.skillKey, `effects.${effect.effectKey}.results.${shieldResults[0]!.resultKey}`);
    const provider = compileShieldProvider(authored, effect, shieldResults[0]!, shieldPath, state, typeEntries);
    const consumeState = numericState(authored);
    consumeState.bindParameters = false;
    provider.listeners = [{
      listenerKey: rule.ruleKey,
      eventMatcher: { all: ['event/spell_shield_blocked'] },
      operations: compileConsumeOperations(authored, rule, shieldEffectKey, consumeState)
    }];
    for (const key of consumeState.requiredAttributes) state.requiredAttributes.add(key);
    mergeProvider(providers, provider, shieldPath);
  }
  return {
    skillHit: { skillKey: authored.skillKey, candidates },
    resolveKind,
    providers: [...providers.values()],
    params: state.params,
    formulas: [...state.namedFormulas.values()],
    requiredAttributes: [...state.requiredAttributes],
    typeEntries: [...typeEntries].map(([key, domain]) => ({ key, domain })),
    vampRules,
    abilityTypes: [...abilityTypes]
  };
}

function addType(request: CompileRequest, key: string, domain: string, path: string): void {
  const old = request.typeCatalog.types.find((row) => row.key === key);
  if (old && old.domain !== domain) fail(path, `类型域冲突：${key}`);
  if (!old) request.typeCatalog.types.push({ key, domain });
}

export function withHitProgram(
  input: CompileRequest,
  binding: HitProgramBinding,
  options: { rulesHash: string }
): CompileRequest {
  if (!options.rulesHash.trim() || options.rulesHash === input.rulesHash) fail('rulesHash', '接入规则后必须提供新的配置摘要');
  const adapted = adaptHitProgram(binding.authored);
  const request = structuredClone(input);
  request.rulesHash = options.rulesHash;
  request.sharedProviders ??= [];
  request.formulas ??= [];
  for (const entry of adapted.typeEntries) addType(request, entry.key, entry.domain, 'typeCatalog');
  for (const provider of adapted.providers) {
    const existing = request.sharedProviders.find((row) => row.providerKey === provider.providerKey);
    if (existing && !sameJson(existing, provider)) fail(`sharedProviders.${provider.providerKey}`, 'provider 与现有定义冲突');
    if (!existing) request.sharedProviders.push(provider);
  }
  const provider = request.sharedProviders.find((row) => row.providerKey === binding.hitProviderKey);
  const ability = provider?.abilities?.find((row) => row.abilityKey === binding.hitAbilityKey);
  if (!ability) return fail('bindings', '绑定必须指向已有命中能力');
  if (ability.kind !== 'active') return fail('bindings', '命中入口必须是主动单次能力');
  if (adapted.resolveKind === 'skill' && ability.types?.includes('ability/basic_attack')) {
    return fail('bindings', '技能命中不能绑定已声明普通攻击身份的能力');
  }
  if (adapted.vampRules) {
    if (request.combatants.length !== 2 || !request.combatants.some((actor) => actor.key === 'source')
      || !request.combatants.some((actor) => actor.key === 'target')
      || request.combatants.some((actor) => binding.authored.identity[actor.key].category !== 'CHAMPION')) {
      return fail('combatants', '吸血首期仅接受身份已核验的两个英雄对象');
    }
    if (request.rules.vampRules?.length && !sameJson(request.rules.vampRules, adapted.vampRules)) {
      return fail('rules.vampRules', '已有游戏吸血规则与命中计划冲突');
    }
    request.rules.vampRules = adapted.vampRules;
    ability.types = [...new Set([...(ability.types ?? []).filter((key) => !key.startsWith('ability/')), ...adapted.abilityTypes])];
    for (const actor of request.combatants) actor.types = [...new Set([...(actor.types ?? []), 'combatant/champion'])];
  }
  if (adapted.resolveKind === 'basic_attack') {
    ability.skillKey = binding.authored.skillKey;
    ability.types = [...new Set([...(ability.types ?? []), 'ability/basic_attack', ...adapted.abilityTypes])];
  }
  if ((ability.operations ?? []).some((operation) => operation.operation !== 'resolve_skill_hit')) {
    return fail('bindings', '命中能力 operations 只能是一条 resolve_skill_hit，不能混放伤害或控制');
  }
  if (adapted.skillHit.candidates.length || adapted.resolveKind === 'basic_attack') {
    ability.operations = [{
      operation: 'resolve_skill_hit',
      target: 'target',
      skillHit: adapted.skillHit
    }];
  }
  ability.params ??= {};
  for (const [key, value] of Object.entries(adapted.params)) {
    if (key in ability.params && ability.params[key] !== value) fail(`ability.params.${key}`, '参数与现有运行输入冲突');
    ability.params[key] = value;
  }
  for (const formula of adapted.formulas) {
    const old = request.formulas.find((row) => row.key === formula.key);
    if (old && JSON.stringify(old.expression) !== JSON.stringify(formula.expression)) fail('formulas', '具名公式与现有输入冲突');
    if (!old) request.formulas.push(formula);
  }
  for (const actor of request.combatants) {
    for (const key of adapted.requiredAttributes) {
      const slot = actor.attributes[key];
      if (!slot) fail(`combatants.${actor.key}.attributes.${key}`, '缺少明确的运行属性，不能自动补零');
      for (const field of ['base', 'current', 'max', 'resolved'] as const) {
        finite(slot[field], `combatants.${actor.key}.attributes.${key}.${field}`);
      }
    }
  }
  return request;
}

export function spellShieldProviderKey(skillKey: string, effectKey: string): string {
  return `shield:${skillKey}:${effectKey}`;
}

export type { SkillEffectSpellShieldBlockScope };
