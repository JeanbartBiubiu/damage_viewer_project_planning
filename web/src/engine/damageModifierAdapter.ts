import type { CompileRequest, GenericFormulaExpr, ModifierDefinition, ProviderDefinition, RunRequest } from '../types/genericEngine';
import type { SkillEffect, SkillEffectDamageModifierResult } from '../types/skillEffect';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillFormula } from '../types/skillFormula';
import type { ModifierZone } from '../types/modifierZone';
import type { NumericValue } from '../types/numericValue';
import type { CombatantCategory, CombatantIdentityFact } from './hitAdapter';
import { compileFormulaExpression, compileNumericValue, constExpr, createNumericCompileState, finiteNumber, NumericAdaptationError, tryFoldConstant, wrapValueRuleExpression } from './numericAdapter';
import { runtimeDamageType } from './damageTypeAdapter';
import { staticRatioValue } from './staticRatioValue';
import { auditAuthoredOrdinaryDamageSources, type OrdinaryDamageSourceAuditInput } from './ordinaryDamageSourceAudit';

export class DamageModifierAdaptationError extends NumericAdaptationError {
  constructor(path: string, message: string) { super(path, message); this.name = 'DamageModifierAdaptationError'; }
}
function fail(path: string, message: string): never { throw new DamageModifierAdaptationError(path, message); }
const finite = (value: unknown, path: string): number => finiteNumber(value, path, fail);
const CATEGORY: Record<CombatantCategory, string> = {
  CHAMPION: 'combatant/champion', EPIC_MONSTER: 'combatant/epic_monster', MINION: 'combatant/minion',
  NON_EPIC_MONSTER: 'combatant/non_epic_monster', STRUCTURE: 'combatant/structure'
};
const DELIVERY = { BASIC_ATTACK: 'delivery_basic_attack', SKILL: 'delivery_skill' } as const;
const ORIGIN = { DIRECT: 'origin_direct', REFLECTED: 'origin_reflected' } as const;
const combine = (op: 'min' | 'max' | 'add', items: GenericFormulaExpr[], empty: number): GenericFormulaExpr =>
  items.length ? items.slice(1).reduce((left, right) => ({ op, args: [left, right] }), items[0]!) : constExpr(empty);
const when = (condition: GenericFormulaExpr, yes: GenericFormulaExpr, no = constExpr(0)): GenericFormulaExpr =>
  ({ op: 'if', args: [condition, yes, no] });
const all = (items: GenericFormulaExpr[]): GenericFormulaExpr =>
  items.reduceRight((next, item) => when(item, next), constExpr(1));
type RequiredRead = { participant: 'source' | 'target'; attribute: string; field: string; positive: boolean };
function attributeReads(expression: GenericFormulaExpr): RequiredRead[] {
  const match = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\.(base|current|max|resolved)$/.exec(expression.path ?? '');
  const own: RequiredRead[] = match ? [{ participant: match[1] as 'source' | 'target', attribute: match[2]!, field: match[3]!, positive: false }] : [];
  const children = (expression.args ?? []).flatMap(attributeReads);
  if (expression.op === 'div') {
    const denominator = expression.args?.[1]?.path;
    for (const read of children) if (denominator === `${read.participant}.attr.${read.attribute}.max`) read.positive = true;
  }
  return [...own, ...children];
}

export type AuthoredDamageModifierProgram = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  effects: readonly SkillEffect[];
  rules: readonly SkillTriggerRuleDetail[];
  parameters?: readonly SkillParameter[];
  formulas?: readonly SkillFormula[];
  modifierZones: readonly ModifierZone[];
  owner: 'source' | 'target';
  /** 身份相对本次拥有者；不从两个对象键不同推断敌我。 */
  identity: { owner: CombatantIdentityFact; opponent: CombatantIdentityFact };
};
export type DamageModifierProgramBinding = { providerKey: string; authored: AuthoredDamageModifierProgram };
export type DamageModifierScenario = { compileRequest: CompileRequest; runRequest: RunRequest };

