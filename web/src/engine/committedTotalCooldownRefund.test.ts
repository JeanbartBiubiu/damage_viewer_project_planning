import { describe, expect, it } from 'vitest';
import { finiteImmediatePeriodicSample } from '../../tests/fixtures/finiteImmediatePeriodic';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import type { SkillParameter } from '../types/skillParameter';
import { createNumericCompileState } from './numericAdapter';
import { prepareSimulation } from './simulationAdapter';
import { bindCommittedTotalRefunds, committedRefundProofLevels, compileCommittedTotalRefundRule, type PendingCommittedTotalRefund } from './committedTotalCooldownRefund';

function sample() {
  const item = finiteImmediatePeriodicSample();
  const state = () => createNumericCompileState({ gameId: item.snapshot.gameId, skillKey: item.configuration.skill.skillKey,
    skillLevel: 1, characterLevel: 1, parameters: item.configuration.parameters, formulas: item.configuration.formulas,
    formulaNamespace: 'refund-test', bindParameters: false, allowAttributeReads: true, runtimeInputMessage: '禁止补运行输入' });
  return { ...item, compile: () => compileCommittedTotalRefundRule(item.snapshot, item.configuration, item.refundRule, state(), 'source', 'character') };
}
const parameter = (item: ReturnType<typeof sample>, values: Record<string, number>, mode: 'SKILL_LEVEL' | 'CHARACTER_LEVEL' = 'SKILL_LEVEL'): SkillParameter => ({
  ...item.configuration.parameters[0]!, parameterKey: 'refund_ratio', valueMode: mode, valueType: 'DECIMAL', fixedValue: null, levelValues: values });

async function boundSample() {
  const { snapshot, configuration, spell } = finiteImmediatePeriodicSample();
  const prepared = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 500, target: 1000 });
  const graph = prepared.compileRequest, parent = graph.sharedProviders!.find(row => row.skillKey === configuration.skill.skillKey && row.kind === 'character')!;
  const mount = graph.combatants.find(row => row.key === 'source')!.providers.find(row => row.definitionRef === parent.providerKey)!;
  const listener = parent.abilities!.find(row => row.listenerSpec?.operations?.some(op => op.valuePolicy === 'reduce_total_ratio'))!;
  const operation = listener.listenerSpec!.operations![0]!;
  delete operation.abilityRef;
  const pending: PendingCommittedTotalRefund = { targetSkillKey: spell.skill.skillKey, ratio: .05, effectKey: 'refund_committed_total', authorPath: 'test.refund', dormantReason: null,
    sourceSkillKey: configuration.skill.skillKey, providerRef: mount.providerRef, definitionRef: parent.providerKey,
    listenerAbilityRef: `source.provider[${mount.providerRef}].ability[${listener.abilityKey}]`, operation };
  const mounts = () => graph.combatants.flatMap(actor => actor.providers.map(row => ({ ...row, side: actor.key as 'source' | 'target' })));
  return { graph, parent, pending, listener, operation, bind: (items = [pending]) => bindCommittedTotalRefunds(items, graph.rules.skillActionBindings!, graph.sharedProviders!, mounts()) };
}

