import { describe, expect, it } from 'vitest';
import { targetTimingSample } from '../../tests/fixtures/targetTiming';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { fixedValue } from '../types/numericValue';
import { assembleTriggeredSkillSources } from './simulationTriggeredEquipment';
import { assembleNaturalSkillSources } from './simulationNaturalSkillSources';
import { naturalRuleKeys } from './simulationSkillSourceDescription';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import { inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';

type Sample = ReturnType<typeof targetTimingSample>;
function assemble(sample: Sample) {
  approveSnapshotFixture(sample.snapshot);
  return assembleTriggeredSkillSources(sample.snapshot, [sample.description]);
}
function attributes(sample: Sample) {
  const values: Record<'source' | 'target', Record<string, number>> = { source: {}, target: {} };
  for (const row of inspectSimulationSnapshot(sample.snapshot).requirements) if (row.storedValue === undefined) values[row.side][row.attribute.attributeKey] = 0;
  return values;
}
const provider = (sample: Sample) => assemble(sample).providers.find(row => row.skillKey === 'lab_timing')!;

describe('有界目标时序的生产宿主装配', () => {
  it('真实DTO省略过程失败原因时与显式null装配相同，明确失败原因仍拒绝', () => {
    const raw=targetTimingSample();
    for(const process of raw.configuration.processes) {
      for(const row of [...process.effectBindings,...process.stateOperations]) {
        delete (row.moment as unknown as {failureReason?:string|null}).failureReason;
      }
    }
    if(raw.tail.eventSource.eventType!=='PROCESS_MOMENT')throw new Error('missing synthetic tail');
    delete (raw.tail.eventSource.detail.moment as unknown as {failureReason?:string|null}).failureReason;
    expect(assemble(raw)).toEqual(assemble(targetTimingSample()));
    raw.tick.effectBindings[0]!.moment.failureReason='ACTIVE_CANCELLED';
    expect(()=>assemble(raw)).toThrow(/时序过程/);
  });

  it('三个独立周期与一个预约属于同一真实挂载，周期每锚只有一笔无条件完整伤害', () => {
    const sample = targetTimingSample();
    const before = structuredClone(sample.snapshot);
    const result = assemble(sample);
    const current = result.providers.find(row => row.skillKey === 'lab_timing')!;
    const ticks = current.abilities!.filter(row => row.tickSpec);
    expect(ticks).toHaveLength(3);
    expect(ticks.map(row => row.tickSpec!.anchorStateKey)).toEqual(['phase_a', 'phase_b', 'phase_c']);
    for (const tick of ticks) {
      expect(tick.skillKey).toBe('lab_timing');
      expect(tick.types).toContain('ability/skill_category/passive');
      expect(tick.tickSpec).toMatchObject({ intervalMs: 250, startDelayMs: 0,
        anchorScope: 'state_scope/provider_target', phasePolicy: 'preserve_on_extend' });
      expect(tick.tickSpec!.onTick).toHaveLength(1);
      expect(tick.tickSpec!.onTick[0]).toMatchObject({ operation: 'damage', target: 'target', critEligible: false });
      expect(tick.tickSpec!.onTick[0]).not.toHaveProperty('condition');
    }
    expect(current.abilities!.filter(row => row.targetExpirySpec)).toHaveLength(1);
    expect(Object.values(current.initialStateSchema!).every(row => row.defaultValue === 0)).toBe(true);
    expect(current.initialStateSchema!.layer_count!.maxValue).toBe(3);
    expect(result.mounts.filter(row => row.definitionRef === current.providerKey)).toHaveLength(1);
    expect(sample.snapshot).toEqual(before);
    expect(assemble(sample)).toEqual(result);
  });

  it('预约恰好8条作者叶，清旧层、真实伤害、限制和两条同条件存活重挂保持顺序', () => {
    const sample = targetTimingSample();
    const expiry = provider(sample).abilities!.find(row => row.targetExpirySpec)!;
    expect(expiry.kind).toBe('stateful');
    expect(expiry.targetExpirySpec).toMatchObject({ anchorScope: 'state_scope/provider_target', anchorStateKey: 'reservation' });
    const ops = expiry.targetExpirySpec!.onExpire;
    expect(ops).toHaveLength(8);
    expect(ops.map(row => row.operation)).toEqual(['state_change', 'state_change', 'state_change', 'state_change', 'damage', 'state_change', 'state_change', 'state_change']);
    expect(ops.slice(0, 4).map(row => [row.ref, row.valuePolicy, row.amount])).toEqual([
      ['phase_a', 'set', { op: 'const', value: 0 }], ['phase_b', 'set', { op: 'const', value: 0 }],
      ['phase_c', 'set', { op: 'const', value: 0 }], ['layer_count', 'set', { op: 'const', value: 0 }]
    ]);
    expect(ops[5]).toMatchObject({ ref: 'restriction', amount: { op: 'const', value: 1 } });
    expect(ops[6]!.condition).toEqual(ops[7]!.condition);
    expect(JSON.stringify(ops[6]!.condition)).toContain('target.attr.hp.current');
    expect(ops[6]).toMatchObject({ ref: 'phase_a', amount: { op: 'const', value: 1 } });
    expect(ops[7]).toMatchObject({ ref: 'layer_count', amount: { op: 'const', value: 1 } });
    expect(ops.slice(0, 6).every(row => row.condition === undefined)).toBe(true);
  });

  it('未阻挡的真实计划技能命中降低为三个保相位续期，逐伤条件读取自身普通目标计数前值', () => {
    const sample = targetTimingSample();
    const current = provider(sample);
    const hit = current.abilities!.find(row => row.abilityKey === 'apply_on_hit')!;
    expect(hit.listenerSpec!.eventMatcher.all).toContain('ability/skill/sample_active');
    const durations = hit.listenerSpec!.operations.filter(row => row.operation === 'state_duration_change');
    expect(durations).toHaveLength(3);
    expect(durations.map(row => row.ref)).toEqual(['phase_a', 'phase_b', 'phase_c']);
    expect(durations.every(row => row.valuePolicy === 'ensure_remaining_preserve_phase')).toBe(true);
    expect(durations.every(row => JSON.stringify(row.amount) === JSON.stringify({ op: 'const', value: 4000 }))).toBe(true);
    const terminal = current.abilities!.find(row => row.abilityKey === 'terminal_before_state')!;
    expect(terminal.listenerSpec!.eventMatcher.all).toEqual(expect.arrayContaining(['event/damage_instance', 'event/source_owner']));
    expect(JSON.stringify(terminal.listenerSpec!.condition)).toContain('event.provider_target_state_before.layer_count');
    expect(JSON.stringify(terminal.listenerSpec!.condition)).not.toContain('provider.target_state.layer_count');
  });

  it('自然闭包显式保留计时过程、间隔参数、伤害公式和存活尾规则，没有P主动计划', () => {
    const sample = targetTimingSample();
    const roots = naturalRuleKeys(sample.snapshot, sample.configuration, 'source');
    expect(roots).toEqual(['apply_on_hit', 'terminal_before_state']);
    const closure = selectSimulationSkillSourceClosure(sample.configuration, roots).configuration;
    expect(closure.processes.map(row => row.processKey).sort()).toEqual(['apply_windows', 'detonate', 'one_tick', 'reapply', 'terminal']);
    expect(closure.parameters.map(row => row.parameterKey).sort()).toEqual(['duration_ms', 'period_ms']);
    expect(closure.formulas.map(row => row.formulaKey).sort()).toEqual(['detonation_amount', 'tick_amount']);
    expect(closure.triggerRules.map(row => row.ruleKey).sort()).toEqual(['apply_on_hit', 'reapply_if_alive', 'terminal_before_state']);
    expect(sample.snapshot.selection.plannedSkills.map(row => row.skillKey)).toEqual(['sample_active']);
    approveSnapshotFixture(sample.snapshot);
    expect(assembleNaturalSkillSources(sample.snapshot).providers.some(row => row.skillKey === 'lab_timing' && row.abilities?.filter(a => a.tickSpec).length === 3)).toBe(true);
  });

  it('prepare保留后台普攻和真实主动来源，所有计时仍为零默认的新运行定义', async () => {
    const sample = targetTimingSample();
    approveSnapshotFixture(sample.snapshot);
    const result = await prepareSimulation(sample.snapshot, attributes(sample), { source: 250, target: 500 });
    expect(result.basicAttackBinding?.skillKey).toBe('sample_basic_attack');
    expect(result.compileRequest.rules.skillActionBindings?.some(row => row.skillKey === 'sample_active')).toBe(true);
    const current = result.compileRequest.sharedProviders!.find(row => row.skillKey === 'lab_timing' && row.abilities?.some(a => a.targetExpirySpec))!;
    expect(current.abilities!.filter(row => row.tickSpec)).toHaveLength(3);
    expect(Object.values(current.initialStateSchema!).every(row => row.defaultValue === 0)).toBe(true);
    expect(result.coverage.filter(row => row.authorPath.endsWith('.detail.targetTiming'))).toHaveLength(4);
  });

  const invalid: Array<[string, (sample: Sample) => void]> = [
    ['周期夹带状态写', s => { s.tick.stateOperations.push(structuredClone(s.apply.stateOperations[0]!)); }],
    ['周期夹带第二笔伤害', s => { s.configuration.effects[0]!.results.push({ ...structuredClone(s.configuration.effects[0]!.results[0]!), resultKey: 'extra' }); }],
    ['周期过程带冷却', s => { s.tick.cooldown = { durationValue: fixedValue(1), startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }; }],
    ['周期过程占用行动', s => { s.tick.steps[0]!.occupiesAction = true; }],
    ['周期夹带第二步骤', s => { s.tick.steps.push({ ...structuredClone(s.tick.steps[0]!), stepKey: 'extra' }); }],
    ['周期未知枚举', s => { Object.assign(s.phases[0]!.detail.targetTiming!, { phasePolicy: 'RESTART' }); }],
    ['周期未知字段', s => { Object.assign(s.phases[0]!.detail.targetTiming!, { extra: 1 }); }],
    ['周期空声明', s => { Object.assign(s.phases[0]!.detail, { targetTiming: null }); }],
    ['第四个周期锚', s => { s.configuration.internalStates.push({ ...structuredClone(s.phases[0]!), stateKey: 'fourth' }); }],
    ['预约自我正写', s => { const operation = s.detonate.stateOperations[0]!; operation.stateKey = 'reservation'; if (operation.operation === 'SET') operation.value = fixedValue(1); }],
    ['重挂额外第三写', s => { s.reapply.stateOperations.push({ ...structuredClone(s.reapply.stateOperations[0]!), operationKey: 'extra' }); }],
    ['重挂循环', s => { const action = s.tail.actions[0]!; if (action.actionType === 'START_PROCESS') action.detail.processKey = 'detonate'; }],
    ['普通续时修改时序锚', s => { const action = s.onHit.actions[1]!; if (action.actionType === 'MODIFY_INTERNAL_STATE') action.detail.operation = 'ENSURE_REMAINING'; }],
    ['未明确未阻挡', s => { s.onHit.conditionGroups = []; }],
    ['宽泛技能命中', s => { if (s.onHit.eventSource.eventType === 'SKILL_HIT') s.onHit.eventSource.detail.sourceSkillKey = null; }],
    ['非命中事件续期', s => { s.onHit.eventSource = { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_active', useKind: 'ACTIVE', castPhase: 'INITIAL' } }; }],
    ['主动来源被关闭', s => { s.snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!.enabled = false; }],
    ['主动来源未学', s => { s.snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!.skillLevel = 0; }],
    ['缺少真实主动来源', s => { s.snapshot.source.skillSources = s.snapshot.source.skillSources.filter(row => row.skillKey !== 'sample_active'); }],
    ['外来拥有者计划', s => { s.snapshot.selection.plannedSkills[0]!.origin = { kind: 'CHARACTER', characterKey: s.snapshot.target.character.characterKey }; }],
    ['动态运行间隔', s => { s.configuration.parameters[0]!.valueMode = 'RUNTIME_INPUT'; s.configuration.parameters[0]!.fixedValue = null; }],
    ['非零活动初值', s => { s.phases[0]!.detail.initialValue = fixedValue(1); }],
    ['带外初值绑定', s => { Object.assign(s.phases[0]!.detail, { initialValueBinding: { bindingKey: 'start', parameterKey: 'period_ms', sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue: 0, maxValue: 1 } } }); }],
    ['外来逐伤状态', s => { const c = s.killed.conditionGroups[0]!.conditions[0]!; if (c.conditionType === 'INTERNAL_STATE_CHECK') c.detail.stateSkillKey = 'sample_active'; }],
    ['逐伤前值读取周期锚', s => { const c = s.killed.conditionGroups[0]!.conditions[0]!; if (c.conditionType === 'INTERNAL_STATE_CHECK') c.detail.stateKey = 'phase_a'; }],
    ['逐伤前值读取自身范围', s => { s.count.scope = 'SKILL'; }],
    ['逐伤前值用于受伤事件', s => { s.killed.eventSource = { eventType: 'DAMAGE_TAKEN', detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' } }; }],
    ['暂态物品来源', s => { s.description.kind = 'item'; }],
    ['缺失真实稳定标识', s => { s.description.stableId = ''; }]
  ];
  it.each(invalid)('拒绝%s', (_name, mutate) => {
    const sample = targetTimingSample();
    mutate(sample);
    expect(() => assemble(sample)).toThrow();
  });

  it.each(['one_tick', 'detonate', 'reapply'])('闭包拒绝缺失过程%s，不静默丢时序或存活重挂', processKey => {
    const sample = targetTimingSample();
    sample.configuration.processes = sample.configuration.processes.filter(row => row.processKey !== processKey);
    expect(() => selectSimulationSkillSourceClosure(sample.configuration, ['apply_on_hit', 'terminal_before_state'])).toThrow(/引用缺失|闭包/);
  });

  it('真实未计划时整份自然P休眠，不遗留逐伤监听，也不改作者开关', () => {
    const sample = targetTimingSample();
    sample.snapshot.selection.plannedSkills = [];
    const active = sample.snapshot.source.skillSources.find(row => row.skillKey === 'sample_active')!;
    active.enabledRuleKeys = []; active.inactiveReason = 'ACTIVE_DEFERRED';
    const passive = sample.snapshot.source.skillSources.find(row => row.skillKey === 'lab_timing')!;
    passive.enabledRuleKeys = []; passive.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    expect(naturalRuleKeys(sample.snapshot, sample.configuration, 'source')).toEqual([]);
    approveSnapshotFixture(sample.snapshot);
    expect(assembleNaturalSkillSources(sample.snapshot).providers.some(row => row.skillKey === 'lab_timing')).toBe(false);
    expect(passive.enabled).toBe(true);
  });

  it('遗漏额外自然根时明确拒绝，不保留时序后静默过滤该根', async () => {
    const sample = targetTimingSample();
    const extra = structuredClone(sample.killed);
    extra.ruleKey = 'unsupported_root';
    extra.eventSource = { eventType: 'TAKEDOWN', detail: {} };
    sample.configuration.triggerRules.push(extra);
    sample.snapshot.source.skillSources.find(row => row.skillKey === 'lab_timing')!.enabledRuleKeys.push(extra.ruleKey);
    approveSnapshotFixture(sample.snapshot);
    await expect(async () => prepareSimulation(sample.snapshot, attributes(sample), { source: 250, target: 500 })).rejects.toThrow(/自然入口|闭包|未接入/);
  });
});
