import { ApiRequestError, encodePathSegment, requestJson, type ApiResult } from './apiClient';
import { validateSkillConfiguration } from './skillConfigurationClient';
import type { SimulationSelection, SimulationSnapshot } from '../types/simulationSnapshot';

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const selectionKeys = [
  'sourceCharacterKey', 'sourceLevel', 'targetCharacterKey', 'targetLevel',
  'basicAttackSkillKey', 'basicAttackLevel'
] as const;
const equipmentSelectionKeys = ['sourceEquipmentKeys', 'targetEquipmentKeys'] as const;

export function normalizeEquipmentKeys(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 6) bad(path);
  const keys = (value as unknown[]).map((item, index) => key(item, `${path}[${index}]`));
  if (new Set(keys).size !== keys.length) bad(path);
  return keys.sort();
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad(path);
  return value as Record<string, unknown>;
}

function bad(path: string): never {
  throw new ApiRequestError(`场景快照字段不完整或不一致：${path}`, 502, 'INVALID_SIMULATION_SNAPSHOT');
}

function key(value: unknown, path: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) bad(path);
  return value as string;
}

function rows(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) bad(path);
  return (value as unknown[]).map((row, index) => record(row, `${path}[${index}]`));
}

function numericMap(value: unknown, path: string): Record<string, unknown> {
  const result = record(value, path);
  for (const [name, amount] of Object.entries(result)) {
    key(name, `${path}.${name}`);
    if (typeof amount !== 'number' || !Number.isFinite(amount)) bad(`${path}.${name}`);
  }
  return result;
}

function uniqueCatalog(value: unknown, field: string, path: string, gameId: string) {
  const result = rows(value, path);
  const seen = new Set<string>();
  for (const [index, row] of result.entries()) {
    const stableKey = key(row[field], `${path}[${index}].${field}`);
    if (row.gameId !== gameId || seen.has(stableKey) || row.status !== 'ENABLED') bad(`${path}[${index}]`);
    seen.add(stableKey);
  }
  return result;
}

