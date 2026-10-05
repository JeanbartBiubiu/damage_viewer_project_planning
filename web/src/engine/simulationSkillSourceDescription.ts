import type { ProviderDefinition } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSkillOrigin, SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { NumericAdaptationError } from './numericAdapter';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';

export type SimulationSourceSide = 'source' | 'target';
type Side = SimulationSourceSide;
export type TriggeredSkillSourceDescription = {
  side: Side;
  kind: 'item' | 'character' | 'build';
  stableId: string;
  providerRef: string;
  definitionRef: string;
  path: string;
  skills: Array<{
    skillKey: string;
    skillLevel: number;
    path: string;
    configuration: SkillConfiguration;
    allowedRootKeys?: readonly string[];
    permanentModifier?: (result: SkillConfiguration['effects'][number]['results'][number], path: string) =>
      NonNullable<ProviderDefinition['modifiers']>[number];
  }>;
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

const OWN_ATTACK_EVENTS = new Set(['BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED']);

export function naturalRuleKeys(snapshot: SimulationSnapshot, configuration: SkillConfiguration, side: Side) {
  const allSides = new Set(['SOURCE_INITIALIZED', 'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);
  return configuration.triggerRules.filter(rule => {
    if (!rule.actions.length) return false;
    const event = rule.eventSource;
    if (allSides.has(event.eventType)) return true;
    if (OWN_ATTACK_EVENTS.has(event.eventType)) return side === 'source';
    if (event.eventType === 'BASIC_ATTACK_RECEIVED') return side === 'target';
    if (event.eventType === 'SKILL_USED' || event.eventType === 'SKILL_HIT') {
      return side === 'source' && event.detail.sourceSkillKey === snapshot.selection.basicAttackSkillKey
        && (event.eventType !== 'SKILL_USED' || event.detail.castPhase === 'INITIAL');
    }
    return false;
  }).map(rule => rule.ruleKey).sort();
}

function onlyUndrivenAttackRoots(configuration: SkillConfiguration) {
  const roots = configuration.triggerRules.filter(rule => OWN_ATTACK_EVENTS.has(rule.eventSource.eventType)
    && rule.actions.length > 0).map(rule => rule.ruleKey);
  if (!roots.length) return false;
  return selectSimulationSkillSourceClosure(configuration, roots).excludedRuleKeys.length === 0;
}

export function executableEquipmentRelations(snapshot: SimulationSnapshot, side: Side, equipmentKey: string) {
  const item = snapshot[side].selectedEquipment.find(row => row.equipment.equipmentKey === equipmentKey);
  if (!item) fail(`${side}.selectedEquipment`, '缺少实际所选装备');
  return item.attachedSkills.filter(relation => {
    const matches = snapshot[side].skillSources.filter(source => source.origin.kind === 'EQUIPMENT'
      && source.origin.equipmentKey === equipmentKey && source.skillKey === relation.skillKey);
    if (matches.length !== 1) fail(`${side}.skillSources`, '装备绑定技能的默认来源缺失或重复');
    return matches[0]!.enabled && matches[0]!.skillStatus === 'ENABLED' && matches[0]!.skillLevel !== 0;
  });
}

function sourceRelations(snapshot: SimulationSnapshot, side: Side) {
  const expected = new Map<string, { skillStatus: SimulationSkillSource['skillStatus']; skillLevel?: number }>();
  for (const relation of snapshot[side].attachedSkills) {
    expected.set(simulationSkillSourceIdentity({ kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey }, relation.skillKey),
      { skillStatus: relation.skillStatus });
  }
  for (const item of snapshot[side].selectedEquipment) for (const relation of item.attachedSkills) {
    expected.set(simulationSkillSourceIdentity({ kind: 'EQUIPMENT', equipmentKey: item.equipment.equipmentKey }, relation.skillKey),
      { skillStatus: relation.skillStatus, skillLevel: 1 });
  }
  for (const selected of snapshot[side].selectedBuilds) for (const choice of selected.configuration.selections) {
    for (const relation of selected.definition.skillRelations.filter(row => row.optionKey === choice.optionKey && row.activationRank <= choice.rank)) {
      expected.set(simulationSkillSourceIdentity({ kind: 'BUILD_OPTION', systemKey: selected.definition.system.systemKey,
        roleKey: choice.roleKey, groupKey: choice.groupKey, slotKey: choice.slotKey, optionKey: choice.optionKey }, relation.skillKey),
        { skillStatus: relation.skillStatus, skillLevel: relation.skillLevelMode === 'FIXED' ? relation.fixedSkillLevel! : choice.rank });
    }
  }
  return expected;
}

export function validateSimulationSkillSourceManifest(snapshot: SimulationSnapshot) {
  const configurations = new Map(snapshot.skillConfigurations.map(row => [row.skill.skillKey, row]));
  if (configurations.size !== snapshot.skillConfigurations.length) fail('skillConfigurations', '完整作者配置不能重复');
  const allowedConfigurations = new Set([snapshot.selection.basicAttackSkillKey,
    ...snapshot.references.map(row => row.targetSkillKey).filter(Boolean)]);
  for (const side of ['source', 'target'] as const) {
    if (!Array.isArray(snapshot[side].skillSources) || !Array.isArray(snapshot[side].selectedBuilds)) {
      fail(side, '缺少阶段5默认来源及构筑清单');
    }
    const expected = sourceRelations(snapshot, side);
    const actual = new Set<string>();
    const settings = snapshot.selection[`${side}SkillSettings`];
    if (!Array.isArray(settings)) fail(`selection.${side}SkillSettings`, '来源覆盖设置必须明确提供数组');
    for (const source of snapshot[side].skillSources) {
      const identity = simulationSkillSourceIdentity(source.origin, source.skillKey);
      if (!expected.has(identity) || actual.has(identity)) fail(`${side}.skillSources`, '默认来源与原始绑定不一致或重复');
      const relation = expected.get(identity)!;
      if (source.skillStatus !== relation.skillStatus || relation.skillLevel !== undefined && source.skillLevel !== relation.skillLevel) {
        fail(`${side}.skillSources.${source.skillKey}`, '实际来源全局状态或等级与真实绑定授予不一致');
      }
      actual.add(identity);
      allowedConfigurations.add(source.skillKey);
      if (typeof source.enabled !== 'boolean' || !Array.isArray(source.enabledRuleKeys)
        || new Set(source.enabledRuleKeys).size !== source.enabledRuleKeys.length) fail(`${side}.skillSources`, '来源开关或自然入口缺失或重复');
      const overrides = settings.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
      if (overrides.length > 1 || source.enabled !== (overrides[0]?.enabled ?? true)) fail(`${side}.skillSources`, '来源开关与明确场景设置不一致');
      if (source.origin.kind === 'CHARACTER' && overrides[0]?.skillLevel !== undefined
        && source.skillLevel !== overrides[0].skillLevel) fail(`${side}.skillSources.${source.skillKey}.skillLevel`, '实际来源等级与明确场景设置不一致');
      const configuration = configurations.get(source.skillKey);
      if (source.skillStatus === 'ENABLED' && (!configuration || configuration.skill.status !== 'ENABLED')) {
        fail(`${side}.skillSources.${source.skillKey}`, '完整启用作者配置缺失或全局状态不一致');
      }
      if (source.enabled && source.skillStatus === 'ENABLED' && source.skillLevel !== 0 && configuration) {
        const selectedPrimary = side === 'source' && source.origin.kind === 'CHARACTER'
          && source.skillKey === snapshot.selection.basicAttackSkillKey;
        const roots = naturalRuleKeys(snapshot, configuration, side);
        if (source.inactiveReason === 'NO_AUTONOMOUS_ATTACK') {
          const undrivenPrimary = source.origin.kind === 'CHARACTER' && !selectedPrimary
            && configuration.skill.skillCategoryKeys.includes('basic_attack')
            && roots.every(key => OWN_ATTACK_EVENTS.has(configuration.triggerRules.find(rule => rule.ruleKey === key)!.eventSource.eventType))
            && onlyUndrivenAttackRoots(configuration);
          const undrivenNatural = side === 'target' && source.origin.kind !== 'EQUIPMENT'
            && roots.length === 0 && onlyUndrivenAttackRoots(configuration);
          if (selectedPrimary || source.enabledRuleKeys.length || !undrivenPrimary && !undrivenNatural) {
            fail(`${side}.skillSources.${source.skillKey}`, '无自主普攻排除原因不能隐藏真实自然入口或所选主体，必须是本场不驱动的真实攻击来源');
          }
        }
        if (source.inactiveReason === 'ACTIVE_DEFERRED' && (roots.length
          || !configuration.triggerRules.some(rule => ['SKILL_USED', 'SKILL_HIT'].includes(rule.eventSource.eventType)))) {
          fail(`${side}.skillSources.${source.skillKey}`, '主动后置原因不能隐藏真实自然入口');
        }
        if (source.origin.kind !== 'EQUIPMENT' && source.inactiveReason === null
          && (source.enabledRuleKeys.length !== roots.length || source.enabledRuleKeys.some(key => !roots.includes(key)))) {
          fail(`${side}.skillSources.${source.skillKey}`, '开启来源必须完整保留真实自然入口');
        }
      }
    }
    if (actual.size !== expected.size) fail(`${side}.skillSources`, '默认来源不能被过滤为部分绑定');
    if (settings.some(row => !expected.has(simulationSkillSourceIdentity(row.origin, row.skillKey)))) fail(`selection.${side}SkillSettings`, '覆盖设置不能授予额外未绑定技能');
  }
  for (const configuration of snapshot.skillConfigurations) if (!allowedConfigurations.has(configuration.skill.skillKey)
    || configuration.skill.gameId !== snapshot.gameId) fail('skillConfigurations', '配置集合只能包含默认来源及实际只读依赖');
}

export function equipmentSourceEnabled(snapshot: SimulationSnapshot, side: Side, origin: SimulationSkillOrigin, skillKey: string) {
  const identity = simulationSkillSourceIdentity(origin, skillKey);
  const sources = snapshot[side].skillSources.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity);
  if (sources.length !== 1) fail(`${side}.skillSources`, '来源开关缺失或重复');
  return sources[0]!.enabled && sources[0]!.skillStatus === 'ENABLED' && sources[0]!.skillLevel !== 0;
}
