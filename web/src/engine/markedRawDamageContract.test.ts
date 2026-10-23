import { describe, expect, it } from 'vitest';
import baseCase from '../../tests/mechanisms/cases/attack_start_counter_initial_0.json';
import baseCatalog from '../../tests/mechanisms/catalogs/mechanism_lab.json';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerAction, SkillTriggerRuleDetail, SkillTriggerCondition } from '../types/skillTriggerRule';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { validateMarkedRawDamageContract } from './markedRawDamageContract';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { NumericAdaptationError } from './numericAdapter';

function sample() {
  const snapshot = { gameId: baseCatalog.gameId, ...structuredClone(baseCase.snapshot), catalogs: structuredClone(baseCatalog.catalogs),
    snapshotDigest: 'sample', readAt: '' } as unknown as SimulationSnapshot;
  const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_counter')!;
  const common = { gameId: snapshot.gameId, skillKey: config.skill.skillKey, createdAt: '', updatedAt: '', description: null };
  const owner = config.skill.skillKey;
  const parameters: SkillConfiguration['parameters'] = [
    { ...common, parameterKey: 'mark_duration', name: '期限', sortOrder: 0, valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 3000, levelValues: null },
    { ...common, parameterKey: 'raw_amount', name: '原额', sortOrder: 1, valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null },
    { ...common, parameterKey: 'ratio', name: '比例', sortOrder: 2, valueMode: 'FIXED', valueType: 'DECIMAL', fixedValue: 0.1, levelValues: null }
  ];
  config.parameters = parameters;
  config.formulas = [{ ...common, formulaKey: 'amount', name: '原额乘比例', sortOrder: 0, expression: { inputs: [
    { key: 'ratio', binding: { kind: 'parameter', skillKey: owner, parameterKey: 'ratio' } },
    { key: 'raw', binding: { kind: 'parameter', skillKey: owner, parameterKey: 'raw_amount' } }
  ], stages: [{ key: 'output', name: '输出', expression: { op: 'mul', args: [{ op: 'read', inputKey: 'ratio' }, { op: 'read', inputKey: 'raw' }] } }], outputStageKey: 'output' } }];
  config.internalStates = [{ ...common, stateKey: 'mark', name: '本目标标记', sortOrder: 0, stateType: 'COUNTER', scope: 'TARGET',
    detail: { initialValue: { kind: 'FIXED', value: 0 }, maxValue: { kind: 'FIXED', value: 1 }, durationValue: { kind: 'PARAMETER', parameterKey: 'mark_duration' } } }];
  config.processes = [{ ...common, processKey: 'mark_now', name: '标记置1', sortOrder: 0, activationType: 'PASSIVE', cooldown: null,
    steps: [{ stepKey: 'now', name: '即时', description: null, sortOrder: 0, stepType: 'IMMEDIATE', occupiesAction: false, detail: {} }], effectBindings: [], stateOperations: [{
      operationKey: 'write', name: '置1', sortOrder: 0, stateSkillKey: owner, stateKey: 'mark', operation: 'SET', optionKey: null,
      moment: { momentType: 'STEP_EXECUTION', stepKey: 'now', failureReason: null }, value: { kind: 'FIXED', value: 1 }
    }] }];
  config.effects = [{ ...common, effectKey: 'derived', name: '单真伤', sortOrder: 0, lifecycle: null, results: [{ resultKey: 'damage', name: '真伤', description: null,
    sortOrder: 0, resultType: 'DAMAGE', target: 'TARGET', lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value: { kind: 'FORMULA', formulaKey: 'amount' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { damageTypeKey: 'true', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] }
  }] }];
  const before = (comparator: 'EQ' | 'GTE', value: number): SkillTriggerCondition => ({ conditionKey: 'before', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 0,
    detail: { stateSkillKey: owner, stateKey: 'mark', valueKind: 'DAMAGE_BEFORE_VALUE', optionKey: null, expectedBoolean: null,
      comparator, comparisonValue: { kind: 'FIXED', value } } });
  const start = (): SkillTriggerAction => ({ actionKey: 'mark', name: '标记', actionType: 'START_PROCESS', sortOrder: 0,
    detail: { processKey: 'mark_now' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] });
  const rule = (ruleKey: string, eventSource: SkillTriggerRuleDetail['eventSource'], conditions: SkillTriggerCondition[], action: SkillTriggerAction, sortOrder: number): SkillTriggerRuleDetail => ({
    ruleKey, name: ruleKey, description: null, sortOrder, eventSource, conditionGroups: [{ groupKey: 'qualified', name: '资格', sortOrder: 0, conditions }],
    actions: [action], oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null
  });
  config.triggerRules = [
    rule('primary', { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey: 'lab_basic_attack', damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT' } }, [before('GTE', 0)], start(), 0),
    rule('r_mark', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'lab_r' } }, [
      { conditionKey: 'enemy', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 0, detail: {} },
      { conditionKey: 'unblocked', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1, detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 0 } } }
    ], start(), 1),
    rule('raw', { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey: null, damageTypeKey: 'magic', deliveryKind: 'ANY', originKind: 'ANY' } }, [before('EQ', 1)], {
      actionKey: 'derive', name: '原额派生', actionType: 'EXECUTE_EFFECT', sortOrder: 0, detail: { effectKey: 'derived' }, targetContext: 'CURRENT_TARGET', resultModifiers: [],
      runtimeInputBindings: [{ bindingKey: 'raw', parameterKey: 'raw_amount', sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'RAW_DAMAGE' } }]
    }, 2),
    rule('w_refresh', { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey: 'lab_w', damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'ANY' } }, [before('EQ', 1)], start(), 3)
  ];
  for (const key of ['lab_r', 'lab_w']) snapshot.skillConfigurations.push({ ...structuredClone(config), skill: { ...config.skill, skillKey: key },
    effects: [], processes: [], internalStates: [], triggerRules: [], formulas: [], parameters: [] });
  const validate = () => validateMarkedRawDamageContract(snapshot, config, 'contract');
  return { snapshot, config, validate };
}

