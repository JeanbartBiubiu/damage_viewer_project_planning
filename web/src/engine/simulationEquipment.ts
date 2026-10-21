import type { ProviderDefinition } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { normalizeEquipmentKeys } from '../services/simulationSnapshotClient';
import { constExpr, finiteNumber, NumericAdaptationError } from './numericAdapter';
import { changedAttributes } from './simulationCalculationRules';

export type EquipmentOrigin = {
  side: 'source' | 'target'; equipmentKey: string; equipmentName: string;
  providerRef: string; definitionRef: string; attributeValues: Record<string, number>;
  authorPath: string; compiledPath: string;
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function assembleEquipment(snapshot: SimulationSnapshot) {
  const providers: ProviderDefinition[] = [];
  const origins: EquipmentOrigin[] = [];
  const coverage: Array<{ authorPath: string; compiledPath: string }> = [];
  const changed = changedAttributes();
  const required = { source: new Set<string>(), target: new Set<string>() };
  for (const side of ['source', 'target'] as const) {
    const selectedKeys = normalizeEquipmentKeys(snapshot.selection[`${side}EquipmentKeys`], `selection.${side}EquipmentKeys`);
    const selected = snapshot[side].selectedEquipment;
    if (!Array.isArray(selected) || selected.length !== selectedKeys.length
      || new Set(selected.map(row => row.equipment.equipmentKey)).size !== selected.length) {
      fail(`${side}.selectedEquipment`, '所选装备完整集缺失或重复');
    }
    for (const equipmentKey of selectedKeys) {
      const path = `${side}.selectedEquipment[${equipmentKey}]`;
      const item = selected.find(row => row.equipment.equipmentKey === equipmentKey);
      if (!item || item.equipment.gameId !== snapshot.gameId || item.attributes.equipmentKey !== equipmentKey) {
        fail(path, '装备归属或属性标识不一致');
      }
      if (!Array.isArray(item.attachedSkills)) fail(`${path}.attachedSkills`, '装备必须保留完整技能关系数组');
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
        changed[side].add(attributeKey);
        coverage.push({ authorPath, compiledPath: `${compiledPath}.modifiers[${index}]` });
        return { modifierKey: `attribute_${attributeKey}`, kind: 'attribute', target: `self.attr.${attributeKey}`,
          valuePolicy: 'add', value: constExpr(amount) };
      });
      providers.push({ providerKey: definitionRef, stableId: definitionRef, kind: 'item', modifiers });
      origins.push({ side, equipmentKey, equipmentName: item.equipment.name, providerRef, definitionRef,
        attributeValues: { ...values }, authorPath: path, compiledPath });
      coverage.push({ authorPath: `${path}.equipment.equipmentKey`, compiledPath: `combatants[${side === 'source' ? 0 : 1}].providers[${mountIndex}]` });
    }

  }
  return { providers, origins, coverage, changedAttributes: changed, required };
}

export function equipmentContribution(snapshot: SimulationSnapshot, side: 'source' | 'target', attributeKey: string): number {
  return snapshot[side].selectedEquipment.reduce((total, item) => total + (item.attributes.attributeValues[attributeKey] ?? 0), 0);
}

export function simulationHealthLimit(snapshot: SimulationSnapshot, side: 'source' | 'target', explicitBaseline?: number, permanentIncrease = 0): number | undefined {
  const baseline = snapshot[side].selectedLevelValues.hp ?? explicitBaseline;
  if (baseline === undefined) return undefined;
  if (!Number.isFinite(permanentIncrease) || permanentIncrease < 0) return undefined;
  const limit = baseline + equipmentContribution(snapshot, side, 'hp') + permanentIncrease;
  return Number.isFinite(limit) ? limit : undefined;
}
