import { describe, expect, it } from 'vitest';
import type { CompileRequest } from '../types/genericEngine';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillProcess, SkillProcessMoment, SkillProcessStep } from '../types/skillProcess';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { AuthoredTriggerProgram } from './triggerAdapter';
import { withTriggerProgram } from './triggerAdapter';
import {
  adaptProcessProgram, explicitProcessInterrupt, processCommandFact, withProcessProgram,
  type AuthoredProcessProgram
} from './processAdapter';

const start = (failureReason: SkillProcessMoment['failureReason'] = null): SkillProcessMoment => ({
  momentType: 'PROCESS_START', stepKey: null, failureReason
});
const complete = (): SkillProcessMoment => ({ momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null });
const failure = (failureReason: SkillProcessMoment['failureReason']): SkillProcessMoment => ({
  momentType: 'PROCESS_FAILURE', stepKey: null, failureReason
});

function parameter(overrides: Partial<SkillParameter> = {}): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'cast_skill', parameterKey: 'mana_cost', name: '法力', valueType: 'INTEGER',
    valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 50 }, description: null, sortOrder: 10,
    createdAt: '', updatedAt: '', ...overrides
  };
}

function resource(operation: 'CONSUME' | 'RESTORE' | 'REFUND', value = parameterValue('mana_cost'), resultKey = 'consume_mana'): SkillEffectResult {
  return {
    resultKey, name: resultKey, resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: operation === 'CONSUME' ? 10 : 20,
    lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { attributeKey: 'mana', operation }
  };
}

function effect(results: SkillEffectResult[], effectKey = 'mana_cost'): SkillEffect {
  return {
    gameId: 'lol', skillKey: 'cast_skill', effectKey, name: effectKey, description: null, sortOrder: 10,
    lifecycle: null, results, createdAt: '', updatedAt: ''
  };
}

function step(stepType: SkillProcessStep['stepType'], stepKey: string, detail: SkillProcessStep['detail'], sortOrder = 10): SkillProcessStep {
  return { stepKey, name: stepKey, description: null, sortOrder, stepType, detail } as SkillProcessStep;
}

function rule(overrides: Partial<SkillTriggerRuleDetail> & Pick<SkillTriggerRuleDetail, 'ruleKey' | 'eventSource' | 'actions'>): SkillTriggerRuleDetail {
  return {
    name: overrides.ruleKey, description: null, sortOrder: 10, conditionGroups: [],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null, ...overrides
  };
}

function initialRule(processKey = 'cast'): SkillTriggerRuleDetail {
  return rule({
    ruleKey: 'initial', sortOrder: 10,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    actions: [{
      actionKey: 'cast_initial', name: 'initial', actionType: 'START_PROCESS', sortOrder: 10, targetContext: 'CURRENT_TARGET',
      detail: { processKey }, runtimeInputBindings: [], resultModifiers: []
    }]
  });
}

function program(overrides: Partial<AuthoredProcessProgram> = {}): AuthoredProcessProgram {
  const process: SkillProcess = {
    gameId: 'lol', skillKey: 'cast_skill', processKey: 'cast', name: '施放', activationType: 'ACTIVE', description: null,
    sortOrder: 10, cooldown: null,
    steps: [step('IMMEDIATE', 'start', {})],
    effectBindings: [{ bindingKey: 'pay', effectKey: 'mana_cost', moment: start(), sortOrder: 10 }],
    stateOperations: [], createdAt: '', updatedAt: ''
  };
  return {
    gameId: 'lol', skillKey: 'cast_skill', skillLevel: 1, characterLevel: 1, owner: 'source', process,
    rules: [initialRule()], effects: [effect([resource('CONSUME')])],
    parameters: [parameter(), parameter({ parameterKey: 'cooldown_ms', levelValues: { '1': 12000 }, sortOrder: 20 })],
    castCosts: [{ bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'consume_mana' }],
    ...overrides
  };
}

function healRule(ruleKey: string, comparator: 'LT' | 'GTE', effectKey: string, sortOrder: number): SkillTriggerRuleDetail {
  return rule({ ruleKey, sortOrder,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    conditionGroups: [{ groupKey: `${ruleKey}_hp`, name: '生命门槛', sortOrder: 10, conditions: [{
      conditionKey: 'compare_hp', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 10,
      detail: { subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator,
        comparisonValue: parameterValue('low_health_threshold_ratio') }
    }] }],
    actions: [{ actionKey: 'heal_self', name: '自身治疗', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [] }]
  });
}

function healEffect(effectKey: string, value = fixedValue(200)): SkillEffect {
  return effect([{
    resultKey: 'heal', name: '自身治疗', resultType: 'DIRECT_HEAL', target: 'SOURCE', description: null, sortOrder: 10,
    lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: {}
  }], effectKey);
}

function healingProgram(): AuthoredProcessProgram {
  const authored = program();
  authored.rules.push(healRule('normal', 'GTE', 'normal_heal', 10), healRule('low', 'LT', 'low_heal', 20));
  authored.effects.push(healEffect('normal_heal'), healEffect('low_heal', fixedValue(300)));
  authored.parameters!.push(parameter({ parameterKey: 'low_health_threshold_ratio', valueType: 'DECIMAL', levelValues: { '1': 0.4 }, sortOrder: 30 }));
  return authored;
}

function request(): CompileRequest {
  const slot = { base: 100, current: 100, max: 100, resolved: 100 };
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p4', rulesHash: 'before-p4',
    typeCatalog: { types: [], relations: [] }, rules: {},
    combatants: [
      { key: 'source', attributes: { hp: slot, power: slot }, resources: { mana: { current: 100, max: 200 }, energy: { current: 5, max: 10 } }, providers: [] },
      { key: 'target', attributes: { hp: slot, power: slot }, resources: { mana: { current: 80, max: 80 } }, providers: [] }
    ]
  };
}

