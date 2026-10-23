import { describe, it, expect } from 'vitest';
import { adaptHitProgram, type AuthoredHitProgram } from './hitAdapter';
import { fixedValue, parameterValue, formulaValue } from '../types/numericValue';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SkillParameter } from '../types/skillParameter';

const skill = 'lab_impact';
const life = () => ({ durationValue: fixedValue(4000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
  instanceScope: 'SOURCE_TARGET' as const, reapplicationStackMode: 'KEEP' as const,
  reapplicationDurationMode: 'REFRESH_ALL' as const, expiryMode: 'ALL_AT_ONCE' as const,
  periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null });
const wound = (): SkillEffectResult => ({ resultKey: 'wound', name: '受治疗降低', description: null, sortOrder: 10,
  resultType: 'HEALING_MODIFIER', target: 'TARGET', spellShieldBlockScope: null,
  detail: { modifierZoneKey: 'healing_group', direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'ANY' },
  valueRule: { value: fixedValue(.4), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
  lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
    reapplicationValueMode: 'REPLACE', periodicExecutionMode: null } });
const damage = (): SkillEffectResult => ({ resultKey: 'damage', name: '伤害', description: null, sortOrder: 10,
  resultType: 'DAMAGE', target: 'TARGET', spellShieldBlockScope: 'SKILL', lifecycleBehavior: null,
  valueRule: { value: fixedValue(100), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
  detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] } });
