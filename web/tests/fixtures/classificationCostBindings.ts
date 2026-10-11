import type { SimulationCastCostRef } from '../../src/engine/simulationActiveSkills';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { fixedValue } from '../../src/types/numericValue';
import { simulationActiveSample } from './simulationActiveSkill';
import { triggeredEquipmentSimulationSample } from './simulationTriggeredEquipment';
import { syncSimulationSkillSources } from './simulationSkillSources';
import { permanentEquipmentSimulationSample } from './simulationPermanentEquipment';

export const authoredCostRef: SimulationCastCostRef = { skillKey: 'sample_active', bindingKey: 'pay_authored_fee', effectKey: 'authored_cost', resultKey: 'consume_fee' };

/** 明确作者构造：分类已改名，任意数值属性只作为费用元数据，不为角色添加数值。 */
export function classificationCostBindingsSample(): SimulationSnapshot {
  const snapshot = simulationActiveSample();
  snapshot.selection.basicAttackSkillKey = 'sample_basic_attack';
  snapshot.selection.basicAttackLevel = 1;
  const equipment = JSON.parse(JSON.stringify(triggeredEquipmentSimulationSample()).replaceAll('"lol"', '"demo"')) as SimulationSnapshot;
  const item = equipment.source.selectedEquipment[0]!;
  item.attributes.attributeValues = {};
  snapshot.source.selectedEquipment.push(item);
  snapshot.selection.sourceEquipmentKeys.push(item.equipment.equipmentKey);
  snapshot.skillConfigurations.push(equipment.skillConfigurations.find(row => row.skill.skillKey === 'item_1043_passive')!);
  snapshot.catalogs.skillCategories.push(equipment.catalogs.skillCategories.find(row => row.skillCategoryKey === 'passive')!);
  const rules = snapshot.catalogs.calculationRules.configuration!;
  rules.equipmentPassiveCategoryKey = 'passive';
  rules.ignorableCastCostAttributeKeys = ['spell_fee'];
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'spell_fee', name: '作者明确费用', valueType: 'INTEGER' });
  const skill = snapshot.skillConfigurations.find(row => row.skill.skillKey === authoredCostRef.skillKey)!;
  skill.effects.push({ gameId: snapshot.gameId, skillKey: skill.skill.skillKey, effectKey: authoredCostRef.effectKey, name: '作者明确施法成本',
    description: null, sortOrder: 20, lifecycle: null, createdAt: '', updatedAt: '', results: [{ resultKey: authoredCostRef.resultKey,
      name: '作者费用消费', resultType: 'RESOURCE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
      valueRule: { value: fixedValue(7), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { attributeKey: 'spell_fee', operation: 'CONSUME' }, lifecycleBehavior: null, spellShieldBlockScope: null }] });
  skill.processes[0]!.effectBindings.push({ bindingKey: authoredCostRef.bindingKey, effectKey: authoredCostRef.effectKey,
    moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, sortOrder: 0 });
  const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll('"basic_attack"', '"authored_strike"').replaceAll('"passive"', '"authored_item"')) as SimulationSnapshot;
  return syncSimulationSkillSources(renamed);
}

/** 两个独立装备来源完整保留，不合并或裁剪作者初始化、效果或关系。 */
export function authoredAuraPairSample(differentAttributes = false): SimulationSnapshot {
  const snapshot = permanentEquipmentSimulationSample([], ['item_3110']);
  const originalItem = snapshot.target.selectedEquipment[0]!;
  const originalSkill = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'item_3110_passive')!;
  const secondItem = JSON.parse(JSON.stringify(originalItem).replaceAll('item_3110', 'authored_aura_b')) as typeof originalItem;
  const secondSkill = JSON.parse(JSON.stringify(originalSkill).replaceAll('item_3110', 'authored_aura_b')) as typeof originalSkill;
  originalSkill.parameters[0]!.fixedValue = .2;
  secondSkill.parameters[0]!.fixedValue = .5;
  const result = secondSkill.effects[0]!.results[0]!;
  if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('光环样例必须保留原属性结果');
  if (differentAttributes) result.detail.attributeKey = 'armor';
  snapshot.target.selectedEquipment.push(secondItem);
  snapshot.skillConfigurations.push(secondSkill);
  snapshot.selection.targetEquipmentKeys.push(secondItem.equipment.equipmentKey);
  snapshot.source.selectedLevelValues.attack_speed = 1;
  snapshot.source.attributes.levelValues['1'] = { ...snapshot.source.selectedLevelValues };
  const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll('item_3110', 'authored_aura_a')
    .replaceAll('"attack_speed"', '"authored_tempo"').replaceAll('"armor"', '"authored_guard"')
    .replaceAll('"basic_attack"', '"authored_strike"').replaceAll('"passive"', '"authored_item"')) as SimulationSnapshot;
  return syncSimulationSkillSources(renamed);
}
