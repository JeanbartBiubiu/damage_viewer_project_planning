import { describe, expect, it } from 'vitest';
import { equipmentSimulationSample } from '../../../tests/fixtures/simulationEquipment';
import { inspectCombatRunInputs, type CombatInspection, type CombatRunDrafts } from './combatRunInputs';

const inspection: CombatInspection = {
  requirements: [], coverage: [], equipmentOrigins: [], mechanicRequirements: [], resourceRequirements: [],
  permanentHealthIncreases: { source: 25, target: 0 }
};

function drafts(): CombatRunDrafts {
  return {
    attributes: { source: {}, target: {} }, healthMode: 'full_health', health: { source: undefined, target: undefined },
    resources: {}, mechanics: {},
    automatic: { rules: [], durationMs: 30_000, recordTimeSeries: true, attackSpeedInputMax: 10,
      outputMode: 'detailed', maxAutomaticSkillRecords: 1000, maxHealingRecords: 256 }
  };
}

describe('混合战斗方案有效初态', () => {
  const a = equipmentSimulationSample(['item_1028']);
  const b = equipmentSimulationSample(['item_1036']);

  it('每个方案独立按含装备和永久收益的上限开始', () => {
    expect(inspectCombatRunInputs(a, inspection, [], drafts(), () => false).input?.health).toEqual({ source: 825, target: 590 });
    expect(inspectCombatRunInputs(b, inspection, [], drafts(), () => false).input?.health).toEqual({ source: 675, target: 590 });
  });

  it('共同手填生命在 B 越界时不产生有效输入', () => {
    const input = drafts();
    input.healthMode = 'custom';
    input.health = { source: 700, target: 590 };
    expect(inspectCombatRunInputs(a, inspection, [], input, () => false).input?.health).toEqual(input.health);
    expect(inspectCombatRunInputs(b, inspection, [], input, () => false)).toMatchObject({
      input: null, limits: { source: 675, target: 590 }, issues: [expect.stringContaining('不超过含装备生命上限 675')]
    });
  });

  it('缺失属性留空，用户明确填写的合法零值保留在冻结输入', () => {
    const snapshot = structuredClone(b);
    const attribute = snapshot.catalogs.attributes.find(row => row.attributeKey === 'armor')!;
    delete snapshot.source.selectedLevelValues.armor;
    const required = { ...inspection, requirements: [{ side: 'source' as const, attribute, storedValue: undefined }] };
    const input = drafts();
    expect(inspectCombatRunInputs(snapshot, required, [], input, () => false).input).toBeNull();
    input.attributes.source.armor = 0;
    expect(inspectCombatRunInputs(snapshot, required, [], input, () => false).input?.attributes.source.armor).toBe(0);
  });
});
