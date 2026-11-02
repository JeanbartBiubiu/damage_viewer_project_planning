import { afterEach, describe, expect, it } from 'vitest';
import { createSiblingTargetCounterReadResolver } from './siblingTargetCounterRead';
import { siblingTargetCounterSample, siblingTargetCounterHitSample } from '../../tests/fixtures/siblingTargetCounter';
import { fixedValue, parameterValue } from '../types/numericValue';
import type { SimulationSkillInactiveReason } from '../types/simulationSnapshot';
import type { ProviderStateFieldSchema } from '../types/genericEngine';
import type { NamedFormula } from '../types/genericEngine';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { registerFormulaForApprovedReads, rememberApprovedFormulaValues, selectFormulaProofScope } from './approvedFormulaValues';
import { adaptHitProgram, type AuthoredHitProgram } from './hitAdapter';
import { assembleActiveSkills } from './simulationActiveSkills';
import { selectSimulationSkillSourceClosure } from './simulation/sources/closure';
import type { SkillTriggerInternalStateCheckCondition } from '../types/skillTriggerRule';

type Sample = ReturnType<typeof siblingTargetCounterSample>;
const read = (sample: Sample) => createSiblingTargetCounterReadResolver(sample.snapshot, sample.natural)(
  sample.requester.skill.skillKey, sample.skillKey, sample.stateKey, 'test.sibling');
const synchronize = (sample: Sample) => Object.assign(sample.natural.origins[0]!, structuredClone(sample.source));
const disable = (sample: Sample, kind: 'scene' | 'global' | 'level') => {
  if (kind === 'scene') { sample.source.enabled = false; sample.source.inactiveReason = 'SCENE_DISABLED'; }
  if (kind === 'global') {
    (sample.source as { skillStatus: string }).skillStatus = 'DISABLED'; sample.source.inactiveReason = 'GLOBAL_DISABLED';
    sample.configuration.skill.status = 'DISABLED';
    sample.snapshot.source.attachedSkills.find(row => row.skillKey === sample.skillKey)!.skillStatus = 'DISABLED';
  }
  if (kind === 'level') { sample.source.skillLevel = 0; sample.source.inactiveReason = 'UNLEARNED'; }
  synchronize(sample); sample.natural.mounts = []; sample.natural.providers = [];
};

