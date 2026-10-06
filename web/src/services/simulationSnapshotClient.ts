import { ApiRequestError, encodePathSegment, requestJson, type ApiResult } from './apiClient';
import { validateSkillConfiguration } from './skillConfigurationClient';
import { simulationSkillSourceIdentity } from './simulationSkillSourceIdentity';
import type {
  BuildConfiguration, BuildDefinition, SimulationPlannedSkill, SimulationSelection, SimulationSkillSetting, SimulationSkillOrigin, SimulationSnapshot
} from '../types/simulationSnapshot';

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const selectionKeys = [
  'sourceCharacterKey', 'sourceLevel', 'targetCharacterKey', 'targetLevel'
] as const;
const equipmentSelectionKeys = ['sourceEquipmentKeys', 'targetEquipmentKeys'] as const;
const inactiveReasons = ['GLOBAL_DISABLED', 'SCENE_DISABLED', 'UNLEARNED', 'NO_AUTONOMOUS_ATTACK',
  'ACTIVE_DEFERRED', 'CONFIGURATION_INCOMPLETE', 'LEVEL_REQUIRED'];

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

function exactRecord(value: unknown, fields: readonly string[], path: string): Record<string, unknown> {
  const result = record(value, path);
  for (const field of Object.keys(result)) if (!fields.includes(field)) bad(`${path}.${field}`);
  return result;
}

function integer(value: unknown, minimum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2147483647) bad(path);
  return value as number;
}

function origin(value: unknown, path: string): SimulationSkillOrigin {
  const item = record(value, path);
  switch (item.kind) {
    case 'CHARACTER':
      exactRecord(item, ['kind', 'characterKey'], path);
      return { kind: 'CHARACTER', characterKey: key(item.characterKey, `${path}.characterKey`) };
    case 'EQUIPMENT':
      exactRecord(item, ['kind', 'equipmentKey'], path);
      return { kind: 'EQUIPMENT', equipmentKey: key(item.equipmentKey, `${path}.equipmentKey`) };
    case 'BUILD_OPTION':
      exactRecord(item, ['kind', 'systemKey', 'roleKey', 'groupKey', 'slotKey', 'optionKey'], path);
      return { kind: 'BUILD_OPTION', systemKey: key(item.systemKey, `${path}.systemKey`),
        roleKey: key(item.roleKey, `${path}.roleKey`), groupKey: key(item.groupKey, `${path}.groupKey`),
        slotKey: key(item.slotKey, `${path}.slotKey`), optionKey: key(item.optionKey, `${path}.optionKey`) };
    default: return bad(`${path}.kind`);
  }
}

function sortedUnique<T>(items: T[], identity: (item: T) => string, path: string): T[] {
  if (new Set(items.map(identity)).size !== items.length) bad(path);
  return items.sort((left, right) => identity(left).localeCompare(identity(right)));
}

function buildConfigurations(value: unknown, path: string): BuildConfiguration[] {
  const items = rows(value, path).map((item, index) => {
    const entryPath = `${path}[${index}]`;
    exactRecord(item, ['systemKey', 'groupAssignments', 'selections', 'budgets'], entryPath);
    const groupAssignments = rows(item.groupAssignments, `${entryPath}.groupAssignments`).map((assignment, assignmentIndex) => {
      const assignmentPath = `${entryPath}.groupAssignments[${assignmentIndex}]`;
      exactRecord(assignment, ['roleKey', 'groupKey'], assignmentPath);
      return { roleKey: key(assignment.roleKey, `${assignmentPath}.roleKey`), groupKey: key(assignment.groupKey, `${assignmentPath}.groupKey`) };
    });
    const selections = rows(item.selections, `${entryPath}.selections`).map((selection, selectionIndex) => {
      const selectionPath = `${entryPath}.selections[${selectionIndex}]`;
      exactRecord(selection, ['roleKey', 'groupKey', 'slotKey', 'optionKey', 'rank'], selectionPath);
      return { roleKey: key(selection.roleKey, `${selectionPath}.roleKey`), groupKey: key(selection.groupKey, `${selectionPath}.groupKey`),
        slotKey: key(selection.slotKey, `${selectionPath}.slotKey`), optionKey: key(selection.optionKey, `${selectionPath}.optionKey`),
        rank: integer(selection.rank, 1, `${selectionPath}.rank`) };
    });
    const budgetValues = record(item.budgets, `${entryPath}.budgets`);
    const budgets = Object.fromEntries(Object.keys(budgetValues).sort().map(name => [
      key(name, `${entryPath}.budgets.${name}`), integer(budgetValues[name], 0, `${entryPath}.budgets.${name}`)
    ]));
    return { systemKey: key(item.systemKey, `${entryPath}.systemKey`),
      groupAssignments: sortedUnique(groupAssignments, assignment => JSON.stringify([assignment.roleKey, assignment.groupKey]), `${entryPath}.groupAssignments`),
      selections: sortedUnique(selections, selection => JSON.stringify([selection.roleKey, selection.groupKey, selection.slotKey, selection.optionKey]), `${entryPath}.selections`), budgets };
  });
  return sortedUnique(items, item => item.systemKey, path);
}

