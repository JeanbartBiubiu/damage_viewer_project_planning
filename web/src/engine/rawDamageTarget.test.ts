import { describe, expect, it } from 'vitest';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerExecuteEffectAction, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { GenericFormulaExpr } from '../types/genericEngine';
import type { Expression } from '../types/formulaContract.generated';
import { lowerRawDamageTargetValueRule, rawDamageTargetBinding } from './rawDamageTarget';
import { lowerSettledDamageHealValueRule, settledDamageHealBinding } from './settledDamageHeal';

function sample() {
  const gameId = 'mechanism_lab', skillKey = 'raw_bonus', time = '2026-10-23T00:00:00Z';
  const action: SkillTriggerExecuteEffectAction = { actionKey: 'derive', name: '本笔原额派生', actionType: 'EXECUTE_EFFECT', sortOrder: 0,
    targetContext: 'CURRENT_TARGET', detail: { effectKey: 'bonus' }, resultModifiers: [], runtimeInputBindings: [{
      bindingKey: 'raw_amount', parameterKey: 'magic_damage_base', sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'RAW_DAMAGE' }
    }] };
  const rule: SkillTriggerRuleDetail = { ruleKey: 'damage', name: '本笔监听', description: null, sortOrder: 0,
    eventSource: { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey: null, damageTypeKey: 'magic', deliveryKind: 'ANY', originKind: 'DIRECT' } },
    conditionGroups: [], actions: [action], oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null };
  const common = { gameId, skillKey, description: null, createdAt: time, updatedAt: time };
  // 保持已存P的输入顺序、参数键及原公式树，匿名技能避免英雄特判或依赖ignored资料。
  const configuration: SkillConfiguration = { baseDigest: '0'.repeat(64),
    skill: { ...common, name: '原额派生样本', maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['passive'] },
    parameters: [
      { ...common, parameterKey: 'curse_duration_ms', name: '期限', sortOrder: 0, valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 3000, levelValues: null },
      { ...common, parameterKey: 'magic_damage_base', name: '原额', sortOrder: 1, valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null },
      { ...common, parameterKey: 'magic_damage_bonus_true_ratio', name: '比例', sortOrder: 2, valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: 0.1, levelValues: null }
    ],
    formulas: [{ ...common, formulaKey: 'bonus_true_damage', name: '原额乘比例', sortOrder: 0, expression: {
      inputs: [
        { key: 'input_0', binding: { kind: 'parameter', skillKey, parameterKey: 'magic_damage_bonus_true_ratio' } },
        { key: 'input_1', binding: { kind: 'parameter', skillKey, parameterKey: 'magic_damage_base' } }
      ], stages: [{ key: 'output', name: '原技能公式输出', expression: { op: 'mul', args: [
        { op: 'read', inputKey: 'input_0' }, { op: 'read', inputKey: 'input_1' }
      ] } }], outputStageKey: 'output'
    } }], effects: [{ ...common, effectKey: 'bonus', name: '原额单伤害', sortOrder: 0, lifecycle: null, results: [{
      resultKey: 'damage', name: '派生伤害', description: null, resultType: 'DAMAGE', target: 'TARGET', sortOrder: 0,
      lifecycleBehavior: null, spellShieldBlockScope: null,
      detail: { damageTypeKey: 'true', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null },
        vampQualification: 'RESOLVED', vampOverrides: [] },
      valueRule: { value: { kind: 'FORMULA', formulaKey: 'bonus_true_damage' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }
    }] }], triggerRules: [rule], processes: [], internalStates: [] };
  const effect = configuration.effects[0]!, result = effect.results[0]!, valueRule = result.valueRule!;
  const parameterKey = 'magic_damage_base', valuePath = `skills.${skillKey}.effects.bonus.results.damage.valueRule`;
  const binding = () => rawDamageTargetBinding(action, rule, configuration, 'action');
  const lower = () => lowerRawDamageTargetValueRule(valueRule, configuration, 1, 18, parameterKey, valuePath);
  return { configuration, rule, action, effect, result, valueRule, parameterKey, valuePath, binding, lower };
}