describe('按真实已提交总冷却比例返还的作者门禁', () => {
  it('显式累计上限保留，零伤资格由作者条件负责，缺省仍要求正伤害', () => {
    const item=sample(),result=item.refund.results[0]!;
    if(result.resultType!=='COOLDOWN_CHANGE'||result.detail.operation==='RESET')throw Error('fixture');
    result.detail.cumulativeLimit={groupKey:'shared_refund',maxRatio:.39};
    for(const group of item.refundRule.conditionGroups)group.conditions=group.conditions.filter(condition=>!(condition.conditionType==='EVENT_VALUE_COMPARE'&&condition.detail.eventValueKey==='POST_DEFENSE_DAMAGE'));
    expect(item.compile()?.cumulativeLimit).toEqual({groupKey:'shared_refund',maxRatio:.39});
    delete result.detail.cumulativeLimit;
    expect(item.compile).toThrow(/正防御后伤害/);
  });
  it.each(['bad_key','zero','oversize','unknown','null'] as const)('拒绝非法累计上限：%s',kind=>{
    const item=sample(),result=item.refund.results[0]!;
    if(result.resultType!=='COOLDOWN_CHANGE'||result.detail.operation==='RESET')throw Error('fixture');
    const detail: Record<string,unknown>=result.detail;
    detail.cumulativeLimit=kind==='null'?null:{groupKey:kind==='bad_key'?'Bad-Key':'valid',maxRatio:kind==='zero'?0:kind==='oversize'?1.1:.39,...(kind==='unknown'?{scope:'guess'}:{})};
    expect(item.compile).toThrow(/累计退款额度/);
  });

  it.each([0, .05, 1])('静态有限比例%s合法', ratio => {
    const item = sample(); item.refund.results[0]!.valueRule!.value = { kind: 'FIXED', value: ratio };
    expect(item.compile()?.ratio).toBe(ratio);
  });
  it.each([-.01, 1.01, NaN, Infinity])('非法比例%s不转成默认值', ratio => {
    const item = sample(); item.refund.results[0]!.valueRule!.value = { kind: 'FIXED', value: ratio };
    expect(item.compile).toThrow();
  });
  it.each(['negative_multiplier', 'nonfinite_multiplier', 'reversed_bounds', 'oversize_multiplier'] as const)('拒绝无效结果倍率/夹取：%s', kind => {
    const item = sample(), rule = item.refund.results[0]!.valueRule!;
    if (kind === 'negative_multiplier') rule.fixedMultiplier = -1;
    if (kind === 'nonfinite_multiplier') rule.fixedMultiplier = Infinity;
    if (kind === 'reversed_bounds') { rule.fixedMinValue = 1; rule.fixedMaxValue = 0; }
    if (kind === 'oversize_multiplier') rule.fixedMultiplier = 21;
    expect(item.compile).toThrow();
  });
  it('所有技能等级逐级核定，不能只取当前合法级', () => {
    const item = sample(); item.configuration.skill.maxLevel = 2;
    item.configuration.parameters.push(parameter(item, { 1: .05, 2: 1.2 }));
    item.refund.results[0]!.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'refund_ratio' };
    expect(item.compile).toThrow(/所有静态等级/);
    item.configuration.parameters.at(-1)!.levelValues!['2'] = .1;
    expect(item.compile()?.ratio).toBe(.05);
    delete item.configuration.parameters.at(-1)!.levelValues!['2'];
    expect(item.compile).toThrow(/逐级完整/);
  });
  it('实际角色等级目录完整核定，超大范围不会按max逐次循环', () => {
    const item = sample(); item.snapshot.source.attributes.maxLevel = 2;
    item.configuration.parameters.push(parameter(item, { 1: .05, 2: -.1 }, 'CHARACTER_LEVEL'));
    item.refund.results[0]!.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'refund_ratio' };
    expect(item.compile).toThrow(/所有静态等级/);
    item.snapshot.source.attributes.maxLevel = Number.MAX_SAFE_INTEGER;
    expect(item.compile).toThrow(/逐级完整/);
  });
  it('显式缺参数或运行输入不能当静态比例', () => {
    const item = sample(); item.refund.results[0]!.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'missing' };
    expect(item.compile).toThrow(/参数|静态快照/);
    item.refund.results[0]!.valueRule!.value = { kind: 'PARAMETER', parameterKey: 'settled_amount' };
    expect(item.compile).toThrow(/计算时输入/);
  });
  it('属性公式不能成为静态比例依赖', () => {
    const item = sample(), formula = structuredClone(item.spell.formulas[0]!);
    formula.skillKey = item.configuration.skill.skillKey; item.configuration.formulas.push(formula);
    item.refund.results[0]!.valueRule!.value = { kind: 'FORMULA', formulaKey: formula.formulaKey };
    expect(item.compile).toThrow(/属性、事件或实例时间/);
  });
  it.each(['off', 'zero', 'unplanned'] as const)('目标%s只排除退款，不改变作者规则', kind => {
    const item = sample(), settings = item.snapshot.selection.sourceSkillSettings.find(row => row.skillKey === item.spell.skill.skillKey)!;
    if (kind === 'off') settings.enabled = false;
    if (kind === 'zero') settings.skillLevel = 0;
    item.snapshot.selection.plannedSkills = item.snapshot.selection.plannedSkills.filter(row => row.skillKey !== item.spell.skill.skillKey);
    syncSimulationSkillSources(item.snapshot);
    const before = structuredClone(item.configuration);
    expect(item.compile()?.dormantReason).toBe(kind === 'off' ? 'SCENE_DISABLED' : kind === 'zero' ? 'UNLEARNED' : 'ACTIVE_DEFERRED');
    expect(item.configuration).toEqual(before);
  });
  it.each(['once', 'second_action', 'wrong_event', 'wrong_scope', 'missing_positive', 'positive_or_gap'] as const)('拒绝扩大事件/动作/正值范围：%s', kind => {
    const item = sample(), row = item.refund.results[0]!;
    if (kind === 'once') item.refundRule.oncePerUse = 'SOURCE_TARGET' as never;
    if (kind === 'second_action') item.refundRule.actions.push(structuredClone(item.refundRule.actions[0]!));
    if (kind === 'wrong_event') item.refundRule.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: {} };
    if (kind === 'wrong_scope' && row.resultType === 'COOLDOWN_CHANGE') row.detail.affectedSkillScope.skillKeys = ['foreign_skill'];
    if (kind === 'missing_positive') item.refundRule.conditionGroups = [];
    if (kind === 'positive_or_gap') item.refundRule.conditionGroups.push({ ...item.refundRule.conditionGroups[0]!, groupKey: 'gap', conditions: [] });
    expect(item.compile).toThrow();
  });
  it.each(['CONFIGURATION_INCOMPLETE', 'unknown_status', 'missing_level', 'deferred_but_planned'] as const)('未知或矛盾来源不得吞成未计划：%s', kind => {
    const item = sample(), source = item.snapshot.source.skillSources.find(row => row.skillKey === item.spell.skill.skillKey)!;
    if (kind === 'CONFIGURATION_INCOMPLETE') { source.inactiveReason = 'CONFIGURATION_INCOMPLETE'; item.snapshot.selection.plannedSkills = []; }
    if (kind === 'unknown_status') { source.skillStatus = 'UNKNOWN' as never; item.snapshot.selection.plannedSkills = []; }
    if (kind === 'missing_level') { source.skillLevel = null; item.snapshot.selection.plannedSkills = []; }
    if (kind === 'deferred_but_planned') source.inactiveReason = 'ACTIVE_DEFERRED';
    expect(item.compile).toThrow();
  });
  it('等级证明只遍历本金额真实依赖，不扩其它未消费参数', () => {
    const item = sample(); item.configuration.parameters.push(parameter(item, { 1: 5, 2: -100 }));
    expect(committedRefundProofLevels(item.configuration, { kind: 'FIXED', value: .05 }, 1, 1, { minLevel: 1, maxLevel: 1 })).toEqual([{ skillLevel: 1, characterLevel: 1 }]);
  });
});

