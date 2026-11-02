import type { ModifierDefinition, ProviderDefinition } from '../types/genericEngine';
import type { SkillEffectAttributeChangeResult } from '../types/skillEffect';
import type { PermanentResultContext } from './simulationPermanentResults';
import type { SimulationCoverage, OperationOrigin, SimulationSkillOriginTrace } from './simulation/model';
import { createNumericCompileState, NumericAdaptationError } from './numericAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { shieldEffectDefinitionRef, shieldResultDefinitionRef } from './shieldEffectAdapter';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';

type Dependency = { context: PermanentResultContext; result: SkillEffectAttributeChangeResult; path: string };
// 私有装配信息不进入Generic协议；只关联本次实际编译产生的修正对象。
const dependencies = new WeakMap<ModifierDefinition, Dependency>();
const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };

export function shieldAttributeProofLevels(snapshot: SimulationSnapshot, configuration: SkillConfiguration,
  result: SkillEffectAttributeChangeResult, selectedSkillLevel: number, selectedCharacterLevel: number) {
  const value = result.valueRule?.value;
  const formula = value?.kind === 'FORMULA' ? configuration.formulas.find(row => row.formulaKey === value.formulaKey) : undefined;
  if (value?.kind === 'FORMULA' && !formula) fail(`skills.${configuration.skill.skillKey}.effects`, '依赖盾属性缺少完整公式');
  const keys = value?.kind === 'PARAMETER' ? [value.parameterKey] : formula
    ? skillFormulaReachableInputs(formula.expression)
      .flatMap(input => input.binding.kind === 'parameter' ? [input.binding.parameterKey] : []) : [];
  const modes = configuration.parameters.filter(parameter => keys.includes(parameter.parameterKey)).map(parameter => parameter.valueMode);
  const ranks = modes.includes('SKILL_LEVEL') ? Array.from({ length: configuration.skill.maxLevel }, (_, index) => index + 1) : [selectedSkillLevel];
  const config = snapshot.catalogs.levelConfig;
  const levels = modes.includes('CHARACTER_LEVEL') ? Array.from({ length: config.maxLevel - config.minLevel + 1 }, (_, index) => config.minLevel + index) : [selectedCharacterLevel];
  return ranks.flatMap(skillLevel => levels.map(characterLevel => ({ skillLevel, characterLevel })));
}

export function registerShieldAttributeDependency(context: PermanentResultContext, result: SkillEffectAttributeChangeResult,
  path: string, modifier: ModifierDefinition) {
  const dependency = result.detail.requiredShield;
  if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)
    || Object.keys(dependency).length !== 3 || Object.keys(dependency).some(key => !['skillKey', 'effectKey', 'resultKey'].includes(key))
    || Object.values(dependency).some(value => typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value))) fail(`${path}.detail.requiredShield`, '依赖盾需要完整且唯一的技能、效果和结果标识');
  const behavior = result.lifecycleBehavior;
  const effect = context.configuration.effects.find(row => row.results.includes(result));
  if (context.source.origin.kind === 'EQUIPMENT' || result.target !== 'SOURCE' || result.detail.attributeKey === 'hp'
    || !['INCREASE', 'DECREASE'].includes(result.detail.operation) || result.spellShieldBlockScope !== null
    || effect?.results.length !== 1 || behavior?.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'MOMENT_EVALUATION'
    || behavior.stackValueMode !== 'SHARED' || behavior.reapplicationValueMode !== null || behavior.periodicExecutionMode !== null
    || !result.valueRule) fail(path, '依赖盾只接完整自身永久静态非生命属性');
  const effectKey = effect!.effectKey;
  const consumers = context.configuration.triggerRules.flatMap(rule => rule.actions.filter(action =>
    action.actionType === 'EXECUTE_EFFECT' && action.detail.effectKey === effectKey).map(action => ({ rule, action })));
  const consumer = consumers[0];
  if (consumers.length !== 1 || !consumer || consumer.rule.eventSource.eventType !== 'SOURCE_INITIALIZED'
    || Object.keys(consumer.rule.eventSource.detail).length || consumer.rule.conditionGroups.length
    || consumer.rule.oncePerUse !== null || consumer.rule.perTargetCooldown !== null || consumer.rule.maxTriggersPerProcess !== null
    || consumer.action.targetContext !== 'EVENT_SOURCE' || consumer.action.runtimeInputBindings.length
    || consumer.action.resultModifiers.length || context.configuration.processes.some(process => process.effectBindings.some(binding => binding.effectKey === effectKey))) {
    fail(path, '依赖盾属性只接唯一无条件拥有者初始化，不能丢弃事件、条件或过程消费资格');
  }
  for (const { skillLevel, characterLevel } of shieldAttributeProofLevels(context.snapshot, context.configuration, result,
    context.source.skillLevel!, context.snapshot.selection[`${context.side}Level`])) {
      const state = createNumericCompileState({ gameId: context.snapshot.gameId, skillKey: context.source.skillKey, skillLevel,
        characterLevel, parameters: context.configuration.parameters, formulas: context.configuration.formulas,
        formulaNamespace: `${context.formulaNamespace}/dependency-check`, bindParameters: false, allowAttributeReads: false,
        runtimeInputMessage: '依赖盾属性必须在全部声明等级静态确定' });
      const amount = staticEffectAmount(result.valueRule, `${path}.valueRule`, state);
      if (amount < 0 || result.detail.operation === 'DECREASE' && modifier.valuePolicy !== 'add' && amount > 1) fail(path, '依赖盾的全部声明等级金额必须非负，比例减少不超过1');
  }
  dependencies.set(modifier, { context, result, path });
}

