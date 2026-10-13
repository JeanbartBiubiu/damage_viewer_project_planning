import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { continuousAttackRequest, continuousAttackRunInputHash } from './continuousAttackRequest';

function sample() {
  const snapshot = simulationSample();
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(snapshot, inputs, { source: 650, target: 590 });
  return { snapshot, inputs, prepared };
}
describe('连续普攻请求与冻结身份', () => {
  it('曲线开关是明确运行输入，关闭时仍保留预算和间隔', async () => {
    const { prepared, snapshot } = sample();
    const enabled = await continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 2 });
    const disabled = await continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 2, recordTimeSeries: false });
    expect(enabled.runInputHash).not.toBe(disabled.runInputHash);
    expect(disabled.runRequest.sampling).toEqual({ disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 });
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 2, recordTimeSeries: 0 as unknown as boolean })).rejects.toThrow(/布尔/);
  });
  it('构造唯一原生计划、明确预算及只读采样，不预写外部使用和下一刀', async () => {
    const { prepared, snapshot } = sample();
    const { runRequest, runInputHash, attackSpeedAdmission } = await continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 2 }, 'session');
    expect(runRequest.driverPlan.entries).toEqual([]);
    expect(runRequest.driverPlan.basicAttack).toMatchObject({ ...prepared.basicAttackBinding, attackSpeedInputMax: 2 });
    expect(runRequest).not.toHaveProperty('skillUses');
    expect(runRequest).not.toHaveProperty('attackStartFacts');
    expect(runRequest).not.toHaveProperty('skillHitFacts');
    expect(runRequest.safetyBudget).toEqual({ maxEvents: 10000, maxCommandsPerEvent: 256, maxChainDepth: 32, maxProcessInstances: 10000, maxBasicAttacks: 4096 });
    expect(runRequest.recordBudget).toEqual({ maxAttackRecords: 1000, maxDamageRecords: 2000, maxMechanicRecords: 2000 });
    expect(runRequest.sampling).toEqual({ disabled: false, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 });
    expect(runRequest.initialSnapshot.combatants[0]!.attributes.attack_speed!.max).toBe(0.651);
    expect(attackSpeedAdmission).toEqual({ attributeKey: 'attack_speed', inputMax: 2, source: 'scenario_input' });
    expect(runInputHash).toMatch(/^[a-f0-9]{64}$/);
    runRequest.initialSnapshot.combatants[0]!.attributes.hp!.current = 10;
    const again = await continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 2 }, 'new');
    expect(again.runRequest.initialSnapshot.combatants[0]!.attributes.hp!.current).toBe(650);
    expect(again.runInputHash).toBe(runInputHash);
  });

  it('目录有上界时使用真实值；为空必须显式填写，不使用游戏封顶默认值', async () => {
    const { prepared, snapshot } = sample();
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000 })).rejects.toThrow(/明确填写/);
    for (const value of [0, -1, Infinity, NaN, 0.6]) {
      await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: value })).rejects.toThrow(/上界/);
    }
    snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed')!.maxValue = 8;
    const result = await continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2.5 });
    expect(result.attackSpeedAdmission).toEqual({ attributeKey: 'attack_speed', inputMax: 8, source: 'attribute_range' });
  });

  it('摘要覆盖观察时长、上界及来源，同时不含会话、读取时间', async () => {
    const { prepared, snapshot, inputs } = sample();
    const get = (durationMs = 30000, attackSpeedInputMax = 2) => continuousAttackRequest(prepared, snapshot, { durationMs, attackSpeedInputMax });
    const first = await get();
    const altered = structuredClone(first.runRequest);
    altered.recordBudget!.maxDamageRecords = 0;
    expect(await continuousAttackRunInputHash(altered, first.attackSpeedAdmission)).not.toBe(first.runInputHash);
    altered.recordBudget = structuredClone(first.runRequest.recordBudget);
    altered.sampling.disabled = true;
    expect(await continuousAttackRunInputHash(altered, first.attackSpeedAdmission)).not.toBe(first.runInputHash);
    altered.sampling = structuredClone(first.runRequest.sampling);
    altered.safetyBudget!.maxEvents = 20;
    expect(await continuousAttackRunInputHash(altered, first.attackSpeedAdmission)).not.toBe(first.runInputHash);
    expect((await get(30001)).runInputHash).not.toBe(first.runInputHash);
    expect((await get(30000, 3)).runInputHash).not.toBe(first.runInputHash);
    snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed')!.maxValue = 2;
    expect((await get()).runInputHash).not.toBe(first.runInputHash);
    const prior = await prepareSimulation(snapshot, inputs, { source: 650, target: 590 });
    snapshot.readAt = 'another-read-time';
    expect((await prepareSimulation(snapshot, inputs, { source: 650, target: 590 })).compileRequest.rulesHash).toBe(prior.compileRequest.rulesHash);
  });

  it('拒绝无效时长、初始死亡、目标挂载及命中前扣血', async () => {
    const { prepared, snapshot } = sample();
    for (const durationMs of [0, 600001, 1.5, NaN, Infinity]) {
      await expect(continuousAttackRequest(prepared, snapshot, { durationMs, attackSpeedInputMax: 2 })).rejects.toThrow(/观察时长/);
    }
    const run = () => continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 });
    prepared.compileRequest.combatants[1]!.attributes.hp!.current = 0;
    await expect(run()).rejects.toThrow(/initialHealth.target/);
    prepared.compileRequest.combatants[1]!.attributes.hp!.current = 590;
    prepared.compileRequest.combatants[1]!.providers = [...prepared.compileRequest.combatants[0]!.providers];
    await expect(run()).rejects.toThrow(/目标挂载/);
    prepared.compileRequest.combatants[1]!.providers = [];
    prepared.compileRequest.sharedProviders![0]!.processes![0]!.momentOperations[0]!.operations[0]!.operation = 'damage';
    await expect(run()).rejects.toThrow(/命中前扣血/);
  });

  it('相同裸结果标识分属不同效果，重复挂接保留全部真实编译路径', () => {
    const { snapshot, inputs } = sample();
    const config = snapshot.skillConfigurations[0]!;
    config.effects[0]!.results[0]!.resultKey = 'damage';
    config.triggerRules[1]!.actions.push({ ...structuredClone(config.triggerRules[1]!.actions[0]!), actionKey: 'second_binding', sortOrder: 1 });
    const prepared = assembleSimulation(snapshot, inputs, { source: 650, target: 590 });
    expect(prepared.operationOrigins.find(row => row.effectKey === 'start')!.operationRef).toBe('skills.sample_basic_attack.effects.start.results.damage');
    const origin = prepared.operationOrigins.find(row => row.effectKey === 'hit' && row.resultKey === 'damage')!;
    expect(origin.operationRef).toBe('skills.sample_basic_attack.effects.hit.results.damage');
    expect(origin.compiledPaths).toHaveLength(2);
    expect(new Set(origin.compiledPaths).size).toBe(2);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
