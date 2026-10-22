import type { ProviderDefinition, SkillActionBinding, SkillHitCandidate } from '../types/genericEngine';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SimulationPlannedSkill, SimulationSnapshot } from '../types/simulationSnapshot';
import type { OperationOrigin, SimulationCoverage } from './simulationAdapter';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { NumericAdaptationError, constExpr, type NumericCompileState } from './numericAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { calculationConfiguration } from './simulationCalculationRules';
import { validateSimulationSkillSourceManifest } from './simulationSkillSourceDescription';

/** 仅宿主暂存；不属于原生命中候选或操作协议。 */
export type SkillHitCooldownReduction = {
  candidate: SkillHitCandidate; skillKeys: string[]; amountMs: number;
};
export type PendingSkillHitCooldownReduction = SkillHitCooldownReduction & {
  authorPath: string; compiledPath: string; hitAbilityRef: string;
};
export type SkillHitCooldownAssembly = {
  origin: SimulationPlannedSkill['origin']; binding: SkillActionBinding;
  providers: ProviderDefinition[]; coverage: SimulationCoverage[]; operationOrigins: OperationOrigin[];
  hitCooldownReductions: PendingSkillHitCooldownReduction[];
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function compileSkillHitCooldownReduction(skillKey: string, effect: SkillEffect,
  result: Extract<SkillEffectResult, { resultType: 'COOLDOWN_CHANGE' }>, path: string, state: NumericCompileState):
  Omit<SkillHitCooldownReduction, 'candidate'> {
  if (effect.lifecycle !== null || result.lifecycleBehavior !== null || result.spellShieldBlockScope !== null
    || result.target !== 'SOURCE' || result.detail.operation !== 'REDUCE') {
    fail(path, '命中减冷却仅接无生命周期、无独立阻挡的SOURCE即时REDUCE');
  }
  const scope = result.detail.affectedSkillScope;
  if (Object.keys(result.detail).some(key => !['operation', 'affectedSkillScope'].includes(key))
    || !scope || Object.keys(scope).some(key => !['mode', 'skillKeys', 'skillCategoryKeys'].includes(key))
    || scope.mode !== 'SKILLS' || !Array.isArray(scope.skillKeys) || scope.skillKeys.length < 1 || scope.skillKeys.length > 4
    || scope.skillKeys.some(key => typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(key))
    || new Set(scope.skillKeys).size !== scope.skillKeys.length || !scope.skillKeys.includes(skillKey)
    || !Array.isArray(scope.skillCategoryKeys) || scope.skillCategoryKeys.length !== 0) {
    fail(`${path}.detail.affectedSkillScope`, '命中减冷却需要最多4个唯一明确技能且包含本次施放技能');
  }
  if (!result.valueRule) fail(`${path}.valueRule`, '命中减冷却缺少完整数值规则');
  const amountMs = staticEffectAmount(result.valueRule, `${path}.valueRule`, state);
  if (!Number.isSafeInteger(amountMs) || amountMs < 0) fail(`${path}.valueRule`, '命中减冷却需要完整静态有限非负安全整数毫秒');
  return { skillKeys: [...scope.skillKeys], amountMs };
}

/** 按完整真实装配结果绑定，不从技能名合成能力名，也不授予未计划来源。 */
export function bindSkillHitCooldownReductions(snapshot: SimulationSnapshot, assemblies: readonly SkillHitCooldownAssembly[]): void {
  if (!assemblies.some(assembly => assembly.hitCooldownReductions.length)) return;
  validateSimulationSkillSourceManifest(snapshot);
  const staged: Array<{ assembly: SkillHitCooldownAssembly; pending: PendingSkillHitCooldownReduction;
    refs: string[]; skipped: string[] }> = [];
  for (const assembly of assemblies) for (const pending of assembly.hitCooldownReductions) {
    const { authorPath, candidate } = pending, binding = assembly.binding;
    if (assembly.origin.kind !== 'CHARACTER' || assembly.origin.characterKey !== snapshot.selection.sourceCharacterKey
      || binding.source !== 'source' || !pending.skillKeys.includes(binding.skillKey) || candidate.operations.length) {
      fail(authorPath, '命中减冷却缺少同角色真实施放来源或重复绑定');
    }
    const hitParents = assembly.providers.filter(provider => provider.providerKey === binding.providerDefinitionRef);
    const hitAbilities = hitParents[0]?.abilities?.filter(ability => pending.hitAbilityRef
      === `${binding.source}.provider[${binding.providerRef}].ability[${ability.abilityKey}]`) ?? [];
    if (hitParents.length !== 1 || hitAbilities.length !== 1 || hitAbilities[0]!.kind !== 'active'
      || hitAbilities[0]!.skillKey !== binding.skillKey || !binding.hitBindings.some(hit => hit.hitAbilityRef === pending.hitAbilityRef)
      || !hitAbilities[0]!.operations?.some(operation => operation.operation === 'resolve_skill_hit'
        && operation.skillHit?.skillKey === binding.skillKey && operation.skillHit.candidates.includes(candidate))) {
      fail(authorPath, '命中减冷却必须来自实际父挂载中的真实命中能力与候选');
    }
    const refs: string[] = [], skipped: string[] = [];
    for (const skillKey of pending.skillKeys) {
      const sources = snapshot.source.skillSources.filter(source => source.skillKey === skillKey
        && source.origin.kind === 'CHARACTER' && source.origin.characterKey === assembly.origin.characterKey);
      const configurations = snapshot.skillConfigurations.filter(configuration => configuration.skill.skillKey === skillKey);
      const source = sources[0], configuration = configurations[0];
      if (sources.length !== 1 || configurations.length !== 1 || !configuration || configuration.skill.gameId !== snapshot.gameId
        || configuration.skill.skillCategoryKeys.includes(calculationConfiguration(snapshot)?.basicAttackCategoryKey ?? '')) {
        fail(authorPath, '减冷却范围必须对应同角色真实拥有的普通技能，不能引用普攻或外来来源');
      }
      const plans = snapshot.selection.plannedSkills.filter(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey)
        === simulationSkillSourceIdentity(source!.origin, skillKey));
      const matches = assemblies.filter(row => row.binding.skillKey === skillKey
        && simulationSkillSourceIdentity(row.origin, skillKey) === simulationSkillSourceIdentity(source!.origin, skillKey));
      if (!source!.enabled || source!.skillStatus !== 'ENABLED' || source!.skillLevel === 0 || plans.length === 0) {
        if (matches.length) fail(authorPath, '关闭、未学或未计划来源不能被减冷却装配启用');
        skipped.push(skillKey);
        continue;
      }
      const actual = matches[0], targetBinding = actual?.binding;
      const initials = targetBinding?.controls.filter(control => control.action === 'INITIAL') ?? [];
      const initial = initials[0];
      const definitions = actual?.providers.filter(provider => provider.providerKey === targetBinding?.providerDefinitionRef) ?? [];
      const definition = definitions[0];
      const processes = definition?.processes?.filter(process => process.processKey === initial?.processKey) ?? [];
      const process = processes[0];
      const abilities = definition?.abilities?.filter(ability => initial?.abilityRef
        === `${targetBinding!.source}.provider[${targetBinding!.providerRef}].ability[${ability.abilityKey}]`) ?? [];
      const ability = abilities[0];
      if (source!.inactiveReason !== null || configuration.skill.status !== 'ENABLED' || plans.length !== 1
        || source!.skillLevel !== plans[0]!.skillLevel || matches.length !== 1 || targetBinding?.source !== 'source'
        || initials.length !== 1 || definitions.length !== 1 || definition?.kind !== 'character' || definition.skillKey !== skillKey
        || processes.length !== 1 || !process?.cooldown || process.skillKey !== skillKey || abilities.length !== 1
        || ability?.skillKey !== skillKey || ability.kind !== 'active' || ability.processControl?.action !== 'INITIAL'
        || ability.processControl.processKey !== process.processKey || ability.processControl.useRefFromEvent === true) {
        fail(authorPath, '启用的减冷却范围缺少同拥有者真实挂载、唯一INITIAL及普通过程冷却');
      }
      refs.push(initial!.abilityRef);
    }
    if (!refs.length || new Set(refs).size !== refs.length) fail(authorPath, '命中减冷却必须至少绑定本次施放技能的唯一真实INITIAL');
    staged.push({ assembly, pending, refs, skipped });
  }
  // 全部引用先核对完再发布，错误不会留下一半候选或空来源映射。
  for (const { assembly, pending, refs, skipped } of staged) {
    pending.candidate.operations = refs.map(abilityRef => ({ operation: 'cooldown_change', target: 'source',
      valuePolicy: 'reduce', abilityRef, amount: constExpr(pending.amountMs), ref: pending.authorPath }));
    const compiledPaths = refs.map((_ref, index) => `${pending.compiledPath}.operations[${index}]`);
    assembly.operationOrigins.push({ abilityRef: pending.hitAbilityRef, operationRef: pending.authorPath,
      skillKey: assembly.binding.skillKey, effectKey: pending.candidate.effectKey, resultKey: pending.candidate.resultKey,
      providerDefinitionRef: assembly.binding.providerDefinitionRef, compiledPaths });
    for (const compiledPath of compiledPaths) assembly.coverage.push(
      { authorPath: `${pending.authorPath}.valueRule`, compiledPath: `${compiledPath}.amount` },
      { authorPath: `${pending.authorPath}.detail.affectedSkillScope`, compiledPath: `${compiledPath}.abilityRef` });
    if (skipped.length) assembly.coverage.push({ authorPath: `${pending.authorPath}.detail.affectedSkillScope`,
      compiledPath: `${pending.compiledPath}.operations`, note: `本场关闭、未学或未计划来源零匹配，不启用：${skipped.join('、')}` });
  }
  for (const assembly of assemblies) assembly.hitCooldownReductions.length = 0;
}