describe('完整装配后按实际INITIAL末期绑定', () => {
  it('成功引用真实目标入口，监听独立于自身治疗', async () => {
    const item = await boundSample(); item.bind();
    expect(item.operation.abilityRef).toBe(item.graph.rules.skillActionBindings!.find(row => row.skillKey === item.pending.targetSkillKey)!.controls[0]!.abilityRef);
    expect(item.parent.abilities!.filter(row => row.listenerSpec)).toHaveLength(2);
  });
  it.each(['missing_binding', 'duplicate_binding', 'wrong_owner', 'missing_mount', 'duplicate_mount', 'wrong_definition', 'no_cooldown', 'wrong_process', 'not_initial', 'once', 'mixed_ops'] as const)('错实际关系硬拒绝且不发布引用：%s', async kind => {
    const item = await boundSample(), binding = item.graph.rules.skillActionBindings!.find(row => row.skillKey === item.pending.targetSkillKey)!;
    const definition = item.graph.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const actor = item.graph.combatants.find(row => row.key === 'source')!;
    if (kind === 'missing_binding') item.graph.rules.skillActionBindings = item.graph.rules.skillActionBindings!.filter(row => row !== binding);
    if (kind === 'duplicate_binding') item.graph.rules.skillActionBindings!.push(structuredClone(binding));
    if (kind === 'wrong_owner') binding.source = 'target' as never;
    if (kind === 'missing_mount') actor.providers = actor.providers.filter(row => row.definitionRef !== definition.providerKey);
    if (kind === 'duplicate_mount') actor.providers.push(structuredClone(actor.providers.find(row => row.definitionRef === definition.providerKey)!));
    if (kind === 'wrong_definition') definition.skillKey = 'other_skill';
    if (kind === 'no_cooldown') definition.processes![0]!.cooldown = null;
    if (kind === 'wrong_process') binding.controls[0]!.processKey = 'other_process';
    if (kind === 'not_initial') definition.abilities!.find(row => row.kind === 'active')!.processControl!.action = 'RECAST';
    if (kind === 'once') item.listener.listenerSpec!.oncePerUse = { key: 'bad', scope: 'source_target' } as never;
    if (kind === 'mixed_ops') item.listener.listenerSpec!.operations!.push({ operation: 'heal', target: 'self', amount: { op: 'const', value: 1 } });
    expect(item.bind).toThrow(); expect(item.operation.abilityRef).toBeUndefined();
  });
  it('后项失败不发布前项引用，装配绑定保持原子', async () => {
    const item = await boundSample();
    expect(() => item.bind([item.pending, { ...item.pending, targetSkillKey: 'missing' }])).toThrow();
    expect(item.operation.abilityRef).toBeUndefined();
  });
});
