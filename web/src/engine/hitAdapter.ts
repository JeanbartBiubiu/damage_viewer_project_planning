import { formulasUsedByInternalValue } from './approvedFormulaValues';
import { sameFormulaPayload } from '../services/skillFormulaContract';
import { TypeCatalogEntries } from './typeCatalogEntries';
import { SKILL_CATEGORY_TYPE_PREFIX } from './skillCategoryType';
import type { GameVampRule } from '../types/gameVamp';
import type {
  SkillEffect, SkillEffectResult, SkillEffectSpellShieldBlockScope, SkillEffectStatusOperationResult,
  SkillEffectValueRule
} from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcess } from '../types/skillProcess';
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
  NumericAdaptationError, tryFoldConstant, type NumericCompileState, wrapValueRuleExpression
} from './numericAdapter';
import { compilePersistentResult, type AuthoredPersistentResult } from './persistentResultAdapter';
import { compilePairedAttributeSnapshot } from './pairedAttributeSnapshotAdapter';
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
  internalStates?: readonly SkillInternalState[];
  statuses: ReadonlyArray<Pick<GameStatus, 'statusKey' | 'statusKind' | 'status'>>;
  modifierZones?: ReadonlyArray<Pick<ModifierZone, 'modifierZoneKey' | 'domain' | 'calculationMode' | 'status'>
    & Partial<Pick<ModifierZone, 'gameId' | 'applicationStage'>>>;
  identity: { source: CombatantIdentityFact; target: CombatantIdentityFact };
  skillCategoryKeys?: readonly string[];
  vampRules?: readonly GameVampRule[];
  /** 仅宿主提供当前场景真实游戏绑定；不会进入公开编译或运行协议。 */
  criticalBinding?: (forced: boolean, path: string) => Pick<OperationDefinition, 'critChance' | 'critMultiplierMin'>;
  chargeReleaseContext?: { process: SkillProcess; rules: readonly SkillTriggerRuleDetail[] };
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
  const approved = tryFoldConstant(expr);
  if (approved === null || !Number.isInteger(approved) || approved <= 0) {
    return fail(path, `${label}必须是正整数`);
  }
  return approved;
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
  authored: Pick<AuthoredHitProgram, 'identity'>
): GenericFormulaExpr {
  const category = authored.identity.target.category;
  if (!category) return fail(path, '目录身份及真实类别需显式事实，未知不补英雄默认');
  return constExpr(condition.detail.categories.includes(category) ? 1 : 0);
}

function identityEnemyPredicate(path: string, authored: Pick<AuthoredHitProgram, 'identity'>): GenericFormulaExpr {
  const hostility = authored.identity.target.hostility;
  if (!hostility) return fail(path, '目录身份及真实敌我需显式事实，未知不补敌方默认');
  return constExpr(hostility === 'ENEMY' ? 1 : 0);
}

