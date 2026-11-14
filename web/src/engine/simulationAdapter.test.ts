import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } from './simulationAdapter';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { triggeredEquipmentSimulationSample } from '../../tests/fixtures/simulationTriggeredEquipment';
import { SIMULATION_ADAPTER_VERSION } from './simulationAdapter';
import { simulationHash } from './simulationHash';
import { continuousAttackRequest } from './continuousAttackRequest';

function zeroInputs(snapshot = simulationSample()) {
  const values = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) {
    if (row.storedValue === undefined) values[row.side][row.attribute.attributeKey] = 0;
  }
  return values;
}
const initialHealth = { source: 650, target: 590 };

describe('首批场景装配', () => {
  it('伤害和属性同名时保留两个明确作用域，原键和完整公式不被覆盖或展开', () => {
    const snapshot = simulationSample();
    snapshot.catalogs.damageTypes[0]!.type.damageTypeKey = 'armor';
    snapshot.catalogs.damageTypes[0]!.formula.damageTypeKey = 'armor';
    const damage = snapshot.skillConfigurations[0]!.effects[1]!.results[0]!;
    if (damage.resultType === 'DAMAGE') damage.detail.damageTypeKey = 'armor';
    const before = structuredClone(snapshot);
    const request = assembleSimulation(snapshot, zeroInputs(snapshot), initialHealth).compileRequest;
    expect(request.typeCatalog.types.filter(type => type.key === 'armor')).toEqual([
      { key: 'armor', domain: 'damage' }, { key: 'armor', domain: 'attribute' }
    ]);
    expect(request.rules.damageTypeFormulas![0]).toEqual({ damageType: 'armor', formula: snapshot.catalogs.damageTypes[0]!.formula.formula });
    expect(snapshot).toEqual(before);
  });
  it('通用常驻适配版本参与摘要，即使编译形状未变也不能与旧规则摘要混用', async () => {
    const snapshot = simulationSample();
    const prepared = await prepareSimulation(snapshot, zeroInputs(snapshot), initialHealth);
    const base = { snapshotDigest: snapshot.snapshotDigest, attributeInputs: prepared.attributeInputs,
      initialHealth, equipmentAssumptions: prepared.equipmentAssumptions, request: prepared.compileRequest };
    expect(SIMULATION_ADAPTER_VERSION).toBe('v55-process-status-presence');
    expect(prepared.compileRequest.rulesHash).not.toBe(await simulationHash({ ...base, adapter: 'v8-default-skill-sources' }));
  });

  it('多来源共享目录覆盖只保留一条边，不同挂载和资料说明仍完整保留', () => {
    const snapshot = triggeredEquipmentSimulationSample(['item_1043'], ['item_1043']);
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!;
    configuration.parameters.push({ ...configuration.parameters[0]!, parameterKey: 'authoring_note', name: '未引用资料参数', sortOrder: 20 });
    const inputs = zeroInputs(snapshot);
    inputs.source.attack_speed_ratio = .651;
    inputs.target.attack_speed_ratio = .668;
    const prepared = assembleSimulation(snapshot, inputs, initialHealth);
    const pairs = prepared.coverage.map(row => JSON.stringify([row.authorPath, row.compiledPath]));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(prepared.coverage.filter(row => row.authorPath === 'catalogs.vampRules.rules[0]'
      && row.compiledPath === 'rules.vampRules[0]')).toHaveLength(1);
    const resultReferences = prepared.coverage.filter(row => row.authorPath === 'skills.item_1043_passive.effects.on_hit_damage.results.on_hit_damage');
    expect(new Set(resultReferences.map(row => row.compiledPath)).size).toBeGreaterThanOrEqual(2);
    const notes = prepared.coverage.filter(row => row.authorPath === 'skills.item_1043_passive.parameters.authoring_note');
    expect(notes).toHaveLength(2);
    expect(notes.every(row => row.note?.includes('非战斗引用'))).toBe(true);
  });

  it('缺值不补零，按真实一侧要求显式补充，固有等级值不可覆盖', () => {
    const snapshot = simulationSample();
    const inspection = inspectSimulationSnapshot(snapshot);
    expect(inspection.requirements.filter(row => row.storedValue === undefined)).toHaveLength(5);
    expect(inspection.requirements.filter(row => row.side === 'target').map(row => row.attribute.attributeKey)).toEqual(['armor', 'hp']);
    expect(() => assembleSimulation(snapshot, { source: {}, target: {} }, initialHealth)).toThrow(/需要明确的有限数值/);
    expect(() => assembleSimulation(snapshot, { source: { ...zeroInputs().source, attack_damage: 0 }, target: {} }, initialHealth)).toThrow(/不能覆盖/);
    expect(() => assembleSimulation(snapshot, { source: { ...zeroInputs().source, made_up: 0 }, target: {} }, initialHealth)).toThrow(/不是本次所需/);
  });

  it('完整保留原结果、独立暴击公式、五阶段、来源挂载与过程开始绑定', () => {
    const snapshot = simulationSample();
    const inputs = zeroInputs(snapshot);
    inputs.source.critical_strike_chance = 0.25;
    const { compileRequest: request, coverage } = assembleSimulation(snapshot, inputs, initialHealth);
    const provider = request.sharedProviders![0]!;
    expect(request.schemaVersion).toBe('generic-p0');
    const hit = provider.abilities!.find(row => row.abilityKey === 'attack_hit')!;
    const candidates = hit.operations![0]!.skillHit!.candidates;
    expect(candidates.map(row => row.resultKey)).toEqual(['damage', 'hit_link']);
    expect(candidates[0]!.operations[0]).toMatchObject({ damageType: 'physics', critEligible: true,
      critChance: { op: 'read', path: 'source.attr.critical_strike_chance.resolved' },
      critMultiplier: { op: 'ref', ref: 'selected/sample_basic_attack/levels/1/1/multiplier' } });
    expect(candidates[1]!.operations[0]!.operation).toBe('apply_hit_link');
    expect(provider.processes![0]!.momentOperations[0]!.operations[0]!.operation).toBe('apply_attack_link');
    expect(provider.listeners![0]!.eventMatcher.all).toContain('event/basic_attack_start');
    expect(provider.abilities![1]!.processControl).toMatchObject({ useRefFromEvent: true });
    expect(request.rules.damageTypeFormulas![0]!.formula.stages.find(stage => stage.key === 'factor')!.expression).toMatchObject({ op: 'div' });
    expect(request.rules.triggerRules).toBeUndefined();
    expect(coverage).toContainEqual({ authorPath: 'damageTypes.physics.formula', compiledPath: 'rules.damageTypeFormulas[0].formula' });
    expect(request.combatants[0]!.attributes.attack_damage!.base).toBe(60);
    expect(request.combatants[0]!.attributes.crit_damage).toBeUndefined();
  });

  it('编译时刻绑定实际等级参数，间隔只做明确整数毫秒转换', () => {
    const snapshot = simulationSample();
    const { compileRequest: request } = assembleSimulation(snapshot, zeroInputs(snapshot), initialHealth);
    expect(request.sharedProviders![0]!.abilities![1]!.params).toEqual({});
    expect(request.formulas?.find(row => row.key.endsWith('/interval'))?.parameters).toEqual([{ parameterKey: 'milliseconds', valueMode: 'FIXED', valueType: 'DECIMAL', value: 1000 }]);
    expect(request.formulas?.find(row => row.key.endsWith('/multiplier'))?.parameters).toEqual([{ parameterKey: 'base_multiplier', valueMode: 'FIXED', valueType: 'DECIMAL', value: 2 }]);
    expect(request.sharedProviders![0]!.processes![0]!.cooldown).toMatchObject({
      roundPositiveMs: true, durationMs: { op: 'ref', ref: 'selected/sample_basic_attack/levels/1/1/interval' }
    });
  });

  it('未知并列结果、条件、未接入效果及未来阶段引用必须整体拒绝', () => {
    const unknown = simulationSample();
    unknown.skillConfigurations[0]!.effects[1]!.results[1]!.resultType = 'DIRECT_HEAL' as never;
    expect(() => inspectSimulationSnapshot(unknown)).toThrow(/并列结果尚未接入/);
    const condition = simulationSample();
    condition.skillConfigurations[0]!.triggerRules[0]!.oncePerUse = { groupKey: 'limit', scope: 'SKILL' };
    expect(() => inspectSimulationSnapshot(condition)).toThrow(/触发限制/);
    const orphan = simulationSample();
    orphan.skillConfigurations[0]!.effects.push({ ...structuredClone(orphan.skillConfigurations[0]!.effects[0]!), effectKey: 'extra' });
    expect(() => inspectSimulationSnapshot(orphan)).toThrow(/未接入的效果/);
    const forward = simulationSample();
    forward.catalogs.damageTypes[0]!.formula.formula.stages[0]!.expression = { op: 'ref', stageKey: 'factor' };
    expect(() => inspectSimulationSnapshot(forward)).toThrow(/FORMULA_CYCLE/);
  });

  it('缺公式、连续入口非法攻速、非有限与超范围补充值给出明确路径', async () => {
    const missing = simulationSample(); missing.catalogs.damageTypes = [];
    expect(() => inspectSimulationSnapshot(missing)).toThrow(/真实共同防御/);
    const zeroSpeed = simulationSample(); zeroSpeed.source.selectedLevelValues.attack_speed = 0;
    const prepared = assembleSimulation(zeroSpeed, zeroInputs(), initialHealth);
    expect(prepared.compileRequest.combatants[0]!.attributes.attack_speed!.resolved).toBe(0);
    await expect(continuousAttackRequest(prepared, zeroSpeed, { durationMs: 1000, attackSpeedInputMax: 2 })).rejects.toThrow(/continuous.attack_speed/);
    const inputs = zeroInputs(); inputs.source.critical_strike_chance = 1.1;
    expect(() => assembleSimulation(simulationSample(), inputs, initialHealth)).toThrow(/critical_strike_chance/);
    inputs.source.critical_strike_chance = NaN;
    expect(() => assembleSimulation(simulationSample(), inputs, initialHealth)).toThrow(/有限数值/);
  });

  it('摘要包含真实快照与显式场景输入；单次模板身份一致且不安排重复', async () => {
    const snapshot = simulationSample();
    const first = await prepareSimulation(snapshot, zeroInputs(), initialHealth);
    const second = await prepareSimulation(snapshot, zeroInputs(), initialHealth);
    expect(first.compileRequest.rulesHash).toBe(second.compileRequest.rulesHash);
    const changedInputs = zeroInputs(); changedInputs.source.critical_strike_chance = 0.25;
    expect((await prepareSimulation(snapshot, changedInputs, initialHealth)).compileRequest.rulesHash).not.toBe(first.compileRequest.rulesHash);
    const request = singleAttackRequest(first.compileRequest, 'session');
    expect(request.driverPlan.entries).toHaveLength(2);
    expect(request.driverPlan.entries.every(row => !row.repeat && !row.whileReady)).toBe(true);
    expect(request.attackStartFacts![0]!.useRef).toBe(request.skillHitFacts![0]!.useRef);
    expect(request.skillUses![0]!.useKey).toBe(request.skillHitFacts![0]!.useRef);
    expect(request.initialSnapshot.combatants[0]!.providers[0]).toMatchObject({
      providerRef: 'selected_basic_attack', definitionRef: 'selected_basic_attack_definition',
      source: 'source', owner: 'source', stacks: 1, expireAt: null
    });
    expect(request.initialSnapshot.combatants[1]!.providers).toEqual([]);
  });

  it('不丢弃真实的额外技能分类，使同一能力的吸血资格与作者数据一致', () => {
    const snapshot = simulationSample();
    snapshot.skillConfigurations[0]!.skill.skillCategoryKeys.push('common');
    snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'common' });
    const request = assembleSimulation(snapshot, zeroInputs(snapshot), initialHealth).compileRequest;
    expect(request.sharedProviders![0]!.abilities!.every(ability => ability.types!.includes('ability/skill_category/common'))).toBe(true);
  });

  it('双方当前生命为明确场景输入，允许真实0并与上限/基础值分开', () => {
    const snapshot = simulationSample();
    expect(() => assembleSimulation(snapshot, zeroInputs(), undefined as never)).toThrow(/initialHealth.source/);
    expect(() => assembleSimulation(snapshot, zeroInputs(), { source: 651, target: 590 })).toThrow(/initialHealth.source/);
    const prepared = assembleSimulation(snapshot, zeroInputs(), { source: 300, target: 0 });
    expect(prepared.compileRequest.combatants[0]!.attributes.hp).toMatchObject({ base: 650, current: 300, max: 650, resolved: 650 });
    expect(prepared.compileRequest.combatants[1]!.attributes.hp!.current).toBe(0);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