function numericState(a: AuthoredDamageModifierProgram, allowAttributeReads: boolean) {
  return createNumericCompileState({ gameId: a.gameId, skillKey: a.skillKey, skillLevel: a.skillLevel,
    characterLevel: a.characterLevel, parameters: a.parameters, formulas: a.formulas,
    formulaNamespace: `damage_modifier/${a.skillKey}`, bindParameters: false, allowAttributeReads,
    runtimeInputMessage: '条件伤害修正不能使用未供值的运行输入' });
}
function staticNumber(a: AuthoredDamageModifierProgram, value: NumericValue, path: string): number {
  const expr = compileNumericValue(value, path, numericState(a, false), fail);
  const folded = tryFoldConstant(expr);
  if (folded === null) return fail(path, '需要可静态求值的数值');
  return finite(folded, path);
}
function staticThreshold(a: AuthoredDamageModifierProgram, value: NumericValue, path: string): number {
  const state = numericState(a, false);
  if (value.kind !== 'FORMULA') return staticRatioValue(compileNumericValue(value, path, state, fail), path, fail);
  const rows = a.formulas?.filter(row => row.formulaKey === value.formulaKey) ?? [];
  if (rows.length !== 1 || rows[0]!.gameId !== a.gameId || rows[0]!.skillKey !== a.skillKey) fail(path, '门槛公式缺失、重复或归属错误');
  return staticRatioValue(compileFormulaExpression(rows[0]!.expression, `${path}.expression`, state, fail), path, fail);
}
function assertIdentity(a: AuthoredDamageModifierProgram): void {
  if (!['source', 'target'].includes(a.owner)) fail('owner', '拥有者必须明确');
  if (!a.identity?.owner?.category || !CATEGORY[a.identity.owner.category]
    || a.identity.owner.hostility !== 'SELF') fail('identity.owner', '需要相对拥有者的明确类别及自身身份');
  if (!a.identity.opponent?.category || !CATEGORY[a.identity.opponent.category]
    || !['ALLY', 'ENEMY'].includes(a.identity.opponent.hostility ?? '')) {
    fail('identity.opponent', '需要对手的明确类别及敌我事实，不能补默认');
  }
}