function reads(expr: GenericFormulaExpr): string[] {
  return [...(expr.op === 'read' && expr.path ? [expr.path] : []), ...(expr.args ?? []).flatMap(reads)];
}

describe('原始伤害事件的独立即时目标伤害降低', () => {
  it('已存P同形公式只读本笔baseRawAmount，作者及映射完整保留', () => {
    const { configuration, binding, lower, valueRule, parameterKey, valuePath } = sample();
    const original = structuredClone(configuration);
    expect(binding()).toBe(parameterKey);
    const lowered = lower();
    expect(lowered.expression).toEqual({ op: 'max', args: [{ op: 'mul', args: [
      { op: 'const', value: 0.1 }, { op: 'read', path: 'event.damage.baseRawAmount' }
    ] }, { op: 'const', value: 0 }] });
    const oldArithmetic = lowerSettledDamageHealValueRule(valueRule, configuration, 1, 18, parameterKey, valuePath);
    expect(lowered.mappings).toEqual(oldArithmetic.mappings);
    expect(lowered.author).toEqual(oldArithmetic.author);
    expect(reads(lowered.expression)).toEqual(['event.damage.baseRawAmount']);
    expect(configuration).toEqual(original);
  });

  it('旧POST自身治疗授权不因新RAW目标伤害出现而放宽', () => {
    const { action, rule, configuration, binding } = sample();
    expect(() => settledDamageHealBinding(action, rule, configuration, 'action')).toThrow();
    action.runtimeInputBindings[0] = { ...action.runtimeInputBindings[0]!, sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'POST_DEFENSE_DAMAGE' } };
    expect(binding).toThrow();
  });

  it.each(['missing_binding', 'post_binding', 'duplicate_binding', 'binding_extra', 'missing_binding_key', 'boolean_binding_key',
    'missing_parameter', 'duplicate_parameter', 'foreign_parameter', 'parameter_default', 'parameter_extra',
    'foreign_effect', 'effect_extra', 'duplicate_effect', 'mixed_actions', 'once', 'cooldown', 'wrong_event',
    'mixed_results', 'self_result', 'resource_result', 'spell_shield', 'persistent', 'result_extra', 'detail_extra',
    'critical', 'unresolved', 'vamp_override', 'reflected', 'basic_delivery', 'value_rule_extra'] as const)(
    '拒绝不完整或超范围动作形状：%s', mutation => {
      const { action, rule, configuration, effect, result, valueRule, binding } = sample();
      const parameter = configuration.parameters[1]!;
      if (mutation === 'missing_binding') action.runtimeInputBindings = [];
      if (mutation === 'post_binding') action.runtimeInputBindings[0] = { ...action.runtimeInputBindings[0]!, sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'POST_DEFENSE_DAMAGE' } };
      if (mutation === 'duplicate_binding') action.runtimeInputBindings.push(structuredClone(action.runtimeInputBindings[0]!));
      if (mutation === 'binding_extra') Object.assign(action.runtimeInputBindings[0]!, { defaultValue: 0 });
      if (mutation === 'missing_binding_key') delete (action.runtimeInputBindings[0] as unknown as Record<string, unknown>).bindingKey;
      if (mutation === 'boolean_binding_key') Object.assign(action.runtimeInputBindings[0]!, { bindingKey: true });
      if (mutation === 'missing_parameter') configuration.parameters.splice(1, 1);
      if (mutation === 'duplicate_parameter') configuration.parameters.push(structuredClone(parameter));
      if (mutation === 'foreign_parameter') parameter.skillKey = 'other';
      if (mutation === 'parameter_default') parameter.fixedValue = 0;
      if (mutation === 'parameter_extra') Object.assign(parameter, { defaultValue: 0 });
      if (mutation === 'foreign_effect') effect.skillKey = 'other';
      if (mutation === 'effect_extra') Object.assign(effect, { condition: true });
      if (mutation === 'duplicate_effect') configuration.effects.push(structuredClone(effect));
      if (mutation === 'mixed_actions') rule.actions.push(structuredClone(action));
      if (mutation === 'once') rule.oncePerUse = { groupKey: 'once', scope: 'SOURCE' } as never;
      if (mutation === 'cooldown') rule.perTargetCooldown = { targetContext: 'CURRENT_TARGET', durationValue: { kind: 'FIXED', value: 1 } };
      if (mutation === 'wrong_event') rule.eventSource = { eventType: 'DAMAGE_TAKEN', detail: { sourceSkillKey: null, damageTypeKey: 'magic', deliveryKind: 'ANY', originKind: 'DIRECT' } };
      if (mutation === 'mixed_results') effect.results.push(structuredClone(result));
      if (mutation === 'self_result') result.target = 'SOURCE';
      if (mutation === 'spell_shield') result.spellShieldBlockScope = 'RESULT';
      if (mutation === 'persistent') result.lifecycleBehavior = { moment: 'PERSISTENT', periodicExecutionMode: null, reapplicationValueMode: null, stackValueMode: null, valueReadMode: null };
      if (mutation === 'result_extra') Object.assign(result, { condition: { op: 'const', value: 1 } });
      if (mutation === 'detail_extra') Object.assign(result.detail, { attackDamageRole: 'PRIMARY' });
      if (result.resultType !== 'DAMAGE') throw new Error('fixture');
      if (mutation === 'critical') result.detail.critical.mode = 'SOURCE_CRIT_CHANCE';
      if (mutation === 'unresolved') result.detail.vampQualification = 'UNRESOLVED';
      if (mutation === 'vamp_override') result.detail.vampOverrides.push({ vampType: 'OMNIVAMP', mode: 'DISABLED', basisOutputKind: null, efficiencyValue: null });
      if (mutation === 'reflected') result.detail.originKind = 'REFLECTED';
      if (mutation === 'basic_delivery') result.detail.deliveryKind = 'BASIC_ATTACK';
      if (mutation === 'value_rule_extra') Object.assign(valueRule, { runtimeSource: 'event' });
      if (mutation === 'resource_result') Object.assign(result, { resultType: 'RESOURCE_CHANGE' });
      expect(binding).toThrow();
    });
});