function skillSettings(value: unknown, path: string): SimulationSkillSetting[] {
  const items = rows(value, path).map((item, index) => {
    const entryPath = `${path}[${index}]`;
    exactRecord(item, ['origin', 'skillKey', 'enabled', 'skillLevel'], entryPath);
    const source = origin(item.origin, `${entryPath}.origin`);
    if (typeof item.enabled !== 'boolean') bad(`${entryPath}.enabled`);
    const setting: SimulationSkillSetting = { origin: source, skillKey: key(item.skillKey, `${entryPath}.skillKey`), enabled: item.enabled as boolean };
    if ('skillLevel' in item) {
      if (source.kind !== 'CHARACTER') bad(`${entryPath}.skillLevel`);
      setting.skillLevel = integer(item.skillLevel, 0, `${entryPath}.skillLevel`);
    }
    return setting;
  });
  return sortedUnique(items, item => simulationSkillSourceIdentity(item.origin, item.skillKey), path);
}

export function normalizeSimulationSelection(value: SimulationSelection): SimulationSelection {
  const selection = exactRecord(value, [...selectionKeys, ...equipmentSelectionKeys, 'sourceBuildConfigurations',
    'targetBuildConfigurations', 'sourceSkillSettings', 'targetSkillSettings', 'basicAttackSkillKey', 'basicAttackLevel', 'plannedSkills'], 'selection');
  const result = {} as SimulationSelection;
  for (const name of selectionKeys) {
    if (name.endsWith('Key')) Object.assign(result, { [name]: key(selection[name], `selection.${name}`) });
    else Object.assign(result, { [name]: integer(selection[name], 1, `selection.${name}`) });
  }
  if ((selection.basicAttackSkillKey === null) !== (selection.basicAttackLevel === null)) bad('selection.basicAttack');
  result.basicAttackSkillKey = selection.basicAttackSkillKey === null ? null : key(selection.basicAttackSkillKey, 'selection.basicAttackSkillKey');
  result.basicAttackLevel = selection.basicAttackLevel === null ? null : integer(selection.basicAttackLevel, 1, 'selection.basicAttackLevel');
  const plans = rows(selection.plannedSkills, 'selection.plannedSkills');
  if (plans.length > 16) bad('selection.plannedSkills');
  result.plannedSkills = sortedUnique(plans.map((plan, index) => {
    const path = `selection.plannedSkills[${index}]`;
    exactRecord(plan, ['origin', 'skillKey', 'skillLevel', 'phaseKinds'], path);
    const source = origin(plan.origin, `${path}.origin`);
    if (source.kind !== 'CHARACTER' || source.characterKey !== result.sourceCharacterKey) bad(`${path}.origin`);
    if (!Array.isArray(plan.phaseKinds) || !plan.phaseKinds.includes('INITIAL')
      || new Set(plan.phaseKinds).size !== plan.phaseKinds.length
      || plan.phaseKinds.some(phase => !['INITIAL', 'CHARGE_RELEASE', 'RECAST', 'CANCEL'].includes(phase))) bad(`${path}.phaseKinds`);
    return { origin: source, skillKey: key(plan.skillKey, `${path}.skillKey`),
      skillLevel: integer(plan.skillLevel, 1, `${path}.skillLevel`),
      phaseKinds: [...plan.phaseKinds].sort() as SimulationPlannedSkill['phaseKinds'] };
  }), plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey), 'selection.plannedSkills');
  for (const side of ['source', 'target'] as const) {
    result[`${side}EquipmentKeys`] = normalizeEquipmentKeys(selection[`${side}EquipmentKeys`], `selection.${side}EquipmentKeys`);
    result[`${side}BuildConfigurations`] = buildConfigurations(selection[`${side}BuildConfigurations`], `selection.${side}BuildConfigurations`);
    result[`${side}SkillSettings`] = skillSettings(selection[`${side}SkillSettings`], `selection.${side}SkillSettings`);
    for (const setting of result[`${side}SkillSettings`]) {
      const source = setting.origin;
      if (source.kind === 'CHARACTER' && source.characterKey !== result[`${side}CharacterKey`]) bad(`selection.${side}SkillSettings.origin`);
      if (source.kind === 'EQUIPMENT' && !result[`${side}EquipmentKeys`].includes(source.equipmentKey)) bad(`selection.${side}SkillSettings.origin`);
      if (source.kind === 'BUILD_OPTION' && !result[`${side}BuildConfigurations`].some(build => build.systemKey === source.systemKey
        && build.selections.some(item => item.roleKey === source.roleKey && item.groupKey === source.groupKey
          && item.slotKey === source.slotKey && item.optionKey === source.optionKey))) bad(`selection.${side}SkillSettings.origin`);
      if (side === 'source' && source.kind === 'CHARACTER' && setting.skillKey === result.basicAttackSkillKey
        && setting.skillLevel !== undefined && setting.skillLevel !== result.basicAttackLevel) bad('selection.sourceSkillSettings.skillLevel');
    }
  }
  for (const plan of result.plannedSkills) {
    const setting = result.sourceSkillSettings.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey)
      === simulationSkillSourceIdentity(plan.origin, plan.skillKey));
    if (setting && (!setting.enabled || setting.skillLevel !== undefined && setting.skillLevel !== plan.skillLevel)) bad('selection.plannedSkills');
  }
  return result;
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

