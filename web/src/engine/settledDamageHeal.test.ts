import { describe, expect, it } from 'vitest';
import { settledDamageHealSample } from '../../tests/fixtures/settledDamageHeal';
import type { GenericFormulaExpr } from '../types/genericEngine';
import type { Expression } from '../types/formulaContract.generated';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { lowerSettledDamageHealValueRule, settledDamageHealBinding } from './settledDamageHeal';
import { compileNaturalRestoration } from './naturalRestoration';
import { skillFormulaPreflightRequest } from './skillFormulaPreflight';
import { assembleNaturalSkillSources } from './simulation/sources/natural';

function reads(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(reads);
  if (!value || typeof value !== 'object') return [];
  const expression = value as GenericFormulaExpr;
  return [...(expression.op === 'read' && expression.path ? [expression.path] : []), ...Object.values(expression).flatMap(reads)];
}

describe('本笔实际伤害金额的动作级自身治疗', () => {
  it('真实自然来源降低为拥有者逐笔监听，原共同公式保留且实际金额不引用未绑定公式', () => {
    const { snapshot, configuration } = settledDamageHealSample();
    const assembled = assembleNaturalSkillSources(snapshot);
    const ability = assembled.providers.flatMap(provider => provider.abilities ?? []).find(row => row.skillKey === configuration.skill.skillKey)!;
    expect(ability.kind).toBe('passive_listener');
    expect(ability.listenerSpec).toMatchObject({ maxTriggersPerEvent: 1,
      eventMatcher: { all: ['event/damage_instance', 'event/source_owner', 'damage_trait/delivery_skill'] },
      operations: [{ operation: 'heal', target: 'self' }] });
    expect(reads(ability.listenerSpec!.operations![0]!.amount)).toEqual(['event.damage.mitigatedAmount']);
    expect(JSON.stringify(ability.listenerSpec!.operations![0]!.amount)).not.toContain('"ref"');
    const author = assembled.triggered.formulas.find(row => row.key.endsWith('/heal_amount'))!;
    expect(author.expression).toEqual(configuration.formulas[0]!.expression);
    expect(author.parameters.find(row => row.parameterKey === 'settled_amount')).toEqual({ parameterKey: 'settled_amount', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL' });
    expect(assembled.triggered.operationOrigins).toHaveLength(1);
    expect(assembled.mounts).toHaveLength(1);
  });

  it('DAMAGE_DEALT正值条件仅读同一实际防御后金额', () => {
    const { snapshot, rule } = settledDamageHealSample();
    rule.conditionGroups[0]!.conditions.push({ conditionKey: 'positive', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1,
      detail: { eventValueKey: 'POST_DEFENSE_DAMAGE', comparator: 'GT', comparisonValue: { kind: 'FIXED', value: 0 } } });
    const assembled = assembleNaturalSkillSources(snapshot);
    const listener = assembled.providers.flatMap(provider => provider.abilities ?? []).find(row => row.listenerSpec)?.listenerSpec!;
    expect(reads(listener.condition)).toContain('event.damage.mitigatedAmount');
    expect(reads(listener.operations![0]!.amount)).toEqual(['event.damage.mitigatedAmount']);
  });

  it('原命名公式只进入完整预检声明，不生成假事件、运行来源或初始化操作', () => {
    const { snapshot, configuration } = settledDamageHealSample();
    const request = skillFormulaPreflightRequest(snapshot);
    expect(request.sharedProviders).toEqual([]);
    const formula = request.formulas!.find(row => row.skillKey === configuration.skill.skillKey)!;
    expect(formula.expression).toEqual(configuration.formulas[0]!.expression);
    expect(formula.parameters.find(row => row.parameterKey === 'settled_amount')).not.toHaveProperty('runtimeSource');
    expect(request.combatants.every(row => Object.keys(row.attributes).length === 0 && row.providers.length === 0)).toBe(true);
    expect(JSON.stringify(request)).not.toContain('mitigatedAmount');
  });

  it.each(['disabled', 'unlearned'] as const)('%s来源不生成挂载或索要事件金额', state => {
    const { snapshot, configuration } = settledDamageHealSample();
    const setting = snapshot.selection.sourceSkillSettings.find(row => row.skillKey === configuration.skill.skillKey)!;
    if (state === 'disabled') setting.enabled = false; else setting.skillLevel = 0;
    syncSimulationSkillSources(snapshot);
    expect(assembleNaturalSkillSources(snapshot).providers.some(provider => provider.skillKey === configuration.skill.skillKey)).toBe(false);
  });

  it('本动作供值不泄漏到后续无绑定规则的同一公式', () => {
    const { snapshot, configuration, rule, action } = settledDamageHealSample();
    const later = structuredClone(rule); later.ruleKey = 'later_without_binding'; later.sortOrder = 20;
    later.eventSource = { eventType: 'BASIC_ATTACK_START', detail: {} };
    later.actions = [{ ...structuredClone(action), runtimeInputBindings: [] }];
    configuration.triggerRules.push(later); syncSimulationSkillSources(snapshot);
    expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/计算时参数/);
  });

  it('动作绑定不为规则条件提供计算时参数', () => {
    const { snapshot, rule } = settledDamageHealSample();
    rule.conditionGroups[0]!.conditions.push({ conditionKey: 'not_action_scope', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1,
      detail: { eventValueKey: 'POST_DEFENSE_DAMAGE', comparator: 'GT', comparisonValue: { kind: 'PARAMETER', parameterKey: 'settled_amount' } } });
    expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/计算时参数/);
  });

  it('不把新条件入口顺便扩到DAMAGE_DEALT其它事件字段', () => {
    const { snapshot, rule } = settledDamageHealSample();
    rule.conditionGroups[0]!.conditions.push({ conditionKey: 'not_supported', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1,
      detail: { eventValueKey: 'ACTUAL_HP_LOSS', comparator: 'GT', comparisonValue: { kind: 'FIXED', value: 0 } } });
    expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/真实冻结字段/);
  });

  it('无作者最终下界的非负本笔金额也能从真实自然来源装配', () => {
    const { snapshot, configuration, effect } = settledDamageHealSample(); effect.results[0]!.valueRule!.fixedMinValue = null;
    const assembled = assembleNaturalSkillSources(snapshot);
    const operation = assembled.providers.flatMap(provider => provider.abilities ?? []).find(row => row.skillKey === configuration.skill.skillKey)!.listenerSpec!.operations![0]!;
    expect(operation.operation).toBe('heal'); expect(operation.amount!.op).toBe('div');
  });

  it.each([undefined, null, true])('绑定标识%s不能经隐式字符串转换通过真实装配', value => {
    const { snapshot, configuration, rule, action } = settledDamageHealSample();
    const binding = action.runtimeInputBindings[0]! as unknown as Record<string, unknown>;
    if (value === undefined) delete binding.bindingKey; else binding.bindingKey = value;
    expect(() => settledDamageHealBinding(action, rule, configuration, 'action')).toThrow(/稳定标识/);
    expect(() => assembleNaturalSkillSources(snapshot)).toThrow(/稳定标识/);
  });

  it.each(['missing', 'duplicate', 'wrong_field', 'wrong_type', 'default', 'foreign_parameter', 'unknown_detail',
    'missing_key', 'resource', 'target', 'shield', 'persistent', 'mixed_results', 'mixed_actions', 'once', 'wrong_event'] as const)
  ('拒绝不完整或超范围绑定：%s', mutation => {
    const { configuration, rule, action, effect, parameterKey } = settledDamageHealSample();
    const parameter = configuration.parameters.find(row => row.parameterKey === parameterKey)!;
    if (mutation === 'missing') action.runtimeInputBindings = [];
    if (mutation === 'duplicate') action.runtimeInputBindings.push(structuredClone(action.runtimeInputBindings[0]!));
    if (mutation === 'wrong_field') action.runtimeInputBindings[0] = { ...action.runtimeInputBindings[0]!, sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'ACTUAL_HP_LOSS' } };
    if (mutation === 'wrong_type') parameter.valueType = 'INTEGER';
    if (mutation === 'default') parameter.fixedValue = 0;
    if (mutation === 'foreign_parameter') parameter.skillKey = 'other_skill';
    if (mutation === 'unknown_detail') Object.assign(action.runtimeInputBindings[0]!.detail, { defaultValue: 0 });
    if (mutation === 'missing_key') action.runtimeInputBindings[0]!.bindingKey = '';
    if (mutation === 'resource') effect.results[0] = { ...effect.results[0]!, resultType: 'RESOURCE_CHANGE', valueRule: effect.results[0]!.valueRule!, detail: { attributeKey: 'mana', operation: 'RESTORE' } };
    if (mutation === 'target') effect.results[0]!.target = 'TARGET';
    if (mutation === 'shield') effect.results[0]!.spellShieldBlockScope = 'RESULT';
    if (mutation === 'persistent') effect.results[0]!.lifecycleBehavior = { moment: 'PERSISTENT', periodicExecutionMode: null, reapplicationValueMode: null, stackValueMode: null, valueReadMode: null };
    if (mutation === 'mixed_results') effect.results.push(structuredClone(effect.results[0]!));
    if (mutation === 'mixed_actions') rule.actions.push(structuredClone(action));
    if (mutation === 'once') rule.oncePerUse = {} as never;
    if (mutation === 'wrong_event') rule.eventSource = { eventType: 'DAMAGE_TAKEN', detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } };
    expect(() => settledDamageHealBinding(action, rule, configuration, 'action')).toThrow();
  });
});