describe('processAdapter', () => {
  it('首次过程控制唯一，条件在两个监听上冻结，直接治疗保留原数值且不污染作者输入', () => {
    const authored = healingProgram();
    const before = structuredClone(authored);
    const adapted = adaptProcessProgram(authored);
    expect(authored).toEqual(before);
    expect(adapted.controls).toEqual([{ abilityKey: 'cast_initial', action: 'INITIAL' }]);
    expect(adapted.provider.abilities).toHaveLength(3);
    expect(adapted.provider.abilities[0]).toMatchObject({ kind: 'active', types: ['ability/initial_cast/@mount'],
      processControl: { processKey: 'cast', action: 'INITIAL' } });
    for (const [index, op, amount] of [[1, 'gte', 200], [2, 'lt', 300]] as const) {
      const listener = adapted.provider.abilities[index]!.listenerSpec!;
      expect(listener.eventMatcher.all).toEqual(['event/ability_started', 'ability/initial_cast/@mount', 'event/source_owner']);
      expect(listener.condition).toEqual({ op, args: [
        { op: 'div', args: [{ op: 'read', path: 'source.attr.hp.current' }, { op: 'read', path: 'source.attr.hp.max' }] },
        { op: 'const', value: 0.4 }
      ] });
      expect(listener.operations).toEqual([{ operation: 'heal', target: 'self', amount: { op: 'const', value: amount } }]);
      expect(listener.operations![0]!.condition).toBeUndefined();
    }
    expect(adapted.requiredAttributes).toContain('hp');
    const input = request();
    const bound = withProcessProgram(input, { processProviderKey: 'cast_one', authored }, { rulesHash: 'healing' });
    expect(input).toEqual(request());
    expect(bound.typeCatalog.types).toEqual(expect.arrayContaining([
      { key: 'ability/basic_attack', domain: 'ability' }, { key: 'event/ability_started', domain: 'event' },
      { key: 'event/source_owner', domain: 'event' }, { key: 'ability/initial_cast/source/cast_one', domain: 'ability' }
    ]));
    const abilities = bound.sharedProviders![0]!.abilities!;
    expect(abilities[0]!.types).toEqual(['ability/initial_cast/source/cast_one']);
    expect(abilities[1]!.listenerSpec!.eventMatcher.all).toContain('ability/initial_cast/source/cast_one');
  });

  it('首次治疗生成定义不能由同拥有者别名或另一拥有者复用，独立绑定仍可并存', () => {
    const authored = healingProgram();
    const first = withProcessProgram(request(), { processProviderKey: 'cast_one', authored }, { rulesHash: 'first-heal' });
    const second = withProcessProgram(first, { processProviderKey: 'cast_two', authored }, { rulesHash: 'second-heal' });
    expect(second.combatants[0]!.providers).toEqual([
      { providerRef: 'cast_one', definitionRef: 'process_source_cast_one' },
      { providerRef: 'cast_two', definitionRef: 'process_source_cast_two' }
    ]);
    expect(second.sharedProviders?.filter(provider => provider.providerKey.startsWith('process_source_cast_'))).toHaveLength(2);

    for (const [combatantIndex, providerRef, path] of [
      [0, 'alias', /combatants\.source\.providers\.alias\.definitionRef/],
      [1, 'foreign', /combatants\.target\.providers\.foreign\.definitionRef/]
    ] as const) {
      const polluted = structuredClone(first);
      polluted.combatants[combatantIndex]!.providers.push({ providerRef, definitionRef: 'process_source_cast_one' });
      const before = structuredClone(polluted);
      expect(() => withProcessProgram(polluted, { processProviderKey: 'cast_one', authored }, { rulesHash: `retry_${providerRef}` })).toThrow(path);
      expect(polluted).toEqual(before);
    }
    const duplicated = structuredClone(first);
    duplicated.combatants[0]!.providers.push({ providerRef: 'cast_one', definitionRef: 'process_source_cast_one' });
    expect(() => withProcessProgram(duplicated, { processProviderKey: 'cast_one', authored }, { rulesHash: 'retry_duplicate' }))
      .toThrow(/combatants\.source\.providers\.cast_one/);
  });

  it('治疗公式使用原等级参数与来源属性，监听金额不依赖主动能力的参数帧', () => {
    const authored = healingProgram();
    authored.parameters!.push(parameter({ parameterKey: 'base_heal', levelValues: { '1': 100 }, sortOrder: 40 }));
    authored.parameters!.push(parameter({ parameterKey: 'ap_ratio', valueType: 'DECIMAL', levelValues: { '1': 1 }, sortOrder: 50 }));
    authored.formulas = [{ gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'total_heal', name: '治疗公式',
      description: null, sortOrder: 10, createdAt: '', updatedAt: '', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'base_heal' },
        { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
          { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'ap', attributeValueKind: 'TOTAL' },
          { nodeType: 'PARAMETER', parameterKey: 'ap_ratio' }
        ] }
      ] } }];
    authored.effects[1]!.results[0]!.valueRule!.value = formulaValue('total_heal');
    const adapted = adaptProcessProgram(authored);
    expect(adapted.requiredAttributes).toEqual(expect.arrayContaining(['hp', 'ap']));
    expect(adapted.provider.abilities[1]!.listenerSpec!.operations![0]!.amount).toEqual({
      op: 'max', args: [{ op: 'add', args: [{ op: 'const', value: 100 }, { op: 'mul', args: [
        { op: 'read', path: 'source.attr.ap.resolved' }, { op: 'const', value: 1 }
      ] }] }, { op: 'const', value: 0 }]
    });
  });

  it('首次自身治疗以字段路径拒绝错误阶段、条件、动作和结果形状', () => {
    const reject = (mutate: (authored: AuthoredProcessProgram) => void, path: RegExp) => {
      const authored = healingProgram(); mutate(authored);
      expect(() => adaptProcessProgram(authored)).toThrow(path);
    };
    reject((p) => { p.rules[1]!.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: null } }; }, /rules\.normal\.eventSource\.detail\.castPhase/);
    reject((p) => { p.rules[1]!.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: 'RECAST' } }; }, /rules\.normal\.eventSource\.detail\.castPhase/);
    reject((p) => { p.rules[1]!.conditionGroups = []; }, /rules\.normal\.conditionGroups/);
    reject((p) => { p.rules[1]!.conditionGroups[0]!.conditions[0]!.detail.subject = 'CURRENT_TARGET'; }, /rules\.normal\.conditionGroups\.normal_hp\.conditions\.compare_hp\.detail\.subject/);
    reject((p) => { p.rules[1]!.conditionGroups[0]!.conditions[0]!.conditionType = 'EVENT_VALUE_COMPARE' as 'ATTRIBUTE_COMPARE'; }, /rules\.normal\.conditionGroups\.normal_hp\.conditions\.compare_hp\.conditionType/);
    reject((p) => { p.rules[1]!.conditionGroups[0]!.conditions[0]!.detail.attributeKey = 'Missing-Hp'; }, /rules\.normal\.conditionGroups\.normal_hp\.conditions\.compare_hp\.detail\.attributeKey/);
    reject((p) => { p.rules[1]!.actions[0]!.runtimeInputBindings = [{} as never]; }, /rules\.normal\.actions\.heal_self\.runtimeInputBindings/);
    reject((p) => { p.rules[1]!.actions[0]!.resultModifiers = [{} as never]; }, /rules\.normal\.actions\.heal_self\.resultModifiers/);
    reject((p) => { p.effects[1]!.results[0]!.target = 'TARGET'; }, /effects\.normal_heal\.results\.heal\.target/);
    reject((p) => { p.effects[1]!.lifecycle = {} as SkillEffect['lifecycle']; }, /effects\.normal_heal\.lifecycle/);
    reject((p) => { (p.effects[1]!.results[0]!.detail as Record<string, unknown>).extra = true; }, /effects\.normal_heal\.results\.heal\.detail\.extra/);
    reject((p) => { p.effects[1]!.results[0]!.valueRule!.value = parameterValue('unknown'); }, /effects\.normal_heal\.results\.heal\.valueRule\.value/);
  });
  it('抽出开始时自身消耗，保留倍率与未声明冷却，且不把参数冷却补上', () => {
    const authored = program();
    const mana = authored.effects[0]!.results[0]!;
    if (mana.resultType !== 'RESOURCE_CHANGE') throw new Error('fixture');
    mana.valueRule = { value: parameterValue('mana_cost'), fixedMultiplier: 2, fixedMinValue: 0, fixedMaxValue: 80 };
    const before = structuredClone(authored);
    const adapted = adaptProcessProgram(authored);
    expect(authored).toEqual(before);
    expect(adapted.provider.processes![0]).toMatchObject({
      processKey: 'cast', skillKey: 'cast_skill', cooldown: null,
      costs: [{ resourceKey: 'mana', amount: { op: 'const', value: 80 } }],
      momentOperations: []
    });
    expect(adapted.initialAbilityKey).toBe('cast_initial');
    const initial = adapted.provider.abilities![0]!;
    expect(initial).toMatchObject({ kind: 'active', skillKey: 'cast_skill', processControl: { action: 'INITIAL', processKey: 'cast' } });
    expect(initial.cost).toBeUndefined();
    expect(initial.cooldown).toBeUndefined();
    expect(initial.operations).toBeUndefined();
    expect(JSON.stringify(adapted.provider)).not.toContain('12000');
  });

  it('同资源成本逐笔保留供原生校验与原子准入，其余结果按作者顺序保留', () => {
    const authored = program({
      effects: [effect([
        resource('CONSUME', fixedValue(20), 'first'),
        resource('CONSUME', fixedValue(40), 'second'),
        resource('RESTORE', fixedValue(5), 'refund_now')
      ])],
      castCosts: [
        { bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'second' },
        { bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'first' }
      ],
      rules: [
        initialRule(),
        rule({
          ruleKey: 'after', sortOrder: 5,
          eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: start() } },
          actions: [{
            actionKey: 'again', name: 'again', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET',
            detail: { effectKey: 'mana_cost' }, runtimeInputBindings: [], resultModifiers: []
          }]
        })
      ]
    });
    authored.process.effectBindings[0]!.sortOrder = 30;
    const adapted = adaptProcessProgram(authored);
    expect(adapted.provider.processes![0]!.costs).toEqual([
      { resourceKey: 'mana', amount: { op: 'const', value: 40 } },
      { resourceKey: 'mana', amount: { op: 'const', value: 20 } }
    ]);
    const amounts = adapted.provider.processes![0]!.momentOperations[0]!.operations.map((operation) => operation.amount);
    expect(amounts).toEqual([{ op: 'const', value: 5 }, { op: 'const', value: 5 }]);
  });

  it('不同失败筛选穿插时仍保留绑定A、绑定B、规则C的作者顺序', () => {
    const cooldown = (value: number, key: string) => effect([{
      resultKey: 'set_cd', name: '冷却', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', description: null, sortOrder: 10,
      lifecycleBehavior: null, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(value), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: ['cast_skill'], skillCategoryKeys: [] } }
    }], key);
    const authored = program({ effects: [effect([resource('CONSUME')]), cooldown(1000, 'a'), cooldown(2000, 'b'), cooldown(3000, 'c')] });
    authored.process.effectBindings.push(
      { bindingKey: 'a', effectKey: 'a', moment: failure(null), sortOrder: 20 },
      { bindingKey: 'b', effectKey: 'b', moment: failure('ACTIVE_CANCELLED'), sortOrder: 30 }
    );
    authored.rules = [initialRule(), rule({
      ruleKey: 'c', eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: failure(null) } },
      actions: [{ actionKey: 'set_c', name: '设置C', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'c' }, runtimeInputBindings: [], resultModifiers: [] }]
    })];
    const groups = adaptProcessProgram(authored).provider.processes[0]!.momentOperations;
    expect(groups.map((group) => group.moment.failureReason)).toEqual([null, 'ACTIVE_CANCELLED', null]);
    expect(groups.flatMap((group) => group.operations.map((operation) => operation.amount))).toEqual([
      { op: 'const', value: 1000 }, { op: 'const', value: 2000 }, { op: 'const', value: 3000 }
    ]);
  });

  it('负成本不能被同资源正成本抵消，动态成本也保留逐笔表达式', () => {
    const first = resource('CONSUME', fixedValue(60), 'first');
    const second = resource('CONSUME', fixedValue(-10), 'second');
    if (second.resultType !== 'RESOURCE_CHANGE') throw new Error('fixture');
    second.valueRule.fixedMinValue = null;
    const authored = program({ effects: [effect([first, second])], castCosts: [
      { bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'first' },
      { bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'second' }
    ] });
    expect(() => adaptProcessProgram(authored)).toThrow(/effects\.mana_cost\.results\.second\.valueRule.*非负/);
    second.valueRule.value = fixedValue(10);
    expect(adaptProcessProgram(authored).provider.processes[0]!.costs.map((cost) => cost.amount)).toEqual([
      { op: 'const', value: 60 }, { op: 'const', value: 10 }
    ]);
    authored.formulas = [{ gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'dynamic', name: '动态', description: null,
      sortOrder: 10, createdAt: '', updatedAt: '',
      expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'power', attributeValueKind: 'CURRENT' } }];
    second.valueRule = { value: formulaValue('dynamic'), fixedMultiplier: -1, fixedMinValue: null, fixedMaxValue: null };
    const costs = adaptProcessProgram(authored).provider.processes[0]!.costs;
    expect(costs).toHaveLength(2);
    expect(costs[1]!.amount).toEqual({ op: 'mul', args: [{ op: 'ref', ref: 'process/cast_skill/dynamic' }, { op: 'const', value: -1 }] });
    expect(JSON.stringify(costs)).not.toContain('"op":"max"');
    authored.castCosts = [...authored.castCosts, authored.castCosts[0]!];
    expect(() => adaptProcessProgram(authored)).toThrow(/castCosts\[2\].*重复/);
  });

  it('相同退款公式按动作读取自己的成本，后续动作不能借用前一动作参数', () => {
    const energyCost = resource('CONSUME', fixedValue(10), 'consume_energy');
    const manaRefund = resource('REFUND', formulaValue('half_paid'), 'refund_mana');
    const energyRefund = resource('REFUND', formulaValue('half_paid'), 'refund_energy');
    if (energyCost.resultType !== 'RESOURCE_CHANGE' || energyRefund.resultType !== 'RESOURCE_CHANGE' || manaRefund.resultType !== 'RESOURCE_CHANGE') throw new Error('fixture');
    energyCost.detail.attributeKey = 'energy';
    energyRefund.detail.attributeKey = 'energy';
    manaRefund.valueRule.fixedMinValue = null;
    energyRefund.valueRule.fixedMinValue = null;
    const actions: SkillTriggerRuleDetail['actions'] = ['mana', 'energy'].map((key, index) => ({
      actionKey: `refund_${key}`, name: key, actionType: 'EXECUTE_EFFECT', sortOrder: index, targetContext: 'CURRENT_TARGET',
      detail: { effectKey: `refund_${key}` }, resultModifiers: [],
      runtimeInputBindings: [{ bindingKey: 'paid', parameterKey: 'paid', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: key } }]
    }));
    const authored = program({ effects: [effect([resource('CONSUME', fixedValue(60)), energyCost]), effect([manaRefund], 'refund_mana'), effect([energyRefund], 'refund_energy')],
      parameters: [parameter({ parameterKey: 'paid', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null }),
        parameter({ parameterKey: 'half', valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: 0.5, levelValues: null })],
      formulas: [{ gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'half_paid', name: '一半', description: null, sortOrder: 10, createdAt: '', updatedAt: '',
        expression: { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'paid' }, { nodeType: 'PARAMETER', parameterKey: 'half' }] } }],
      castCosts: [{ bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'consume_mana' }, { bindingKey: 'pay', effectKey: 'mana_cost', resultKey: 'consume_energy' }],
      rules: [initialRule(), rule({ ruleKey: 'refund', eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: complete() } }, actions })]
    });
    const adapted = adaptProcessProgram(authored);
    const amounts = adapted.provider.processes[0]!.momentOperations.flatMap((group) => group.operations.map((operation) => operation.amount));
    expect(amounts).toHaveLength(2);
    const refunds = amounts.map((amount) => adapted.formulas.find((formula) => formula.key === amount?.ref)?.expression);
    expect(refunds[0]).toEqual({ op: 'mul', args: [{ op: 'read', path: 'process.actual_cost.mana' }, { op: 'read', path: 'ability.param.half' }] });
    expect(refunds[1]).toEqual({ op: 'mul', args: [{ op: 'read', path: 'process.actual_cost.energy' }, { op: 'read', path: 'ability.param.half' }] });
    actions[1]!.runtimeInputBindings = [];
    expect(() => adaptProcessProgram(authored)).toThrow(/计算时输入/);
  });

  it('数值联合、公式节点、效果和结果上的额外语义均按具体路径拒绝', () => {
    const authored = program();
    authored.process.steps = [step('DELAY', 'wait', { delayValue: fixedValue(100) })];
    const numeric = (authored.process.steps[0]!.detail as { delayValue: object }).delayValue;
    Object.assign(numeric, { parameterKey: 'unknown' });
    expect(() => adaptProcessProgram(authored)).toThrow(/steps\.wait\.detail\.delayValue\.parameterKey/);
    Object.assign(numeric, { parameterKey: null });
    expect(() => adaptProcessProgram(authored)).toThrow(/delayValue\.parameterKey/);
    delete (numeric as { parameterKey?: unknown }).parameterKey;
    const result = authored.effects[0]!.results[0]!;
    Object.assign(result, { resultModifiers: [{ mode: 'unknown' }] });
    expect(() => adaptProcessProgram(authored)).toThrow(/results\.consume_mana\.resultModifiers/);
    delete (result as { resultModifiers?: unknown }).resultModifiers;
    Object.assign(authored.effects[0]!, { unknownBehavior: true });
    expect(() => adaptProcessProgram(authored)).toThrow(/effects\.mana_cost\.unknownBehavior/);
    delete (authored.effects[0]! as { unknownBehavior?: unknown }).unknownBehavior;
    authored.formulas = [{ gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'bad', name: '公式', description: null, sortOrder: 10, createdAt: '', updatedAt: '',
      expression: { nodeType: 'PARAMETER', parameterKey: 'mana_cost' } }];
    Object.assign(authored.formulas[0]!.expression, { operands: [] });
    authored.process.steps = [step('DELAY', 'wait', { delayValue: formulaValue('bad') })];
    expect(() => adaptProcessProgram(authored)).toThrow(/formulas\.bad\.expression\.operands/);
    delete (authored.formulas[0]!.expression as { operands?: unknown }).operands;
    expect(() => adaptProcessProgram(authored)).not.toThrow();
  });

  it('数值各入口和数值规则不丢额外字段，合法空元数据保留', () => {
    const reject = (mutate: (authored: AuthoredProcessProgram) => void, path: RegExp) => {
      const authored = program();
      mutate(authored);
      expect(() => adaptProcessProgram(authored)).toThrow(path);
    };
    reject((authored) => {
      authored.process.cooldown = { durationValue: fixedValue(1000), startMoment: start() };
      Object.assign(authored.process.cooldown.durationValue, { formulaKey: 'ignored' });
    }, /cooldown\.durationValue\.formulaKey/);
    reject((authored) => {
      authored.process.steps.push(step('RECAST', 'again', { windowValue: fixedValue(1000), maximumRecastCountValue: fixedValue(1) }, 20));
      Object.assign((authored.process.steps[1]!.detail as { maximumRecastCountValue: object }).maximumRecastCountValue, { parameterKey: 'ignored' });
    }, /steps\.again\.detail\.maximumRecastCountValue\.parameterKey/);
    reject((authored) => {
      Object.assign(authored.effects[0]!.results[0]!.valueRule!, { scaleWithLevel: true });
    }, /results\.consume_mana\.valueRule\.scaleWithLevel/);
    reject((authored) => {
      Object.assign(authored.effects[0]!.results[0]!.valueRule!.value, { value: 5 });
    }, /valueRule\.value\.value/);
    reject((authored) => {
      authored.effects.push(effect([{
        resultKey: 'set_cd', name: '冷却', resultType: 'COOLDOWN_CHANGE', target: 'TARGET', description: null, sortOrder: 10,
        lifecycleBehavior: null, spellShieldBlockScope: null,
        valueRule: { value: fixedValue(1000), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: ['cast_skill'], skillCategoryKeys: [] } }
      }], 'cd'));
      authored.process.effectBindings.push({ bindingKey: 'cd', effectKey: 'cd', sortOrder: 20, moment: start() });
    }, /effects\.cd\.results\.set_cd\.target/);
    const authored = program({ parameters: [parameter({ valueMode: 'FIXED', fixedValue: 0, levelValues: null })] });
    const before = structuredClone(authored);
    expect(adaptProcessProgram(authored).provider.processes[0]!.costs).toEqual([{ resourceKey: 'mana', amount: { op: 'const', value: 0 } }]);
    expect(authored).toEqual(before);
  });

  it('重施与蓄力只生成对应控制能力，推进和取消不是首次主动能力', () => {
    const recast = program();
    recast.process.steps = [
      step('DELAY', 'windup', { delayValue: parameterValue('mana_cost') }, 10),
      step('RECAST', 'again', { windowValue: fixedValue(1000), maximumRecastCountValue: fixedValue(1) }, 20)
    ];
    recast.rules = [
      initialRule(),
      rule({
        ruleKey: 'recast', sortOrder: 20,
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: 'RECAST' } },
        actions: [{
          actionKey: 'cast_recast', name: 'recast', actionType: 'ADVANCE_PROCESS', sortOrder: 10, targetContext: null,
          detail: { processKey: 'cast', stepKey: 'again' }, runtimeInputBindings: [], resultModifiers: []
        }]
      })
    ];
    const adapted = adaptProcessProgram(recast);
    expect(adapted.provider.processes![0]!.steps[0]).toMatchObject({ stepType: 'DELAY', delayMs: { op: 'const', value: 50 } });
    expect(adapted.provider.processes![0]!.steps[1]).toEqual({ stepKey: 'again', stepType: 'RECAST', windowMs: { op: 'const', value: 1000 } });
    expect(adapted.controls.map((control) => control.action)).toEqual(['INITIAL', 'RECAST']);
    expect(adapted.provider.abilities![1]).toMatchObject({ kind: 'active', processControl: { action: 'RECAST', stepKey: 'again' } });

    const charge = program();
    charge.process.steps = [step('CHARGE', 'hold', { minimumChargeValue: fixedValue(0), maximumChargeValue: fixedValue(400), releaseAtMaximum: false })];
    charge.rules = [initialRule(), rule({
      ruleKey: 'release', sortOrder: 20,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: 'CHARGE_RELEASE' } },
      actions: [{
        actionKey: 'cast_release', name: 'release', actionType: 'ADVANCE_PROCESS', sortOrder: 10, targetContext: null,
        detail: { processKey: 'cast', stepKey: 'hold' }, runtimeInputBindings: [], resultModifiers: []
      }]
    })];
    expect(adaptProcessProgram(charge).controls[1]).toMatchObject({ action: 'CHARGE_RELEASE', stepKey: 'hold' });
  });

  it('完成与明确取消失败才读取实际成本，普通冷却保留真实起算时点', () => {
    const authored = program({
      effects: [
        effect([resource('CONSUME', fixedValue(60))]),
        effect([{
          resultKey: 'give_back', name: 'give_back', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 10,
          lifecycleBehavior: null, spellShieldBlockScope: null,
          valueRule: { value: parameterValue('paid'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
          detail: { attributeKey: 'mana', operation: 'REFUND' }
        }], 'refund'),
        effect([{
          resultKey: 'set_cd', name: 'set_cd', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', description: null, sortOrder: 10,
          lifecycleBehavior: null, spellShieldBlockScope: null,
          valueRule: { value: fixedValue(1500), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
          detail: { operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: ['cast_skill'], skillCategoryKeys: [] } }
        }], 'cd')
      ],
      parameters: [
        parameter({ valueMode: 'FIXED', fixedValue: 60, levelValues: null }),
        parameter({ parameterKey: 'paid', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null })
      ]
    });
    authored.process.cooldown = { durationValue: fixedValue(8000), startMoment: failure('ACTIVE_CANCELLED') };
    authored.process.effectBindings.push(
      { bindingKey: 'cd_bind', effectKey: 'cd', moment: failure('ACTIVE_CANCELLED'), sortOrder: 30 }
    );
    authored.rules = [
      initialRule(),
      rule({
        ruleKey: 'cancel', sortOrder: 20,
        eventSource: { eventType: 'PROCESS_CANCEL_REQUESTED', detail: { processKey: 'cast' } },
        actions: [{
          actionKey: 'cast_cancel', name: 'cancel', actionType: 'FAIL_PROCESS', sortOrder: 10, targetContext: null,
          detail: { processKey: 'cast', failureReason: 'ACTIVE_CANCELLED' }, runtimeInputBindings: [], resultModifiers: []
        }]
      }),
      rule({
        ruleKey: 'settle', sortOrder: 30,
        eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: failure('ACTIVE_CANCELLED') } },
        actions: [{
          actionKey: 'do_refund', name: 'refund', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET',
          detail: { effectKey: 'refund' }, resultModifiers: [],
          runtimeInputBindings: [{ bindingKey: 'paid', parameterKey: 'paid', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } }]
        }]
      })
    ];
    const adapted = adaptProcessProgram(authored);
    expect(adapted.provider.processes![0]!.cooldown).toMatchObject({
      durationMs: { op: 'const', value: 8000 },
      startMoment: { momentType: 'PROCESS_FAILURE', failureReason: 'ACTIVE_CANCELLED', stepKey: null }
    });
    const operations = adapted.provider.processes![0]!.momentOperations[0]!.operations;
    expect(operations[0]).toMatchObject({ operation: 'cooldown_change', valuePolicy: 'set_remaining', amount: { op: 'const', value: 1500 } });
    expect(operations[1]!.amount).toEqual({ op: 'read', path: 'process.actual_cost.mana' });
    expect(adapted.provider.abilities!.find((ability) => ability.abilityKey === 'cast_cancel')!.kind).toBe('active');
    expect(explicitProcessInterrupt({ abilityKey: 'cut', skillKey: 'cast_skill', processKey: 'cast', failureReason: 'CONTROLLED' }).processControl).toEqual({
      processKey: 'cast', action: 'INTERRUPT', failureReason: 'CONTROLLED'
    });
    expect(processCommandFact('go', 'use_1')).toEqual({ driverEntryKey: 'go', useRef: 'use_1' });
  });

  it('非法形状、阶段、成本、时间、动态绑定、效果和条件按路径拒绝', () => {
    const reject = (mutate: (authored: AuthoredProcessProgram) => void, pattern: RegExp) => {
      const authored = program();
      mutate(authored);
      expect(() => adaptProcessProgram(authored)).toThrow(pattern);
    };
    reject((authored) => { authored.process.activationType = 'PASSIVE'; }, /ACTIVE/);
    reject((authored) => { authored.process.steps = [step('CHANNEL', 'bad', { durationValue: fixedValue(1), executionCountValue: fixedValue(1), firstExecution: 'IMMEDIATE' })]; }, /IMMEDIATE|DELAY|CHARGE|RECAST/);
    reject((authored) => {
      authored.process.steps = [step('RECAST', 'again', { windowValue: fixedValue(1000), maximumRecastCountValue: fixedValue(2) }, 20), step('IMMEDIATE', 'start', {}, 10)];
    }, /末尾|重施次数必须为 1/);
    reject((authored) => { authored.rules[0]!.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: null } }; }, /缺少施放阶段/);
    reject((authored) => { authored.rules[0]!.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'other_skill', useKind: 'ACTIVE', castPhase: 'INITIAL' } }; }, /跨技能/);
    reject((authored) => { (authored.process as SkillProcess & { extra?: boolean }).extra = true; }, /未支持的字段/);
    reject((authored) => { authored.rules[0]!.conditionGroups = [{ groupKey: 'g', name: 'g', sortOrder: 10, conditions: [] }]; }, /条件/);
    reject((authored) => { authored.rules[0]!.oncePerUse = { groupKey: 'once', scope: 'SKILL' }; }, /重放/);
    reject((authored) => { authored.process.stateOperations = [{ operationKey: 'up', name: 'up', stateKey: 'flag', moment: start(), sortOrder: 10, operation: 'ENABLE', value: null, optionKey: null }]; }, /内部状态/);
    reject((authored) => { authored.castCosts = [{ bindingKey: 'missing', effectKey: 'mana_cost', resultKey: 'consume_mana' }]; }, /成本引用无法定位/);
    reject((authored) => { authored.effects[0]!.results[0] = resource('RESTORE'); }, /CONSUME|名称或符号/);
    reject((authored) => {
      authored.process.steps = [step('DELAY', 'wait', { delayValue: fixedValue(1.5) })];
    }, /非整数/);
    reject((authored) => {
      authored.parameters = [parameter({ valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null })];
      authored.effects[0]!.results[0] = resource('CONSUME', parameterValue('mana_cost'));
    }, /计算时输入/);
    reject((authored) => {
      authored.effects.push(effect([{
        resultKey: 'damage', name: 'damage', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
        lifecycleBehavior: null, spellShieldBlockScope: null,
        valueRule: { value: fixedValue(10), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'UNRESOLVED', vampOverrides: [] }
      }], 'hurt'));
      authored.process.effectBindings.push({ bindingKey: 'hurt', effectKey: 'hurt', moment: start(), sortOrder: 20 });
    }, /尚未核定/);
    reject((authored) => {
      authored.effects[0]!.results[0]!.spellShieldBlockScope = 'RESULT';
    }, /法术护盾/);
    reject((authored) => {
      authored.rules.push(rule({
        ruleKey: 'auto', sortOrder: 20,
        eventSource: { eventType: 'CONTROL_RECEIVED', detail: {} },
        actions: [{
          actionKey: 'cut', name: 'cut', actionType: 'FAIL_PROCESS', sortOrder: 10, targetContext: null,
          detail: { processKey: 'cast', failureReason: 'CONTROLLED' }, runtimeInputBindings: [], resultModifiers: []
        }]
      }));
    }, /自动控制/);
    reject((authored) => {
      authored.rules.push(rule({
        ruleKey: 'dead', sortOrder: 20,
        eventSource: { eventType: 'PROCESS_CANCEL_REQUESTED', detail: { processKey: 'cast' } },
        actions: [{
          actionKey: 'dead', name: 'dead', actionType: 'FAIL_PROCESS', sortOrder: 10, targetContext: null,
          detail: { processKey: 'cast', failureReason: 'SOURCE_DIED' }, runtimeInputBindings: [], resultModifiers: []
        }]
      }));
    }, /来源死亡/);
    expect(() => explicitProcessInterrupt({ abilityKey: 'cut', skillKey: 'cast_skill', processKey: 'cast', failureReason: 'SOURCE_DIED' })).toThrow(/来源死亡|伪装取消/);
  });

  it('原请求不被污染，双方和同定义多挂载使用独立命名空间', () => {
    const input = request();
    const before = structuredClone(input);
    const source = withProcessProgram(input, { processProviderKey: 'q', authored: program() }, { rulesHash: 'p4-source' });
    expect(input).toEqual(before);
    const both = withProcessProgram(source, { processProviderKey: 'q', authored: program({ owner: 'target' }) }, { rulesHash: 'p4-target' });
    const second = withProcessProgram(both, { processProviderKey: 'q2', authored: program() }, { rulesHash: 'p4-second' });
    expect(second.sharedProviders?.map((provider) => provider.providerKey)).toEqual([
      'process_source_q', 'process_target_q', 'process_source_q2'
    ]);
    expect(second.combatants.find((actor) => actor.key === 'source')!.providers.map((row) => row.providerRef)).toEqual(['q', 'q2']);
    expect(second.combatants.find((actor) => actor.key === 'target')!.providers.map((row) => row.definitionRef)).toEqual(['process_target_q']);
    expect(input.rulesHash).toBe('before-p4');
  });

  it('初次能力可绑定待击启动，推进能力不能当成首次施法', () => {
    const recast = program();
    recast.process.steps.push(step('RECAST', 'again', { windowValue: fixedValue(1000), maximumRecastCountValue: fixedValue(1) }, 20));
    recast.rules.push(rule({
      ruleKey: 'recast', sortOrder: 20,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'cast_skill', useKind: 'ACTIVE', castPhase: 'RECAST' } },
      actions: [{
        actionKey: 'cast_recast', name: 'recast', actionType: 'ADVANCE_PROCESS', sortOrder: 10, targetContext: null,
        detail: { processKey: 'cast', stepKey: 'again' }, runtimeInputBindings: [], resultModifiers: []
      }]
    }));
    const bound = withProcessProgram(request(), { processProviderKey: 'q', authored: recast }, { rulesHash: 'with-process' });
    const trigger = spellblade();
    const marked = withTriggerProgram(bound, {
      triggerProviderKey: 'blade', authored: trigger, initialCastAbilities: [{ providerRef: 'q', abilityKey: 'cast_initial' }]
    }, { rulesHash: 'with-trigger' });
    const ability = marked.sharedProviders!.find((provider) => provider.providerKey === 'trigger-bound:source:q')!.abilities!.find((row) => row.abilityKey === 'cast_initial')!;
    expect(ability.types?.some((type) => type.includes('initial_cast'))).toBe(true);
    expect(ability.skillKey).toBe('cast_skill');
    expect(() => withTriggerProgram(bound, {
      triggerProviderKey: 'blade', authored: trigger, initialCastAbilities: [{ providerRef: 'q', abilityKey: 'cast_recast' }]
    }, { rulesHash: 'reject-recast' })).toThrow(/主动|首次/);
  });

  it('属性公式成本保持读取，不存在的成本动态绑定不补零', () => {
    const formula: SkillFormula = {
      gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'from_power', name: '力量', description: null, sortOrder: 10,
      createdAt: '', updatedAt: '',
      expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'power', attributeValueKind: 'CURRENT' }
    };
    const cost = resource('CONSUME', formulaValue('from_power'));
    if (cost.resultType !== 'RESOURCE_CHANGE') throw new Error('fixture');
    cost.valueRule = { value: formulaValue('from_power'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };
    const authored = program({
      formulas: [formula],
      effects: [effect([cost])],
      parameters: [parameter({ parameterKey: 'paid', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null })]
    });
    const adapted = adaptProcessProgram(authored);
    expect(adapted.provider.processes![0]!.costs[0]!.amount).toEqual({ op: 'ref', ref: 'process/cast_skill/from_power' });
    expect(adapted.formulas).toEqual([{ key: 'process/cast_skill/from_power', expression: { op: 'read', path: 'source.attr.power.current' } }]);
    authored.rules.push(rule({
      ruleKey: 'settle', sortOrder: 20,
      eventSource: { eventType: 'PROCESS_MOMENT', detail: { processKey: 'cast', moment: complete() } },
      actions: [{
        actionKey: 'read_energy', name: 'read', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'mana_cost' }, resultModifiers: [],
        runtimeInputBindings: [{ bindingKey: 'paid', parameterKey: 'paid', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'energy' } }]
      }]
    }));
    expect(() => adaptProcessProgram(authored)).toThrow(/不能补 0/);
  });
});

