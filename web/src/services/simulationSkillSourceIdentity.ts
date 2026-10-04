import type { SimulationSkillOrigin } from '../types/simulationSnapshot';

export function simulationSkillSourceIdentity(origin: SimulationSkillOrigin, skillKey: string): string {
  switch (origin.kind) {
    case 'CHARACTER': return JSON.stringify([origin.kind, origin.characterKey, skillKey]);
    case 'EQUIPMENT': return JSON.stringify([origin.kind, origin.equipmentKey, skillKey]);
    case 'BUILD_OPTION': return JSON.stringify([
      origin.kind, origin.systemKey, origin.roleKey, origin.groupKey, origin.slotKey, origin.optionKey, skillKey
    ]);
  }
}
