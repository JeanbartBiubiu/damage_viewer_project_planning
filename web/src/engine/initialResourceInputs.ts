import type { ProviderDefinition } from '../types/genericEngine';
import type { SimulationAttributeInputs, SimulationInitialResourceInput, SimulationSnapshot } from '../types/simulationSnapshot';
import { NumericAdaptationError } from './numericAdapter';
import { equipmentContribution } from './simulationEquipment';
import { compiledTargetMark } from './targetMarkContract';

type Side = 'source' | 'target';
export type InitialResourceRequirement = { side: Side; resourceKey: string; resourceName: string; maxValue: number | undefined };
export const initialResourceKey = (side: Side, resourceKey: string) => `${side}:${resourceKey}`;
function fail(message: string): never { throw new NumericAdaptationError('initialResourceInputs', message); }

export function initialResourceCapacity(snapshot: SimulationSnapshot, side: Side, key: string, attributeInput?: number): number | undefined {
  const base = snapshot[side].selectedLevelValues[key] ?? attributeInput;
  if (base === undefined) return undefined;
  const maxValue = base + equipmentContribution(snapshot, side, key);
  if (!Number.isFinite(maxValue) || maxValue <= 0) fail('可恢复资源容量必须有限且严格大于0，不能把0当成无上限');
  return maxValue;
}

/** 只从已装配且真实挂载的普通自身恢复闭包收集；无当前值也能报告容量需求。 */
export function initialResourceRequirements(snapshot: SimulationSnapshot, providers: readonly ProviderDefinition[],
  mounts: readonly { side: Side; providerRef: string; definitionRef: string }[], attributes?: SimulationAttributeInputs): InitialResourceRequirement[] {
  const required = new Map<string, InitialResourceRequirement>();
  for (const mount of mounts) {
    const definitions = providers.filter(provider => provider.providerKey === mount.definitionRef);
    if (definitions.length !== 1) fail('资源恢复缺少唯一真实挂载定义');
    for (const ability of definitions[0]!.abilities ?? []) for (const operation of ability.listenerSpec?.operations ?? []) {
      const mark = compiledTargetMark(operation, `providers.${mount.providerRef}.abilities.${ability.abilityKey}`);
      const restoration = mark ? mark.restore : operation;
      if (!restoration || restoration.operation !== 'resource_change' || restoration.target !== 'self') continue;
      const key = restoration.resourceKey;
      if (!key || key === 'hp') fail('普通资源恢复需要明确非生命资源');
      const entries = snapshot.catalogs.attributes.filter(row => row.attributeKey === key && row.gameId === snapshot.gameId && row.status === 'ENABLED');
      if (entries.length !== 1) fail('可恢复资源缺少唯一已启用的真实属性目录');
      required.set(initialResourceKey(mount.side, key), { side: mount.side, resourceKey: key, resourceName: entries[0]!.name,
        maxValue: initialResourceCapacity(snapshot, mount.side, key, attributes?.[mount.side][key]) });
    }
  }
  return [...required.values()].sort((a, b) => initialResourceKey(a.side, a.resourceKey).localeCompare(initialResourceKey(b.side, b.resourceKey)));
}

export function normalizeInitialResourceInputs(required: readonly InitialResourceRequirement[], inputs: readonly SimulationInitialResourceInput[] = []): SimulationInitialResourceInput[] {
  if (!Array.isArray(inputs)) fail('初始资源输入必须为数组');
  const byKey = new Map<string, SimulationInitialResourceInput>();
  for (const row of inputs) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== 3 || Object.keys(row).some(key => !['side', 'resourceKey', 'current'].includes(key))
      || !['source', 'target'].includes(row.side) || typeof row.resourceKey !== 'string') fail('初始资源输入形状不完整');
    const key = initialResourceKey(row.side, row.resourceKey), requirement = required.find(item => initialResourceKey(item.side, item.resourceKey) === key);
    if (!requirement || byKey.has(key)) fail('初始资源输入不是本场需求或已经重复');
    if (requirement.maxValue === undefined || !Number.isFinite(requirement.maxValue) || requirement.maxValue <= 0) fail('资源容量尚未补全或不是有限正数');
    if (typeof row.current !== 'number' || !Number.isFinite(row.current) || row.current < 0 || row.current > requirement.maxValue) fail('初始当前资源必须明确处于0至真实容量之间');
    byKey.set(key, { ...row });
  }
  if (byKey.size !== required.length) fail('请明确填写本场可恢复资源的初始当前值，0也需要填写；不默认满额');
  return required.map(row => byKey.get(initialResourceKey(row.side, row.resourceKey))!);
}