function spellblade(): AuthoredTriggerProgram {
  const skillKey = 'blade';
  const moment = (momentType: SkillProcessMoment['momentType'], stepKey: string | null = null): SkillProcessMoment => ({
    momentType, stepKey, failureReason: null
  });
  return {
    gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, owner: 'source',
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
    statuses: [],
    internalStates: [
      { gameId: 'lol', skillKey, stateKey: 'ready', name: 'ready', scope: 'SKILL', description: null, sortOrder: 10, stateType: 'FLAG', detail: { initialEnabled: false }, createdAt: '', updatedAt: '' },
      { gameId: 'lol', skillKey, stateKey: 'icd', name: 'icd', scope: 'SKILL', description: null, sortOrder: 20, stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: fixedValue(1500) }, createdAt: '', updatedAt: '' }
    ],
    processes: [{
      gameId: 'lol', skillKey, processKey: 'spellblade', name: 'spellblade', activationType: 'ACTIVE', description: null, sortOrder: 10, cooldown: null,
      steps: [{ stepKey: 'aa', name: 'aa', description: null, sortOrder: 10, stepType: 'EMPOWERED_BASIC_ATTACK', detail: { windowValue: fixedValue(10000), consumeMoment: 'ATTACK_HIT' } }],
      effectBindings: [{ bindingKey: 'do_bonus', effectKey: 'bonus', moment: moment('STEP_EXECUTION', 'aa'), sortOrder: 10 }],
      stateOperations: [
        { operationKey: 'arm', name: 'arm', stateKey: 'ready', moment: moment('PROCESS_START'), sortOrder: 10, operation: 'ENABLE', value: null, optionKey: null },
        { operationKey: 'disarm', name: 'disarm', stateKey: 'ready', moment: moment('STEP_EXECUTION', 'aa'), sortOrder: 20, operation: 'DISABLE', value: null, optionKey: null },
        { operationKey: 'start_icd', name: 'start_icd', stateKey: 'icd', moment: moment('STEP_EXECUTION', 'aa'), sortOrder: 30, operation: 'START', value: null, optionKey: null },
        { operationKey: 'timeout', name: 'timeout', stateKey: 'ready', moment: moment('STEP_TIMEOUT', 'aa'), sortOrder: 40, operation: 'DISABLE', value: null, optionKey: null }
      ],
      createdAt: '', updatedAt: ''
    }],
    effects: [(() => {
      const bonus = effect([{
        resultKey: 'mana', name: 'mana', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 10,
        lifecycleBehavior: null, spellShieldBlockScope: null,
        valueRule: { value: fixedValue(1), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
        detail: { attributeKey: 'mana', operation: 'RESTORE' }
      }], 'bonus');
      bonus.skillKey = skillKey;
      return bonus;
    })()],
    rules: [
      rule({
        ruleKey: 'arm', sortOrder: 10,
        eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: null, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
        conditionGroups: [{
          groupKey: 'cooldown_ready', name: '冷却就绪', sortOrder: 10,
          conditions: [
            { conditionKey: 'icd_ready', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 20, detail: { stateKey: 'icd', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null, comparator: 'EQ', comparisonValue: fixedValue(0) } }
          ]
        }],
        actions: [{ actionKey: 'start', name: 'start', actionType: 'START_PROCESS', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { processKey: 'spellblade' }, runtimeInputBindings: [], resultModifiers: [] }]
      })
    ]
  };
}