describe('同拥有者兄弟普通目标计数的只读挂载', () => {
  afterEach(() => selectFormulaProofScope('sibling_counter_unit_cleanup', true));
  it('读取实际来源挂载，不按技能名构造引用且不改原快照/挂载', () => {
    const sample = siblingTargetCounterSample(), before = JSON.stringify(sample);
    expect(read(sample)).toEqual({ value: { op: 'read', path: 'provider.target_state.window_count' },
      participationProviderRef: sample.providerRef, definitionRef: sample.definitionRef,
      stateKey: sample.stateKey, stateSkillKey: sample.skillKey, formulas: [], inactive: false });
    expect(JSON.stringify(sample)).toBe(before);
  });

  for (const kind of ['scene', 'global', 'level'] as const) it(`${kind}明确关闭时用合法作者零默认，不创建挂载`, () => {
    const sample = siblingTargetCounterSample(); disable(sample, kind);
    expect(read(sample)).toEqual({ value: { op: 'const', value: 0 }, stateKey: sample.stateKey,
      stateSkillKey: sample.skillKey, formulas: [], inactive: true });
    expect(sample.natural.mounts).toEqual([]);
  });

  it('数值按被引用技能实际等级，不借请求方同名参数或1级', () => {
    const sample = siblingTargetCounterSample();
    Object.assign(sample.configuration.parameters[0]!, { valueMode: 'SKILL_LEVEL', fixedValue: null,
      levelValues: { '1': 2, '2': 4, '3': 6 } });
    sample.requester.parameters.push({ ...sample.configuration.parameters[0]!, skillKey: sample.requester.skill.skillKey,
      valueMode: 'FIXED', fixedValue: 99, levelValues: null });
    sample.provider.initialStateSchema[sample.stateKey]!.maxValue = 4;
    expect(read(sample).inactive).toBe(false);
    sample.provider.initialStateSchema[sample.stateKey]!.maxValue = 2;
    expect(() => read(sample)).toThrow('编译字段与作者');
  });

  it('0级不能把所需SKILL_LEVEL参数当1级，关闭来源仍先核定义', () => {
    const sample = siblingTargetCounterSample(); disable(sample, 'level');
    Object.assign(sample.configuration.parameters[0]!, { valueMode: 'SKILL_LEVEL', fixedValue: null,
      levelValues: { '1': 2, '2': 4, '3': 6 } });
    expect(() => read(sample)).toThrow('本次等级必须明确且有效');
    sample.counter.detail.initialValue = fixedValue(1);
    expect(() => read(sample)).toThrow();
  });

  it('角色等级参数使用当前实际角色等级', () => {
    const sample=siblingTargetCounterSample();sample.snapshot.selection.sourceLevel=9;
    Object.assign(sample.configuration.parameters[1]!,{valueMode:'CHARACTER_LEVEL',fixedValue:null,
      levelValues:{'1':1000,'9':9000}});
    sample.provider.initialStateSchema[sample.stateKey]!.durationMs=9000;
    expect(read(sample).inactive).toBe(false);
  });

  it('共同静态公式仅用已核定值，保留被引用技能的完整编译载荷', () => {
    const sample=siblingTargetCounterSample();
    const formula={...sample.configuration.parameters[0]!,formulaKey:'capacity_formula',
      expression:skillFormulaDefinition(sample.skillKey,{nodeType:'PARAMETER',parameterKey:'capacity'})};
    sample.configuration.formulas.push(formula);sample.counter.detail.maxValue={kind:'FORMULA',formulaKey:formula.formulaKey};
    // 此处只种入合成的已核缓存以单测装配守卫；不宣称进行了原生公式核定。
    const program:NamedFormula={key:'unit_approved_capacity',scope:'skill',skillKey:sample.skillKey,
      expression:formula.expression,parameters:[{parameterKey:'capacity',valueMode:'FIXED',valueType:'INTEGER',value:3}]};
    registerFormulaForApprovedReads(program);rememberApprovedFormulaValues([program],{unit_approved_capacity:3});
    sample.provider.initialStateSchema[sample.stateKey]!.maxValue={op:'ref',ref:program.key};
    const actual=read(sample);
    expect(actual.formulas).toHaveLength(1);
    expect(actual.formulas[0]).toMatchObject({skillKey:sample.skillKey,expression:formula.expression,parameters:program.parameters});
    expect(actual.formulas[0]!.key).toContain('/levels/2/');
  });

  it('未核定的共同公式不能自行解释或补值', () => {
    const sample=siblingTargetCounterSample();
    sample.configuration.formulas.push({...sample.configuration.parameters[0]!,formulaKey:'capacity_formula',
      expression:skillFormulaDefinition(sample.skillKey,{nodeType:'PARAMETER',parameterKey:'capacity'})});
    sample.counter.detail.maxValue={kind:'FORMULA',formulaKey:'capacity_formula'};
    expect(()=>read(sample)).toThrow('静态快照的完整依赖');
  });

  it('关闭且级数未提供时只接受无需技能等级的合法固定定义', () => {
    const sample=siblingTargetCounterSample();disable(sample,'scene');sample.source.skillLevel=null;synchronize(sample);
    expect(read(sample).value).toEqual({op:'const',value:0});
  });

  it('不从旧裸数值schema推定完整目标计数', () => {
    const sample=siblingTargetCounterSample();
    (sample.provider.initialStateSchema as Record<string,unknown>)[sample.stateKey]=0;
    expect(()=>read(sample)).toThrow('编译字段与作者');
  });

  it('本技能状态和非法标识不走兄弟只读入口', () => {
    const sample=siblingTargetCounterSample(),resolver=createSiblingTargetCounterReadResolver(sample.snapshot,sample.natural);
    expect(()=>resolver(sample.skillKey,sample.skillKey,sample.stateKey,'test')).toThrow('明确且不同');
    expect(()=>resolver(sample.requester.skill.skillKey,sample.skillKey,'not.valid','test')).toThrow('合法状态标识');
  });

  for (const inactiveReason of ['CONFIGURATION_INCOMPLETE', 'ACTIVE_DEFERRED', 'LEVEL_REQUIRED', 'NO_AUTONOMOUS_ATTACK'] satisfies SimulationSkillInactiveReason[]) {
    it(`${inactiveReason}不能当缺省零或借挂载运行`, () => {
      const sample = siblingTargetCounterSample(); sample.source.inactiveReason = inactiveReason; synchronize(sample);
      expect(() => read(sample)).toThrow('合法已学自然挂载');
      sample.source.enabled = false; synchronize(sample);
      expect(() => read(sample)).toThrow('未知或不完整来源不能当作零');
    });
  }

  const invalidIdentity: Array<[string, (sample: Sample) => void]> = [
    ['实际来源角色不一致', s => { s.snapshot.selection.sourceCharacterKey = 'other_actor'; }],
    ['关系不属于同游戏', s => { s.snapshot.source.attachedSkills.find(r => r.skillKey === s.skillKey)!.gameId = 'other'; }],
    ['关系重复', s => { s.snapshot.source.attachedSkills.push(structuredClone(s.snapshot.source.attachedSkills.find(r => r.skillKey === s.skillKey)!)); }],
    ['来源角色不符', s => { s.source.origin.characterKey = 'other_actor'; }],
    ['来源定义重复', s => { s.snapshot.skillConfigurations.push(structuredClone(s.configuration)); }],
    ['来源状态不符', s => { s.configuration.skill.status = 'DISABLED'; }],
    ['来源状态未知', s => { Object.assign(s.source, { skillStatus: 'UNKNOWN' }); }],
    ['来源开关未知', s => { Object.assign(s.source, { enabled: 1 }); }],
    ['来源级数越界', s => { s.source.skillLevel = 4; }],
    ['来源记录缺失', s => { s.natural.origins = []; }],
    ['来源记录不一致', s => { s.natural.origins[0]!.enabled = false; }],
    ['自然挂载缺失', s => { s.natural.mounts = []; }],
    ['自然挂载重复', s => { s.natural.mounts.push(structuredClone(s.natural.mounts[0]!)); }],
    ['只有另一方挂载', s => { s.natural.mounts[0]!.side = 'target'; }],
    ['挂载定义不符', s => { s.natural.mounts[0]!.definitionRef = 'wrong_definition'; }],
    ['定义缺失', s => { s.natural.providers = []; }],
    ['临时供值器', s => { s.provider.kind = 'status'; }],
    ['另一技能定义', s => { s.provider.skillKey = 'another_skill'; }],
    ['定义身份不符', s => { s.provider.stableId = 'wrong_id'; }],
    ['有期限挂载', s => { (s.provider as { lifecycle?: unknown }).lifecycle = { durationMs: { op: 'const', value: 1000 } }; }]
  ];
  for (const [name, mutate] of invalidIdentity) it(`${name}拒绝`, () => {
    const sample = siblingTargetCounterSample(); mutate(sample); expect(() => read(sample)).toThrow();
  });

  const invalidDefinition: Array<[string, (sample: Sample) => void]> = [
    ['状态缺失', s => { s.configuration.internalStates = []; }],
    ['状态重复', s => { s.configuration.internalStates.push(structuredClone(s.counter)); }],
    ['状态属于另游戏', s => { s.counter.gameId = 'other'; }],
    ['技能范围', s => { s.counter.scope = 'SKILL'; }],
    ['周期锚', s => { s.counter.detail.targetTiming = { kind: 'PHASED_TICK', processKey: 'tick', intervalValue: fixedValue(250), phasePolicy: 'PRESERVE_ON_EXTEND' }; }],
    ['预约锚', s => { s.counter.detail.targetTiming = { kind: 'EXPIRY_PAYLOAD', processKey: 'expire' }; }],
    ['动态初值', s => { s.counter.detail.initialValueBinding = { bindingKey:'initial',parameterKey:'initial',sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue: 0, maxValue: 3 } }; }],
    ['非零默认', s => { s.counter.detail.initialValue = fixedValue(1); }],
    ['负容量', s => { s.configuration.parameters[0]!.fixedValue = -1; }],
    ['小数容量', s => { s.configuration.parameters[0]!.fixedValue = .5; }],
    ['零期限', s => { s.configuration.parameters[1]!.fixedValue = 0; }],
    ['缺期限', s => { delete s.counter.detail.durationValue; }],
    ['运行输入', s => { Object.assign(s.configuration.parameters[1]!, { valueMode: 'RUNTIME_INPUT', fixedValue: null }); }],
    ['参数目录缺失', s => { s.configuration.parameters = []; }],
    ['冒用命中参数', s => { s.counter.detail.maxValue = parameterValue('unknown_capacity'); }]
  ];
  for (const [name, mutate] of invalidDefinition) it(`${name}拒绝`, () => {
    const sample = siblingTargetCounterSample(); mutate(sample); expect(() => read(sample)).toThrow();
  });

  const invalidSchema: Array<[string, (field: ProviderStateFieldSchema) => void]> = [
    ['值类型', f => { f.valueType = 'number'; }], ['默认值', f => { f.defaultValue = 1; }],
    ['容量', f => { f.maxValue = 4; }], ['期限', f => { f.durationMs = 4001; }],
    ['刷新方式', f => { f.refreshPolicy = 'start_on_first_write'; }],
    ['冷却类型', f => { f.stateKind = 'cooldown'; }], ['到期负载', f => { f.onExpire = []; }],
    ['未核公式', f => { f.maxValue = { op: 'ref', ref: 'unapproved_formula' }; }]
  ];
  for (const [name, mutate] of invalidSchema) it(`编译字段${name}不一致拒绝`, () => {
    const sample = siblingTargetCounterSample(); mutate(sample.provider.initialStateSchema[sample.stateKey]!);
    expect(() => read(sample)).toThrow('编译字段与作者');
  });

  it('合法关闭来源仍不能藏已有实际挂载', () => {
    const sample = siblingTargetCounterSample(); sample.source.enabled = false; sample.source.inactiveReason = 'SCENE_DISABLED'; synchronize(sample);
    expect(() => read(sample)).toThrow('关闭或未学来源必须明确未挂载');
  });

  for (const kind of ['unplanned', 'not_learned', 'no_active_process', 'basic_attack'] as const) it(`请求方${kind}不能获得只读授权`, () => {
    const sample = siblingTargetCounterSample();
    if (kind === 'unplanned') sample.snapshot.selection.plannedSkills = [];
    if (kind === 'not_learned') sample.snapshot.source.skillSources.find(s => s.skillKey === sample.requester.skill.skillKey)!.skillLevel = 0;
    if (kind === 'no_active_process') sample.requester.processes[0]!.activationType = 'PASSIVE';
    if (kind === 'basic_attack') sample.snapshot.selection.basicAttackSkillKey = sample.requester.skill.skillKey;
    expect(() => read(sample)).toThrow('真实已计划且已学');
  });
});

