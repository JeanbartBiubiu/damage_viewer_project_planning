import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine } from '../../tests/mechanisms/mechanismRunner';
import { preflightSkillFormulas } from './skillFormulaPreflight';
import { prepareSimulation } from './simulationAdapter';
import { simulationAutomaticCastCosts } from './simulationActiveSkills';
import { finiteTargetCounterContract } from './finiteTargetCounterContract';
import { naturalRuleKeys, plannedSkillRuleKeys } from './simulation/sources/description';
import type { GenericEngineClient } from './genericEngineClient';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import type { MechanismCase } from '../../tests/mechanisms/mechanismCase';
import { skillActionRequest } from './skillActionRequest';
import { bindFiniteTargetCounterSources } from './finiteTargetCounterBinding';
import { assessSkillActionResult } from './skillActionResult';
import { assessContinuousAttackResult } from './continuousAttackResult';

const definition = loadMechanismCases().find(row => row.caseKey === 'target_counter_three_expiry')!;
function config(snapshot: SimulationSnapshot) { return snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_charge')!; }
async function prepare(snapshot = definition.buildSnapshot(), initialHealth = definition.scenario.initialHealth) {
  const { client } = await mechanismEngine();
  await preflightSkillFormulas(snapshot, client as unknown as GenericEngineClient, () => true);
  return prepareSimulation(snapshot, { source: {}, target: {} }, initialHealth, [], [], simulationAutomaticCastCosts(snapshot));
}
async function freshRun(testCase: MechanismCase, mutateCompile?: (compile: CompileRequest) => void,
  mutateRun?: (run: RunRequest) => void, repeat = 1) {
  const snapshot = testCase.buildSnapshot(), prepared = await prepare(snapshot, testCase.scenario.initialHealth), { client } = await mechanismEngine();
  mutateCompile?.(prepared.compileRequest);
  const compiled = await client.compile(prepared.compileRequest);
  if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
  try {
    const built = await skillActionRequest(prepared, snapshot, { durationMs: testCase.scenario.durationMs, attackSpeedInputMax: 10,
      actions: testCase.scenario.actions!, recordTimeSeries: false, maxSkillActionRecords: 1000, maxSkillUseRecords: 1000,
      maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, compiled.sessionId);
    mutateRun?.(built.runRequest);
    const done = await client.run(built.runRequest);
    for (let i = 1; i < repeat; i++) expect(await client.run(built.runRequest)).toEqual(done);
    return { done, prepared, run: built.runRequest, client };
  } finally { await client.release(compiled.sessionId, prepared.compileRequest.rulesHash); }
}
function reads(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(reads);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  return [...(row.op === 'read' && typeof row.path === 'string' ? [row.path] : []), ...Object.values(row).flatMap(reads)];
}

describe('有限实际目标计数窗口装配', () => {
  it('完整作者图同源挂载，叠层、条件快照、爆炸与清窗留在同一操作帧', async () => {
    const prepared = await prepare();
    const provider = prepared.compileRequest.sharedProviders!.find(row => row.skillKey === 'lab_charge' && row.abilities?.some(a => a.tickSpec))!;
    expect(provider.processes).toBeUndefined();
    const active = prepared.compileRequest.sharedProviders!.find(row => row.skillKey === 'lab_charge' && row.processes?.length)!;
    expect(active.processes).toHaveLength(1);
    expect(active.initialStateSchema).toBeUndefined();
    const binding = prepared.compileRequest.rules.skillActionBindings?.find(row => row.skillKey === 'lab_pulse');
    const actualType = `ability/target_counter_hit/${binding!.providerRef}`;
    expect(provider.initialStateSchema).toMatchObject({ bomb_count: { defaultValue: 0, maxValue: 4, durationMs: 0 }, bomb_window: { defaultValue: 0, maxValue: 1, durationMs: 4000 } });
    const stack = provider.abilities!.find(row => row.listenerSpec?.eventMatcher.all?.includes('ability/skill/lab_pulse'))!;
    expect(stack.listenerSpec!.eventMatcher.all).toContain(actualType);
    const sibling = prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding!.providerDefinitionRef)!;
    expect(sibling.abilities!.filter(row => row.types?.includes(actualType))).toHaveLength(1);
    expect(stack.listenerSpec!.operations.map(row => row.operation)).toEqual(['state_change', 'state_change', 'damage', 'state_change']);
    expect(stack.listenerSpec!.operations[0]).toMatchObject({ ref: 'bomb_count', valuePolicy: 'add', amount: { value: 1 } });
    expect(stack.listenerSpec!.operations[2]!.condition).toEqual(stack.listenerSpec!.operations[3]!.condition);
    expect(reads(stack.listenerSpec!.operations[2]!.amount)).toContain('provider.target_state.bomb_count');
    expect(reads(stack.listenerSpec!.operations[2]!.amount)).not.toContain('ability.param.bomb_stacks');
    const tick = provider.abilities!.find(row => row.tickSpec)!;
    expect(tick.tickSpec).toMatchObject({ intervalMs: 4000, anchorScope: 'state_scope/provider_target', anchorStateKey: 'bomb_window' });
    expect(tick.tickSpec!.startDelayMs).toBeUndefined();
    expect(tick.tickSpec!.onTick.filter(row => row.operation === 'damage')).toHaveLength(1);
    expect(tick.tickSpec!.onTick.some(row => row.operation === 'state_change' && row.ref === 'bomb_window')).toBe(false);
    const dir = new URL('../../../output/skill-adaptation-20261021-next/e-adapter/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('generic-compiled.json', dir), JSON.stringify(prepared.compileRequest, null, 2) + '\n');
    writeFileSync(new URL('generic-prepared.json', dir), JSON.stringify(prepared, null, 2) + '\n');
  });

  it('自身应用根与后置窗口监听分开，兄弟命中只在真实计划开启时可达', () => {
    const snapshot = definition.buildSnapshot(), configuration = config(snapshot);
    expect(plannedSkillRuleKeys(configuration)).toEqual(['application_hit', 'on_used']);
    expect(naturalRuleKeys(snapshot, configuration, 'source')).toEqual(['mark_on_unblocked_hit', 'sibling_hit_stack']);
    snapshot.selection.plannedSkills = snapshot.selection.plannedSkills.filter(row => row.skillKey !== 'lab_pulse');
    expect(naturalRuleKeys(snapshot, configuration, 'source')).toEqual(['mark_on_unblocked_hit']);
    snapshot.selection.plannedSkills = [];
    expect(naturalRuleKeys(snapshot, configuration, 'source')).toEqual([]);
    expect(naturalRuleKeys(snapshot, configuration, 'target')).toEqual([]);
  });

  it('同技能其它来源不借用角色主动计划，按实际origin逐项判定', () => {
    const snapshot = definition.buildSnapshot(), configuration = config(snapshot);
    const character = snapshot.source.skillSources.find(source => source.skillKey === 'lab_charge')!;
    const other = { ...structuredClone(character), origin: { kind: 'EQUIPMENT' as const, equipmentKey: 'other_charge' } };
    snapshot.source.skillSources.push(other);
    expect(naturalRuleKeys(snapshot, configuration, 'source', character)).toEqual(['mark_on_unblocked_hit', 'sibling_hit_stack']);
    expect(naturalRuleKeys(snapshot, configuration, 'source', other)).toEqual([]);
    expect(() => naturalRuleKeys(snapshot, configuration, 'source')).toThrow('当前真实来源');
  });

  it('绑定阶段不编译未计划、关闭或0级的其它半成品图', () => {
    for (const state of ['unplanned', 'disabled', 'zero']) {
      const snapshot = definition.buildSnapshot();
      snapshot.selection.plannedSkills = [];
      const source = snapshot.source.skillSources.find(source => source.skillKey === 'lab_charge')!;
      if (state === 'disabled') source.enabled = false;
      if (state === 'zero') source.skillLevel = 0;
      config(snapshot).triggerRules.find(rule => rule.ruleKey === 'full_detonation')!.actions.pop();
      expect(() => bindFiniteTargetCounterSources(snapshot, [], { providers: [], bindings: [], types: [], coverage: [] })).not.toThrow();
      snapshot.selection.plannedSkills.push({ origin: { kind: 'CHARACTER', characterKey: 'lab_attacker' }, skillKey: 'lab_charge', skillLevel: 1, phaseKinds: ['INITIAL'] });
      expect(() => bindFiniteTargetCounterSources(snapshot, [], { providers: [], bindings: [], types: [], coverage: [] })).toThrow();
    }
  });

  it('实际背景普攻与有限窗口主动挂载均保留唯一来源', async () => {
    const basic = loadMechanismCases().find(row => row.caseKey === 'target_counter_real_basic_four')!;
    const prepared = await prepare(basic.buildSnapshot());
    const dir = new URL('../../../output/skill-adaptation-20261021-next/e-adapter/', import.meta.url);
    writeFileSync(new URL('generic-basic-compiled.json', dir), JSON.stringify(prepared.compileRequest, null, 2) + '\n');
    const built = await skillActionRequest(prepared, basic.buildSnapshot(), { durationMs: basic.scenario.durationMs, attackSpeedInputMax: 10,
      actions: basic.scenario.actions!, recordTimeSeries: false, maxSkillActionRecords: 1000, maxSkillUseRecords: 1000,
      maxHealingRecords: 1000, maxResourceChangeRecords: 1000 });
    writeFileSync(new URL('generic-basic-prepared.json', dir), JSON.stringify(prepared, null, 2) + '\n');
    writeFileSync(new URL('generic-basic-run.json', dir), JSON.stringify(built.runRequest, null, 2) + '\n');
    expect(prepared.compileRequest.rules.skillActionBindings).toHaveLength(1);
    const origin = prepared.skillOrigins.filter(row => row.skillKey === 'lab_charge');
    expect(origin).toHaveLength(1);
    expect(origin[0]!.providerRef).toBe('source_natural_skill_1');
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    expect(binding.providerRef).toBe('source_natural_skill_1_active');
    expect(prepared.operationOrigins.filter(row => row.effectKey === 'bomb_explosion').every(row => row.skillKey === 'lab_charge' && row.abilityRef.startsWith('source.provider[source_natural_skill_1]'))).toBe(true);
  });

  it('删除真实未阻挡条件、原子清理或改为外来目标状态均拒绝', () => {
    const mutations = [
      (snapshot: SimulationSnapshot) => { config(snapshot).triggerRules.find(row => row.ruleKey === 'mark_on_unblocked_hit')!.conditionGroups = []; },
      (snapshot: SimulationSnapshot) => { config(snapshot).triggerRules.find(row => row.ruleKey === 'full_detonation')!.actions.pop(); },
      (snapshot: SimulationSnapshot) => {
        const action = config(snapshot).triggerRules.find(row => row.ruleKey === 'natural_detonation')!.actions[0]!;
        const binding = action.runtimeInputBindings[0]!;
        if (binding.sourceType === 'INTERNAL_STATE') binding.detail.stateSkillKey = 'lab_pulse';
      },
      (snapshot: SimulationSnapshot) => {
        const duplicate = structuredClone(config(snapshot).triggerRules.find(row => row.ruleKey === 'sibling_hit_stack')!);
        duplicate.ruleKey = 'duplicate_stack'; config(snapshot).triggerRules.push(duplicate);
      },
      (snapshot: SimulationSnapshot) => {
        const extra = structuredClone(config(snapshot).triggerRules.find(row => row.ruleKey === 'attack_stack')!);
        extra.ruleKey = 'extra_root'; extra.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
        config(snapshot).triggerRules.push(extra);
      },
      (snapshot: SimulationSnapshot) => {
        const extra = structuredClone(config(snapshot).processes.find(row => row.processKey === 'clear_window')!);
        extra.processKey = 'extra_consume'; extra.stateOperations[0]!.operation = 'CONSUME';
        config(snapshot).processes.push(extra);
      },
    ];
    for (const mutate of mutations) { const snapshot = definition.buildSnapshot(); mutate(snapshot); expect(() => finiteTargetCounterContract(config(snapshot))).toThrow(); }
  });

  it('合法独立法术盾探针使真实零应用blocked1，不挂弹、不结算', async () => {
    const zero = loadMechanismCases().find(row => row.caseKey === 'target_counter_zero_expiry')!;
    // 此为已有Generic类型的独立探针，仅核对实际阻挡分支；管理SPELL_SHIELD作者结果仍未接入。
    // 直接compile/run新会话，保持fresh guard；不在原生状态建立后注入provider。
    const result = await freshRun(zero, compile => {
      compile.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
      compile.sharedProviders!.push({ providerKey: 'shield_probe_definition', kind: 'character', stableId: 'shield_probe', types: ['provider/spell_shield'] });
      compile.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'shield_probe', definitionRef: 'shield_probe_definition' });
    });
    expect(result.done.ok).toBe(true);
    expect(result.done.summary.sourceDamageDealt).toBe(0);
    expect(result.done.summary.targetFinalHp).toBe(10000);
    expect(result.done.evidence.items.filter(row => row.kind === 'skill_hit')).toMatchObject([{ data: { skillKey: 'lab_charge', source: 'source', target: 'target', blocked: 1 } }]);
    expect(result.done.damageRecords).toEqual([]);
    expect(result.done.evidence.items.filter(row => row.kind === 'provider_tick')).toEqual([]);
    const dir = new URL('../../../output/skill-adaptation-20261021-next/e-adapter/', import.meta.url);
    writeFileSync(new URL('spell-shield-probe.json', dir), JSON.stringify({ boundary: '独立合法通用provider类型探针；不代表管理SPELL_SHIELD结果适配', compile: result.prepared.compileRequest, run: result.run, done: result.done }, null, 2) + '\n');
  });

  it('同名窗口放到错误拥有者时不响应真实source根命中', async () => {
    const zero = loadMechanismCases().find(row => row.caseKey === 'target_counter_zero_expiry')!;
    const { done } = await freshRun(zero, compile => {
      const source = compile.combatants.find(row => row.key === 'source')!, target = compile.combatants.find(row => row.key === 'target')!;
      const companion = compile.sharedProviders!.find(provider => provider.abilities?.some(ability => ability.tickSpec))!;
      const index = source.providers.findIndex(mount => mount.definitionRef === companion.providerKey);
      target.providers.push(source.providers.splice(index, 1)[0]!);
    });
    expect(done.summary.sourceDamageDealt).toBe(0);
    expect(done.summary.targetFinalHp).toBe(10000);
    expect(done.damageRecords).toHaveLength(1);
    expect(done.damageRecords![0]!.rawAmount).toBe(0);
  });

  it('伪造兄弟主动目标为自身由真实运行门禁拒绝', async () => {
    await expect(freshRun(definition, undefined, run => { run.driverPlan.skillActions![1]!.target = 'source'; })).rejects.toThrow();
  });

  it('记录关闭、预算0与同会话100次运行保持相同实际结算和终态', async () => {
    const early = loadMechanismCases().find(row => row.caseKey === 'target_counter_four_early')!;
    const full = (await freshRun(early, undefined, undefined, 100)).done;
    const summary = (await freshRun(early, undefined, run => { run.outputMode = 'summary'; })).done;
    const zero = (await freshRun(early, undefined, run => {
      run.recordBudget = { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0, maxResourceChangeRecords: 0 };
    })).done;
    for (const done of [full, summary, zero]) {
      expect(done.summary.sourceDamageDealt).toBe(240);
      expect(done.summary.targetFinalHp).toBe(9760);
      expect(done.finalSnapshot).toEqual(full.finalSnapshot);
    }
    expect(summary.damageRecords ?? []).toHaveLength(0);
    expect(zero.damageRecords ?? []).toHaveLength(0);
  }, 20000);

  it('第四层命中耗尽操作预算时整笔叠层、伤害与清窗回滚', async () => {
    const early = loadMechanismCases().find(row => row.caseKey === 'target_counter_four_early')!;
    const { done } = await freshRun(early, undefined, run => { run.safetyBudget = { maxCommandsPerEvent: 5 }; });
    const dir = new URL('../../../output/skill-adaptation-20261021-next/e-adapter/', import.meta.url);
    writeFileSync(new URL('command-budget-probe.json', dir), JSON.stringify(done, null, 2) + '\n');
    expect(done.summary.execution?.budgetCause).toBe('max_commands_per_event');
    expect(done.summary.sourceDamageDealt).toBe(0);
    expect(done.summary.targetFinalHp).toBe(10000);
    const source = done.finalSnapshot.combatants.find(actor => actor.key === 'source')!;
    const state = source.providerState.source_natural_skill_0 as { targetState: { values: Record<string, number> } };
    expect(state.targetState.values).toMatchObject({ bomb_count: 3, bomb_window: 1 });
  });

  it('背景普攻下真实目标终点有独立刀号，完整图缺任一实际来源或原子尾均拒绝验收', async () => {
    const basic = loadMechanismCases().find(row => row.caseKey === 'target_counter_real_basic_four')!;
    const slower = { ...basic, buildSnapshot() {
      const snapshot = basic.buildSnapshot();
      snapshot.source.selectedLevelValues.attack_speed = .5;
      snapshot.source.attributes.levelValues[1]!.attack_speed = .5;
      return snapshot;
    } };
    const result = await freshRun(slower, undefined, run => {
      run.recordBudget!.maxAttackRecords = 1000;
    });
    const assess = (compile = result.prepared.compileRequest) => assessSkillActionResult(compile, result.run, result.done, result.prepared.operationOrigins);
    expect(result.done.summary.sourceDamageDealt).toBe(180);
    const explosion = result.done.damageRecords!.find(row => row.rawAmount === 180)!;
    expect(explosion).toMatchObject({ timeMs: 4000, attackIndex: null, useRef: '' });
    expect(assess().issues).toEqual([]);
    expect(assess().complete).toBe(true);
    const mutations: Array<(compile: CompileRequest) => void> = [
      compile => { compile.sharedProviders!.find(row => row.abilities?.some(a => a.tickSpec))!.abilities!.find(a => a.tickSpec)!.tickSpec!.anchorScope = 'state_scope/provider'; },
      compile => { compile.sharedProviders!.find(row => row.abilities?.some(a => a.tickSpec))!.abilities!.find(a => a.tickSpec)!.tickSpec!.anchorStateKey = 'foreign_window'; },
      compile => { delete compile.sharedProviders!.find(row => row.abilities?.some(a => a.tickSpec))!.abilities!.find(a => a.tickSpec)!.tickSpec!.anchorScope; },
      compile => { compile.sharedProviders!.find(row => row.abilities?.some(a => a.tickSpec))!.abilities!.find(a => a.tickSpec)!.tickSpec!.intervalMs = 3999; },
      compile => { compile.sharedProviders!.find(row => row.abilities?.some(a => a.tickSpec))!.abilities!.find(a => a.listenerSpec?.operations?.length === 2)!.listenerSpec!.eventMatcher.all!.pop(); },
      compile => { compile.sharedProviders!.find(row => row.abilities?.some(a => a.tickSpec))!.abilities!.find(a => a.listenerSpec?.operations?.length === 4)!.listenerSpec!.operations!.pop(); },
      compile => {
        const actual = compile.sharedProviders!.find(row => row.skillKey === 'lab_charge' && row.processes?.length)!;
        actual.abilities!.find(ability => ability.operations?.some(operation => operation.operation === 'resolve_skill_hit'))!.types = [];
      },
    ];
    for (const mutate of mutations) {
      const compile = structuredClone(result.prepared.compileRequest); mutate(compile);
      expect(assess(compile).issues.join(';')).toContain('伤害节点的执行入口');
    }
    for (const field of ['attackIndex', 'useRef', 'instructionKey'] as const) {
      const done = structuredClone(result.done), row = done.damageRecords!.find(row => row.rawAmount === 180)!;
      if (field === 'attackIndex') row.attackIndex = 1;
      else row[field] = 'borrowed_identity';
      expect(assessSkillActionResult(result.prepared.compileRequest, result.run, done, result.prepared.operationOrigins).issues.length).toBeGreaterThan(0);
    }
    const full = await freshRun(basic), forged = structuredClone(full.done);
    const ordinaryListener = forged.damageRecords!.find(row => row.rawAmount === 240)!;
    ordinaryListener.attackIndex = 0; ordinaryListener.useRef = '';
    expect(assessSkillActionResult(full.prepared.compileRequest, full.run, forged, full.prepared.operationOrigins).issues.length).toBeGreaterThan(0);
    const lethalCase = { ...slower, scenario: { ...slower.scenario, initialHealth: { source: 1000, target: 180 } } };
    const killed = await freshRun(lethalCase);
    expect(assessSkillActionResult(killed.prepared.compileRequest, killed.run, killed.done, killed.prepared.operationOrigins).complete).toBe(true);
    const tail = structuredClone(killed.done), lethal = tail.damageRecords!.find(row => row.rawAmount === 180)!;
    tail.damageRecords!.push({ ...structuredClone(lethal), damageId: lethal.damageId + 1,
      castInstanceId: lethal.castInstanceId + 1, rawAmount: 0, postDefenseDamage: 0, actualHpLoss: 0, hpBefore: 0, hpAfter: 0 });
    expect(assessContinuousAttackResult(killed.prepared.compileRequest, killed.run, tail, killed.prepared.operationOrigins).issues.join(';'))
      .toContain('真实死亡以后出现新的攻击或独立周期');
  });
});
