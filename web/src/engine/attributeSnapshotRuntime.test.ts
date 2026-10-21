import { describe, expect, it } from 'vitest';
import { loadMechanismCases, type MechanismCase } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine } from '../../tests/mechanisms/mechanismRunner';
import { preflightSkillFormulas } from './skillFormulaPreflight';
import { prepareSimulation } from './simulationAdapter';
import { simulationAutomaticCastCosts } from './simulationActiveSkills';
import { skillActionRequest } from './skillActionRequest';
import { continuousAttackRequest } from './continuousAttackRequest';
import type { GenericEngineClient } from './genericEngineClient';
import type { CompileRequest, RunRequest } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';

const definitions = loadMechanismCases();
async function fresh(key: string, mutateSnapshot?: (snapshot: SimulationSnapshot, scenario: MechanismCase['scenario']) => void,
  mutateCompile?: (compile: CompileRequest) => void, mutateRun?: (run: RunRequest) => void, repeats = 1) {
  const definition = definitions.find(row => row.caseKey === key)!, snapshot = definition.buildSnapshot(), scenario = structuredClone(definition.scenario);
  mutateSnapshot?.(snapshot, scenario);
  const { client: node } = await mechanismEngine(), client = node as unknown as GenericEngineClient;
  const ignoredCosts = simulationAutomaticCastCosts(snapshot);
  await preflightSkillFormulas(snapshot, client);
  const prepared = await prepareSimulation(snapshot, scenario.attributeInputs ?? { source: {}, target: {} }, scenario.initialHealth, [], [], ignoredCosts);
  mutateCompile?.(prepared.compileRequest);
  const compiled = await client.compile(prepared.compileRequest);
  if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
  try {
    const common = { durationMs: scenario.durationMs, attackSpeedInputMax: 10, recordTimeSeries: false };
    const built = scenario.mode === 'skill_action'
      ? await skillActionRequest(prepared, snapshot, { ...common, actions: scenario.actions!, maxSkillActionRecords: 1000, maxSkillUseRecords: 1000, maxHealingRecords: 1000 }, compiled.sessionId)
      : await continuousAttackRequest(prepared, snapshot, common, compiled.sessionId);
    mutateRun?.(built.runRequest);
    const done = await client.run(built.runRequest);
    for (let index = 1; index < repeats; index++) expect(await client.run(built.runRequest)).toEqual(done);
    return { done, prepared, run: built.runRequest };
  } finally { await client.release(compiled.sessionId, prepared.compileRequest.rulesHash); }
}