type HitSample = ReturnType<typeof siblingTargetCounterHitSample>;
const hitCondition = (sample: HitSample, index = 0) => sample.rules[index]!.conditionGroups[0]!.conditions[0]! as SkillTriggerInternalStateCheckCondition;
const authoredHit = (sample: HitSample, withResolver = true): AuthoredHitProgram => ({
  gameId: sample.snapshot.gameId, skillKey: sample.requester.skill.skillKey, skillLevel: 1,
  characterLevel: sample.snapshot.selection.sourceLevel, rules: sample.rules, effects: sample.requester.effects,
  parameters: sample.requester.parameters, formulas: sample.requester.formulas, internalStates: sample.requester.internalStates,
  statuses: sample.snapshot.catalogs.statuses, skillCategoryKeys: sample.requester.skill.skillCategoryKeys,
  vampRules: sample.snapshot.catalogs.vampRules.rules,
  identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
  ...(withResolver ? { siblingTargetCounterRead: createSiblingTargetCounterReadResolver(sample.snapshot, sample.natural) } : {})
});

describe('兄弟目标计数的实际命中和主动接线', () => {
  afterEach(() => selectFormulaProofScope('sibling_counter_unit_cleanup', true));

  it('两个互斥伤害候选保留作者数值、真实挂载和法盾资格，不生成状态写入', () => {
    const sample = siblingTargetCounterHitSample(), before = JSON.stringify(sample);
    const hit = adaptHitProgram(authoredHit(sample));
    expect(hit.skillHit.candidates).toHaveLength(2);
    for (const [index, comparator, amount] of [[0, 'eq', 100], [1, 'gt', 125]] as const) {
      expect(hit.skillHit.candidates[index]).toMatchObject({ effectKey: sample.rules[index]!.ruleKey,
        participationProviderRef: sample.providerRef, spellShieldBlockScope: 'SKILL',
        participationCondition: { op: comparator, args: [{ op: 'read', path: 'provider.target_state.window_count' }, { op: 'const', value: 0 }] },
        operations: [{ operation: 'damage', amount: { op: 'const', value: amount } }] });
    }
    expect(JSON.stringify(hit)).not.toContain('state_change');
    expect(JSON.stringify(sample)).toBe(before);
  });

  for (const kind of ['scene', 'global', 'level'] as const) it(`${kind}关闭来源仍保留正常伤害分支，两个条件都明确比较零`, () => {
    const sample = siblingTargetCounterHitSample(); disable(sample, kind);
    const candidates = adaptHitProgram(authoredHit(sample)).skillHit.candidates;
    expect(candidates.map(candidate => candidate.participationProviderRef)).toEqual([undefined, undefined]);
    expect(candidates.map(candidate => candidate.participationCondition)).toEqual([
      { op: 'eq', args: [{ op: 'const', value: 0 }, { op: 'const', value: 0 }] },
      { op: 'gt', args: [{ op: 'const', value: 0 }, { op: 'const', value: 0 }] }
    ]);
    expect(candidates[0]!.operations[0]).toMatchObject({ operation: 'damage', amount: { op: 'const', value: 100 } });
  });

  it('第五个真实自然上下文进入主动命中，旧调用对外部读取仍严格拒绝', () => {
    const sample = siblingTargetCounterHitSample();
    expect(() => assembleActiveSkills(sample.snapshot)).toThrow('明确只读当前值比较');
    const actual = assembleActiveSkills(sample.snapshot, [], undefined, [], sample.natural);
    const operations = actual.providers.flatMap(provider => provider.abilities?.flatMap(ability => ability.operations ?? []) ?? []);
    const hit = operations.find(operation => operation.operation === 'resolve_skill_hit')!.skillHit!;
    expect(hit.candidates.map(candidate => candidate.participationProviderRef)).toEqual([sample.providerRef, sample.providerRef]);
    expect(actual.operationOrigins.map(origin => origin.skillKey)).toEqual([sample.requester.skill.skillKey, sample.requester.skill.skillKey]);
    expect(actual.operationOrigins.map(origin => origin.effectKey)).toEqual(['plain_hit', 'boost_hit']);
    expect(actual.providers.some(provider => provider.providerKey === sample.definitionRef)).toBe(false);
  });

  it('已有无外部读取的旧主动调用保持可用', () => {
    const sample = siblingTargetCounterHitSample();
    for (const rule of sample.rules) rule.conditionGroups = [];
    expect(assembleActiveSkills(sample.snapshot).bindings).toHaveLength(1);
  });

  it('外部状态静态公式的完整原作者载荷进入最终命中编译集合', () => {
    const sample = siblingTargetCounterHitSample();
    const formula = { ...sample.configuration.parameters[0]!, formulaKey: 'capacity_formula',
      expression: skillFormulaDefinition(sample.skillKey, { nodeType: 'PARAMETER', parameterKey: 'capacity' }) };
    sample.configuration.formulas.push(formula); sample.counter.detail.maxValue = { kind: 'FORMULA', formulaKey: formula.formulaKey };
    const program: NamedFormula = { key: 'unit_approved_capacity_hit', scope: 'skill', skillKey: sample.skillKey,
      expression: formula.expression, parameters: [{ parameterKey: 'capacity', valueMode: 'FIXED', valueType: 'INTEGER', value: 3 }] };
    // 单测只验证已核公式载荷接线；固定机制用例另走真实原生预检和运行。
    registerFormulaForApprovedReads(program); rememberApprovedFormulaValues([program], { unit_approved_capacity_hit: 3 });
    sample.provider.initialStateSchema[sample.stateKey]!.maxValue = { op: 'ref', ref: program.key };
    const hit = adaptHitProgram(authoredHit(sample));
    expect(hit.formulas).toHaveLength(1);
    expect(hit.formulas[0]).toMatchObject({ scope: 'skill', skillKey: sample.skillKey,
      expression: formula.expression, parameters: program.parameters });
    expect(hit.formulas[0]!.key).toContain('/levels/2/');
    expect(hit.params).toEqual({});
  });

  it('身份和公共命中值条件可组合，命中值仍保留在原条件层', () => {
    const sample = siblingTargetCounterHitSample();
    for (const rule of sample.rules) rule.conditionGroups[0]!.conditions.push(
      { conditionKey: 'enemy', sortOrder: 1, conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', detail: {} },
      { conditionKey: 'not_blocked', sortOrder: 2, conditionType: 'EVENT_VALUE_COMPARE',
        detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue: fixedValue(0) } }
    );
    for (const candidate of adaptHitProgram(authoredHit(sample)).skillHit.candidates) {
      expect(candidate.participationProviderRef).toBe(sample.providerRef);
      expect(candidate.participationCondition!.op).toBe('min');
      expect(candidate.eventValueConditions).toEqual([{ key: 'blocked', comparator: 'eq', value: { op: 'const', value: 0 } }]);
    }
  });

  it('右值使用命中方实际等级参数，不能借被读技能同名参数', () => {
    const sample = siblingTargetCounterHitSample();
    sample.requester.skill.maxLevel = 3;
    sample.snapshot.selection.plannedSkills[0]!.skillLevel = 2;
    sample.snapshot.source.skillSources.find(source => source.skillKey === sample.requester.skill.skillKey)!.skillLevel = 2;
    sample.requester.parameters.push({ ...sample.configuration.parameters[0]!, skillKey: sample.requester.skill.skillKey,
      parameterKey: 'threshold', valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 1, '2': 2, '3': 3 } });
    sample.configuration.parameters.push({ ...sample.configuration.parameters[0]!, parameterKey: 'threshold', fixedValue: 99 });
    hitCondition(sample).detail.comparisonValue = parameterValue('threshold');
    const authored = authoredHit(sample); authored.skillLevel = 2;
    expect(adaptHitProgram(authored).skillHit.candidates[0]!.participationCondition).toEqual({ op: 'eq', args: [
      { op: 'read', path: 'provider.target_state.window_count' }, { op: 'const', value: 2 }
    ] });
    sample.requester.parameters = [];
    expect(() => adaptHitProgram(authoredHit(sample))).toThrow();
  });

  for (const amount of [-1, .5]) it(`右值门槛${amount}不是非负整数时拒绝`, () => {
    const sample = siblingTargetCounterHitSample(); hitCondition(sample).detail.comparisonValue = fixedValue(amount);
    expect(() => adaptHitProgram(authoredHit(sample))).toThrow('非负整数');
  });

  it('一个候选混合自身状态或第二个外部来源均拒绝', () => {
    const sample = siblingTargetCounterHitSample(), first = hitCondition(sample);
    const second = structuredClone(first); second.conditionKey = 'second';
    sample.rules[0]!.conditionGroups[0]!.conditions.push(second);
    second.detail.stateSkillKey = sample.requester.skill.skillKey;
    expect(() => adaptHitProgram(authoredHit(sample))).toThrow('不能混合');
    second.detail.stateSkillKey = 'another_window';
    expect(() => adaptHitProgram(authoredHit(sample))).toThrow('不能混合');
  });

  for (const kind of ['missing_resolver', 'generic_hit', 'basic_hit'] as const) it(`${kind}不能得到外部计数授权`, () => {
    const sample = siblingTargetCounterHitSample();
    if (kind === 'generic_hit') sample.rules[0]!.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } };
    if (kind === 'basic_hit') for (const rule of sample.rules) rule.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    expect(() => adaptHitProgram(authoredHit(sample, kind !== 'missing_resolver'))).toThrow('明确只读当前值比较');
  });

  it('条件节点夹带动态绑定或未知字段不能被只读分支静默忽略', () => {
    const sample = siblingTargetCounterHitSample();
    Object.assign(hitCondition(sample), { runtimeInputBindings: [] });
    expect(() => adaptHitProgram(authoredHit(sample))).toThrow('明确只读当前值比较');
    expect(() => selectSimulationSkillSourceClosure(sample.requester, [sample.rules[0]!.ruleKey])).toThrow('明确普通目标计数只读条件');
  });
});