function compileResult(a: AuthoredDamageModifierProgram, result: SkillEffectDamageModifierResult, path: string) {
  const detail = result.detail;
  if (result.target !== 'SOURCE' || detail.direction !== 'DEALT') fail(path, '本入口需要施加给拥有者的造成伤害修正');
  if (result.spellShieldBlockScope !== null) fail(`${path}.spellShieldBlockScope`, '初始化修正没有命中护盾判定');
  const behavior = result.lifecycleBehavior;
  if (!behavior || behavior.moment !== 'PERSISTENT' || behavior.stackValueMode !== 'SHARED'
    || behavior.periodicExecutionMode !== null) fail(`${path}.lifecycleBehavior`, '需要持续、共享单层且非周期的修正');
  if (!['MOMENT_EVALUATION', 'APPLICATION_SNAPSHOT'].includes(behavior.valueReadMode ?? '')) fail(`${path}.lifecycleBehavior.valueReadMode`, '数值读取方式不明确');
  if (behavior.valueReadMode === 'MOMENT_EVALUATION' && behavior.reapplicationValueMode !== null) fail(`${path}.lifecycleBehavior.reapplicationValueMode`, '逐笔数值不使用重施快照策略');
  if (behavior.valueReadMode === 'APPLICATION_SNAPSHOT' && !['KEEP', 'REPLACE'].includes(behavior.reapplicationValueMode ?? '')) fail(`${path}.lifecycleBehavior.reapplicationValueMode`, '施加快照重施策略不受支持');
  if (detail.criticalFilter !== 'ANY') fail(`${path}.detail.criticalFilter`, '本入口尚未编译仅暴击或非暴击分支，不能当作全部伤害执行');
  if (!['INCREASE', 'DECREASE'].includes(detail.operation)) fail(`${path}.detail.operation`, '修正方向不明确');
  const zones = a.modifierZones.filter(z => z.modifierZoneKey === detail.modifierZoneKey);
  if (zones.length !== 1) fail(`${path}.detail.modifierZoneKey`, '乘区缺失或重复');
  const zone = zones[0]!;
  if (zone.gameId !== a.gameId || zone.status !== 'ENABLED' || zone.domain !== 'DAMAGE'
    || zone.calculationMode !== 'RATIO_ADD' || zone.applicationStage !== 'DAMAGE_PRE_DEFENSE') {
    fail(`${path}.detail.modifierZoneKey`, '需要同游戏启用的防御前伤害比例加算乘区');
  }
  const state = numericState(a, behavior.valueReadMode === 'MOMENT_EVALUATION');
  const rule = result.valueRule;
  if (!rule) return fail(`${path}.valueRule`, '修正金额缺失');
  if (finite(rule.fixedMultiplier, `${path}.valueRule.fixedMultiplier`) < 0) fail(`${path}.valueRule.fixedMultiplier`, '比例倍率不能为负');
  for (const key of ['fixedMinValue', 'fixedMaxValue'] as const) if (rule[key] !== null) finite(rule[key], `${path}.valueRule.${key}`);
  if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) fail(`${path}.valueRule`, '数值下限不能高于上限');
  let value = wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.valueRule.value`, state, fail), rule);
  const constant = tryFoldConstant(value);
  if (constant !== null && (!Number.isFinite(constant) || constant < 0)) fail(`${path}.valueRule`, '修正比例必须是明确非负值');
  if (constant === null && behavior.valueReadMode === 'APPLICATION_SNAPSHOT') fail(`${path}.valueRule`, '初始化快照金额必须静态可求');
  if (constant === null && (rule.fixedMinValue === null || rule.fixedMinValue < 0 || (rule.fixedMaxValue !== null && rule.fixedMaxValue < 0))) {
    fail(`${path}.valueRule`, '动态修正比例需要作者明确非负下界，不能把负的增加比例当作减伤');
  }
  if (detail.operation === 'DECREASE') value = { op: 'mul', args: [constExpr(-1), value] };
  const predicates: GenericFormulaExpr[] = [];
  if (detail.damageTypeKey !== null) {
    const type = runtimeDamageType(detail.damageTypeKey, `${path}.detail.damageTypeKey`, fail).slice('damage/'.length);
    predicates.push({ op: 'read', path: `damage.type.${type}` });
  }
  if (detail.deliveryKind !== 'ANY') {
    const key = DELIVERY[detail.deliveryKind];
    if (!key) fail(`${path}.detail.deliveryKind`, '未知伤害产生方式');
    predicates.push({ op: 'read', path: `damage.trait.${key}` });
  }
  if (detail.originKind !== 'ANY') {
    const key = ORIGIN[detail.originKind];
    if (!key) fail(`${path}.detail.originKind`, '未知伤害来源性质');
    predicates.push({ op: 'read', path: `damage.trait.${key}` });
  }
  const condition = detail.condition ?? null;
  if (condition) {
    if (condition.receiver !== 'ENEMY_CHAMPION' || condition.attributeValueKind !== 'CURRENT_RATIO'
      || !['LT', 'GT'].includes(condition.comparator)) fail(`${path}.detail.condition`, '不支持的生效条件');
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(condition.attributeKey)) fail(`${path}.detail.condition.attributeKey`, '属性标识不合法');
    const threshold = staticThreshold(a, condition.comparisonValue, `${path}.detail.condition.comparisonValue`);
    if (threshold < 0 || threshold > 1) fail(`${path}.detail.condition.comparisonValue`, '生命比例门槛必须在0至1');
    state.requiredAttributes.add(condition.attributeKey);
    predicates.push(constExpr(a.identity.opponent.category === 'CHAMPION' && a.identity.opponent.hostility === 'ENEMY' ? 1 : 0));
    predicates.push({ op: 'eq', args: [{ op: 'read', path: 'damage.self' }, constExpr(0)] });
    predicates.push({ op: condition.comparator === 'LT' ? 'lt' : 'gt', args: [
      { op: 'div', args: [{ op: 'read', path: `target.attr.${condition.attributeKey}.current` }, { op: 'read', path: `target.attr.${condition.attributeKey}.max` }] },
      constExpr(threshold)
    ] });
  }
  return { zone, value, condition: all(predicates), attributes: state.requiredAttributes,
    ratioAttribute: condition?.attributeKey };
}

export function adaptDamageModifierProgram(a: AuthoredDamageModifierProgram, providerKey: string) {
  assertIdentity(a);
  for (const [key, value] of Object.entries({ gameId: a.gameId, skillKey: a.skillKey })) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(key, '需要合法标识');
  }
  if (!/^[a-zA-Z0-9_:/.-]+$/.test(providerKey)) fail('providerKey', '运行定义标识不合法');
  if (![a.skillLevel, a.characterLevel].every(x => Number.isInteger(x) && x > 0)) fail('level', '等级必须明确');
  if (a.rules.length !== 1 || a.effects.length !== 1) fail('rules', '需要完整的单初始化规则及其唯一常驻效果');
  const rule = a.rules[0]!, effect = a.effects[0]!;
  if (effect.gameId !== a.gameId || effect.skillKey !== a.skillKey) fail('effects', '效果不属于当前技能');
  if (rule.eventSource.eventType !== 'SOURCE_INITIALIZED' || Object.keys(rule.eventSource.detail).length
    || rule.conditionGroups.length || rule.actions.length !== 1
    || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null || rule.oncePerUse != null) {
    fail(`rules.${rule.ruleKey}`, '只支持无额外资格、次数或冷却的初始化入口');
  }
  const action = rule.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT' || action.detail.effectKey !== effect.effectKey
    || action.targetContext !== 'CURRENT_TARGET' || action.runtimeInputBindings.length || action.resultModifiers.length) {
    fail(`rules.${rule.ruleKey}.actions`, '初始化动作必须完整引用此自身效果，不支持删去动作改写');
  }
  const life = effect.lifecycle;
  if (!life || life.instanceScope !== 'SOURCE' || life.durationValue !== null || life.expiryMode !== 'EXPLICIT_ONLY'
    || life.reapplicationStackMode !== 'KEEP' || life.reapplicationDurationMode !== null
    || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null) {
    fail(`effects.${effect.effectKey}.lifecycle`, '此初始化入口需要无期限、无周期的来源单层效果');
  }
  for (const key of ['maxStacksValue', 'applicationStacksValue'] as const) {
    if (staticNumber(a, life[key], `effects.${effect.effectKey}.lifecycle.${key}`) !== 1) fail(key, '必须为一层');
  }
  if (!effect.results.length || new Set(effect.results.map(r => r.resultKey)).size !== effect.results.length) fail('results', '结果缺失或重复');
  const groups = new Map<string, ReturnType<typeof compileResult>[]>();
  const requiredAttributes = new Set<string>(), ratioAttributes = new Set<string>();
  const requiredReads: RequiredRead[] = [];
  for (const result of effect.results) {
    const path = `skills.${a.skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`;
    if (result.resultType !== 'DAMAGE_MODIFIER') fail(path, '不能忽略并列的其他结果');
    const compiled = compileResult(a, result, path);
    groups.set(compiled.zone.modifierZoneKey, [...(groups.get(compiled.zone.modifierZoneKey) ?? []), compiled]);
    compiled.attributes.forEach(x => requiredAttributes.add(x));
    if (compiled.ratioAttribute) ratioAttributes.add(compiled.ratioAttribute);
    const reads = [...attributeReads(compiled.value), ...attributeReads(compiled.condition)];
    requiredReads.push(...reads);
    if (!result.detail.condition) requiredReads.push(...reads.filter(r => r.participant === 'target')
      .map(r => ({ ...r, participant: 'source' as const })));
  }
  const modifiers: ModifierDefinition[] = [...groups.entries()].sort(([, a], [, b]) =>
    a[0]!.zone.sortOrder - b[0]!.zone.sortOrder || (a[0]!.zone.modifierZoneKey < b[0]!.zone.modifierZoneKey ? -1 : 1)
  ).map(([key, rows]) => ({ modifierKey: `zone_${key}`, kind: 'pipeline', command: 'damage', channel: 'all_damage',
    stage: 'outgoing_pre_mitigation', bucket: 'all_instances', priority: rows[0]!.zone.sortOrder,
    valuePolicy: 'multiply',
    value: { op: 'max', args: [constExpr(0), { op: 'add', args: [constExpr(1), combine('add', rows.map(r => when(r.condition, r.value)), 0)] }] },
    condition: combine('max', rows.map(r => r.condition), 0)
  }));
  const provider: ProviderDefinition = { providerKey, kind: 'passive', stableId: `${a.gameId}/${a.skillKey}/${effect.effectKey}`, modifiers };
  return { provider, requiredAttributes: [...requiredAttributes], ratioAttributes: [...ratioAttributes], requiredReads, zones: [...groups.keys()] };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** 将已验证的常驻初始化组成加入新的两对象场景；恢复直接沿用输出快照，不再次初始化。 */
export async function withDamageModifierPrograms(input: DamageModifierScenario, bindings: readonly DamageModifierProgramBinding[]): Promise<DamageModifierScenario> {
  if (!bindings.length) fail('bindings', '需要完整组成');
  if (input.runRequest.initialSnapshot.timeMs !== 0 || input.runRequest.initialSnapshot.processInstances?.length
    || input.runRequest.initialSnapshot.useTriggerLedger?.length) fail('initialSnapshot', '只在新场景初始化，恢复不得重放初始化');
  if (input.compileRequest.schemaHash !== input.runRequest.schemaHash || input.compileRequest.schemaHash !== input.runRequest.initialSnapshot.schemaHash) fail('schemaHash', '场景契约不一致');
  if (input.runRequest.rulesHash !== input.compileRequest.rulesHash || input.runRequest.expectedRulesHash !== input.compileRequest.rulesHash
    || input.runRequest.initialSnapshot.rulesHash !== input.compileRequest.rulesHash) fail('rulesHash', '原场景配置摘要不一致，不能覆盖掩盖');
  const output = structuredClone(input), request = output.compileRequest, run = output.runRequest;
  const preDefenseDamage = (m: ModifierDefinition) => m.kind === 'pipeline' && m.command === 'damage' && m.stage === 'outgoing_pre_mitigation';
  if (request.rules.modifiers?.some(preDefenseDamage) || request.sharedProviders?.some(p => p.modifiers?.some(preDefenseDamage))) {
    fail('compileRequest', '原场景已有无法核对管理乘区的防御前伤害修正，不能混入后把同区加算变成相乘');
  }
  if (request.combatants.length !== 2 || run.initialSnapshot.combatants.length !== 2
    || new Set(request.combatants.map(c => c.key)).size !== 2 || new Set(run.initialSnapshot.combatants.map(c => c.key)).size !== 2) fail('combatants', '需要明确的来源和目标两个对象');
  request.sharedProviders ??= [];
  const zones = new Set<string>();
  for (const binding of bindings) {
    const a = binding.authored;
    if (a.gameId !== bindings[0]!.authored.gameId) fail('bindings', '不能混用游戏');
    const adapted = adaptDamageModifierProgram(a, binding.providerKey);
    if (request.sharedProviders.some(p => p.providerKey === binding.providerKey)
      || request.combatants.some(c => c.providers.some(p => p.providerRef === binding.providerKey || p.definitionRef === binding.providerKey))
      || run.initialSnapshot.combatants.some(c => c.providers.some(p => p.providerRef === binding.providerKey || p.definitionRef === binding.providerKey))) {
      fail('providerKey', '定义或挂载已经存在，禁止重复与别名复用');
    }
    for (const zone of adapted.zones) {
      const key = `${a.owner}/${zone}`;
      if (zones.has(key)) fail('modifierZoneKey', '多个来源共用乘区尚未联合编译，不能把同区加算变成相乘');
      zones.add(key);
    }
    const opponent = a.owner === 'source' ? 'target' : 'source';
    for (const [actorKey, identity] of [[a.owner, a.identity.owner], [opponent, a.identity.opponent]] as const) {
      const actor = request.combatants.find(c => c.key === actorKey)!;
      const snapshot = run.initialSnapshot.combatants.find(c => c.key === actorKey);
      if (!actor || !snapshot || !actor.types?.includes(CATEGORY[identity.category!])) fail(`combatants.${actorKey}.types`, '场景类别与明确身份不一致');
      const participant = actorKey === a.owner ? 'source' : 'target';
      for (const read of adapted.requiredReads.filter(r => r.participant === participant)) {
        const key = read.attribute;
        for (const [label, attrs] of [['compile', actor.attributes], ['snapshot', snapshot.attributes]] as const) {
          const slot = attrs[key];
          if (!slot) fail(`${label}.${actorKey}.attributes.${key}`, '缺少属性，不能补零');
          finite(slot[read.field as keyof typeof slot], `${label}.${actorKey}.${key}.${read.field}`);
          if (read.positive && slot.max <= 0) fail(`${label}.${actorKey}.${key}.max`, '比例属性最大值必须大于0');
        }
      }
    }
    for (const key of [...Object.values(DELIVERY), ...Object.values(ORIGIN)]) {
      const type = `damage_trait/${key}`, existing = request.typeCatalog.types.find(t => t.key === type);
      if (existing && existing.domain !== 'damage_trait') fail('typeCatalog', '伤害标签域冲突');
      if (!existing) request.typeCatalog.types.push({ key: type, domain: 'damage_trait' });
    }
    request.sharedProviders.push(adapted.provider);
    request.combatants.find(c => c.key === a.owner)!.providers.push({ providerRef: binding.providerKey, definitionRef: binding.providerKey });
    run.initialSnapshot.combatants.find(c => c.key === a.owner)!.providers.push({ providerRef: binding.providerKey,
      definitionRef: binding.providerKey, source: a.owner, owner: a.owner, stacks: 1, expireAt: null, state: {} });
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ request,
    bindings: bindings.map(b => ({ providerKey: b.providerKey, owner: b.authored.owner, identity: b.authored.identity })) })));
  const rulesHash = `rules.damage_modifier.${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')}`;
  request.rulesHash = rulesHash; run.rulesHash = rulesHash; run.expectedRulesHash = rulesHash; run.initialSnapshot.rulesHash = rulesHash;
  return output;
}

/** 正式普通伤害来源入口：最终产伤路径逐项核对后，才能取得可运行的修正场景。 */
export async function withAuthoredOrdinaryDamageModifiers(
  input: DamageModifierScenario,
  bindings: readonly DamageModifierProgramBinding[],
  sources: OrdinaryDamageSourceAuditInput
) {
  const sourceInput = structuredClone(sources);
  if (bindings.some(binding => binding.authored.gameId !== sourceInput.gameId)) {
    fail('sources.gameId', '伤害来源与修正组成必须属于同一游戏');
  }
  const output = await withDamageModifierPrograms(input, bindings);
  const sourceAudit = auditAuthoredOrdinaryDamageSources(output.compileRequest, output.runRequest, sourceInput);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({
    request: output.compileRequest, sources: sourceInput, sourceAudit
  })));
  const rulesHash = `rules.authored_ordinary_damage.${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')}`;
  output.compileRequest.rulesHash = rulesHash;
  output.runRequest.rulesHash = rulesHash;
  output.runRequest.expectedRulesHash = rulesHash;
  output.runRequest.initialSnapshot.rulesHash = rulesHash;
  return { ...output, sourceAudit };
}