function uniqueCatalog(value: unknown, field: string, path: string, gameId: string, allowDisabled = false) {
  const result = rows(value, path);
  const seen = new Set<string>();
  for (const [index, row] of result.entries()) {
    const stableKey = key(row[field], `${path}[${index}].${field}`);
    if (row.gameId !== gameId || seen.has(stableKey)
      || row.status !== 'ENABLED' && (!allowDisabled || row.status !== 'DISABLED')) bad(`${path}[${index}]`);
    seen.add(stableKey);
  }
  return result;
}

type SourceBinding = { origin: SimulationSkillOrigin; skillKey: string; skillName: string; skillStatus: string; skillLevel?: number };

function binding(value: Record<string, unknown>, source: SimulationSkillOrigin, path: string, skillLevel?: number): SourceBinding {
  if (!['ENABLED', 'DISABLED'].includes(String(value.skillStatus)) || typeof value.skillName !== 'string' || !value.skillName.trim()) bad(path);
  return { origin: source, skillKey: key(value.skillKey, `${path}.skillKey`), skillName: value.skillName as string,
    skillStatus: String(value.skillStatus), skillLevel };
}

function buildDefinition(value: unknown, configuration: BuildConfiguration, gameId: string, path: string): BuildDefinition {
  const definition = exactRecord(value, ['system', 'groups', 'options', 'skillRelations'], path);
  const system = record(definition.system, `${path}.system`);
  if (system.gameId !== gameId || system.systemKey !== configuration.systemKey
    || !['SLOT_SELECTION', 'POINT_ALLOCATION'].includes(String(system.configurationMode))) bad(`${path}.system`);
  const rules = record(system.selectionRules, `${path}.system.selectionRules`);
  const roles = rows(rules.groupRoles, `${path}.system.selectionRules.groupRoles`);
  const groups = rows(definition.groups, `${path}.groups`);
  const options = rows(definition.options, `${path}.options`);
  sortedUnique([...groups], item => key(item.groupKey, `${path}.groups.groupKey`), `${path}.groups`);
  sortedUnique([...options], item => key(item.optionKey, `${path}.options.optionKey`), `${path}.options`);
  for (const group of groups) {
    if (group.gameId !== gameId || group.systemKey !== system.systemKey) bad(`${path}.groups`);
    const slots = rows(group.slots, `${path}.groups.slots`);
    sortedUnique(slots, slot => key(slot.slotKey, `${path}.groups.slots.slotKey`), `${path}.groups.slots`);
    for (const slot of slots) {
      if (!Array.isArray(slot.optionKeys)) bad(`${path}.groups.slots.optionKeys`);
      for (const optionKey of slot.optionKeys as unknown[]) {
        if (!options.some(option => option.optionKey === optionKey)) bad(`${path}.groups.slots.optionKeys`);
      }
    }
  }
  for (const option of options) {
    if (option.gameId !== gameId || option.systemKey !== system.systemKey) bad(`${path}.options`);
    const maximum = integer(option.maxRank, 1, `${path}.options.maxRank`);
    if (!Array.isArray(option.rankCosts) || option.rankCosts.length !== maximum) bad(`${path}.options.rankCosts`);
    for (const cost of option.rankCosts as unknown[]) integer(cost, 0, `${path}.options.rankCosts`);
  }
  for (const assignment of configuration.groupAssignments) {
    const role = roles.find(item => item.roleKey === assignment.roleKey);
    if (!role || !Array.isArray(role.groupKeys) || !role.groupKeys.includes(assignment.groupKey)
      || !groups.some(group => group.groupKey === assignment.groupKey)) bad(`${path}.configuration.groupAssignments`);
  }
  for (const selection of configuration.selections) {
    const group = groups.find(item => item.groupKey === selection.groupKey);
    const option = options.find(item => item.optionKey === selection.optionKey);
    const slot = group && rows(group.slots, `${path}.groups.slots`).find(item => item.slotKey === selection.slotKey);
    if (!configuration.groupAssignments.some(item => item.roleKey === selection.roleKey && item.groupKey === selection.groupKey)
      || !option || selection.rank > Number(option.maxRank) || !slot || !(slot.optionKeys as string[]).includes(selection.optionKey)) bad(`${path}.configuration.selections`);
  }
  const relations = rows(definition.skillRelations, `${path}.skillRelations`);
  const identities = new Set<string>();
  for (const relation of relations) {
    const option = options.find(item => item.optionKey === relation.optionKey);
    const skillKey = key(relation.skillKey, `${path}.skillRelations.skillKey`);
    const identity = JSON.stringify([relation.optionKey, skillKey]);
    if (relation.gameId !== gameId || relation.systemKey !== system.systemKey || !option || identities.has(identity)
      || !['ENABLED', 'DISABLED'].includes(String(relation.skillStatus))) bad(`${path}.skillRelations`);
    identities.add(identity);
    if (integer(relation.activationRank, 1, `${path}.skillRelations.activationRank`) > Number(option.maxRank)) bad(`${path}.skillRelations.activationRank`);
    if (relation.skillLevelMode === 'FIXED') integer(relation.fixedSkillLevel, 1, `${path}.skillRelations.fixedSkillLevel`);
    else if (relation.skillLevelMode !== 'SAME_AS_OPTION' || relation.fixedSkillLevel !== null) bad(`${path}.skillRelations.skillLevelMode`);
  }
  return value as BuildDefinition;
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
  expected = normalizeSimulationSelection(expected);
  const selection = normalizeSimulationSelection(root.selection as SimulationSelection);
  for (const name of selectionKeys) {
    if (selection[name] !== expected[name]) bad(`selection.${name}`);
    if (name.endsWith('Key')) key(selection[name], `selection.${name}`);
    else if (!Number.isInteger(selection[name]) || Number(selection[name]) < 1) bad(`selection.${name}`);
  }
  for (const name of equipmentSelectionKeys) {
    const actual = normalizeEquipmentKeys(selection[name], `selection.${name}`);
    const wanted = normalizeEquipmentKeys(expected[name], `selection.${name}`);
    if (JSON.stringify(record(root.selection, 'selection')[name]) !== JSON.stringify(actual)
      || JSON.stringify(actual) !== JSON.stringify(wanted)) bad(`selection.${name}`);
  }
  for (const side of ['source', 'target'] as const) {
    for (const name of [`${side}BuildConfigurations`, `${side}SkillSettings`] as const) {
      if (JSON.stringify(selection[name]) !== JSON.stringify(expected[name])) bad(`selection.${name}`);
    }
  }
  const expectedSkills = new Set<string>(expected.basicAttackSkillKey === null ? [] : [expected.basicAttackSkillKey]);
  const equipmentAttributeKeys = new Set<string>();
  const sourceRows: Record<string, unknown>[] = [];
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
    const bindings = new Map<string, SourceBinding>();
    const addBinding = (entry: SourceBinding) => {
      const identity = simulationSkillSourceIdentity(entry.origin, entry.skillKey);
      if (bindings.has(identity)) bad(`${side}.skillSources`);
      bindings.set(identity, entry);
      expectedSkills.add(entry.skillKey);
    };
    for (const relation of attached) {
      const skillKey = key(relation.skillKey, `${side}.attachedSkills.skillKey`);
      if (relation.gameId !== gameId || relation.characterKey !== characterKey || seen.has(skillKey)
        || !['ENABLED', 'DISABLED'].includes(String(relation.skillStatus))) bad(`${side}.attachedSkills`);
      seen.add(skillKey);
      addBinding(binding(relation, { kind: 'CHARACTER', characterKey }, `${side}.attachedSkills`,
        side === 'source' && skillKey === expected.basicAttackSkillKey ? expected.basicAttackLevel! : undefined));
    }
    if (side === 'source' && expected.basicAttackSkillKey !== null
      && !attached.some(row => row.skillKey === expected.basicAttackSkillKey && row.skillStatus === 'ENABLED')) {
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
          || !['ENABLED', 'DISABLED'].includes(String(relation.skillStatus)) || seenItemSkills.has(skillKey)) bad(`${path}.attachedSkills`);
        seenItemSkills.add(skillKey);
        addBinding(binding(relation, { kind: 'EQUIPMENT', equipmentKey: equipment.equipmentKey as string }, `${path}.attachedSkills`, 1));
      }
    }
    const builds = rows(actor.selectedBuilds, `${side}.selectedBuilds`);
    const wantedBuilds = expected[`${side}BuildConfigurations`];
    if (builds.length !== wantedBuilds.length) bad(`${side}.selectedBuilds`);
    const seenBuilds = new Set<string>();
    for (const [index, selectedBuild] of builds.entries()) {
      const path = `${side}.selectedBuilds[${index}]`;
      const configuration = buildConfigurations([selectedBuild.configuration], `${path}.configuration`)[0]!;
      const wanted = wantedBuilds.find(item => item.systemKey === configuration.systemKey);
      if (!wanted || seenBuilds.has(configuration.systemKey) || JSON.stringify(configuration) !== JSON.stringify(wanted)) bad(`${path}.configuration`);
      seenBuilds.add(configuration.systemKey);
      const definition = buildDefinition(selectedBuild.definition, configuration, gameId, `${path}.definition`);
      for (const selectedOption of configuration.selections) {
        for (const relation of definition.skillRelations.filter(item => item.optionKey === selectedOption.optionKey && item.activationRank <= selectedOption.rank)) {
          addBinding(binding(relation as unknown as Record<string, unknown>, { kind: 'BUILD_OPTION', systemKey: configuration.systemKey,
            roleKey: selectedOption.roleKey, groupKey: selectedOption.groupKey, slotKey: selectedOption.slotKey, optionKey: selectedOption.optionKey }, path,
          relation.skillLevelMode === 'FIXED' ? relation.fixedSkillLevel! : selectedOption.rank));
        }
      }
    }
    const sources = rows(actor.skillSources, `${side}.skillSources`);
    if (sources.length !== bindings.size) bad(`${side}.skillSources`);
    const seenSources = new Set<string>();
    const settings = expected[`${side}SkillSettings`];
    for (const [index, source] of sources.entries()) {
      const path = `${side}.skillSources[${index}]`;
      const sourceOrigin = origin(source.origin, `${path}.origin`);
      const skillKey = key(source.skillKey, `${path}.skillKey`);
      const identity = simulationSkillSourceIdentity(sourceOrigin, skillKey);
      const relation = bindings.get(identity);
      const setting = settings.find(item => simulationSkillSourceIdentity(item.origin, item.skillKey) === identity);
      if (!relation || seenSources.has(identity) || source.skillStatus !== relation.skillStatus || source.skillName !== relation.skillName
        || typeof source.enabled !== 'boolean' || source.inactiveReason !== null && !inactiveReasons.includes(String(source.inactiveReason))) bad(path);
      seenSources.add(identity);
      if (source.enabled !== (setting?.enabled ?? true)) bad(`${path}.enabled`);
      if (setting?.enabled && relation.skillStatus === 'DISABLED') bad(`${path}.enabled`);
      if (source.skillLevel !== null) integer(source.skillLevel, 0, `${path}.skillLevel`);
      if (relation.skillLevel !== undefined && source.skillLevel !== relation.skillLevel
        || setting?.skillLevel !== undefined && source.skillLevel !== setting.skillLevel) bad(`${path}.skillLevel`);
      if (relation.skillStatus === 'DISABLED' && source.inactiveReason !== 'GLOBAL_DISABLED'
        || relation.skillStatus !== 'DISABLED' && source.enabled === false && source.inactiveReason !== 'SCENE_DISABLED'
        || relation.skillStatus !== 'DISABLED' && source.enabled === true && source.skillLevel === 0 && source.inactiveReason !== 'UNLEARNED'
        || source.inactiveReason === 'GLOBAL_DISABLED' && relation.skillStatus !== 'DISABLED'
        || source.inactiveReason === 'SCENE_DISABLED' && source.enabled !== false
        || source.inactiveReason === 'UNLEARNED' && source.skillLevel !== 0
        || source.inactiveReason === 'LEVEL_REQUIRED' && source.skillLevel !== null) bad(`${path}.inactiveReason`);
      if (!Array.isArray(source.enabledRuleKeys)) bad(`${path}.enabledRuleKeys`);
      if (source.inactiveReason !== null && source.enabledRuleKeys.length) bad(`${path}.enabledRuleKeys`);
      sortedUnique((source.enabledRuleKeys as unknown[]).map((item, ruleIndex) => key(item, `${path}.enabledRuleKeys[${ruleIndex}]`)), item => item, `${path}.enabledRuleKeys`);
      sourceRows.push(source);
    }
    if (settings.some(setting => !seenSources.has(simulationSkillSourceIdentity(setting.origin, setting.skillKey)))) bad(`selection.${side}SkillSettings`);
  }
  const references = rows(root.references, 'references');
  const permittedSkills = new Set([...expectedSkills, ...sourceRows.map(source => String(source.skillKey)),
    ...references.flatMap(reference => [String(reference.targetSkillKey), reference.targetType === 'SKILL' ? String(reference.targetKey) : ''])]);
  const configurations = rows(root.skillConfigurations, 'skillConfigurations');
  if (configurations.length > 32) bad('skillConfigurations');
  const seenSkills = new Set<string>();
  for (const [index, configuration] of configurations.entries()) {
    const skill = record(configuration.skill, `skillConfigurations[${index}].skill`);
    const skillKey = key(skill.skillKey, `skillConfigurations[${index}].skill.skillKey`);
    integer(skill.maxLevel, 1, `skillConfigurations[${index}].skill.maxLevel`);
    if (seenSkills.has(skillKey) || !permittedSkills.has(skillKey) || !['ENABLED', 'DISABLED'].includes(String(skill.status))) bad(`skillConfigurations[${index}].skill`);
    const sources = sourceRows.filter(source => source.skillKey === skillKey);
    if (sources.some(source => source.skillStatus !== skill.status
      || source.skillLevel !== null && Number(source.skillLevel) > Number(skill.maxLevel)
      || record(source.origin, 'origin').kind === 'EQUIPMENT' && skill.maxLevel !== 1)) bad(`skillConfigurations[${index}].skill`);
    seenSkills.add(skillKey);
    validateSkillConfiguration(configuration, gameId, skillKey);
    const ruleKeys = new Set(rows(configuration.triggerRules, `skillConfigurations[${index}].triggerRules`).map(rule => rule.ruleKey));
    if (sources.some(source => (source.enabledRuleKeys as string[]).some(ruleKey => !ruleKeys.has(ruleKey)))) bad(`skillConfigurations[${index}].triggerRules`);
  }
  if ([...expectedSkills].some(skillKey => !seenSkills.has(skillKey))) bad('skillConfigurations');
  for (const plan of expected.plannedSkills) {
    const source = sourceRows.find(row => row.skillKey === plan.skillKey
      && simulationSkillSourceIdentity(origin(row.origin, 'source.skillSources.origin'), plan.skillKey)
        === simulationSkillSourceIdentity(plan.origin, plan.skillKey));
    const configuration = configurations.find(row => record(row.skill, 'skillConfigurations.skill').skillKey === plan.skillKey);
    if (!source || source.enabled !== true || source.skillStatus !== 'ENABLED' || source.skillLevel !== plan.skillLevel
      || source.inactiveReason !== null || !configuration) bad('selection.plannedSkills');
  }
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
  uniqueCatalog(catalogs.skillCategories, 'skillCategoryKey', 'catalogs.skillCategories', gameId, true);
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

export function simulationSnapshotPath(gameId: string): string {
  return `/api/admin/games/${encodePathSegment(gameId)}/simulation-snapshot`;
}

export async function getSimulationSnapshot(
  apiBaseUrl: string,
  gameId: string,
  selection: SimulationSelection,
  token: string,
  signal?: AbortSignal
): Promise<ApiResult<SimulationSnapshot>> {
  const normalized = normalizeSimulationSelection(selection);
  const result = await requestJson<unknown>(apiBaseUrl, simulationSnapshotPath(gameId), {
    method: 'POST', body: JSON.stringify(normalized), token, signal
  });
  return { ...result, data: validateSimulationSnapshot(result.data, gameId, normalized) };
}