describe('兄弟计数只读条件的执行闭包边界', () => {
  it('只保留本技能实际执行和右值数值依赖，外部状态不会被加入或索取', () => {
    const sample = siblingTargetCounterHitSample();
    sample.requester.parameters.push({ ...sample.configuration.parameters[0]!, skillKey: sample.requester.skill.skillKey,
      parameterKey: 'threshold', fixedValue: 1 });
    hitCondition(sample).detail.comparisonValue = parameterValue('threshold');
    const before = JSON.stringify(sample.requester);
    const closure = selectSimulationSkillSourceClosure(sample.requester, sample.requester.triggerRules.map(rule => rule.ruleKey));
    expect(closure.configuration.internalStates).toEqual([]);
    expect(closure.configuration.parameters.map(parameter => parameter.parameterKey)).toEqual(['threshold']);
    expect(closure.configuration.effects.map(effect => effect.effectKey)).toEqual(['plain_hit', 'boost_hit']);
    expect(closure.configuration.processes.map(process => process.processKey)).toEqual(['cast']);
    expect(JSON.stringify(sample.requester)).toBe(before);
  });

  for (const event of ['generic_hit', 'basic_hit', 'initialized'] as const) it(`${event}上的外部状态条件仍拒绝`, () => {
    const sample = siblingTargetCounterHitSample();
    if (event === 'generic_hit') sample.rules[0]!.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } };
    if (event === 'basic_hit') sample.rules[0]!.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    if (event === 'initialized') sample.rules[0]!.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
    expect(() => selectSimulationSkillSourceClosure(sample.requester, [sample.rules[0]!.ruleKey])).toThrow('实际自身技能命中');
  });

  it('自身命中上的跨技能写入仍拒绝', () => {
    const sample = siblingTargetCounterHitSample();
    sample.rules[0]!.actions.push({ actionKey: 'write_other', name: '非法跨写', sortOrder: 1,
      actionType: 'MODIFY_INTERNAL_STATE', targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [],
      detail: { stateSkillKey: sample.skillKey, stateKey: sample.stateKey, operation: 'ENSURE_REMAINING', value: fixedValue(1) } });
    expect(() => selectSimulationSkillSourceClosure(sample.requester, [sample.rules[0]!.ruleKey])).toThrow('跨技能执行');
  });

  it('右值或动作动态绑定中的外部状态仍拒绝', () => {
    const sample = siblingTargetCounterHitSample();
    const binding = { bindingKey: 'external', parameterKey: 'external', sourceType: 'INTERNAL_STATE',
      detail: { stateSkillKey: sample.skillKey, stateKey: sample.stateKey } };
    (sample.rules[0]!.actions[0]!.runtimeInputBindings as unknown[]).push(binding);
    expect(() => selectSimulationSkillSourceClosure(sample.requester, [sample.rules[0]!.ruleKey])).toThrow('跨技能执行');
  });
});