describe('完整标记原额派生图的只读合同', () => {
  it('提取四条真实规则和作者对象，不改写完整配置或读取actor默认值', () => {
    const { snapshot, config, validate } = sample(), before = structuredClone(snapshot);
    const contract = validate();
    expect(contract).toMatchObject({ parameterKey: 'raw_amount', primarySkillKey: 'lab_basic_attack', rSkillKey: 'lab_r', wSkillKey: 'lab_w', durationMs: 3000 });
    expect(snapshot).toEqual(before);
    expect(contract).toBeDefined();
    void config;
  });

  it('没有RAW绑定的旧配置完全不进入新识别', () => {
    const { snapshot, config } = sample(); config.triggerRules = [];
    expect(validateMarkedRawDamageContract(snapshot, config, 'contract')).toBeUndefined();
  });

  it('按实际real目录验证完整五阶段常量公式，保留抗性与穿透的零值说明阶段', () => {
    const { snapshot, config, validate } = sample();
    const row = snapshot.catalogs.damageTypes.find(item => item.type.damageTypeKey === 'true')!;
    row.type.damageTypeKey = 'real';
    row.formula.damageTypeKey = 'real';
    Object.assign(config.effects[0]!.results[0]!.detail, { damageTypeKey: 'real' });
    row.formula.formula = { inputs: [], stages: [
      { key: 'resistanceBeforePenetration', name: '穿透前抗性', expression: { op: 'const', value: '0' } },
      { key: 'penetrationPercent', name: '比例穿透', expression: { op: 'const', value: '0' } },
      { key: 'penetrationFlat', name: '固定穿透', expression: { op: 'const', value: '0' } },
      { key: 'effectiveResistance', name: '有效抗性', expression: { op: 'const', value: '0' } },
      { key: 'resistanceFactor', name: '结算倍率', expression: { op: 'const', value: '1' } }
    ], outputStageKey: 'resistanceFactor' };
    const before = structuredClone(snapshot);
    expect(validate()?.trueDamageTypeKey).toBe('real');
    expect(snapshot).toEqual(before);
  });

  it('输出恒为1也不能夹带未使用的计算阶段', () => {
    const { snapshot, validate } = sample();
    snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'true')!.formula.formula.stages.push({
      key: 'unused', name: '未使用的计算', expression: { op: 'add', args: [{ op: 'const', value: '0' }, { op: 'const', value: '1' }] }
    });
    expect(validate).toThrow(NumericAdaptationError);
  });

  it('直接消费固定机制原配置的实际条件组，不要求不存在的描述字段', () => {
    const actual = loadMechanismCases().find(row => row.caseKey === 'marked_raw_primary_then_magic')!.buildSnapshot();
    const config = actual.skillConfigurations.find(row => row.triggerRules.some(rule => rule.actions.some(action => action.runtimeInputBindings.some(binding => binding.sourceType === 'EVENT_VALUE' && binding.detail.eventValueKey === 'RAW_DAMAGE'))))!;
    const contract = validateMarkedRawDamageContract(actual, config, 'actual');
    expect(contract?.magicRule).toBe(config.triggerRules.find(rule => rule.ruleKey === contract?.magicRule.ruleKey));
    expect(contract?.durationMs).toBe(3000);
  });

  it('允许保留不参与本笔金额的原有参数和公式，也不索取其运行输入', () => {
    const { config, validate } = sample();
    config.parameters.push({ ...config.parameters[1]!, parameterKey: 'unused_input' });
    config.formulas.push({ ...config.formulas[0]!, formulaKey: 'unused_formula', expression: { inputs: [],
      stages: [{ key: 'unused', name: '未执行', expression: { op: 'const', value: '2' } }], outputStageKey: 'unused' } });
    expect(validate()?.parameterKey).toBe('raw_amount');
  });

  it('只接受完整快照原定义，不使用入口裁剪后的近似图', () => {
    const { snapshot, config } = sample(), clipped = structuredClone(config);
    clipped.triggerRules.splice(0, 1);
    expect(() => validateMarkedRawDamageContract(snapshot, clipped, 'clipped')).toThrow(NumericAdaptationError);
  });

  const invalid: [string, (value: ReturnType<typeof sample>) => void][] = [
    ['多余规则', ({ config }) => config.triggerRules.push({ ...structuredClone(config.triggerRules[0]!), ruleKey: 'extra' })],
    ['多余效果', ({ config }) => config.effects.push({ ...structuredClone(config.effects[0]!), effectKey: 'extra' })],
    ['多余状态', ({ config }) => config.internalStates.push({ ...structuredClone(config.internalStates[0]!), stateKey: 'extra' })],
    ['多余过程', ({ config }) => config.processes.push({ ...structuredClone(config.processes[0]!), processKey: 'extra' })],
    ['缺标记规则', ({ config }) => config.triggerRules.splice(0, 1)],
    ['非目标状态', ({ config }) => { config.internalStates[0]!.scope = 'SKILL'; }],
    ['初始非零', ({ config }) => Object.assign(config.internalStates[0]!.detail, { initialValue: { kind: 'FIXED', value: 1 } })],
    ['额度非一', ({ config }) => Object.assign(config.internalStates[0]!.detail, { maxValue: { kind: 'FIXED', value: 2 } })],
    ['初始动态绑定', ({ config }) => Object.assign(config.internalStates[0]!.detail, { initialValueBinding: {} })],
    ['期限为零', ({ config }) => { config.parameters[0]!.fixedValue = 0; }],
    ['被动占用行动', ({ config }) => { config.processes[0]!.steps[0]!.occupiesAction = true; }],
    ['错误状态写者', ({ config }) => { config.processes[0]!.stateOperations[0]!.stateSkillKey = 'lab_r'; }],
    ['错误执行时点', ({ config }) => { config.processes[0]!.stateOperations[0]!.moment.momentType = 'PROCESS_START'; }],
    ['写入值为零', ({ config }) => { config.processes[0]!.stateOperations[0]!.value = { kind: 'FIXED', value: 0 }; }],
    ['PRIMARY非DIRECT', ({ config }) => Object.assign(config.triggerRules[0]!.eventSource.detail, { originKind: 'INDIRECT' })],
    ['PRIMARY读取活值', ({ config }) => Object.assign(config.triggerRules[0]!.conditionGroups[0]!.conditions[0]!.detail, { valueKind: 'VALUE' })],
    ['派生读取活值', ({ config }) => Object.assign(config.triggerRules[2]!.conditionGroups[0]!.conditions[0]!.detail, { valueKind: 'VALUE' })],
    ['续期允许未挂标', ({ config }) => Object.assign(config.triggerRules[3]!.conditionGroups[0]!.conditions[0]!.detail, { comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: 0 } })],
    ['R缺法盾资格', ({ config }) => config.triggerRules[1]!.conditionGroups[0]!.conditions.splice(1, 1)],
    ['R冒用旧接触', ({ config }) => Object.assign(config.triggerRules[1]!.conditionGroups[0]!.conditions[1]!.detail, { eventValueKey: 'SKILL_HIT_FIRST_CONTACT' })],
    ['R缺敌方资格', ({ config }) => config.triggerRules[1]!.conditionGroups[0]!.conditions.splice(0, 1)],
    ['额外条件组', ({ config }) => config.triggerRules[1]!.conditionGroups.push(structuredClone(config.triggerRules[1]!.conditionGroups[0]!))],
    ['额外RAW动作', ({ config }) => config.triggerRules[2]!.actions.push(structuredClone(config.triggerRules[2]!.actions[0]!))],
    ['RAW错目标', ({ config }) => { config.triggerRules[2]!.actions[0]!.targetContext = 'EVENT_SOURCE'; }],
    ['RAW参数带默认', ({ config }) => { config.parameters[1]!.fixedValue = 0; }],
    ['RAW混用POST', ({ config }) => { const action = config.triggerRules[2]!.actions[0]!; Object.assign(action, { runtimeInputBindings: [...action.runtimeInputBindings,
      { bindingKey: 'post', parameterKey: 'raw_amount', sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'POST_DEFENSE_DAMAGE' } }] }); }],
    ['比例为负', ({ config }) => { config.parameters[2]!.fixedValue = -0.1; }],
    ['比例动态输入', ({ config }) => { config.parameters[2]!.valueMode = 'RUNTIME_INPUT'; config.parameters[2]!.fixedValue = null; }],
    ['外部定义缺失', ({ snapshot }) => { snapshot.skillConfigurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey !== 'lab_w'); }],
    ['外部定义禁用', ({ snapshot }) => { snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_w')!.skill.status = 'DISABLED'; }],
    ['外部定义重复', ({ snapshot }) => { snapshot.skillConfigurations.push(structuredClone(snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_w')!)); }],
    ['目录禁用', ({ snapshot }) => { snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'true')!.type.status = 'DISABLED'; }],
    ['目录重复', ({ snapshot }) => { snapshot.catalogs.damageTypes.push(structuredClone(snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'true')!)); }],
    ['真伤系数非一', ({ snapshot }) => { snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'true')!.formula.formula.stages[0]!.expression = { op: 'const', value: '0.5' }; }],
    ['真伤冒用抗性公式', ({ snapshot }) => { snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'true')!.formula.formula = structuredClone(snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === 'magic')!.formula.formula); }],
    ['派生伤害递归', ({ config }) => Object.assign(config.effects[0]!.results[0]!.detail, { damageTypeKey: 'magic' })],
    ['结果增加法盾资格', ({ config }) => { config.effects[0]!.results[0]!.spellShieldBlockScope = 'SKILL'; }]
  ];
  it.each(invalid)('拒绝不闭合拓扑：%s', (_name, mutate) => {
    const value = sample(); mutate(value);
    expect(value.validate).toThrow(NumericAdaptationError);
  });
});
