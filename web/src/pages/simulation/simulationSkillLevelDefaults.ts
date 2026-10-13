import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import type { SimulationSelection, SimulationSnapshot } from '../../types/simulationSnapshot';

export function fillSimulationSkillLevelDefaults(selection: SimulationSelection, snapshot: SimulationSnapshot,
  clearedLevels: Readonly<Record<string, boolean>>) {
  const next = { ...selection };
  let changed = false;
  for (const side of ['source', 'target'] as const) {
    const settings = [...selection[`${side}SkillSettings`]];
    for (const source of snapshot[side].skillSources) {
      const identity = simulationSkillSourceIdentity(source.origin, source.skillKey);
      if (source.origin.kind !== 'CHARACTER' || source.skillStatus !== 'ENABLED' || source.skillLevel !== null
        || clearedLevels[`${side}:${identity}`]
        || side === 'source' && source.skillKey === selection.basicAttackSkillKey) continue;
      const index = settings.findIndex(setting => simulationSkillSourceIdentity(setting.origin, setting.skillKey) === identity);
      if (settings[index]?.skillLevel !== undefined) continue;
      const maximum = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === source.skillKey)?.skill.maxLevel;
      if (maximum === undefined) continue;
      const setting = { ...(settings[index] ?? { origin: source.origin, skillKey: source.skillKey, enabled: source.enabled }), skillLevel: maximum };
      if (index < 0) settings.push(setting);
      else settings[index] = setting;
      changed = true;
    }
    next[`${side}SkillSettings`] = settings;
  }
  return { selection: next, changed };
}