export function compileHitIdentityCondition(
  condition: SkillTriggerCondition,
  path: string,
  authored: Pick<AuthoredHitProgram, 'identity'>
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
      if (condition.conditionType === 'INTERNAL_STATE_CHECK') {
        const detail = condition.detail;
        const definitions = authored.internalStates?.filter(row => row.stateKey === detail.stateKey) ?? [];
        const definition = definitions[0];
        if (definitions.length !== 1 || !definition || definition.gameId !== authored.gameId || definition.skillKey !== authored.skillKey
          || detail.stateSkillKey !== authored.skillKey || definition.stateType !== 'COUNTER' || definition.scope !== 'SKILL'
          || detail.valueKind !== 'VALUE' || detail.optionKey !== null || detail.expectedBoolean !== null
          || !detail.comparator || !COMPARATORS[detail.comparator] || !detail.comparisonValue
          || Object.keys(detail).some(key => !['stateSkillKey', 'stateKey', 'valueKind', 'optionKey', 'expectedBoolean', 'comparator', 'comparisonValue'].includes(key))) {
          fail(path, '命中状态比较仅允许本技能自身整数计数当前值');
        }
        const right = compileNumericValue(detail.comparisonValue, `${path}.comparisonValue`,
          { ...state, bindParameters: false, allowAttributeReads: false, runtimeInputReads: undefined, sceneParameterValues: undefined }, fail);
        const threshold = tryFoldConstant(right);
        if (threshold === null || !Number.isSafeInteger(threshold) || threshold < 0) fail(path, '命中状态门槛必须为明确非负整数');
        remaining.push({ op: COMPARATORS[detail.comparator]!, args: [{ op: 'read', path: `provider.state.${detail.stateKey}` }, right] });
      } else remaining.push(compileHitIdentityCondition(condition, path, authored));
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
  typeEntries: TypeCatalogEntries,
  resolveKind: HitResolveKind,
  empoweredPayload = false
): { operation: OperationDefinition; vamp: AdaptedVampDamage } {
  if (result.target !== 'TARGET') return fail(`${path}.target`, '本期伤害只支持作用对象 TARGET');
  if (momentOf(result) !== 'INSTANT') return fail(`${path}.lifecycleBehavior`, 'DAMAGE moment must be INSTANT');
  const role = result.detail.attackDamageRole;
  if ('attackDamageRole' in result.detail && role !== 'PRIMARY' && role !== 'REPLACE_PRIMARY') fail(`${path}.detail.attackDamageRole`, '未知普攻伤害角色');
  if (role === 'PRIMARY' && resolveKind !== 'basic_attack') fail(`${path}.detail.attackDamageRole`, '主体角色必须绑定真实普攻入口');
  const expectedDelivery = resolveKind === 'basic_attack' || role === 'REPLACE_PRIMARY' ? 'BASIC_ATTACK' : 'SKILL';
  if (result.detail.deliveryKind !== expectedDelivery && !(empoweredPayload && role === undefined && result.detail.deliveryKind === 'BASIC_ATTACK')) {
    return fail(
      `${path}.detail.deliveryKind`,
      resolveKind === 'basic_attack'
        ? '普攻命中入口要求显式 BASIC_ATTACK 产生方式，不能与技能口径混用'
        : '本期命中入口只接受技能伤害'
    );
  }
  if (result.detail.originKind !== 'DIRECT') return fail(`${path}.detail.originKind`, '未支持的来源性质');
  const critical = result.detail.critical;
  const criticalOperation: Partial<OperationDefinition> = { critEligible: false };
  if (critical.mode === 'DISALLOWED') {
    if (critical.multiplierValue !== null) return fail(`${path}.detail.critical.multiplierValue`, '禁止暴击不得保留倍率');
  } else if (critical.mode === 'SOURCE_CRIT_CHANCE' || critical.mode === 'FORCED') {
    if (!critical.multiplierValue || !authored.criticalBinding) return fail(`${path}.detail.critical`, '暴击需要原作者倍率与真实场景游戏绑定');
    Object.assign(criticalOperation, authored.criticalBinding(critical.mode === 'FORCED', `${path}.detail.critical.mode`));
    criticalOperation.critEligible = true;
    criticalOperation.critMultiplier = compileNumericValue(critical.multiplierValue, `${path}.detail.critical.multiplierValue`, state, fail);
    const chance = criticalOperation.critChance;
    if (!chance) return fail(`${path}.detail.critical`, '暴击缺少实际概率绑定');
    if (chance?.op === 'read') {
      const attribute = /^source\.attr\.([a-z][a-z0-9_]*)\.resolved$/.exec(chance.path ?? '');
      if (!attribute) return fail(`${path}.detail.critical`, '来源暴击概率必须读取实际来源属性');
      state.requiredAttributes.add(attribute[1]!);
    }
  } else return fail(`${path}.detail.critical.mode`, '未知暴击模式');
  const damageType = result.detail.damageTypeKey;
  if (typeof damageType !== 'string' || !damageType) return fail(`${path}.detail.damageTypeKey`, '需要明确的伤害类型原键');
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
      operation: 'damage', target: 'target', damageType, amount, ref: result.resultKey, ...criticalOperation,
      ...adapted.operation
    },
    vamp: adapted
  };
}

