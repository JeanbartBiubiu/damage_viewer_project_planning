import { describe, expect, it } from 'vitest';
import { permanentEquipmentSimulationSample } from '../../tests/fixtures/simulationPermanentEquipment';
import { assembleSimulation, inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';

function inputsFor(snapshot: ReturnType<typeof permanentEquipmentSimulationSample>) {
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  return inputs;
}
const health = { source: 650, target: 590 };
const aura = [{ owner: 'target' as const, equipmentKey: 'item_3110', target: 'source' as const, inRange: true }];

describe('4B完整常驻装备', () => {
  it('双方振奋各自完整建立治疗和护盾，所有来源、效果及初始化不串', async () => {
    const snapshot = permanentEquipmentSimulationSample(['item_3065'], ['item_3065']);
    const prepared = await prepareSimulation(snapshot, inputsFor(snapshot), health);
    const providers = prepared.compileRequest.sharedProviders!;
    expect(providers.filter(row => row.modifiers?.some(modifier => modifier.command === 'heal'))).toHaveLength(2);
    expect(providers.filter(row => row.modifiers?.some(modifier => modifier.command === 'shield'))).toHaveLength(2);
    expect(new Set(providers.map(row => row.providerKey)).size).toBe(providers.length);
    for (const initializer of providers.filter(row => row.listeners?.some(listener => listener.eventMatcher.all?.includes('event/source_initialized')))) {
      expect(initializer.listeners).toHaveLength(2);
      expect(initializer.listeners).toMatchObject([{ maxTriggersPerEvent: 1, operations: [{ target: 'self' }] }, { maxTriggersPerEvent: 1, operations: [{ target: 'self' }] }]);
    }
    await expect(continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 })).resolves.toBeDefined();
  });

  it('冰心缺范围确认拒绝，显式假设进入摘要、覆盖及运行冻结输入', async () => {
    const snapshot = permanentEquipmentSimulationSample([], ['item_3110']);
    const inputs = inputsFor(snapshot);
    expect(() => assembleSimulation(snapshot, inputs, health)).toThrow(/equipmentAssumptions/);
    for (const assumptions of [[{ ...aura[0]!, inRange: false }], [{ ...aura[0]!, target: 'target' as const }], [...aura, ...aura]]) {
      expect(() => assembleSimulation(snapshot, inputs, health, assumptions)).toThrow(/equipmentAssumptions/);
    }
    const prepared = await prepareSimulation(snapshot, inputs, health, aura);
    expect(prepared.compileRequest.sharedProviders!.flatMap(row => row.modifiers ?? [])).toContainEqual(expect.objectContaining({ target: 'opponent.attr.attack_speed', value: { op: 'const', value: .8 } }));
    expect(prepared.coverage.some(row => row.authorPath.startsWith('equipmentAssumptions.target'))).toBe(true);
    const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 1000, attackSpeedInputMax: 2 });
    expect(continuous.runRequest.runtimeOptions!.equipmentAssumptions).toEqual(aura);
    expect(prepared.equipmentAssumptions).not.toBe(aura);
  });

  it('拒绝缺护盾、夹带命中触发或额外配置，不静默过滤', () => {
    const missing = permanentEquipmentSimulationSample(['item_3065']);
    missing.skillConfigurations[1]!.effects.pop();
    expect(() => inspectSimulationSnapshot(missing)).toThrow(/必须完整/);
    const trigger = permanentEquipmentSimulationSample(['item_3065']);
    trigger.skillConfigurations[1]!.triggerRules[0]!.eventSource = { eventType: 'BASIC_ATTACK_HIT', detail: { sourceSkillKey: null } };
    expect(() => inspectSimulationSnapshot(trigger)).toThrow(/初始化/);
    const extra = permanentEquipmentSimulationSample(['item_3065']);
    extra.skillConfigurations.push(structuredClone(extra.skillConfigurations[1]!));
    expect(() => inspectSimulationSnapshot(extra)).toThrow(/重复/);
  });
});
