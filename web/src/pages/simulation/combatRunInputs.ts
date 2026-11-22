import { initialResourceCapacity, initialResourceKey } from '../../engine/initialResourceInputs';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterInput, type SceneInitialParameterRequirement } from '../../engine/sceneInitialParameterInput';
import { simulationAttributeInputIssue, type inspectSimulationSnapshot, type prepareSimulation } from '../../engine/simulationAdapter';
import type { AutomaticSkillInputs } from '../../engine/automaticSkillRequest';
import { equipmentRangeRequirements } from '../../engine/simulationEquipmentRange';
import { simulationHealthLimit } from '../../engine/simulationEquipment';
import type { SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth, SimulationInitialResourceInput, SimulationSnapshot } from '../../types/simulationSnapshot';
import { mechanicDraftIssues, mechanicInputsFromDrafts, type SimulationMechanicDrafts } from './simulationMechanicDrafts';

export type CombatSide = 'source' | 'target';
export type CombatHealthMode = 'full_health' | 'custom';
export type CombatAttributeDrafts = Record<CombatSide, Record<string, number | undefined>>;
export type CombatHealthDraft = Record<CombatSide, number | undefined>;
export type CombatInspection = ReturnType<typeof inspectSimulationSnapshot>;

export type CombatRunInput = {
  selection: SimulationSnapshot['selection'];
  attributes: SimulationAttributeInputs;
  health: SimulationInitialHealth;
  assumptions: SimulationEquipmentAssumption[];
  resources: SimulationInitialResourceInput[];
  mechanics: Parameters<typeof prepareSimulation>[4];
  scene: ReturnType<typeof normalizeSceneInitialParameterInputs>;
  automatic: AutomaticSkillInputs;
};

export type CombatRunDrafts = {
  attributes: CombatAttributeDrafts;
  healthMode: CombatHealthMode;
  health: CombatHealthDraft;
  resources: Record<string, number | undefined>;
  mechanics: SimulationMechanicDrafts;
  automatic: AutomaticSkillInputs;
};

const sides = ['source', 'target'] as const;
const sideName = { source: '攻击方', target: '目标' };

export function combatSceneInputs(snapshot: SimulationSnapshot, requirements: SceneInitialParameterRequirement[],
  values: Record<string, number | undefined>) {
  const issues: string[] = [];
  const inputs = requirements.flatMap(row => {
    const value = values[row.declarationIdentity];
    if (value === undefined || !Number.isFinite(value) || value < row.minValue || value > row.maxValue
      || row.valueType === 'INTEGER' && !Number.isInteger(value)) {
      issues.push(`${sideName[row.side]}／${row.skillName}／${row.parameterName}：请填写合法的战前初值。`);
      return [];
    }
    return [sceneInitialParameterInput(row, value)];
  });
  return { issues, inputs: issues.length ? [] : normalizeSceneInitialParameterInputs(snapshot, inputs) };
}

export function inspectCombatRunInputs(snapshot: SimulationSnapshot, inspection: CombatInspection,
  scene: CombatRunInput['scene'], drafts: CombatRunDrafts, isInRange: (owner: CombatSide, key: string) => boolean) {
  const issues: string[] = [];
  const attributes: SimulationAttributeInputs = { source: {}, target: {} };
  for (const requirement of inspection.requirements) {
    const { side, attribute, storedValue } = requirement;
    const key = attribute.attributeKey;
    const value = storedValue ?? drafts.attributes[side][key];
    if (value === undefined) {
      issues.push(`${sideName[side]}补充属性「${attribute.name}」需明确填写。`);
      continue;
    }
    const issue = simulationAttributeInputIssue(snapshot, requirement, value);
    const kind = storedValue === undefined ? '补充属性' : '属性';
    if (issue) issues.push(`${sideName[side]}${kind}「${attribute.name}」：${issue.message}。`);
    else if (storedValue === undefined) attributes[side][key] = value;
  }

  const health: SimulationInitialHealth = { source: 0, target: 0 };
  const limits: CombatHealthDraft = { source: undefined, target: undefined };
  for (const side of sides) {
    const limit = simulationHealthLimit(snapshot, side, attributes[side].hp, inspection.permanentHealthIncreases[side]);
    limits[side] = limit;
    const value = drafts.healthMode === 'full_health' ? limit : drafts.health[side];
    if (limit === undefined || !(limit > 0)) {
      issues.push(`${sideName[side]}生命上限需为有限正数。`);
    } else if (value === undefined || !Number.isFinite(value) || value <= 0 || value > limit) {
      issues.push(`${sideName[side]}初始当前生命须大于 0 且不超过含装备生命上限 ${limit}。`);
    } else health[side] = value;
  }

  const resources: SimulationInitialResourceInput[] = [];
  for (const row of inspection.resourceRequirements) {
    const current = drafts.resources[initialResourceKey(row.side, row.resourceKey)];
    const capacity = initialResourceCapacity(snapshot, row.side, row.resourceKey, attributes[row.side][row.resourceKey]);
    if (capacity === undefined) {
      issues.push(`${sideName[row.side]}${row.resourceName}容量尚未补全。`);
    } else if (current === undefined || !Number.isFinite(current) || current < 0 || current > capacity) {
      issues.push(`${sideName[row.side]}初始当前${row.resourceName}须明确填写 0～${capacity}。`);
    } else resources.push({ side: row.side, resourceKey: row.resourceKey, current });
  }

  const assumptions = equipmentRangeRequirements(snapshot).map<SimulationEquipmentAssumption>(({ owner, equipmentKey, equipmentName }) => {
    const inRange = isInRange(owner, equipmentKey);
    if (!inRange) issues.push(`请确认${sideName[owner]}${equipmentName}的对手全程在作用范围内。`);
    return { owner, equipmentKey, target: owner === 'source' ? 'target' : 'source', inRange };
  });
  issues.push(...mechanicDraftIssues(inspection.mechanicRequirements, drafts.mechanics));
  const input: CombatRunInput | null = issues.length ? null : {
    selection: snapshot.selection, attributes, health, assumptions, resources, scene,
    mechanics: mechanicInputsFromDrafts(inspection.mechanicRequirements, drafts.mechanics), automatic: drafts.automatic
  };
  return { input, issues, limits };
}

export function mergeCombatRequirements<T>(a: T[], b: T[], key: (row: T) => string): T[] {
  const byKey = new Map(a.map(row => [key(row), row]));
  for (const row of b) if (!byKey.has(key(row))) byKey.set(key(row), row);
  return [...byKey.values()];
}
