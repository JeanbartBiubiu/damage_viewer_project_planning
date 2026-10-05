import type { SkillActionInput } from '../../engine/skillActionRequest';
import type { SimulationPlannedSkill } from '../../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';

export function plannedSkillsFromActions(actions: readonly SkillActionInput[]): SimulationPlannedSkill[] {
  const plans = new Map<string, SimulationPlannedSkill>();
  for (const action of actions) {
    const identity = simulationSkillSourceIdentity(action.origin, action.skillKey);
    const previous = plans.get(identity);
    if (previous && previous.skillLevel !== action.skillLevel) throw new Error('同一真实来源只能有一个技能等级');
    plans.set(identity, { origin: action.origin, skillKey: action.skillKey, skillLevel: action.skillLevel, phaseKinds: ['INITIAL'] });
  }
  if (plans.size > 16) throw new Error('本次最多16份不同真实角色来源');
  return [...plans].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, plan]) => plan);
}
