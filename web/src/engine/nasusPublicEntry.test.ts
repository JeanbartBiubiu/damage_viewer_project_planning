import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { SceneInitialParameterInput } from './sceneInitialParameterInput';
import type { SimulationCastCostRef } from './simulationActiveSkills';
import { approveSnapshotFixture, compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';
import { inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { simulationHealthLimit } from './simulationEquipment';
import { validateSimulationSnapshot } from '../services/simulationSnapshotClient';

type ActualFrozenInput = { snapshot: SimulationSnapshot; sceneInputs: SceneInitialParameterInput[]; ignoredCosts: SimulationCastCostRef[];
  attributes: { source: Record<string, number>; target: Record<string, number> } | null; initialHealth: { source: number; target: number } | null };
const inputs = JSON.parse(gunzipSync(readFileSync(new URL('../../tests/fixtures/nasus-public-entry.json.gz', import.meta.url))).toString('utf8')) as ActualFrozenInput[];

describe('真实内瑟斯作者快照经公开检查、准备和正式编译入口', () => {
  it.each(inputs.map((value, index) => ({ value, name: index === 0 ? 'Q/E/R与背景普攻' : 'R-only未计划Q零范围' })))('$name完整准入并保留3结果与比例削甲真实形状', async ({ value }) => {
    const snapshot = structuredClone(value.snapshot);
    expect(validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection)).toBe(snapshot);
    const authorBefore = JSON.stringify(snapshot);
    approveSnapshotFixture(snapshot, value.sceneInputs);
    const inspection = inspectSimulationSnapshot(snapshot, value.ignoredCosts, value.sceneInputs);
    const attributes = structuredClone(value.attributes ?? { source: {}, target: {} });
    for (const requirement of inspection.requirements) if (requirement.storedValue === undefined && attributes[requirement.side][requirement.attribute.attributeKey] === undefined) {
      // 这是明确的测试场景补值；真实作者快照与技能配置不被修改。
      attributes[requirement.side][requirement.attribute.attributeKey] = requirement.attribute.attributeKey === 'attack_speed_ratio' ? .7 : 0;
    }
    const health = value.initialHealth ?? { source: simulationHealthLimit(snapshot, 'source') * .5, target: simulationHealthLimit(snapshot, 'target') };
    const prepared = await prepareSimulation(snapshot, attributes, health, [], [], value.ignoredCosts, value.sceneInputs);
    const healthProvider = prepared.compileRequest.sharedProviders!.find(provider => provider.modifiers?.some(modifier => modifier.kind === 'resource_max'))!;
    expect(healthProvider.lifecycle).toEqual({ durationMs: { op: 'const', value: 15000 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' });
    expect(healthProvider.modifiers).toEqual([
      { modifierKey: 'armor', kind: 'attribute', target: 'self.attr.armor', valuePolicy: 'add', bucket: 'attribute_flat_add', value: { op: 'const', value: 70 } },
      { modifierKey: 'health', kind: 'resource_max', target: 'self.attr.hp', currentValuePolicy: 'grant_positive_delta_clamp', valuePolicy: 'add', value: { op: 'const', value: 600 } },
      { modifierKey: 'magic_resistance', kind: 'attribute', target: 'self.attr.magic_resistance', valuePolicy: 'add', bucket: 'attribute_flat_add', value: { op: 'const', value: 70 } }
    ]);
    const scope = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.modifiers ?? []).find(modifier => modifier.kind === 'cooldown_duration')!;
    if (snapshot.selection.plannedSkills.some(plan => plan.skillKey === 'nasus_e')) {
      const armorProvider = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === 'attribute:nasus_e:armor_reduction:armor')!;
      expect(armorProvider.modifiers).toEqual([{ modifierKey: 'armor', kind: 'attribute', target: 'self.attr.armor', valuePolicy: 'multiply', bucket: 'attribute_percent_multiply', stage: 'total', value: { op: 'const', value: .5 } }]);
      expect(scope.affectedAbilityRefs).toHaveLength(1);
    } else expect(scope.affectedAbilityRefs).toEqual([]);
    const compiled = compileFixtureWithNative(prepared.compileRequest);
    expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(authorBefore);
  });
  it.each(['increase', 'ratio_add', 'wrong_stage', 'source_target', 'two_results', 'out_of_range'])('真实公开入口拒绝整体比例边界%s', mode => {
    const source = structuredClone(inputs[0]!), snapshot = source.snapshot;
    const effect = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'nasus_e')!.effects.find(row => row.effectKey === 'armor_reduction')!;
    const result = effect.results[0]!;
    if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('真实固定夹具形状变化');
    const zone = snapshot.catalogs.modifierZones.find(row => row.modifierZoneKey === result.detail.modifierZoneKey)!;
    if (mode === 'increase') result.detail.operation = 'INCREASE';
    if (mode === 'ratio_add') zone.calculationMode = 'RATIO_ADD';
    if (mode === 'wrong_stage') zone.applicationStage = 'ATTRIBUTE_FLAT';
    if (mode === 'source_target') result.target = 'SOURCE';
    if (mode === 'two_results') effect.results.push({ ...result, resultKey: 'second' });
    if (mode === 'out_of_range') result.valueRule!.value = { kind: 'FIXED', value: 1.1 };
    approveSnapshotFixture(snapshot, source.sceneInputs);
    expect(() => inspectSimulationSnapshot(snapshot, source.ignoredCosts, source.sceneInputs)).toThrow();
  });
});