describe('真实Wasm自身回盾和双端属性快照边界', () => {
  it('MISS不施加两端；真实0伤害背景普攻照常运行', async () => {
    const { done } = await fresh('attribute_paired_snapshot_refresh', (_snapshot, scenario) => {
      for (const action of scenario.actions!) action.hitPreset = 'MISS';
    });
    expect(done.summary.basicAttack?.hitCount).toBe(5);
    expect(done.finalSnapshot.combatants[0]!.attributes.move_speed!.resolved).toBe(300);
    expect(done.finalSnapshot.combatants[1]!.attributes.move_speed!.resolved).toBe(400);
    expect(done.finalSnapshot.combatants.flatMap(actor => actor.providers).some(provider => provider.modifierSnapshots)).toBe(false);
  });

  it('合法独立法术盾探针控制同组两端，不独立消费来源结果资格', async () => {
    // 只证明已有Generic法术盾类型阻挡真实命中；不宣称管理SPELL_SHIELD作者结果已支持。
    const { done } = await fresh('attribute_paired_snapshot_refresh', (snapshot, scenario) => {
      scenario.actions = scenario.actions!.slice(0, 1); scenario.durationMs = 1001;
      // 独立Generic法盾探针不属于作者白名单；此探针采用合法无背景普攻场景，其它核心场景保留背景普攻。
      snapshot.selection.basicAttackSkillKey = null; snapshot.selection.basicAttackLevel = null;
      snapshot.source.skillSources[0]!.enabledRuleKeys = [];
      snapshot.source.skillSources[0]!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
    }, compile => {
      compile.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
      compile.sharedProviders!.push({ providerKey: 'snapshot_shield_probe_definition', kind: 'character', stableId: 'snapshot_shield_probe', types: ['provider/spell_shield'] });
      compile.combatants[1]!.providers.push({ providerRef: 'snapshot_shield_probe', definitionRef: 'snapshot_shield_probe_definition' });
    });
    expect(done.finalSnapshot.combatants[0]!.attributes.move_speed!.resolved).toBe(300);
    expect(done.finalSnapshot.combatants[1]!.attributes.move_speed!.resolved).toBe(400);
    expect(done.evidence.items.filter(row => row.kind === 'skill_hit')).toMatchObject([{ data: { skillKey: 'lab_transfer', blocked: 1 } }]);
    expect(done.finalSnapshot.combatants.flatMap(actor => actor.providers).some(provider => provider.modifierSnapshots)).toBe(false);
  });

  it('捕获后其它真实技能改变目标属性，不追随既有来源冻结量', async () => {
    const { done } = await fresh('attribute_paired_snapshot_refresh', (snapshot, scenario) => {
      const configuration = structuredClone(snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_transfer')!);
      configuration.skill.skillKey = 'lab_boost'; configuration.skill.name = '目标后续变化'; configuration.parameters = []; configuration.formulas = [];
      const effect = configuration.effects[0]!, result = effect.results[0]!;
      effect.skillKey = 'lab_boost'; effect.results = [result]; effect.lifecycle!.durationValue = { kind: 'FIXED', value: 5000 };
      if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('缺少目标属性');
      result.detail.operation = 'INCREASE'; result.detail.modifierZoneKey = 'flat_attributes';
      result.valueRule!.value = { kind: 'FIXED', value: 200 };
      configuration.processes[0]!.skillKey = 'lab_boost';
      for (const rule of configuration.triggerRules) if (rule.eventSource.eventType === 'SKILL_HIT' || rule.eventSource.eventType === 'SKILL_USED') rule.eventSource.detail.sourceSkillKey = 'lab_boost';
      snapshot.skillConfigurations.push(configuration);
      snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[1]!, skillKey: 'lab_boost' });
      snapshot.source.skillSources.push({ ...structuredClone(snapshot.source.skillSources[1]!), skillKey: 'lab_boost' });
      snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings[0]!, skillKey: 'lab_boost' });
      snapshot.selection.plannedSkills.push({ ...snapshot.selection.plannedSkills[0]!, skillKey: 'lab_boost' });
      scenario.actions = [scenario.actions![0]!, { ...scenario.actions![1]!, skillKey: 'lab_boost', instructionKey: 'later_change', atMs: 1000 }];
      scenario.durationMs = 2001;
    });
    expect(done.finalSnapshot.combatants[0]!.attributes.move_speed!.resolved).toBe(380);
    expect(done.finalSnapshot.combatants[1]!.attributes.move_speed!.resolved).toBe(480);
  });

  it('同刻真实普攻先重启等待，旧到期不能补盾供本刀吸收', async () => {
    const { done } = await fresh('defense_own_counter_shield_restart', snapshot => {
      const state = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_guard')!.internalStates[0]!;
      if (state.stateType !== 'COUNTER') throw new Error('缺少计数');
      state.detail.durationValue = { kind: 'FIXED', value: 1000 };
    });
    expect(done.damageRecords!.map(row => row.shieldAbsorbed)).toEqual([100, 0, 0]);
    expect(done.finalSnapshot.combatants[1]!.attributes.armor!.resolved).toBeCloseTo(110, 12);
    expect(done.finalSnapshot.combatants[1]!.attributes.hp!.current).toBeCloseTo(461.9047619047619, 9);
  });

  it('防御后零伤害不启动等待，保留开场真实盾', async () => {
    const { done, prepared } = await fresh('defense_own_counter_shield_restart', snapshot => {
      snapshot.source.selectedLevelValues.attack_damage = 0;
      snapshot.source.attributes.levelValues['1']!.attack_damage = 0;
    });
    const target = done.finalSnapshot.combatants[1]!;
    expect(target.attributes.hp!.current).toBe(1000);
    expect(target.attributes.armor!.resolved).toBeCloseTo(130, 12);
    expect(target.shields).toHaveLength(1);
    expect(target.shields[0]).toMatchObject({ remaining: 100 });
    const ref = prepared.skillOrigins.find(origin => origin.side === 'target' && origin.skillKey === 'lab_guard')!.providerRef!;
    const bag = target.providerState[ref] as { state: Record<string, number>; expireAt: Record<string, number> } | undefined;
    expect(bag?.state.wait).not.toBe(1);
    expect(bag?.expireAt.wait).toBeUndefined();
  });

  it('实际扣血重启：只有盾损不启动，溢出生命损失才写等待并刷新期限', async () => {
    for (const [damage, duration] of [[115, 501], [460, 1501]] as const) {
      const { done, prepared } = await fresh('defense_own_counter_shield_restart', (snapshot, scenario) => {
        const rule = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_guard')!.triggerRules.find(row => row.ruleKey === 'damaged')!;
        const condition = rule.conditionGroups[0]!.conditions[0]!;
        if (condition.conditionType !== 'EVENT_VALUE_COMPARE') throw new Error('缺少事件条件');
        condition.detail.eventValueKey = 'ACTUAL_HP_LOSS';
        snapshot.source.selectedLevelValues.attack_damage = damage;
        snapshot.source.attributes.levelValues['1']!.attack_damage = damage;
        scenario.durationMs = duration;
      });
      const target = done.finalSnapshot.combatants[1]!;
      const ref = prepared.skillOrigins.find(origin => origin.side === 'target' && origin.skillKey === 'lab_guard')!.providerRef!;
      const bag = target.providerState[ref] as { state: Record<string, number>; expireAt: Record<string, number> } | undefined;
      expect(done.damageRecords![0]!.shieldAbsorbed).toBeCloseTo(damage === 115 ? 50 : 100, 12);
      expect(done.damageRecords![0]!.actualHpLoss).toBeCloseTo(damage === 115 ? 0 : 100, 12);
      if (damage === 115) {
        expect(target.attributes.hp!.current).toBe(1000);
        expect(bag?.state.wait).not.toBe(1);
        expect(bag?.expireAt.wait).toBeUndefined();
      } else {
        expect(target.attributes.hp!.current).toBeCloseTo(680.952380952381, 9);
        expect(bag!.state.wait).toBe(1);
        expect(bag!.expireAt.wait).toBe(2500);
      }
    }
  });

  it('明细、汇总、零记录预算和100次同会话重放保持冻结值与实际终态', async () => {
    const full = await fresh('attribute_paired_snapshot_refresh', undefined, undefined, undefined, 100);
    const summary = await fresh('attribute_paired_snapshot_refresh', undefined, undefined, run => { run.outputMode = 'summary'; });
    const zero = await fresh('attribute_paired_snapshot_refresh', undefined, undefined, run => {
      run.recordBudget = { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 };
    });
    for (const result of [summary, zero]) {
      expect(result.done.finalSnapshot).toEqual(full.done.finalSnapshot);
      expect(result.done.summary.sourceDamageDealt).toBe(0);
    }
    expect(full.done.finalSnapshot.combatants[1]!.providers.find(provider => provider.modifierSnapshots)!.modifierSnapshots).toEqual({ target_slow: 0.8, source_gain: 64 });
  }, 60000);
});
