import { describe, expect, it } from 'vitest';
import { mixedAction, mixedInputs, prepareMixedSample, simulationEmpoweredSample, simulationMixedSample } from '../../tests/fixtures/simulationMixedSkills';
import { skillActionRequest } from './skillActionRequest';
import { inspectSimulationSnapshot } from './simulationAdapter';
import { plannedSkillsFromActions } from '../pages/simulation/simulationSkillActionDrafts';
import { fixedValue } from '../types/numericValue';

describe('6B明确计划与完整装配', () => {
  it('单段强化待击完整挂接为真实首次激活、原生窗口、命中一次消费和内部冷却', async () => {
    const snapshot = simulationEmpoweredSample();
    const prepared = await prepareMixedSample(snapshot);
    const definition = prepared.compileRequest.sharedProviders!.find(provider => provider.kind === 'item' && provider.abilities?.length)!;
    const arm = definition.abilities!.find(ability => ability.abilityKey === 'arm')!;
    const consume = definition.abilities!.find(ability => ability.abilityKey === 'consume_empowered')!;
    expect(arm.listenerSpec!.eventMatcher.all).toContain('event/ability_started');
    expect(arm.listenerSpec!.eventMatcher.all).not.toContain('event/basic_attack_start');
    expect(consume.listenerSpec!.eventMatcher.all).toContain('event/basic_attack_hit');
    expect(consume.listenerSpec!.operations!.map(operation => operation.operation)).toEqual(['damage', 'state_change', 'state_change']);
    expect(definition.initialStateSchema).toMatchObject({ ready: { defaultValue: 0, durationMs: 1000, refreshPolicy: 'refresh_on_write' },
      icd: { defaultValue: 0, durationMs: 300, refreshPolicy: 'start_on_first_write' } });
    const process = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'item_1043_passive')!.processes[0]!;
    process.stateOperations.pop();
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/必要其它时点不能丢弃/);
  });
  it('正数小数冷却保留作者值并声明原生离散化，0不能补成1', async () => {
    const snapshot = simulationMixedSample(false);
    snapshot.skillConfigurations[1]!.processes[0]!.cooldown!.durationValue = fixedValue(3636.363636);
    const prepared = await prepareMixedSample(snapshot);
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const process = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!.processes![0]!;
    expect(process.cooldown).toMatchObject({ durationMs: { op: 'const', value: 3636.363636 }, roundPositiveMs: true });
    snapshot.skillConfigurations[1]!.processes[0]!.cooldown!.durationValue = fixedValue(0);
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/不能将0/);
  });
  it('同一A两项真实来源只挂载一次，背景普攻沿同一驱动计划且初态精确', async () => {
    const snapshot = simulationMixedSample();
    const prepared = await prepareMixedSample(snapshot);
    const request = await skillActionRequest(prepared, snapshot, mixedInputs(snapshot));
    expect(prepared.compileRequest.rules.skillActionBindings).toHaveLength(2);
    const mounts = prepared.compileRequest.combatants[0]!.providers;
    expect(new Set(mounts.map(mount => mount.providerRef)).size).toBe(mounts.length);
    expect(request.runRequest.driverPlan.basicAttack).toBeDefined();
    expect(request.runRequest.driverPlan.skillActions).toHaveLength(6);
    expect(request.runRequest.initialSnapshot.combatants[0]!.attributes.hp!.current).toBe(300);
    expect(request.runRequest.skillUses).toEqual([]);
    expect(request.runRequest.skillHitFacts).toEqual([]);
    for (const origin of prepared.operationOrigins) for (const path of origin.compiledPaths) {
      let node: unknown = prepared.compileRequest;
      for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) node = (node as Record<string, unknown>)?.[key];
      expect((node as { operation: string }).operation).toMatch(/damage|heal|apply_attack_link|apply_hit_link/);
    }
  });

  it('数组偶然顺序不改变运行摘要；时刻或顺序只改运行摘要，不改编译', async () => {
    const snapshot = simulationMixedSample(false);
    const prepared = await prepareMixedSample(snapshot);
    const inputs = mixedInputs(snapshot);
    const original = await skillActionRequest(prepared, snapshot, inputs);
    const reordered = await skillActionRequest(prepared, snapshot, { ...inputs, actions: [...inputs.actions].reverse() });
    expect(reordered.runInputHash).toBe(original.runInputHash);
    const changed = await skillActionRequest(prepared, snapshot, { ...inputs, actions: inputs.actions.map((action, index) =>
      index ? action : { ...action, atMs: 1 }) });
    expect(changed.runRequest.rulesHash).toBe(original.runRequest.rulesHash);
    expect(changed.runInputHash).not.toBe(original.runInputHash);
    const stable = await skillActionRequest(prepared, snapshot, { ...inputs, actions: [
      mixedAction(snapshot, 'sample_active', 'zeta', 0), mixedAction(snapshot, 'sample_active', 'alpha', 0)] });
    expect(stable.runRequest.driverPlan.skillActions!.map(row => row.instructionKey)).toEqual(['alpha', 'zeta']);
  });

  it('1～64条首次对应至多16份独立来源，一来源不允许不同等级', async () => {
    const snapshot = simulationMixedSample(false);
    const prepared = await prepareMixedSample(snapshot);
    const inputs = mixedInputs(snapshot);
    const actions = Array.from({ length: 64 }, (_, index) => mixedAction(snapshot, 'sample_active', `instruction_${index}`, index));
    expect((await skillActionRequest(prepared, snapshot, { ...inputs, actions })).runRequest.driverPlan.skillActions).toHaveLength(64);
    expect(plannedSkillsFromActions(actions)).toHaveLength(1);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, actions: [...actions, { ...actions[0]!, instructionKey: 'extra' }] })).rejects.toThrow(/1～64/);
    expect(() => plannedSkillsFromActions([actions[0]!, { ...actions[1]!, skillLevel: 2 }])).toThrow(/一个技能等级/);
  });

  it.each([null, undefined, 'true'])('计划占用%j拒绝，不将任何DELAY默认为true或false', occupiesAction => {
    const snapshot = simulationMixedSample();
    Object.assign(snapshot.skillConfigurations[1]!.processes[0]!.steps[0]!, { occupiesAction });
    expect(() => inspectSimulationSnapshot(snapshot)).toThrow(/occupiesAction/);
  });

  it('不占用仍有完整原过程和首次绑定；非法来源、重复标识和6C控制均拒绝', async () => {
    const snapshot = simulationMixedSample(false, false);
    const prepared = await prepareMixedSample(snapshot);
    for (const binding of prepared.compileRequest.rules.skillActionBindings!) {
      const provider = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
      expect(provider.processes![0]!.steps[0]!.occupiesAction).toBe(false);
    }
    const inputs = mixedInputs(snapshot);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, actions: [inputs.actions[0]!, inputs.actions[0]!] })).rejects.toThrow(/唯一/);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, origin: { kind: 'CHARACTER', characterKey: 'actor_b' } }] })).rejects.toThrow(/真实来源/);
    await expect(skillActionRequest(prepared, snapshot, { ...inputs, actions: [{ ...inputs.actions[0]!, phaseKind: 'RECAST' }] })).rejects.toThrow(/关联原首次/);
  });
});