export function validateSimulationSnapshot(
  value: unknown,
  gameId: string,
  expected: SimulationSelection
): SimulationSnapshot {
  const root = record(value, 'snapshot');
  if (root.gameId !== gameId || typeof root.snapshotDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(root.snapshotDigest)
    || typeof root.readAt !== 'string' || !Number.isFinite(Date.parse(root.readAt))) bad('snapshot');
  const selection = record(root.selection, 'selection');
  for (const name of selectionKeys) {
    if (selection[name] !== expected[name]) bad(`selection.${name}`);
    if (name.endsWith('Key')) key(selection[name], `selection.${name}`);
    else if (!Number.isInteger(selection[name]) || Number(selection[name]) < 1) bad(`selection.${name}`);
  }
  for (const name of equipmentSelectionKeys) {
    const actual = normalizeEquipmentKeys(selection[name], `selection.${name}`);
    const wanted = normalizeEquipmentKeys(expected[name], `selection.${name}`);
    if (JSON.stringify(selection[name]) !== JSON.stringify(actual)
      || JSON.stringify(actual) !== JSON.stringify(wanted)) bad(`selection.${name}`);
  }
  const expectedSkills = new Set([expected.basicAttackSkillKey]);
  const equipmentAttributeKeys = new Set<string>();
  for (const side of ['source', 'target'] as const) {
    const actor = record(root[side], side);
    const character = record(actor.character, `${side}.character`);
    const attrs = record(actor.attributes, `${side}.attributes`);
    const characterKey = side === 'source' ? expected.sourceCharacterKey : expected.targetCharacterKey;
    const level = side === 'source' ? expected.sourceLevel : expected.targetLevel;
    if (character.gameId !== gameId || character.characterKey !== characterKey || attrs.characterKey !== characterKey
      || !Number.isInteger(attrs.minLevel) || !Number.isInteger(attrs.maxLevel)
      || level < Number(attrs.minLevel) || level > Number(attrs.maxLevel)) bad(side);
    const levelValues = record(attrs.levelValues, `${side}.attributes.levelValues`);
    const selected = numericMap(actor.selectedLevelValues, `${side}.selectedLevelValues`);
    const stored = numericMap(levelValues[String(level)], `${side}.attributes.levelValues.${level}`);
    if (Object.keys(stored).length !== Object.keys(selected).length
      || Object.keys(stored).some(name => selected[name] !== stored[name])) bad(`${side}.selectedLevelValues`);
    const attached = rows(actor.attachedSkills, `${side}.attachedSkills`);
    const seen = new Set<string>();
    for (const relation of attached) {
      const skillKey = key(relation.skillKey, `${side}.attachedSkills.skillKey`);
      if (relation.gameId !== gameId || relation.characterKey !== characterKey || seen.has(skillKey)
        || !['ENABLED', 'DISABLED'].includes(String(relation.skillStatus))) bad(`${side}.attachedSkills`);
      seen.add(skillKey);
    }
    if (side === 'source' && !attached.some(row => row.skillKey === expected.basicAttackSkillKey && row.skillStatus === 'ENABLED')) {
      bad('source.attachedSkills');
    }
    const selectedEquipment = rows(actor.selectedEquipment, `${side}.selectedEquipment`);
    const expectedKeys = normalizeEquipmentKeys(expected[`${side}EquipmentKeys`], `selection.${side}EquipmentKeys`);
    if (selectedEquipment.length !== expectedKeys.length) bad(`${side}.selectedEquipment`);
    for (const [index, selectedItem] of selectedEquipment.entries()) {
      const path = `${side}.selectedEquipment[${index}]`;
      const equipment = record(selectedItem.equipment, `${path}.equipment`);
      const itemAttributes = record(selectedItem.attributes, `${path}.attributes`);
      if (equipment.gameId !== gameId || equipment.equipmentKey !== expectedKeys[index]
        || itemAttributes.equipmentKey !== equipment.equipmentKey) bad(path);
      const values = numericMap(itemAttributes.attributeValues, `${path}.attributes.attributeValues`);
      for (const name of Object.keys(values)) equipmentAttributeKeys.add(name);
      const seenItemSkills = new Set<string>();
      for (const relation of rows(selectedItem.attachedSkills, `${path}.attachedSkills`)) {
        const skillKey = key(relation.skillKey, `${path}.attachedSkills.skillKey`);
        if (relation.gameId !== gameId || relation.equipmentKey !== equipment.equipmentKey
          || relation.skillStatus !== 'ENABLED' || seenItemSkills.has(skillKey)) bad(`${path}.attachedSkills`);
        seenItemSkills.add(skillKey);
        expectedSkills.add(skillKey);
      }
    }
  }
  const configurations = rows(root.skillConfigurations, 'skillConfigurations');
  if (configurations.length > 32) bad('skillConfigurations');
  const seenSkills = new Set<string>();
  for (const [index, configuration] of configurations.entries()) {
    const skill = record(configuration.skill, `skillConfigurations[${index}].skill`);
    const skillKey = key(skill.skillKey, `skillConfigurations[${index}].skill.skillKey`);
    if (seenSkills.has(skillKey) || !expectedSkills.has(skillKey) || skill.status !== 'ENABLED') bad(`skillConfigurations[${index}].skill`);
    seenSkills.add(skillKey);
    validateSkillConfiguration(configuration, gameId, skillKey);
  }
  if (seenSkills.size !== expectedSkills.size) bad('skillConfigurations');
  const catalogs = record(root.catalogs, 'catalogs');
  const levels = record(catalogs.levelConfig, 'catalogs.levelConfig');
  if (levels.gameId !== gameId || !Number.isInteger(levels.minLevel) || !Number.isInteger(levels.maxLevel)
    || expected.sourceLevel < Number(levels.minLevel) || expected.targetLevel < Number(levels.minLevel)
    || expected.sourceLevel > Number(levels.maxLevel) || expected.targetLevel > Number(levels.maxLevel)) bad('catalogs.levelConfig');
  const attributes = uniqueCatalog(catalogs.attributes, 'attributeKey', 'catalogs.attributes', gameId);
  for (const name of equipmentAttributeKeys) {
    if (!attributes.some(attribute => attribute.attributeKey === name)) bad(`catalogs.attributes.${name}`);
  }
  for (const [index, attribute] of attributes.entries()) {
    if (!['INTEGER', 'DECIMAL'].includes(String(attribute.valueType))) bad(`catalogs.attributes[${index}].valueType`);
    for (const field of ['minValue', 'maxValue'] as const) {
      const amount = attribute[field];
      if (amount != null && (typeof amount !== 'number' || !Number.isFinite(amount))) bad(`catalogs.attributes[${index}].${field}`);
    }
  }
  uniqueCatalog(catalogs.skillCategories, 'skillCategoryKey', 'catalogs.skillCategories', gameId);
  uniqueCatalog(catalogs.modifierZones, 'modifierZoneKey', 'catalogs.modifierZones', gameId);
  uniqueCatalog(catalogs.statuses, 'statusKey', 'catalogs.statuses', gameId);
  const seenDamageTypes = new Set<string>();
  for (const [index, row] of rows(catalogs.damageTypes, 'catalogs.damageTypes').entries()) {
    const type = record(row.type, `catalogs.damageTypes[${index}].type`);
    const formula = record(row.formula, `catalogs.damageTypes[${index}].formula`);
    const damageTypeKey = key(type.damageTypeKey, `catalogs.damageTypes[${index}].type.damageTypeKey`);
    if (seenDamageTypes.has(damageTypeKey) || type.gameId !== gameId || type.status !== 'ENABLED'
      || type.formulaConfigured !== true || formula.gameId !== gameId || formula.damageTypeKey !== damageTypeKey) {
      bad(`catalogs.damageTypes[${index}]`);
    }
    record(formula.formula, `catalogs.damageTypes[${index}].formula.formula`);
    seenDamageTypes.add(damageTypeKey);
  }
  const vamp = record(catalogs.vampRules, 'catalogs.vampRules');
  rows(vamp.rules, 'catalogs.vampRules.rules');
  rows(root.references, 'references');
  return value as SimulationSnapshot;
}

export function simulationSnapshotPath(gameId: string, selection: SimulationSelection): string {
  const params = new URLSearchParams();
  for (const name of selectionKeys) params.set(name, String(selection[name]));
  for (const name of equipmentSelectionKeys) {
    for (const equipmentKey of normalizeEquipmentKeys(selection[name], `selection.${name}`)) params.append(name, equipmentKey);
  }
  return `/api/admin/games/${encodePathSegment(gameId)}/simulation-snapshot?${params.toString()}`;
}

export async function getSimulationSnapshot(
  apiBaseUrl: string,
  gameId: string,
  selection: SimulationSelection,
  token: string,
  signal?: AbortSignal
): Promise<ApiResult<SimulationSnapshot>> {
  const result = await requestJson<unknown>(apiBaseUrl, simulationSnapshotPath(gameId, selection), { token, signal });
  return { ...result, data: validateSimulationSnapshot(result.data, gameId, selection) };
}
