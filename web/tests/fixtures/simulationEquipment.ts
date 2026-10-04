import type { SimulationSelectedEquipment } from '../../src/types/simulationSnapshot';
import { simulationSample } from './simulationSnapshot';

const equipmentValues: Record<string, Record<string, number>> = {
  item_1036: { attack_damage: 10 }, item_1028: { hp: 150 }, item_1042: { bonus_attack_speed_percent: 0.1 }
};
const equipmentNames: Record<string, string> = { item_1036: '样例长剑', item_1028: '样例红水晶', item_1042: '样例短剑' };

export function equipmentSimulationSample(sourceKeys: string[] = [], targetKeys: string[] = []) {
  const snapshot = simulationSample('lol');
  const attribute = snapshot.catalogs.attributes.find(row => row.attributeKey === 'attack_speed')!;
  snapshot.catalogs.attributes.push(...['attack_speed_ratio', 'bonus_attack_speed_percent'].map(attributeKey => ({ ...attribute, attributeKey })));
  for (const side of ['source', 'target'] as const) {
    snapshot[side].selectedLevelValues.bonus_attack_speed_percent = 0.2;
    snapshot[side].attributes.levelValues['1']!.bonus_attack_speed_percent = 0.2;
    const keys = side === 'source' ? sourceKeys : targetKeys;
    snapshot.selection[`${side}EquipmentKeys`] = [...keys].sort();
    snapshot[side].selectedEquipment = [...keys].sort().map(equipmentKey => ({
      equipment: { gameId: 'lol', equipmentKey, name: equipmentNames[equipmentKey] ?? '未核定样例装备', description: null, createdAt: '', updatedAt: '' },
      attributes: { equipmentKey, attributeValues: { ...equipmentValues[equipmentKey] } }, attachedSkills: []
    } satisfies SimulationSelectedEquipment));
  }
  return snapshot;
}
