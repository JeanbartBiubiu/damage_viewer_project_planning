import type { NamedFormula, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SimulationSnapshot } from '../types/simulationSnapshot';
import type { OperationOrigin, SimulationCoverage } from './simulationAdapter';
import { adaptProcessProgram, type CastCostRef } from './processAdapter';
import { adaptHitProgram } from './hitAdapter';
import { NumericAdaptationError } from './numericAdapter';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { plannedSkillRuleKeys } from './simulationSkillSourceDescription';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import { compileSimulationDamageFormula, validateConfiguration } from './simulationTriggeredEquipment';

export type SimulationCastCostRef = CastCostRef & { skillKey: string };
const ordinaryCostResources = new Set(['mana', 'energy', 'hp']);

export function simulationCastCostCandidates(snapshot: SimulationSnapshot): SimulationCastCostRef[] {
  return snapshot.selection.plannedSkills.flatMap(plan => {
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === plan.skillKey);
    return configuration?.processes.flatMap(process => process.effectBindings.flatMap(binding => {
      if (binding.moment.momentType !== 'PROCESS_START') return [];
      const effect = configuration.effects.find(row => row.effectKey === binding.effectKey);
      return effect?.lifecycle === null ? effect.results.filter(result => result.resultType === 'RESOURCE_CHANGE'
        && result.detail.operation === 'CONSUME' && result.target === 'SOURCE'
        && ordinaryCostResources.has(result.detail.attributeKey)
        && result.lifecycleBehavior === null && result.spellShieldBlockScope === null)
        .map(result => ({ skillKey: plan.skillKey, bindingKey: binding.bindingKey, effectKey: effect.effectKey, resultKey: result.resultKey })) : [];
    })) ?? [];
  });
}

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function assembleActiveSkills(snapshot: SimulationSnapshot, ignoredCosts: readonly SimulationCastCostRef[] = []) {
  const plans = snapshot.selection.plannedSkills;
  if (snapshot.selection.basicAttackSkillKey !== null || snapshot.selection.basicAttackLevel !== null || plans.length !== 1) {
    fail('selection.plannedSkills', '6A只允许一份首次主动技能计划，不含背景普攻或混合执行');
  }
  const plan = plans[0]!;
  const root = `skills.${plan.skillKey}`;
  const complete = snapshot.skillConfigurations.find(row => row.skill.skillKey === plan.skillKey);
  if (!complete) fail(root, '缺少计划技能的完整作者配置');
  validateConfiguration(complete, snapshot.gameId, root, false, plan.skillLevel);
  if (complete.skill.skillCategoryKeys.includes('basic_attack') || plan.phaseKinds.length !== 1 || plan.phaseKinds[0] !== 'INITIAL') {
    fail('selection.plannedSkills', '6A只开放真实主动技能的首次使用');
  }
  const roots = plannedSkillRuleKeys(complete);
  const { configuration, excludedRuleKeys } = selectSimulationSkillSourceClosure(complete, roots);
  if (configuration.processes.length !== 1 || configuration.internalStates.length) fail(root, '6A只开放唯一单段有限施放过程，无未支持的必要状态消费');
  const process = configuration.processes[0]!;
  if (process.steps.length !== 1 || !['DELAY', 'IMMEDIATE'].includes(process.steps[0]!.stepType)) fail(`${root}.processes`, '6A只开放一个有限延时或即时步骤，不开放6B／6C');
  const processRules = configuration.triggerRules.filter(row => row.eventSource.eventType !== 'SKILL_HIT'
    && row.eventSource.eventType !== 'SPELL_SHIELD_BLOCKED');
  const hitRules = configuration.triggerRules.filter(row => row.eventSource.eventType === 'SKILL_HIT'
    || row.eventSource.eventType === 'SPELL_SHIELD_BLOCKED');
  if (ignoredCosts.some(cost => cost.skillKey !== plan.skillKey)) fail('ignoredCastCosts', '费用引用必须属于本次计划技能');
  const candidates = simulationCastCostCandidates(snapshot);
  const costIdentity = (cost: SimulationCastCostRef) => JSON.stringify([cost.skillKey, cost.bindingKey, cost.effectKey, cost.resultKey]);
  if (ignoredCosts.some(cost => !candidates.some(candidate => costIdentity(candidate) === costIdentity(cost)))) {
    fail('ignoredCastCosts', '只允许逐项声明自身即时普通施法成本；弹药、充能、计数等必要消费不忽略');
  }
  const adapted = adaptProcessProgram({ gameId: snapshot.gameId, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
    characterLevel: snapshot.selection.sourceLevel, process, rules: processRules, effects: configuration.effects,
    parameters: configuration.parameters, formulas: configuration.formulas, owner: 'source',
    castCosts: ignoredCosts.map(({ skillKey: _skillKey, ...cost }) => cost), ignoreCastCosts: true });
  const providers: ProviderDefinition[] = [];
  const formulas: NamedFormula[] = [...adapted.formulas];
  const types = new Map<string, string>([['combatant/champion', 'combatant'], ['event/ability_started', 'event'], ['event/source_owner', 'event']]);
  const coverage: SimulationCoverage[] = [];
  const operationOrigins: OperationOrigin[] = [];
  const sourceIndex = [...snapshot.source.skillSources].sort((left, right) => {
    const identity = (source: typeof left) => simulationSkillSourceIdentity(source.origin, source.skillKey);
    return identity(left) < identity(right) ? -1 : identity(left) > identity(right) ? 1 : 0;
  }).findIndex(row => row.origin.kind === 'CHARACTER' && row.origin.characterKey === plan.origin.characterKey && row.skillKey === plan.skillKey);
  if (sourceIndex < 0) fail('selection.plannedSkills.origin', '计划技能没有真实拥有者来源');
  const providerRef = `source_natural_skill_${sourceIndex}`;
  const definitionRef = `${providerRef}_definition`;
  const provider = adapted.provider;
  provider.providerKey = provider.stableId = definitionRef;
  const boundType = `ability/initial_cast/source/${providerRef}`;
  types.set(boundType, 'ability');
  const skillType = `ability/skill/${plan.skillKey}`;
  types.set(skillType, 'ability');
  const categories = configuration.skill.skillCategoryKeys.map(category => {
    if (!snapshot.catalogs.skillCategories.some(row => row.skillCategoryKey === category && row.status === 'ENABLED')) fail(`${root}.skillCategoryKeys`, '缺少真实已启用技能分类');
    types.set(`ability/${category}`, 'ability');
    return `ability/${category}`;
  });
  for (const [abilityIndex, ability] of provider.abilities.entries()) {
    if (ability.kind === 'active') ability.types = [...categories, skillType,
      ...(ability.abilityKey === adapted.initialAbilityKey ? [boundType] : [])];
    const matcher = ability.listenerSpec?.eventMatcher;
    if (matcher?.all) matcher.all = matcher.all.map(type => type === 'ability/initial_cast/@mount' ? boundType : type);
    if (ability.listenerSpec) {
      const rule = processRules.find(row => ability.abilityKey === `listen_${row.ruleKey}`)!;
      const action = rule.actions[0]!;
      if (action.actionType !== 'EXECUTE_EFFECT') fail(`${root}.triggerRules.${rule.ruleKey}`, '首次监听必须对应完整效果');
      const effect = configuration.effects.find(row => row.effectKey === action.detail.effectKey)!;
      const results = [...effect.results].sort((left, right) => left.sortOrder - right.sortOrder);
      ability.listenerSpec.operations?.forEach((operation, index) => {
        const result = results[index]!;
        const authorPath = `${root}.effects.${effect.effectKey}.results.${result.resultKey}`;
        operation.ref = authorPath;
        const compiledPath = `sharedProviders[${definitionRef}].abilities[${abilityIndex}].listenerSpec.operations[${index}]`;
        coverage.push({ authorPath, compiledPath });
        operationOrigins.push({ abilityRef: `source.provider[${providerRef}].ability[${ability.abilityKey}]`, operationRef: authorPath,
          skillKey: plan.skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, compiledPaths: [compiledPath], providerDefinitionRef: definitionRef });
      });
    }
  }
  for (const group of provider.processes[0]!.momentOperations) for (const operation of group.operations) {
    if (operation.abilityRef) operation.abilityRef = operation.abilityRef.replace('self.provider[@mount]', `self.provider[${providerRef}]`);
    if (operation.operation === 'resource_change') fail(`${root}.processes.${process.processKey}`, '未明确声明为施法成本的资源改变仍是必要结果，6A不支持时严格拒绝');
  }
  const binding: SkillActionBinding = { bindingKey: 'selected_active_skill', source: 'source', providerRef,
    providerDefinitionRef: definitionRef, skillKey: plan.skillKey,
    controls: [{ action: 'INITIAL', processKey: process.processKey, abilityRef: `source.provider[${providerRef}].ability[${adapted.initialAbilityKey}]` }], hitBindings: [] };
  const defenses = new Map<string, ReturnType<typeof compileSimulationDamageFormula>>();
  let vampRules: ReturnType<typeof adaptHitProgram>['vampRules'];
  if (hitRules.length) {
    const hit = adaptHitProgram({ gameId: snapshot.gameId, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
      characterLevel: snapshot.selection.sourceLevel, rules: hitRules, effects: configuration.effects,
      parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
      modifierZones: snapshot.catalogs.modifierZones, skillCategoryKeys: configuration.skill.skillCategoryKeys,
      vampRules: snapshot.catalogs.vampRules.rules, identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } } });
    if (!hit.skillHit.candidates.length) fail(`${root}.triggerRules`, '计划命中缺少完整必要结果');
    const hitAbilityIndex = provider.abilities.length;
    provider.abilities.push({ abilityKey: 'selected_skill_hit', kind: 'active', skillKey: plan.skillKey,
      types: [...new Set([...categories, skillType, ...hit.abilityTypes])], params: hit.params,
      operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: hit.skillHit }] });
    binding.hitBindings.push({ hitBindingKey: 'selected_skill_release_hit', processKey: process.processKey,
      moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null },
      hitAbilityRef: `source.provider[${providerRef}].ability[selected_skill_hit]` });
    providers.push(...hit.providers);
    formulas.push(...hit.formulas);
    for (const type of hit.typeEntries) types.set(type.key, type.domain);
    vampRules = hit.vampRules;
    for (const [candidateIndex, candidate] of hit.skillHit.candidates.entries()) {
      const authorPath = `${root}.effects.${candidate.effectKey}.results.${candidate.resultKey}`;
      for (const operation of candidate.operations) operation.ref = authorPath;
      const compiledPath = `sharedProviders[${definitionRef}].abilities[${hitAbilityIndex}].operations[0].skillHit.candidates[${candidateIndex}]`;
      coverage.push({ authorPath, compiledPath });
      operationOrigins.push({ abilityRef: binding.hitBindings[0]!.hitAbilityRef, operationRef: authorPath,
        skillKey: plan.skillKey, effectKey: candidate.effectKey, resultKey: candidate.resultKey,
        compiledPaths: candidate.operations.map((_operation, index) => `${compiledPath}.operations[${index}]`), providerDefinitionRef: definitionRef });
      for (const operation of candidate.operations) if (operation.operation === 'damage' && operation.damageType) {
        const result = configuration.effects.find(effect => effect.effectKey === candidate.effectKey)!.results.find(row => row.resultKey === candidate.resultKey)!;
        if (result.resultType !== 'DAMAGE') fail(authorPath, '命中伤害必须对应实际作者结果');
        const defense = compileSimulationDamageFormula(snapshot, result.detail.damageTypeKey);
        defenses.set(operation.damageType, { ...defense, damageType: operation.damageType });
      }
    }
  }
  providers.unshift(provider);
  coverage.push({ authorPath: `${root}.processes.${process.processKey}`, compiledPath: `sharedProviders[${definitionRef}].processes[0]` });
  for (const rule of processRules) coverage.push({ authorPath: `${root}.triggerRules.${rule.ruleKey}`, compiledPath: `sharedProviders[${definitionRef}].abilities` });
  for (const ruleKey of excludedRuleKeys) coverage.push({ authorPath: `${root}.triggerRules.${ruleKey}`,
    compiledPath: 'runtimeOptions.skillOrigins', note: '未计划的独立入口不执行；必要自然来源仍独立完整装配' });
  for (const cost of ignoredCosts) coverage.push({ authorPath: `${root}.effects.${cost.effectKey}.results.${cost.resultKey}`,
    compiledPath: `sharedProviders[${definitionRef}].processes[0].costs`, note: `本期忽略明确施法成本；原挂接${cost.bindingKey}保留在作者快照，不建立门槛、扣除或退款` });
  return { providers, formulas, types: [...types].map(([key, domain]) => ({ key, domain })), binding,
    rules: { damageTypeFormulas: [...defenses.values()], ...(vampRules ? { vampRules } : {}) }, coverage, operationOrigins,
    ignoredCastCosts: structuredClone([...ignoredCosts]) };
}