describe('本笔治疗的有界作者公式展开', () => {
  function sample() {
    const { configuration, effect, parameterKey } = settledDamageHealSample();
    const rule = effect.results[0]!.valueRule!;
    const rulePath = `skills.${configuration.skill.skillKey}.effects.${effect.effectKey}.results.heal.valueRule`;
    const lower = () => lowerSettledDamageHealValueRule(rule, configuration, 1, 1, parameterKey, rulePath);
    return { configuration, effect, rule, parameterKey, lower, rulePath };
  }

  it('只执行本笔字段乘原18参数除100，保持完整原公式不变', () => {
    const { lower, configuration } = sample(); const before = structuredClone(configuration);
    expect(lower().expression).toEqual({ op: 'max', args: [{ op: 'div', args: [
      { op: 'mul', args: [{ op: 'read', path: 'event.damage.mitigatedAmount' }, { op: 'const', value: 18 }] },
      { op: 'const', value: 100 }
    ] }, { op: 'const', value: 0 }] });
    expect(configuration).toEqual(before);
  });

  it.each([0, 18, 125])('系数%s来自实际参数，可大于100且不猜默认', points => {
    const { configuration, lower } = sample(); configuration.parameters[0]!.fixedValue = points;
    expect(reads(lower().expression)).toEqual(['event.damage.mitigatedAmount']);
    expect(JSON.stringify(lower().expression)).toContain(`"value":${points}`);
  });

  it('合法等级参数按当前实际技能等级读取，零级不补一级', () => {
    const { configuration, rule, parameterKey, rulePath } = sample(); const coefficient = configuration.parameters[0]!;
    coefficient.valueMode = 'SKILL_LEVEL'; coefficient.fixedValue = null; coefficient.levelValues = { '1': 10, '2': 20 };
    configuration.skill.maxLevel = 2;
    const lowered = lowerSettledDamageHealValueRule(rule, configuration, 2, 1, parameterKey, rulePath);
    expect(JSON.stringify(lowered.expression)).toContain('"value":20');
    expect(() => lowerSettledDamageHealValueRule(rule, configuration, 0, 1, parameterKey, rulePath)).toThrow(/等级/);
  });

  it.each([true, false])('最终max0顺序%s与结果倍率/重复下界归一为一次最外max0，映射均落实际节点', zeroFirst => {
    const { configuration, rule, lower } = sample();
    const stage = configuration.formulas[0]!.expression.stages[0]!; const inner = stage.expression;
    stage.expression = { op: 'max', args: zeroFirst ? [{ op: 'const', value: '0' }, inner] : [inner, { op: 'const', value: '0' }] };
    rule.fixedMultiplier = 2;
    const lowered = lower();
    expect(JSON.stringify(lowered.expression).match(/"op":"max"/g)).toHaveLength(1);
    expect(lowered.expression.op).toBe('max');
    expect(lowered.expression.args![0]!.op).toBe('mul');
    for (const mapping of lowered.mappings) {
      let node: unknown = { expression: lowered.expression };
      for (const segment of mapping.privatePath.replaceAll('[', '.').replaceAll(']', '').split('.')) node = (node as Record<string, unknown>)[segment];
      expect(node, mapping.authorPath).toBeDefined();
    }
  });

  it('没有作者最终下界时仍证明非负，不新增隐式上下界', () => {
    const { rule, lower } = sample(); rule.fixedMinValue = null;
    expect(lower().expression.op).toBe('div');
  });

  it.each(['negative', 'infinite', 'missing_static', 'another_runtime', 'unused_binding', 'twice', 'denominator',
    'zero_divisor', 'if', 'target_read', 'hidden_attribute', 'hidden_runtime', 'negative_multiplier', 'upper_bound', 'nonzero_lower'] as const)
  ('拒绝非法依赖或金额结构：%s', mutation => {
    const { configuration, rule, parameterKey, lower } = sample();
    const formula = configuration.formulas[0]!.expression;
    const event: Expression = { op: 'read', inputKey: 'amount' };
    if (mutation === 'negative') configuration.parameters[0]!.fixedValue = -1;
    if (mutation === 'infinite') configuration.parameters[0]!.fixedValue = Infinity;
    if (mutation === 'missing_static') configuration.parameters[0]!.fixedValue = null;
    if (mutation === 'another_runtime') { configuration.parameters[0]!.valueMode = 'RUNTIME_INPUT'; configuration.parameters[0]!.fixedValue = null; }
    if (mutation === 'unused_binding') formula.stages[0]!.expression = { op: 'const', value: '20' };
    if (mutation === 'twice') formula.stages[0]!.expression = { op: 'mul', args: [event, event] };
    if (mutation === 'denominator') formula.stages[0]!.expression = { op: 'div', args: [{ op: 'const', value: '1' }, event] };
    if (mutation === 'zero_divisor') formula.stages[0]!.expression = { op: 'div', args: [event, { op: 'const', value: '0' }] };
    if (mutation === 'if') formula.stages[0]!.expression = { op: 'if', args: [{ op: 'const', value: '1' }, event, event] };
    if (mutation === 'target_read') formula.inputs[1]!.binding = { kind: 'attribute', object: 'target', attributeKey: 'hp', view: 'current_frame', valueKind: 'MAX' };
    if (mutation === 'hidden_attribute') {
      formula.inputs.push({ key: 'hidden', binding: { kind: 'attribute', object: 'source', attributeKey: 'ability_power', view: 'current_frame', valueKind: 'TOTAL' } });
      formula.stages.push({ key: 'hidden', name: '未选阶段不能隐藏依赖', expression: { op: 'read', inputKey: 'hidden' } });
    }
    if (mutation === 'hidden_runtime') {
      configuration.parameters.push({ ...configuration.parameters.find(row => row.parameterKey === parameterKey)!, parameterKey: 'other_runtime' });
      formula.inputs.push({ key: 'hidden', binding: { kind: 'parameter', skillKey: configuration.skill.skillKey, parameterKey: 'other_runtime' } });
      formula.stages.push({ key: 'hidden', name: '未选计算时依赖', expression: { op: 'read', inputKey: 'hidden' } });
    }
    if (mutation === 'negative_multiplier') rule.fixedMultiplier = -1;
    if (mutation === 'upper_bound') rule.fixedMaxValue = 20;
    if (mutation === 'nonzero_lower') rule.fixedMinValue = 1;
    expect(lower).toThrow();
  });

  it('重复引用阶段展开仍有节点预算，不能借合法小图生成超限私有树', () => {
    const { configuration, lower } = sample(); const formula = configuration.formulas[0]!.expression;
    formula.stages = [{ key: 'factor0', name: '静态因子', expression: { op: 'const', value: '1' } }];
    for (let i = 1; i <= 10; i++) formula.stages.push({ key: `factor${i}`, name: '重复静态阶段', expression: {
      op: 'mul', args: [{ op: 'ref', stageKey: `factor${i - 1}` }, { op: 'ref', stageKey: `factor${i - 1}` }]
    } });
    formula.stages.push({ key: 'output', name: '本笔金额', expression: { op: 'mul', args: [{ op: 'read', inputKey: 'amount' }, { op: 'ref', stageKey: 'factor10' }] } });
    expect(lower).toThrow(/预算|LIMIT/);
  });

  it('旧静态治疗和非生命资源恢复分支保持原操作', () => {
    const { effect } = sample(); const heal = effect.results[0]!;
    expect(compileNaturalRestoration(effect, heal, 'result', () => ({ op: 'const', value: 30 }))).toEqual({ operation: 'heal', target: 'self', amount: { op: 'const', value: 30 }, ref: 'result' });
    const resource = { ...heal, resultType: 'RESOURCE_CHANGE' as const, valueRule: heal.valueRule!, detail: { attributeKey: 'mana', operation: 'RESTORE' as const } };
    expect(compileNaturalRestoration(effect, resource, 'resource', () => ({ op: 'const', value: 12 }))).toMatchObject({ operation: 'resource_change', target: 'self', resourceKey: 'mana' });
  });
});