describe('RAW算术仅复用旧有界降低器而保留作者', () => {
  it.each([0, 0.1, 2])('静态比例%s保留且事件即使乘零也恰一次', ratio => {
    const { configuration, lower } = sample(); configuration.parameters[2]!.fixedValue = ratio;
    expect(reads(lower().expression)).toEqual(['event.damage.baseRawAmount']);
    expect(JSON.stringify(lower().expression)).toContain(`"value":${ratio}`);
  });

  it.each([NaN, Infinity, -Infinity])('不以最终max0掩盖非有限静态比例%s', ratio => {
    const { configuration, lower } = sample(); configuration.parameters[2]!.fixedValue = ratio;
    expect(lower).toThrow();
  });

  it('显式技能等级静态比例按真实等级读取，零级不补一级', () => {
    const { configuration, valueRule, parameterKey, valuePath } = sample();
    configuration.skill.maxLevel = 2;
    Object.assign(configuration.parameters[2]!, { valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 0.1, '2': 0.2 } });
    const value = lowerRawDamageTargetValueRule(valueRule, configuration, 2, 18, parameterKey, valuePath);
    expect(JSON.stringify(value.expression)).toContain('"value":0.2');
    expect(() => lowerRawDamageTargetValueRule(valueRule, configuration, 0, 18, parameterKey, valuePath)).toThrow();
  });

  it.each([true, false])('最终max0顺序%s及结果倍率保留映射位置', zeroFirst => {
    const { configuration, valueRule, lower } = sample();
    const stage = configuration.formulas[0]!.expression.stages[0]!, body = stage.expression;
    stage.expression = { op: 'max', args: zeroFirst ? [{ op: 'const', value: '0' }, body] : [body, { op: 'const', value: '0' }] };
    valueRule.fixedMultiplier = 2;
    const result = lower();
    expect(reads(result.expression)).toEqual(['event.damage.baseRawAmount']);
    expect(result.expression.op).toBe('max');
    const nodeAt = (mapping: string) => mapping.replace(/\[(\d+)\]/g, '.$1').replace(/^expression\.?/, '').split('.').filter(Boolean)
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], result.expression);
    for (const mapping of result.mappings) expect(nodeAt(mapping.privatePath)).toBeDefined();
    expect(result.author).toEqual({ formulaKey: 'bonus_true_damage', parameterKey: 'magic_damage_base' });
  });

  it.each(['missing_factor', 'foreign_formula', 'negative', 'offset', 'twice', 'divisor', 'attribute', 'hidden_runtime',
    'upper_bound', 'nonzero_min', 'negative_multiplier', 'not_consumed', 'nested_max'] as const)(
    '拒绝有来源但未授权的金额图：%s', mutation => {
      const { configuration, valueRule, lower } = sample();
      const formula = configuration.formulas[0]!.expression, output = formula.stages[0]!;
      const event: Expression = { op: 'read', inputKey: 'input_1' }, factor: Expression = { op: 'const', value: '1' };
      if (mutation === 'missing_factor') configuration.parameters.splice(2, 1);
      if (mutation === 'foreign_formula') configuration.formulas[0]!.skillKey = 'other';
      if (mutation === 'negative') configuration.parameters[2]!.fixedValue = -0.1;
      if (mutation === 'offset') output.expression = { op: 'add', args: [event, factor] };
      if (mutation === 'twice') output.expression = { op: 'mul', args: [event, event] };
      if (mutation === 'divisor') output.expression = { op: 'div', args: [factor, event] };
      if (mutation === 'attribute') formula.inputs.push({ key: 'hidden', binding: { kind: 'attribute', view: 'current_frame', object: 'source', valueKind: 'TOTAL', attributeKey: 'ability_power' } });
      if (mutation === 'hidden_runtime') {
        configuration.parameters.push({ ...structuredClone(configuration.parameters[1]!), parameterKey: 'other_runtime' });
        formula.inputs.push({ key: 'hidden', binding: { kind: 'parameter', skillKey: configuration.skill.skillKey, parameterKey: 'other_runtime' } });
      }
      if (mutation === 'upper_bound') valueRule.fixedMaxValue = 10;
      if (mutation === 'nonzero_min') valueRule.fixedMinValue = 1;
      if (mutation === 'negative_multiplier') valueRule.fixedMultiplier = -1;
      if (mutation === 'not_consumed') output.expression = factor;
      if (mutation === 'nested_max') output.expression = { op: 'mul', args: [{ op: 'max', args: [event, { op: 'const', value: '0' }] }, factor] };
      expect(lower).toThrow();
    });

  it('重用阶段不能越过节点预算，原完整预检声明不被改写', () => {
    const { configuration, lower } = sample(); const formula = configuration.formulas[0]!.expression;
    formula.stages = [{ key: 'factor0', name: '静态因子', expression: { op: 'const', value: '1' } }];
    for (let index = 1; index <= 10; index++) formula.stages.push({ key: `factor${index}`, name: '静态展开', expression: {
      op: 'mul', args: [{ op: 'ref', stageKey: `factor${index - 1}` }, { op: 'ref', stageKey: `factor${index - 1}` }]
    } });
    formula.stages.push({ key: 'output', name: '本笔原额', expression: { op: 'mul', args: [
      { op: 'read', inputKey: 'input_1' }, { op: 'ref', stageKey: 'factor10' }
    ] } });
    const before = structuredClone(configuration);
    expect(lower).toThrow(/预算|LIMIT/);
    expect(configuration).toEqual(before);
  });
});