function compilePersistentHitResult(
  authored: AuthoredHitProgram,
  effect: SkillEffect,
  result: SkillEffectStatusOperationResult | Extract<SkillEffectResult, { resultType: 'ATTRIBUTE_CHANGE' }>,
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
    if (old && !sameFormulaPayload(old, formula)) fail(`${path}.formulas`, '具名公式与现有输入冲突');
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
  typeEntries: TypeCatalogEntries
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
    providerKey, skillKey: authored.skillKey, kind: 'status', stableId: providerKey, types: [typeKey],
    lifecycle: {
      durationMs: compileDuration(effect, authored, `${planPath(authored.skillKey, `effects.${effect.effectKey}`)}.lifecycle.durationValue`, state),
      maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target'
    }
  };
  mergeProvider(providers, provider, `${path}.provider`);
  return { operation: 'apply_provider', target: 'target', providerDefinitionRef: providerKey };
}

/** 自然技能声明的控制借用原命中单元，数值与数据来源仍属于该自然技能。 */
export function compilePassiveHitControl(authored: AuthoredHitProgram, effect: SkillEffect, context: {
  providerRef: string; parentDefinitionRef: string; occurrenceKey: string; participationCondition?: GenericFormulaExpr;
}) {
  catalogKey(context.providerRef, 'participationProviderRef');
  const state = numericState(authored);
  state.bindParameters = false;
  state.allowAttributeReads = false;
  const providers = new Map<string, ProviderDefinition>();
  const types = new TypeCatalogEntries();
  if (!effect.results.length || effect.gameId !== authored.gameId || effect.skillKey !== authored.skillKey) fail(planPath(authored.skillKey, `effects.${effect.effectKey}`), '被动控制必须引用同技能完整效果');
  const candidates: SkillHitCandidate[] = stableSorted(effect.results, result => result.sortOrder).map(result => {
    const path = planPath(authored.skillKey, `effects.${effect.effectKey}.results.${result.resultKey}`);
    if (result.resultType !== 'STATUS_OPERATION') return fail(path, '被动命中候选本期只接入闭合控制，不能混入其它结果');
    const kind = lookupStatus(authored, result.detail.statusKey, `${path}.detail.statusKey`);
    if (kind === 'movement_slow' || result.target !== 'TARGET' || result.detail.operation !== 'APPLY'
      || momentOf(result) !== 'PERSISTENT' || !result.lifecycleBehavior
      || result.lifecycleBehavior.valueReadMode !== null || result.lifecycleBehavior.stackValueMode !== null
      || result.lifecycleBehavior.reapplicationValueMode !== null || result.lifecycleBehavior.periodicExecutionMode !== null
      || result.valueRule !== null || result.spellShieldBlockScope !== 'RESULT') return fail(path, '被动控制必须是完整有期、无数值的目标施加，沿原技能覆盖单元');
    const providerKey = `status:${context.parentDefinitionRef}:${authored.skillKey}:${effect.effectKey}:${result.resultKey}`;
    const operation = compileClosedControl(authored, effect, result, kind, providerKey, path, state, providers, types);
    const provider = providers.get(providerKey)!;
    const duration = tryFoldConstant(provider.lifecycle!.durationMs!);
    if (duration === null || !Number.isSafeInteger(duration) || duration <= 0) return fail(path, '被动控制时长必须由自身等级核定，不能读施放技能参数');
    provider.lifecycle!.durationMs = constExpr(duration);
    return { candidateKey: `${context.occurrenceKey}:${result.resultKey}`, effectOccurrenceKey: context.occurrenceKey,
      effectKey: effect.effectKey, resultKey: result.resultKey,
      semantic: { resultType: 'STATUS_OPERATION', target: 'TARGET', moment: 'PERSISTENT', statusOperation: 'APPLY', statusKey: result.detail.statusKey, statusKind: kind },
      spellShieldBlockScope: 'RESULT', participationProviderRef: context.providerRef,
      ...(context.participationCondition ? { participationCondition: context.participationCondition } : {}),
      operations: [{ ...operation, ref: `skills.${authored.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}` }]
    };
  });
  return { candidates, providers: [...providers.values()], formulas: [...state.namedFormulas.values()], types: [...types].map(([key, domain]) => ({ key, domain })) };
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
  typeEntries: TypeCatalogEntries,
  resolveKind: HitResolveKind,
  empoweredPayload = false
): { semantic: SkillHitSemantic; operations: OperationDefinition[]; vamp?: AdaptedVampDamage } {
  if (result.resultType !== 'DAMAGE' && 'attackDamageRole' in result.detail) fail(`${path}.detail.attackDamageRole`, '非伤害结果不能声明普攻伤害角色');
  if (result.resultType === 'DAMAGE') {
    if (effect.lifecycle !== null || result.lifecycleBehavior !== null) {
      return fail(path, '即时命中伤害不能丢弃持续或周期生命周期与结果时点');
    }
    const compiled = compileDamage(authored, result, path, state, typeEntries, resolveKind, empoweredPayload);
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
        operations: [compilePersistentHitResult(authored, effect, result, providerKey, path, state, providers)]
      };
    }
    return {
      semantic,
      operations: [compileClosedControl(authored, effect, result, kind, providerKey, path, state, providers, typeEntries)]
    };
  }
  if (result.resultType === 'ATTRIBUTE_CHANGE') {
    if (effect.lifecycle) {
      const life = effect.lifecycle;
      const zone = authored.modifierZones?.filter(row => row.modifierZoneKey === result.detail.modifierZoneKey) ?? [];
      const flat = zone[0]?.applicationStage === 'ATTRIBUTE_FLAT' && zone[0]?.calculationMode === 'FLAT_ADD';
      const totalDecrease = zone[0]?.applicationStage === 'ATTRIBUTE_PERCENT' && zone[0]?.calculationMode === 'RATIO_MULTIPLY'
        && result.detail.operation === 'DECREASE';
      if (effect.results.length !== 1 || result.target !== 'TARGET' || result.detail.attributeKey === 'hp'
        || life.endWhenShieldEndsResultKey != null || !life.durationValue || zone.length !== 1
        || zone[0]!.gameId !== authored.gameId || !flat && !totalDecrease
        || zone[0]!.domain !== 'ATTRIBUTE' || zone[0]!.status !== 'ENABLED') {
        return fail(path, '持久命中属性只接完整单结果目标属性平加或总属性比例减少，不能混入其它生命周期或修正');
      }
      const duration = tryFoldConstant(compileNumericValue(life.durationValue, `${path}.lifecycle.durationValue`,
        { ...state, bindParameters: false, allowAttributeReads: false, allowedContextKeys: undefined }, fail));
      if (duration === null || !Number.isSafeInteger(duration) || duration < 1) return fail(path, '持久命中属性需要静态正整数期限');
      return {
        semantic: { resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET', moment: 'PERSISTENT' },
        operations: [compilePersistentHitResult(authored, effect, result, `attribute:${authored.skillKey}:${effect.effectKey}:${result.resultKey}`, path, state, providers)]
      };
    }
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
  typeEntries: TypeCatalogEntries
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
    providerKey: spellShieldProviderKey(authored.skillKey, effect.effectKey), skillKey: authored.skillKey, kind: 'status', stableId: spellShieldProviderKey(authored.skillKey, effect.effectKey),
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
  if (rule.eventSource.eventType === 'SKILL_HIT' && Object.prototype.hasOwnProperty.call(rule.eventSource.detail, 'processMoment')) {
    return fail(`${root}.eventSource.detail.processMoment`, '阶段命中必须先经过完整过程阶段图校验');
  }
  for (const action of rule.actions) {
    if (action.actionType !== 'EXECUTE_EFFECT') return fail(`${root}.actions.${action.actionKey}.actionType`, '未支持的过程或动作依赖，按共享契约整体拒绝');
    if (action.resultModifiers.length) {
      return fail(`${root}.actions.${action.actionKey}.runtimeInputBindings`, '未支持的动作依赖、来源或目标，按共享契约整体拒绝');
    }
    if (action.targetContext !== 'CURRENT_TARGET') {
      return fail(`${root}.actions.${action.actionKey}.targetContext`, '未支持的目标上下文');
    }
  }
}

function hitActionState(authored: AuthoredHitProgram, action: SkillTriggerRuleDetail['actions'][number], state: NumericCompileState): NumericCompileState {
  const reads: Record<string, GenericFormulaExpr> = {};
  const keys = new Set<string>();
  const context = authored.chargeReleaseContext;
  const process = context?.process;
  const orderedSteps = process && [...process.steps].sort((left, right) => left.sortOrder - right.sortOrder);
  const terminal = orderedSteps?.[orderedSteps.length - 1];
  const chargeRelease = process?.gameId === authored.gameId && process.skillKey === authored.skillKey && terminal?.stepType === 'CHARGE'
    && context!.rules.some(rule => rule.eventSource.eventType === 'SKILL_USED' && rule.eventSource.detail.sourceSkillKey === authored.skillKey
      && rule.eventSource.detail.useKind === 'ACTIVE' && rule.eventSource.detail.castPhase === 'INITIAL'
      && rule.actions.length === 1 && rule.actions[0]!.actionType === 'START_PROCESS' && rule.actions[0]!.detail.processKey === process.processKey)
    && (terminal.detail.releaseAtMaximum === true || context!.rules.some(rule => rule.eventSource.eventType === 'SKILL_USED' && rule.eventSource.detail.sourceSkillKey === authored.skillKey
      && rule.eventSource.detail.useKind === 'ACTIVE' && rule.eventSource.detail.castPhase === 'CHARGE_RELEASE'
      && !rule.conditionGroups.length && !rule.perTargetCooldown && !rule.maxTriggersPerProcess && !rule.oncePerUse
      && rule.actions.length === 1 && rule.actions[0]!.actionType === 'ADVANCE_PROCESS'
      && rule.actions[0]!.targetContext === null && !rule.actions[0]!.runtimeInputBindings.length && !rule.actions[0]!.resultModifiers.length
      && rule.actions[0]!.detail.processKey === process.processKey && rule.actions[0]!.detail.stepKey === terminal.stepKey));
  for (const binding of action.runtimeInputBindings) {
    const path = planPath(authored.skillKey, `actions.${action.actionKey}.runtimeInputBindings.${binding.bindingKey}`);
    const parameter = authored.parameters?.filter(parameter => parameter.parameterKey === binding.parameterKey);
    if (!chargeRelease || binding.sourceType !== 'EVENT_VALUE' || binding.detail.eventValueKey !== 'CHARGE_DURATION_MS'
      || keys.has(binding.bindingKey) || binding.parameterKey in reads || parameter?.length !== 1
      || parameter[0]!.gameId !== authored.gameId || parameter[0]!.skillKey !== authored.skillKey || parameter[0]!.valueMode !== 'RUNTIME_INPUT') {
      fail(path, '仅真实同源蓄力释放的命中动作允许绑定实际蓄力毫秒；其它动态输入或重复绑定仍拒绝');
    }
    catalogKey(binding.bindingKey, `${path}.bindingKey`);
    keys.add(binding.bindingKey);
    reads[binding.parameterKey] = { op: 'read', path: 'use.charge_duration_ms' };
  }
  return { ...state, runtimeInputReads: reads };
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
  const typeEntries = new TypeCatalogEntries(resolveKind === 'basic_attack'
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
      const actionState = hitActionState(authored, action, state);
      const effect = lookupEffect(authored, action.detail.effectKey, planPath(authored.skillKey, `rules.${rule.ruleKey}.actions.${action.actionKey}.detail.effectKey`));
      const occurrence = `${rule.ruleKey}:${action.actionKey}`;
      const paired = effect.lifecycle ? compilePairedAttributeSnapshot(authored, effect, actionState) : null;
      if (paired) {
        if (resolveKind !== 'skill') fail(planPath(authored.skillKey, `effects.${effect.effectKey}`), '双端冻结属性必须来自实际技能命中');
        mergeProvider(providers, paired.provider, planPath(authored.skillKey, `effects.${effect.effectKey}`));
        candidates.push({ candidateKey: `${occurrence}:${paired.targetResult.resultKey}`, effectOccurrenceKey: occurrence,
          effectKey: effect.effectKey, resultKey: paired.targetResult.resultKey,
          semantic: { resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET', moment: 'PERSISTENT' }, spellShieldBlockScope: 'SKILL',
          ...(converted.participation ? { participationCondition: converted.participation } : {}),
          ...(converted.eventValueConditions.length ? { eventValueConditions: converted.eventValueConditions } : {}), operations: [paired.operation] });
        continue;
      }
      for (const result of stableSorted(effect.results, (item) => item.sortOrder)) {
        const path = planPath(authored.skillKey, `effects.${effect.effectKey}.results.${result.resultKey}`);
        const compiled = compileResultOperations(authored, effect, result, path, actionState, providers, typeEntries, resolveKind);
        const role = result.resultType === 'DAMAGE' ? result.detail.attackDamageRole : undefined;
        if (role === 'REPLACE_PRIMARY') fail(`${path}.detail.attackDamageRole`, '替换主体必须由自身首次单步骤强化待击消费');
        if (role && (converted.participation || converted.eventValueConditions.length)) fail(path, '主体角色不能附带参与或事件值条件');
        if (compiled.vamp) {
          if (vampRules && !sameJson(vampRules, compiled.vamp.rules)) fail(path, '同一命中计划的游戏吸血规则不一致');
          vampRules = compiled.vamp.rules;
          for (const key of compiled.vamp.abilityTypes) abilityTypes.add(key);
        }
        candidates.push({
          ...(role ? { attackDamageRole: role } : {}),
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
    formulas: formulasUsedByInternalValue([...providers.values()], [...state.namedFormulas.values()]),
    requiredAttributes: [...state.requiredAttributes],
    typeEntries: [...typeEntries].map(([key, domain]) => ({ key, domain })),
    vampRules,
    abilityTypes: [...abilityTypes]
  };
}

/** 从真实作者过程挂接编译负载；不制造作者规则，也不发布第二份命中事件。 */
export function adaptEmpoweredProcessPayload(authored: Omit<AuthoredHitProgram, 'rules' | 'chargeReleaseContext'>, process: SkillProcess,
  context: { processStartStateBindings?: Readonly<Record<string, string>>; sceneParameterValues?: Readonly<Record<string, number>> } = {}): AdaptedHitProgram {
  const root = `skills.${authored.skillKey}.processes.${process.processKey}`;
  const step = process.steps[0];
  const quota = step?.stepType === 'EMPOWERED_BASIC_ATTACK' && Object.prototype.hasOwnProperty.call(step.detail, 'maximumAttackCountValue');
  if (process.gameId !== authored.gameId || process.skillKey !== authored.skillKey || process.steps.length !== 1
    || step?.stepType !== 'EMPOWERED_BASIC_ATTACK' || step.detail.consumeMoment !== (quota ? 'ATTACK_START' : 'ATTACK_HIT') || step.occupiesAction !== false) fail(root, '负载仅接真实单步骤且明确声明消费模式的强化过程');
  const bindings = stableSorted(process.effectBindings.filter(binding => binding.moment.momentType === 'STEP_EXECUTION' && binding.moment.stepKey === step.stepKey), binding => binding.sortOrder);
  if (!bindings.length) fail(`${root}.effectBindings`, '强化步骤缺少真实命中挂接');
  const program: AuthoredHitProgram = { ...authored, rules: [] };
  if (quota && compileLifecycleNumber(step.detail.maximumAttackCountValue!, `${root}.steps.${step.stepKey}.detail.maximumAttackCountValue`, program, '发动配额') > 64) fail(root, '发动配额必须为静态1～64整数');
  const state = numericState(program), providers = new Map<string, ProviderDefinition>(), typeEntries = new TypeCatalogEntries();
  state.processStartStateBindings = context.processStartStateBindings;
  // resolve_skill_hit 的正式编译依赖；声明类型不创建作者监听或运行时命中事实。
  typeEntries.set('event/skill_hit', 'event');
  const candidates: SkillHitCandidate[] = [];
  const keys = new Set<string>(), abilityTypes = new Set<string>();
  let vampRules: GenericVampRule[] | undefined;
  for (const binding of bindings) {
    const bindingPath = `${root}.effectBindings.${binding.bindingKey}`;
    catalogKey(binding.bindingKey, `${bindingPath}.bindingKey`);
    if (keys.has(binding.bindingKey)) fail(bindingPath, '强化挂接身份重复');
    keys.add(binding.bindingKey);
    if (binding.moment.failureReason != null) fail(bindingPath, '强化步骤执行不能夹带失败原因');
    const effect = lookupEffect(program, binding.effectKey, `${bindingPath}.effectKey`);
    if (!effect.results.length) fail(bindingPath, '强化效果缺少完整结果');
    const resultKeys = new Set<string>();
    for (const result of stableSorted(effect.results, row => row.sortOrder)) {
      const path = `skills.${authored.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`;
      catalogKey(result.resultKey, `${path}.resultKey`);
      if (resultKeys.has(result.resultKey)) fail(path, '强化结果身份重复');
      resultKeys.add(result.resultKey);
      if (result.target !== 'TARGET' || result.resultType !== 'DAMAGE'
        && !(result.resultType === 'STATUS_OPERATION' && result.detail.operation === 'APPLY')) fail(path, '强化负载仅接实际命中目标的完整伤害或状态施加');
      const compiled = compileResultOperations(program, effect, result, path, result.resultType === 'DAMAGE'
        ? { ...state, sceneParameterValues: context.sceneParameterValues } : state, providers, typeEntries, 'skill', true);
      if (compiled.vamp) {
        if (vampRules && !sameJson(vampRules, compiled.vamp.rules)) fail(path, '强化负载吸血规则不一致');
        vampRules = compiled.vamp.rules;
        compiled.vamp.abilityTypes.forEach(key => abilityTypes.add(key));
      }
      for (const operation of compiled.operations) operation.ref = path;
      candidates.push({ candidateKey: `${binding.bindingKey}:${result.resultKey}`, effectOccurrenceKey: binding.bindingKey,
        ...(result.resultType === 'DAMAGE' && result.detail.attackDamageRole ? { attackDamageRole: result.detail.attackDamageRole } : {}),
        effectKey: effect.effectKey, resultKey: result.resultKey, semantic: compiled.semantic,
        spellShieldBlockScope: result.spellShieldBlockScope, operations: compiled.operations });
    }
  }
  if (candidates.some(candidate => candidate.attackDamageRole !== undefined)
    && (candidates.length !== 1 || candidates[0]?.attackDamageRole !== 'REPLACE_PRIMARY'
      || candidates[0].semantic.resultType !== 'DAMAGE' || candidates[0].semantic.moment !== 'INSTANT'
      || candidates[0].operations.length !== 1 || candidates[0].operations[0]?.operation !== 'damage')) {
    fail(`${root}.effectBindings`, '替换主体负载必须为唯一无条件即时目标伤害');
  }
  if (quota && candidates.some(candidate => candidate.attackDamageRole !== undefined)) fail(`${root}.effectBindings`, '发动配额只接普通附加负载，不能声明主体替换');
  return { skillHit: { skillKey: authored.skillKey, candidates }, resolveKind: 'skill', providers: [...providers.values()], params: state.params,
    formulas: formulasUsedByInternalValue([...providers.values(), candidates], [...state.namedFormulas.values()]), requiredAttributes: [...state.requiredAttributes],
    typeEntries: [...typeEntries].map(([key, domain]) => ({ key, domain })), vampRules, abilityTypes: [...abilityTypes] };
}

function addType(request: CompileRequest, key: string, domain: string, _path: string): void {
  const old = request.typeCatalog.types.find((row) => row.key === key && row.domain === domain);
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
    ability.types = [...new Set([...(ability.types ?? []).filter((key) => !key.startsWith(SKILL_CATEGORY_TYPE_PREFIX)), ...adapted.abilityTypes])];
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
  if (provider?.skillKey && provider.skillKey !== binding.authored.skillKey) fail('provider.skillKey', '供值器归属与技能不一致');
  if (!provider) fail('provider', '技能来源供值器不存在');
  provider!.skillKey = binding.authored.skillKey;
  ability.skillKey = binding.authored.skillKey;
  ability.params ??= {};
  for (const [key, value] of Object.entries(adapted.params)) {
    if (key in ability.params && ability.params[key] !== value) fail(`ability.params.${key}`, '参数与现有运行输入冲突');
    ability.params[key] = value;
  }
  for (const formula of adapted.formulas) {
    const old = request.formulas.find((row) => row.key === formula.key);
    if (old && !sameFormulaPayload(old, formula)) fail('formulas', '具名公式与现有输入冲突');
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
