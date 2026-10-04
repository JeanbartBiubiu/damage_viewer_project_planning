import { describe, expect, it } from 'vitest';
import { simulationDefaultSourcesSample } from '../../../tests/fixtures/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import { fillSimulationSkillLevelDefaults } from './simulationSkillLevelDefaults';

describe('来源技能最高等级默认值', () => {
  it('双方未设置的角色技能按各自真实最高等级供值，不修改主体或构筑授予', () => {
    const snapshot = simulationDefaultSourcesSample();
    const original = structuredClone(snapshot);
    const result = fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, {});
    expect(result.changed).toBe(true);
    expect(result.selection.sourceSkillSettings).toEqual([{ origin: { kind: 'CHARACTER', characterKey: 'actor_a' },
      skillKey: 'sample_natural', enabled: true, skillLevel: 3 }]);
    expect(result.selection.targetSkillSettings).toEqual([
      { origin: { kind: 'CHARACTER', characterKey: 'actor_b' }, skillKey: 'sample_basic_attack', enabled: true, skillLevel: 1 },
      { origin: { kind: 'CHARACTER', characterKey: 'actor_b' }, skillKey: 'sample_natural', enabled: true, skillLevel: 3 }
    ]);
    expect(result.selection.basicAttackLevel).toBe(1);
    expect(snapshot).toEqual(original);
  });

  it('显式低等级、未学0及手动清空不被最高等级覆盖', () => {
    const snapshot = simulationDefaultSourcesSample();
    const source = snapshot.source.skillSources.find(row => row.skillKey === 'sample_natural')!;
    for (const skillLevel of [0, 1]) {
      snapshot.selection.sourceSkillSettings = [{ origin: source.origin, skillKey: source.skillKey, enabled: false, skillLevel }];
      expect(fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, {}).selection.sourceSkillSettings[0])
        .toMatchObject({ enabled: false, skillLevel });
    }
    snapshot.selection.sourceSkillSettings = [];
    const cleared = { [`source:${simulationSkillSourceIdentity(source.origin, source.skillKey)}`]: true };
    expect(fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, cleared).selection.sourceSkillSettings).toEqual([]);
    source.skillLevel = 1;
    expect(fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, {}).selection.sourceSkillSettings).toEqual([]);
  });

  it('关闭来源仍可默认最高等级，但保留关闭且不修改全局禁用来源', () => {
    const snapshot = simulationDefaultSourcesSample();
    const source = snapshot.source.skillSources.find(row => row.skillKey === 'sample_natural')!;
    source.enabled = false;
    snapshot.selection.sourceSkillSettings = [{ origin: source.origin, skillKey: source.skillKey, enabled: false }];
    const result = fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, {});
    expect(result.selection.sourceSkillSettings).toEqual([{ origin: source.origin, skillKey: source.skillKey, enabled: false, skillLevel: 3 }]);
    expect(result.selection.sourceSkillSettings.some(setting => setting.skillKey === 'sample_disabled')).toBe(false);
  });

  it('已应用默认值后不再要求重读，缺作者定义不猜等级', () => {
    const snapshot = simulationDefaultSourcesSample();
    const first = fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, {});
    expect(fillSimulationSkillLevelDefaults(first.selection, snapshot, {}).changed).toBe(false);
    snapshot.skillConfigurations = snapshot.skillConfigurations.filter(configuration => configuration.skill.skillKey !== 'sample_natural');
    expect(fillSimulationSkillLevelDefaults(snapshot.selection, snapshot, {}).selection.sourceSkillSettings).toEqual([]);
  });
});
