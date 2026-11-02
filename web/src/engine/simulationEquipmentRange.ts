import type { SimulationEquipmentAssumption, SimulationSnapshot } from '../types/simulationSnapshot';
import { NumericAdaptationError } from './numericAdapter';
import { executableEquipmentRelations, validateSimulationSkillSourceManifest } from './simulation/sources/description';
import { selectSimulationSkillSourceClosure } from './simulation/sources/closure';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function equipmentRangeRequirements(snapshot: SimulationSnapshot) {
  validateSimulationSkillSourceManifest(snapshot);
  return (['source', 'target'] as const).flatMap(owner => snapshot[owner].selectedEquipment.filter(item =>
    executableEquipmentRelations(snapshot, owner, item.equipment.equipmentKey).some(relation => {
      const source = snapshot[owner].skillSources.find(row => row.origin.kind === 'EQUIPMENT'
        && row.origin.equipmentKey === item.equipment.equipmentKey && row.skillKey === relation.skillKey)!;
      const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === relation.skillKey);
      if (configurations.length !== 1) fail(`${owner}.selectedEquipment.${item.equipment.equipmentKey}`, '范围来源缺少完整唯一作者配置');
      const { configuration } = selectSimulationSkillSourceClosure(configurations[0]!, source.enabledRuleKeys);
      return configuration.effects.some(effect => effect.lifecycle?.instanceScope === 'SOURCE'
        && (effect.lifecycle.periodicIntervalValue !== null && effect.results.some(result => result.resultType === 'DAMAGE' && result.target === 'TARGET')
          || effect.lifecycle.expiryMode === 'EXPLICIT_ONLY' && effect.lifecycle.periodicIntervalValue === null
            && effect.results.some(result => result.resultType === 'ATTRIBUTE_CHANGE' && result.target === 'TARGET' && result.detail.attributeKey !== 'hp')));
    })).map(item => ({ owner, equipmentKey: item.equipment.equipmentKey, equipmentName: item.equipment.name })));
}

export function validateEquipmentAssumptions(snapshot: SimulationSnapshot, assumptions: readonly SimulationEquipmentAssumption[]) {
  const expected = equipmentRangeRequirements(snapshot);
  if (assumptions.length !== expected.length) fail('equipmentAssumptions', '每个静态光环或来源周期都必须明确确认唯一对手全程在范围内');
  for (const { owner, equipmentKey } of expected) {
    const rows = assumptions.filter(row => row.owner === owner && row.equipmentKey === equipmentKey);
    if (rows.length !== 1 || rows[0]!.target !== (owner === 'source' ? 'target' : 'source') || rows[0]!.inRange !== true) {
      fail(`equipmentAssumptions.${owner}.${equipmentKey}`, '范围目标必须为另一方，且必须明确确认全程在范围内');
    }
  }
  return structuredClone([...assumptions].sort((left, right) => left.owner.localeCompare(right.owner) || left.equipmentKey.localeCompare(right.equipmentKey)));
}