function effect(key: string, result: SkillEffectResult, persistent = false): SkillEffect {
  return { gameId: 'lol', skillKey: skill, effectKey: key, name: key, description: null, sortOrder: 10,
    lifecycle: persistent ? life() : null, results: [result], createdAt: '', updatedAt: '' };
}
function rule(key: string, effectKey: string, order: number, blocked = false): SkillTriggerRuleDetail {
  return { ruleKey: key, name: key, description: null, sortOrder: order,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: skill } },
    conditionGroups: [{ groupKey: 'eligible', name: '合法目标', sortOrder: 10, conditions: [
      { conditionKey: 'champion', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } },
      { conditionKey: 'enemy', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 20, detail: {} },
      ...(blocked ? [{ conditionKey: 'unblocked', conditionType: 'EVENT_VALUE_COMPARE' as const, sortOrder: 30,
        detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED' as const, comparator: 'EQ' as const, comparisonValue: fixedValue(0) } }] : [])
    ] }], actions: [{ actionKey: 'apply_' + key, name: key, actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null };
}
function program(): AuthoredHitProgram {
  return { gameId: 'lol', skillKey: skill, skillLevel: 1, characterLevel: 18,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [], modifierZones: [{ gameId: 'lol', modifierZoneKey: 'healing_group', domain: 'HEALING',
      calculationMode: 'RATIO_MAX', applicationStage: 'HEALING_RESULT', status: 'ENABLED' }],
    skillCategoryKeys: ['common'], parameters: [], formulas: [],
    vampRules: [{ vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
      defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['common'] }],
    effects: [effect('impact', damage()), effect('wounds', wound(), true)],
    rules: [rule('impact', 'impact', 10), rule('wounds', 'wounds', 30, true)] };
}
function parameter(key: string, mode: SkillParameter['valueMode'], value: number | Record<string, number>): SkillParameter {
  return { gameId: 'lol', skillKey: skill, parameterKey: key, name: key, valueType: 'DECIMAL', valueMode: mode,
    fixedValue: typeof value === 'number' ? value : null, levelValues: typeof value === 'object' ? value : null,
    description: null, sortOrder: 10, createdAt: '', updatedAt: '' };
}
const wounds = (p: AuthoredHitProgram) => p.effects[1]!.results[0]!;
function eventCondition(p: AuthoredHitProgram, ruleIndex: number, key: 'SKILL_HIT_FIRST_CONTACT' | 'SKILL_HIT_SPELL_SHIELD_BLOCKED', n: number) {
  p.rules[ruleIndex]!.conditionGroups[0]!.conditions.push({ conditionKey: 'extra', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 40,
    detail: { eventValueKey: key, comparator: 'EQ', comparisonValue: fixedValue(n) } });
}

describe('真实命中有限受治疗降低的窄入口', () => {
  it('复用完整有限status，只输出RECEIVED/ANY单heal修正和真实目标apply', () => {
    const p = program(), before = structuredClone(p), result = adaptHitProgram(p);
    expect(p).toEqual(before);
    expect(result.skillHit.candidates.map(row => [row.semantic.resultType, row.spellShieldBlockScope])).toEqual([['DAMAGE', 'SKILL'], ['HEALING_MODIFIER', null]]);
    expect(result.skillHit.candidates[1]!.eventValueConditions).toEqual([{ key: 'blocked', comparator: 'eq', value: { op: 'const', value: 0 } }]);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({ providerKey: 'healing:lab_impact:wounds:wound', kind: 'status',
      lifecycle: { durationMs: { op: 'const', value: 4000 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' },
      modifiers: [{ kind: 'pipeline', command: 'heal', healDirection: 'RECEIVED', healCategory: 'ANY', healGroupKey: 'healing_group',
        healGroupCalculationMode: 'ratio_max', valuePolicy: 'add_percent', value: { op: 'const', value: -.4 } }] });
    expect(result.requiredAttributes).toEqual(['omnivamp_percent']);
  });
  it.each([0, 1])('边界比例%s与零伤真实见证仍合法', n => {
    const p = program(); wounds(p).valueRule!.value = fixedValue(n); p.effects[0]!.results[0]!.valueRule!.value = fixedValue(0);
    expect(adaptHitProgram(p).providers[0]!.modifiers![0]!.value).toEqual({ op: 'const', value: -n });
  });
  it('本技能参数按所有声明等级核定，保留百分数乘数', () => {
    const p = program(); p.parameters = [parameter('ratio', 'SKILL_LEVEL', { '1': 40, '2': 40 }), parameter('duration', 'FIXED', 4000)];
    wounds(p).valueRule = { value: parameterValue('ratio'), fixedMultiplier: .01, fixedMinValue: 0, fixedMaxValue: 1 };
    p.effects[1]!.lifecycle!.durationValue = parameterValue('duration');
    expect(adaptHitProgram(p).providers[0]!.modifiers![0]!.value).toEqual({ op: 'const', value: -.4 });
  });
  it('伤害见证必须先于每个null减疗候选，不能靠较晚SKILL补齐', () => {
    const p = program(); p.rules[1]!.sortOrder = 1;
    expect(() => adaptHitProgram(p)).toThrow();
  });
  const invalid: Array<[string, (p: AuthoredHitProgram) => void]> = [
    ['缺见证', p => { p.rules = [p.rules[1]!]; }],
    ['减疗缺未挡条件', p => { p.rules[1]!.conditionGroups = []; }],
    ['减疗blocked1', p => { (p.rules[1]!.conditionGroups[0]!.conditions[2] as never as {detail:{comparisonValue:unknown}}).detail.comparisonValue = fixedValue(1); }],
    ['减疗额外firstContact', p => eventCondition(p, 1, 'SKILL_HIT_FIRST_CONTACT', 1)],
    ['减疗重复blocked', p => eventCondition(p, 1, 'SKILL_HIT_SPELL_SHIELD_BLOCKED', 0)],
    ['见证firstContact', p => eventCondition(p, 0, 'SKILL_HIT_FIRST_CONTACT', 1)],
    ['见证blocked1', p => eventCondition(p, 0, 'SKILL_HIT_SPELL_SHIELD_BLOCKED', 1)],
    ['首见证恒假不能借较晚见证', p => {
      Object.assign(p.rules[0]!.conditionGroups[0]!.conditions[0]!.detail, { categories: ['MINION'] });
      p.rules = [...p.rules, rule('later_stable', 'impact', 20)];
    }],
    ['见证先RESULT后SKILL也拒', p => { p.effects = [effect('earlier', { ...damage(), spellShieldBlockScope: 'RESULT' }), ...p.effects]; p.rules = [rule('earlier', 'earlier', 1), ...p.rules]; }],
    ['见证once', p => { p.rules[0]!.oncePerUse = { groupKey: 'limited', scope: 'SKILL' }; }],
    ['减疗once', p => { p.rules[1]!.oncePerUse = { groupKey: 'limited', scope: 'TARGET' }; }],
    ['见证隐藏条件', p => { Object.assign(p.effects[0]!.results[0]!.detail, { condition: { op: 'const', value: 1 } }); }],
    ['见证隐藏重复', p => { Object.assign(p.effects[0]!.results[0]!, { repeatCount: 2 }); }],
    ['目标非英雄', p => { p.identity.target.category = 'MINION'; }],
    ['错误游戏目录', p => { p.modifierZones = [{ ...p.modifierZones![0]!, gameId: 'other' }]; }],
    ['缺目录', p => { p.modifierZones = []; }],
    ['重复目录', p => { p.modifierZones = [...p.modifierZones!, p.modifierZones![0]!]; }],
    ['禁用目录', p => { p.modifierZones = [{ ...p.modifierZones![0]!, status: 'DISABLED' }]; }],
    ['错目录阶段', p => { p.modifierZones = [{ ...p.modifierZones![0]!, applicationStage: 'ATTRIBUTE_PERCENT' }]; }],
    ['RATIO_ADD', p => { p.modifierZones = [{ ...p.modifierZones![0]!, calculationMode: 'RATIO_ADD' }]; }],
    ['DIRECT种类', p => { Object.assign(wounds(p).detail, { healingKind: 'DIRECT' }); }],
    ['KEEP数值模式', p => { wounds(p).lifecycleBehavior!.reapplicationValueMode = 'KEEP'; }],
    ['错误法盾粒度', p => { wounds(p).spellShieldBlockScope = 'RESULT'; }],
    ['额外同效果结果', p => { p.effects[1]!.results.push({ ...wound(), resultKey: 'other' }); }],
    ['周期', p => { p.effects[1]!.lifecycle!.periodicIntervalValue = fixedValue(500); }],
    ['关联盾', p => { p.effects[1]!.lifecycle!.endWhenShieldEndsResultKey = 'shield'; }],
    ['多层', p => { p.effects[1]!.lifecycle!.maxStacksValue = fixedValue(2); }],
    ['无限期限', p => { p.effects[1]!.lifecycle!.durationValue = null; }],
    ['非整数期限', p => { p.effects[1]!.lifecycle!.durationValue = fixedValue(1.5); }],
    ['非安全期限', p => { p.effects[1]!.lifecycle!.durationValue = fixedValue(Number.MAX_SAFE_INTEGER + 1); }],
    ['负比例夹取', p => { wounds(p).valueRule!.value = fixedValue(-.1); wounds(p).valueRule!.fixedMinValue = 0; }],
    ['大比例夹取', p => { wounds(p).valueRule!.value = fixedValue(2); wounds(p).valueRule!.fixedMaxValue = 1; }],
    ['运行输入零乘', p => { p.parameters = [parameter('input', 'RUNTIME_INPUT', {})]; wounds(p).valueRule!.value = parameterValue('input'); wounds(p).valueRule!.fixedMultiplier = 0; }],
    ['其它等级超界', p => { p.parameters = [parameter('ratio', 'SKILL_LEVEL', { '1': .4, '2': 2 })]; wounds(p).valueRule!.value = parameterValue('ratio'); }],
    ['其它等级负期限', p => { p.parameters = [parameter('duration', 'CHARACTER_LEVEL', { '1': -1, '18': 4000 })]; p.effects[1]!.lifecycle!.durationValue = parameterValue('duration'); }],
    ['缺所选等级', p => { p.parameters = [parameter('ratio', 'SKILL_LEVEL', { '2': .4 })]; wounds(p).valueRule!.value = parameterValue('ratio'); }],
    ['非法等级键', p => { p.parameters = [parameter('ratio', 'SKILL_LEVEL', { '0': .4, '1': .4 })]; wounds(p).valueRule!.value = parameterValue('ratio'); }],
    ['普攻入口', p => { for (const r of p.rules) r.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} }; Object.assign(p.effects[0]!.results[0]!.detail, { deliveryKind: 'BASIC_ATTACK' }); }]
  ];
  it.each(invalid)('%s必须拒绝', (_, mutate) => { const p = program(); mutate(p); expect(() => adaptHitProgram(p)).toThrow(); });
  it.each(['amount', 'duration'])('新%s入口显式拒绝FORMULA，不调用或伪造原生核定', kind => {
    const p = program();
    if (kind === 'amount') wounds(p).valueRule!.value = formulaValue('not_executed');
    else p.effects[1]!.lifecycle!.durationValue = formulaValue('not_executed');
    expect(() => adaptHitProgram(p)).toThrow(/FORMULA/);
  });
});
