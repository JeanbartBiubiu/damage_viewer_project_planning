import type { GenericRules, ProviderDefinition } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { normalizeEquipmentKeys } from '../services/simulationSnapshotClient';
import { constExpr, finiteNumber, NumericAdaptationError } from './numericAdapter';
import { PERMANENT_EQUIPMENT_SKILLS } from './simulationEquipmentPassives';

export const PURE_EQUIPMENT_KEYS = ['item_1028', 'item_1036', 'item_1042'] as const;
export type EquipmentOrigin = {
  side: 'source' | 'target'; equipmentKey: string; equipmentName: string;
  providerRef: string; definitionRef: string; attributeValues: Record<string, number>;
  authorPath: string; compiledPath: string;
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function assembleEquipment(snapshot: SimulationSnapshot, skillDerivationSides: ReadonlySet<'source' | 'target'> = new Set()) {
  const providers: ProviderDefinition[] = [];
  const origins: EquipmentOrigin[] = [];
  const coverage: Array<{ authorPath: string; compiledPath: string }> = [];
  const derivations: NonNullable<GenericRules['attributeDerivations']> = [];
  const required = { source: new Set<string>(), target: new Set<string>() };
  for (const side of ['source', 'target'] as const) {
    const selectedKeys = normalizeEquipmentKeys(snapshot.selection[`${side}EquipmentKeys`], `selection.${side}EquipmentKeys`);
    const selected = snapshot[side].selectedEquipment;
    if (!Array.isArray(selected) || selected.length !== selectedKeys.length
      || new Set(selected.map(row => row.equipment.equipmentKey)).size !== selected.length) {
      fail(`${side}.selectedEquipment`, '所选装备完整集缺失或重复');
    }
    let needsDerivation = skillDerivationSides.has(side);
    for (const equipmentKey of selectedKeys) {
      const path = `${side}.selectedEquipment[${equipmentKey}]`;
      const item = selected.find(row => row.equipment.equipmentKey === equipmentKey);
      if (!item || item.equipment.gameId !== snapshot.gameId || item.attributes.equipmentKey !== equipmentKey) {
        fail(path, '装备归属或属性标识不一致');
      }
      if (!Array.isArray(item.attachedSkills)) fail(`${path}.attachedSkills`, '装备必须保留完整技能关系数组');
      const supportedPassive = PERMANENT_EQUIPMENT_SKILLS[equipmentKey] || item.attachedSkills.length > 0;
      if (snapshot.gameId !== 'lol' || (!supportedPassive && !PURE_EQUIPMENT_KEYS.includes(equipmentKey as typeof PURE_EQUIPMENT_KEYS[number]))) {
        fail(path, '该装备尚未核定为4A纯属性，且缺少完整启用被动关系，不能仅取直接属性');
      }
      const values = item.attributes.attributeValues;
      if (!values || typeof values !== 'object' || Array.isArray(values)) fail(`${path}.attributes.attributeValues`, '需要完整直接属性映射');
      const providerRef = `${side}_equipment_${equipmentKey}`;
      const definitionRef = `${providerRef}_definition`;
      const mountIndex = origins.filter(row => row.side === side).length + (side === 'source' ? 1 : 0);
      const providerIndex = providers.length + 1;
      const compiledPath = `sharedProviders[${providerIndex}]`;
      const modifiers = Object.keys(values).sort().map((attributeKey, index) => {
        const authorPath = `${path}.attributes.attributeValues.${attributeKey}`;
        const attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey === attributeKey && row.status === 'ENABLED');
        if (attributes.length !== 1) fail(authorPath, '装备属性缺少唯一已启用的真实目录');
        const amount = finiteNumber(values[attributeKey], authorPath, fail);
        if (attributes[0]!.valueType === 'INTEGER' && !Number.isInteger(amount)) fail(authorPath, '装备属性增量违反整数约束');
        required[side].add(attributeKey);
        if (attributeKey === 'bonus_attack_speed_percent') needsDerivation = true;
        coverage.push({ authorPath, compiledPath: `${compiledPath}.modifiers[${index}]` });
        return { modifierKey: `attribute_${attributeKey}`, kind: 'attribute', target: `self.attr.${attributeKey}`,
          valuePolicy: 'add', value: constExpr(amount) };
      });
      providers.push({ providerKey: definitionRef, stableId: definitionRef, kind: 'item', modifiers });
      origins.push({ side, equipmentKey, equipmentName: item.equipment.name, providerRef, definitionRef,
        attributeValues: { ...values }, authorPath: path, compiledPath });
      coverage.push({ authorPath: `${path}.equipment.equipmentKey`, compiledPath: `combatants[${side === 'source' ? 0 : 1}].providers[${mountIndex}]` });
    }
    if (needsDerivation) {
      const ratio = snapshot.catalogs.attributes.filter(row => row.attributeKey === 'attack_speed_ratio' && row.status === 'ENABLED');
      if (ratio.length !== 1 || ratio[0]!.valueType !== 'DECIMAL' || ratio[0]!.minValue !== 0) {
        fail(`catalogs.attributes.attack_speed_ratio`, `${side === 'source' ? '攻击方' : '目标'}装备攻速需要已启用、小数类型且最小值为0的收益系数目录；缺目录不能运行短剑`);
      }
      for (const attributeKey of ['attack_speed', 'bonus_attack_speed_percent', 'attack_speed_ratio']) required[side].add(attributeKey);
      const read = (attributeKey: string, slot: string) => ({ op: 'read', path: `${side}.attr.${attributeKey}.${slot}` });
      const index = derivations.length;
      derivations.push({ combatantKey: side, attributeKey: 'attack_speed', value: {
        op: 'add', args: [read('attack_speed', 'base'), { op: 'mul', args: [read('attack_speed_ratio', 'resolved'), {
          op: 'sub', args: [read('bonus_attack_speed_percent', 'resolved'), read('bonus_attack_speed_percent', 'base')]
        }] }]
      } });
      const expressionPath = `rules.attributeDerivations[${index}].value`;
      const baselinePath = (attributeKey: string) => Object.prototype.hasOwnProperty.call(snapshot[side].selectedLevelValues, attributeKey)
        ? `${side}.selectedLevelValues.${attributeKey}` : `attributeInputs.${side}.${attributeKey}`;
      coverage.push(
        { authorPath: baselinePath('attack_speed'), compiledPath: `${expressionPath}.args[0]` },
        { authorPath: baselinePath('attack_speed_ratio'), compiledPath: `${expressionPath}.args[1].args[0]` },
        { authorPath: baselinePath('bonus_attack_speed_percent'), compiledPath: `${expressionPath}.args[1].args[1].args[1]` }
      );
      for (const origin of origins.filter(row => row.side === side && 'bonus_attack_speed_percent' in row.attributeValues)) {
        coverage.push({ authorPath: `${origin.authorPath}.attributes.attributeValues.bonus_attack_speed_percent`, compiledPath: `${expressionPath}.args[1].args[1].args[0]` });
      }
    }
  }
  return { providers, origins, coverage, derivations, required };
}

export function equipmentContribution(snapshot: SimulationSnapshot, side: 'source' | 'target', attributeKey: string): number {
  return snapshot[side].selectedEquipment.reduce((total, item) => total + (item.attributes.attributeValues[attributeKey] ?? 0), 0);
}

export function simulationHealthLimit(snapshot: SimulationSnapshot, side: 'source' | 'target', explicitBaseline?: number): number | undefined {
  const baseline = snapshot[side].selectedLevelValues.hp ?? explicitBaseline;
  if (baseline === undefined) return undefined;
  const limit = baseline + equipmentContribution(snapshot, side, 'hp');
  return Number.isFinite(limit) ? limit : undefined;
}