/** 自然来源闭包全部装配后，才将显式依赖合入同拥有者的唯一真实关联盾。 */
export function bindShieldAttributeDependencies(providers: ProviderDefinition[], origins: SimulationSkillOriginTrace[],
  coverage: SimulationCoverage[], operationOrigins: OperationOrigin[], mounts: Array<{ side: 'source' | 'target'; providerRef: string; definitionRef: string }>) {
  const removed = new Set<string>();
  for (const staging of providers) for (const modifier of staging.modifiers ?? []) {
    const dependency = dependencies.get(modifier);
    if (!dependency) continue;
    const { context, result, path } = dependency, ref = result.detail.requiredShield!;
    if (staging.kind !== 'status' || staging.modifiers?.length !== 1) fail(path, '依赖盾属性缺少唯一实际编译结果');
    const matching = origins.filter(origin => origin.side === context.side && origin.skillKey === ref.skillKey
      && origin.origin.kind === context.source.origin.kind
      && simulationSkillSourceIdentity(origin.origin, origin.skillKey) === simulationSkillSourceIdentity(context.source.origin, ref.skillKey));
    if (matching.length !== 1) fail(`${path}.detail.requiredShield`, '依赖盾缺少同拥有者唯一真实来源');
    const origin = matching[0]!;
    const configuration = context.snapshot.skillConfigurations.find(row => row.skill.skillKey === ref.skillKey);
    const effect = configuration?.effects.find(row => row.effectKey === ref.effectKey);
    const shield = effect?.results.find(row => row.resultKey === ref.resultKey);
    if (!effect || effect.gameId !== context.snapshot.gameId || effect.lifecycle?.instanceScope !== 'SOURCE'
      || effect.lifecycle.endWhenShieldEndsResultKey !== ref.resultKey || shield?.resultType !== 'NORMAL_SHIELD'
      || shield.target !== 'SOURCE' || effect.results.filter(row => row.resultType === 'NORMAL_SHIELD').length !== 1) fail(path, '依赖必须指向同游戏真实自身关联普通盾');
    removed.add(staging.providerKey);
    const note = '静态属性持续依赖同拥有者的明确关联盾；破盾沿同一实例移除';
    if (!origin.enabled || origin.skillStatus !== 'ENABLED' || !origin.skillLevel) {
      coverage.push({ authorPath: `${path}.detail.requiredShield`, compiledPath: 'runtimeOptions.skillOrigins', note: '真实兄弟来源关闭或未学，本场不挂依赖属性' });
      continue;
    }
    if (!origin.definitionRef || !origin.providerRef) fail(path, '已启用依赖盾没有真实来源挂载');
    const providerKey = shieldEffectDefinitionRef(ref.skillKey, ref.effectKey, origin.definitionRef);
    const shieldRef = shieldResultDefinitionRef(ref.skillKey, ref.effectKey, ref.resultKey, origin.definitionRef);
    const candidates = providers.filter(provider => provider.providerKey === providerKey && provider.linkedShieldDefinitionRef === shieldRef);
    const parent = providers.find(provider => provider.providerKey === origin.definitionRef);
    const hasOwnedShield = (node: unknown): boolean => {
      if (!node || typeof node !== 'object') return false;
      if (Array.isArray(node)) return node.some(hasOwnedShield);
      const row = node as Record<string, unknown>;
      return row.operation === 'shield' && row.target === 'self' && row.shieldRef === shieldRef
        && row.shieldLifecycleProviderDefinitionRef === providerKey || Object.values(row).some(hasOwnedShield);
    };
    if (candidates.length !== 1 || !parent || !hasOwnedShield(parent)) fail(path, '依赖盾缺少唯一实际拥有者程序及关联盾操作');
    const linked = candidates[0]!;
    const key = `${context.source.skillKey}/${result.resultKey}`;
    if (linked.modifiers?.some(row => row.modifierKey === key)) fail(path, '同一关联盾属性重复装配');
    const index = (linked.modifiers ??= []).length;
    linked.modifiers.push({ ...modifier, modifierKey: key });
    const compiledPath = `sharedProviders[${linked.providerKey}].modifiers[${index}]`;
    coverage.push({ authorPath: path, compiledPath, note },
      { authorPath: `${path}.detail.requiredShield`, compiledPath, note },
      { authorPath: `skills.${ref.skillKey}.effects.${ref.effectKey}.results.${ref.resultKey}`, compiledPath, note });
  }
  if (!removed.size) return;
  const removedPaths: string[] = [];
  const rebases: Array<[string, string]> = [];
  const clean = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const kept: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const row = value[index] as Record<string, unknown>, oldPath = `${path}[${index}]`;
        if (row?.operation === 'apply_provider' && removed.has(String(row.providerDefinitionRef))) {
          removedPaths.push(oldPath);
          continue;
        }
        const before = removedPaths.length;
        clean(row, oldPath);
        const listener = row?.kind === 'passive_listener' ? row.listenerSpec as { operations?: unknown[] } : row;
        if (removedPaths.length > before && Array.isArray(listener?.operations) && listener.operations.length === 0) {
          removedPaths.push(oldPath);
          continue;
        }
        if (index !== kept.length) rebases.push([oldPath, `${path}[${kept.length}]`]);
        kept.push(row);
      }
      value.splice(0, value.length, ...kept);
    } else Object.entries(value).forEach(([key, child]) => clean(child, `${path}.${key}`));
  };
  for (const provider of providers) clean(provider, `sharedProviders.${provider.providerKey}`);
  const canonical = (path: string) => path.replace(/^sharedProviders\[([^\]]+)\]/, 'sharedProviders.$1');
  const dropped = (path: string) => removedPaths.some(prefix => canonical(path) === prefix || canonical(path).startsWith(prefix + '.') || canonical(path).startsWith(prefix + '['));
  const rebase = (path: string) => {
    const original = canonical(path);
    return rebases.filter(([from]) => original === from || original.startsWith(from + '.') || original.startsWith(from + '['))
      .sort(([left], [right]) => right.length - left.length).reduce((value, [from, to]) => value.replace(from, to), original);
  };
  for (let index = operationOrigins.length - 1; index >= 0; index--) {
    const origin = operationOrigins[index]!;
    origin.compiledPaths = origin.compiledPaths.filter(path => !dropped(path)).map(rebase);
    if (!origin.compiledPaths.length) operationOrigins.splice(index, 1);
  }
  for (const row of coverage) if ([...removed].some(key => row.compiledPath.startsWith(`sharedProviders[${key}]`)
    || row.compiledPath.startsWith(`sharedProviders.${key}`)) || dropped(row.compiledPath)) {
    const actual = coverage.find(other => other !== row && other.authorPath === row.authorPath
      && ![...removed].some(key => other.compiledPath.includes(key)));
    row.compiledPath = actual?.compiledPath ?? 'runtimeOptions.skillOrigins';
    row.note = actual?.note ?? '依赖属性已合入实际盾定义或因真实兄弟来源关闭而不挂载';
  } else row.compiledPath = rebase(row.compiledPath);
  for (const provider of providers) if (['character', 'build'].includes(provider.kind) && !provider.abilities?.length
    && !provider.listeners?.length && !provider.modifiers?.length && !provider.processes?.length && !provider.initialStateSchema) {
    if (!origins.some(origin => origin.definitionRef === provider.providerKey
      && coverage.some(row => row.authorPath.startsWith(`skills.${origin.skillKey}.`) && row.note?.includes('依赖属性')))) continue;
    removed.add(provider.providerKey);
    for (let index = mounts.length - 1; index >= 0; index--) if (mounts[index]!.definitionRef === provider.providerKey) mounts.splice(index, 1);
    for (const origin of origins) if (origin.definitionRef === provider.providerKey) { delete origin.providerRef; delete origin.definitionRef; }
  }
  for (let index = providers.length - 1; index >= 0; index--) if (removed.has(providers[index]!.providerKey)) providers.splice(index, 1);
}
