import { TypeCatalogEntries } from './typeCatalogEntries';
import { skillCategoryTypeKey } from './skillCategoryType';
import type { NamedFormula, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SimulationPlannedSkill, SimulationSnapshot } from '../types/simulationSnapshot';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { OperationOrigin, SimulationCoverage } from './simulation/model';
import { adaptProcessProgram, type CastCostRef, type ProcessBasicAttackContext } from './processAdapter';
import { adaptHitProgram } from './hitAdapter';
import { createSiblingTargetCounterReadResolver, type SiblingTargetCounterContext, type SiblingTargetCounterReadResolver } from './siblingTargetCounterRead';
import { bindSkillHitCooldownReductions, type PendingSkillHitCooldownReduction } from './skillHitCooldownReduction';
import { processSkillHitStages } from './processSkillHitStages';
import { skillHitChainContract } from './skillHitChainContract';
import { cooldownDurationProviderKey } from './cooldownDurationEffectAdapter';
import { NumericAdaptationError, tryFoldConstant } from './numericAdapter';
import { finiteTargetCounterContract } from './finiteTargetCounterContract';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { naturalRuleKeys, plannedSkillRuleKeys, sourceIsPlanned, validateSimulationSkillSourceManifest } from './simulation/sources/description';
import { selectSimulationSkillSourceClosure } from './simulation/sources/closure';
import { compileSimulationDamageFormula } from './simulation/compile/damageFormula';
import { validateConfiguration } from './simulation/compile/configuration';
import { calculationConfiguration, changedAttributes, simulationCriticalBinding } from './simulationCalculationRules';
import { sceneAttributeParameterInputs } from './sceneAttributeSnapshotInput';
import { normalizeSceneInitialParameterInputs, sceneInitialParameterRequirements, sceneInitialValuesForSource,
  type SceneInitialParameterInput } from './sceneInitialParameterInput';

export type SimulationCastCostRef = CastCostRef & { skillKey: string };
export function simulationCastCostCandidates(snapshot: SimulationSnapshot): SimulationCastCostRef[] {
  const ordinaryCostResources = new Set(calculationConfiguration(snapshot)?.ignorableCastCostAttributeKeys ?? []);
  return snapshot.selection.plannedSkills.flatMap(plan => {
    const complete = snapshot.skillConfigurations.find(row => row.skill.skillKey === plan.skillKey);
    const source = snapshot.source.skillSources.find(row => simulationSkillSourceIdentity(row.origin, row.skillKey)
      === simulationSkillSourceIdentity(plan.origin, plan.skillKey));
    if (!complete || complete.skill.gameId !== snapshot.gameId || complete.skill.status !== 'ENABLED'
      || !source?.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel !== plan.skillLevel || source.inactiveReason !== null
      || plan.origin.kind !== 'CHARACTER' || plan.origin.characterKey !== snapshot.selection.sourceCharacterKey
      || !Number.isSafeInteger(plan.skillLevel) || plan.skillLevel < 1 || plan.skillLevel > complete.skill.maxLevel
      || !plan.phaseKinds.includes('INITIAL') || new Set(plan.phaseKinds).size !== plan.phaseKinds.length) return [];
    const roots = plannedSkillRuleKeys(complete, plan.phaseKinds);
    if (!roots.length) return [];
    let configuration: SkillConfiguration;
    try { configuration = selectSimulationSkillSourceClosure(complete, roots).configuration; }
    catch (error) {
      // 准入检查仍拒绝不完整闭包；候选显示不能遮掉原错误或使页面崩溃。
      if (error instanceof NumericAdaptationError) return [];
      throw error;
    }
    return configuration.processes.flatMap(process => process.effectBindings.flatMap(binding => {
      if (binding.moment.momentType !== 'PROCESS_START' || binding.moment.stepKey !== null || binding.moment.failureReason != null) return [];
      const effect = configuration.effects.find(row => row.effectKey === binding.effectKey);
      return effect?.lifecycle === null ? effect.results.filter(result => result.resultType === 'RESOURCE_CHANGE'
        && result.detail.operation === 'CONSUME' && result.target === 'SOURCE'
        && ordinaryCostResources.has(result.detail.attributeKey)
        && result.valueRule != null && result.lifecycleBehavior === null && result.spellShieldBlockScope === null)
        .map(result => ({ skillKey: plan.skillKey, bindingKey: binding.bindingKey, effectKey: effect.effectKey, resultKey: result.resultKey })) : [];
    }));
  });
}

/** 自动采用无歧义的普通费用；同资源多次消费不能靠形状猜用途。 */
export function simulationAutomaticCastCosts(snapshot: SimulationSnapshot): SimulationCastCostRef[] {
  const costs = simulationCastCostCandidates(snapshot);
  const resources = new Set<string>();
  for (const cost of costs) {
    const result = snapshot.skillConfigurations.find(row => row.skill.skillKey === cost.skillKey)
      ?.effects.find(effect => effect.effectKey === cost.effectKey)?.results.find(result => result.resultKey === cost.resultKey);
    if (result?.resultType !== 'RESOURCE_CHANGE') fail('ignoredCastCosts', '自动费用引用与当前完整配置不一致');
    const identity = JSON.stringify([cost.skillKey, result.detail.attributeKey]);
    if (resources.has(identity)) {
      fail(`skills.${cost.skillKey}.castCosts`, '同一普通资源有多项过程开始消费，无法自动区分施法成本和必要消费');
    }
    resources.add(identity);
  }
  return costs;
}

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function assembleActiveSkills(snapshot: SimulationSnapshot, ignoredCosts: readonly SimulationCastCostRef[] = [], basicAttackContext?: ProcessBasicAttackContext,
  sceneInputs: readonly SceneInitialParameterInput[] = [], siblingTargetCounters?: SiblingTargetCounterContext) {
  const normalized = normalizeSceneInitialParameterInputs(snapshot, sceneInputs);
  const plans = snapshot.selection.plannedSkills;
  if (!plans.length || plans.length > 16 || new Set(plans.map(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey))).size !== plans.length) {
    fail('selection.plannedSkills', '需要1～16份不同真实来源，每个来源只允许一个等级');
  }
  if (ignoredCosts.some(cost => !plans.some(plan => plan.skillKey === cost.skillKey))) fail('ignoredCastCosts', '费用引用必须属于本次计划技能');
  const siblingTargetCounterRead = siblingTargetCounters ? createSiblingTargetCounterReadResolver(snapshot, siblingTargetCounters) : undefined;
  const assemblies = [...plans].sort((left, right) => simulationSkillSourceIdentity(left.origin, left.skillKey)
    .localeCompare(simulationSkillSourceIdentity(right.origin, right.skillKey), 'en')).map(plan =>
    assembleActiveSkill(snapshot, plan, ignoredCosts.filter(cost => cost.skillKey === plan.skillKey), basicAttackContext, normalized, siblingTargetCounterRead));
  bindSkillHitCooldownReductions(snapshot, assemblies);
  const providers = new Map<string, ProviderDefinition>();
  const formulas = new Map<string, NamedFormula>();
  const types = new TypeCatalogEntries();
  const defenses = new Map<string, ReturnType<typeof compileSimulationDamageFormula>>();
  let vampRules: ReturnType<typeof adaptHitProgram>['vampRules'];
  const allProviderDefinitions = assemblies.flatMap(assembly => assembly.providers);
  if (assemblies.some(assembly => assembly.cooldownDurationScopes.length)) validateSimulationSkillSourceManifest(snapshot);
  // 所有真实入口完成后才展开范围，不能从技能名字猜能力或依赖装配顺序。
  for (const assembly of assemblies) for (const scope of assembly.cooldownDurationScopes) {
    const provider = allProviderDefinitions.find(row => row.providerKey === scope.providerKey)!;
    const refs: string[] = [];
    for (const skillKey of scope.skillKeys) {
      const sources = snapshot.source.skillSources.filter(row => row.skillKey === skillKey && row.origin.kind === 'CHARACTER'
        && row.origin.characterKey === snapshot.selection.sourceCharacterKey);
      const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === skillKey);
      if (sources.length !== 1 || !configuration || configuration.skill.gameId !== snapshot.gameId
        || configuration.skill.skillCategoryKeys.some(key => key === calculationConfiguration(snapshot)?.basicAttackCategoryKey)) fail(scope.authorPath, '冷却时长范围必须引用同拥有者真实普通主动技能');
      const source = sources[0]!;
      if (!source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0) continue;
      if (!sourceIsPlanned(snapshot, 'source', source) && source.inactiveReason === 'ACTIVE_DEFERRED'
        && source.enabledRuleKeys.length === 0 && naturalRuleKeys(snapshot, configuration, 'source', source).length === 0
        && plannedSkillRuleKeys(configuration, ['INITIAL']).length > 0) continue;
      const matches = assemblies.filter(row => row.binding.skillKey === skillKey);
      const control = matches[0]?.binding.controls.filter(row => row.action === 'INITIAL');
      const definition = matches[0]?.providers.find(row => row.providerKey === matches[0]!.binding.providerDefinitionRef);
      const process = definition?.processes?.find(row => row.processKey === control?.[0]?.processKey);
      const ability = definition?.abilities?.find(row => control?.[0]?.abilityRef.endsWith(`.ability[${row.abilityKey}]`));
      if (source.inactiveReason !== null || source.skillStatus !== 'ENABLED' || matches.length !== 1 || control?.length !== 1
        || !process?.cooldown || ability?.kind !== 'active' || ability.processControl?.action !== 'INITIAL'
        || ability.processControl.useRefFromEvent === true || process.skillKey !== skillKey) fail(scope.authorPath, '启用的冷却范围技能缺少真实已绑定且有普通冷却的首次入口');
      refs.push(control[0]!.abilityRef);
    }
    provider.modifiers![0]!.affectedAbilityRefs = [...new Set(refs)].sort();
    assembly.coverage.push({ authorPath: scope.authorPath, compiledPath: `sharedProviders[${provider.providerKey}].modifiers[0].affectedAbilityRefs`,
      note: refs.length ? '按本场真实拥有者INITIAL绑定展开普通冷却引用' : '引用来源关闭、未学或主动未计划，本场范围零匹配；不启用来源' });
  }
  const changed = changedAttributes();
  const collectChanged = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collectChanged); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.operation === 'attribute_change' && typeof row.attributeKey === 'string') {
      if (row.target !== 'source' && row.target !== 'target' && row.target !== 'self') fail('active.attribute_change.target', '计划属性操作缺少明确双方映射');
      changed[row.target === 'target' ? 'target' : 'source'].add(row.attributeKey);
    }
    if (row.operation === 'shield' || row.operation === 'apply_provider') {
      const definition = allProviderDefinitions.find(provider => provider.providerKey === (row.shieldLifecycleProviderDefinitionRef ?? row.providerDefinitionRef));
      for (const modifier of definition?.modifiers ?? []) if (modifier.kind === 'attribute' || modifier.kind === 'resource_max') {
        const attribute = /^self\.attr\.([a-z][a-z0-9_]*)$/.exec(modifier.target ?? '');
        if (attribute) changed[row.target === 'target' ? 'target' : 'source'].add(attribute[1]!);
        const capturedOpponent = modifier.valueReadMode === 'APPLICATION_SNAPSHOT'
          ? /^opponent\.attr\.([a-z][a-z0-9_]*)$/.exec(modifier.target ?? '') : null;
        if (capturedOpponent) changed[row.target === 'target' ? 'source' : 'target'].add(capturedOpponent[1]!);
      }
    }
    Object.values(row).forEach(collectChanged);
  };
  for (const assembly of assemblies) {
    for (const provider of assembly.providers) {
      collectChanged(provider);
      const previous = providers.get(provider.providerKey);
      if (previous && JSON.stringify(previous) !== JSON.stringify(provider)) fail('sharedProviders', '计划来源定义冲突');
      providers.set(provider.providerKey, provider);
    }
    for (const formula of assembly.formulas) {
      const previous = formulas.get(formula.key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(formula)) fail('formulas', '计划公式命名冲突');
      formulas.set(formula.key, formula);
    }
    for (const type of assembly.types) types.set(type.key, type.domain);
    for (const defense of assembly.rules.damageTypeFormulas) {
      const previous = defenses.get(defense.damageType);
      if (previous && JSON.stringify(previous) !== JSON.stringify(defense)) fail('damageTypeFormulas', '计划防御公式不一致');
      defenses.set(defense.damageType, defense);
    }
    if (assembly.rules.vampRules) {
      if (vampRules && JSON.stringify(vampRules) !== JSON.stringify(assembly.rules.vampRules)) fail('vampRules', '计划必须共享真实吸血规则');
      vampRules = assembly.rules.vampRules;
    }
  }
  return { providers: [...providers.values()], formulas: [...formulas.values()], types: [...types].map(([key, domain]) => ({ key, domain })),
    bindings: assemblies.map(assembly => assembly.binding), rules: { damageTypeFormulas: [...defenses.values()], ...(vampRules ? { vampRules } : {}) },
    coverage: assemblies.flatMap(assembly => assembly.coverage), operationOrigins: assemblies.flatMap(assembly => assembly.operationOrigins),
    ignoredCastCosts: structuredClone([...ignoredCosts]), changedAttributes: changed };
}

function assembleActiveSkill(snapshot: SimulationSnapshot, plan: SimulationPlannedSkill, ignoredCosts: readonly SimulationCastCostRef[], basicAttackContext?: ProcessBasicAttackContext,
  sceneInputs: readonly SceneInitialParameterInput[] = [], siblingTargetCounterRead?: SiblingTargetCounterReadResolver) {
  const root = `skills.${plan.skillKey}`;
  const complete = snapshot.skillConfigurations.find(row => row.skill.skillKey === plan.skillKey);
  if (!complete) fail(root, '缺少计划技能的完整作者配置');
  validateConfiguration(complete, snapshot.gameId, root, false, plan.skillLevel, null);
  const basicAttackCategoryKey = calculationConfiguration(snapshot)?.basicAttackCategoryKey;
  if (plan.origin.kind !== 'CHARACTER' || plan.origin.characterKey !== snapshot.selection.sourceCharacterKey
    || basicAttackCategoryKey != null && complete.skill.skillCategoryKeys.includes(basicAttackCategoryKey) || !plan.phaseKinds.includes('INITIAL')
    || new Set(plan.phaseKinds).size !== plan.phaseKinds.length
    || plan.phaseKinds.some(phase => !['INITIAL', 'CHARGE_RELEASE', 'RECAST', 'CANCEL'].includes(phase))) {
    fail('selection.plannedSkills', '只开放攻击方真实角色主动技能，阶段必须明确且包含首次');
  }
  const roots = plannedSkillRuleKeys(complete, plan.phaseKinds);
  const hitChain = skillHitChainContract(complete);
  if (hitChain) for (const [effect, kind] of [[hitChain.firstPair.control, 'MOVEMENT_SLOW'], [hitChain.tailPair.control, 'STUN']] as const) {
    const result = effect.results[0]!;
    const statuses = snapshot.catalogs.statuses.filter(status => result.resultType === 'STATUS_OPERATION' && status.statusKey === result.detail.statusKey);
    if (statuses.length !== 1 || statuses[0]!.gameId !== snapshot.gameId || statuses[0]!.status !== 'ENABLED' || statuses[0]!.statusKind !== kind) fail(`${root}.effects.${effect.effectKey}`, '首段链减速及尾段眩晕必须对应真实完整状态目录');
  }
  const { configuration, excludedRuleKeys } = selectSimulationSkillSourceClosure(complete, roots);
  const firstProcessKeys = new Set(configuration.triggerRules.flatMap(rule => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === plan.skillKey && rule.eventSource.detail.useKind === 'ACTIVE'
    && rule.eventSource.detail.castPhase === 'INITIAL'
    ? rule.actions.flatMap(action => action.actionType === 'START_PROCESS' ? [action.detail.processKey] : []) : []));
  const firstProcesses = configuration.processes.filter(process => firstProcessKeys.has(process.processKey) && process.activationType === 'ACTIVE');
  if (firstProcessKeys.size !== 1 || firstProcesses.length !== 1) fail(`${root}.processes`, '首次入口必须明确引用唯一有限主动过程，不能从完整过程数组猜选');
  const process = firstProcesses[0]!;
  if (complete.triggerRules.some(rule => rule.eventSource.eventType === 'SKILL_HIT'
    && Object.prototype.hasOwnProperty.call(rule.eventSource.detail, 'processMoment'))) {
    processSkillHitStages(plan.skillKey, process, complete.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT'
      && rule.ruleKey !== hitChain?.postRule.ruleKey
      && (rule.eventSource.detail.sourceSkillKey === null || rule.eventSource.detail.sourceSkillKey === plan.skillKey
        || Object.prototype.hasOwnProperty.call(rule.eventSource.detail, 'processMoment'))));
  }
  for (const step of process.steps) if (typeof step.occupiesAction !== 'boolean') {
    fail(`${root}.processes.${process.processKey}.steps.${step.stepKey}.occupiesAction`, '计划步骤必须由作者明确是否占用行动，不为延时猜默认值');
  }
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
  const castCosts = process.effectBindings.flatMap(binding => {
    if (binding.moment.momentType !== 'PROCESS_START' || binding.moment.stepKey !== null || binding.moment.failureReason != null) return [];
    const effect = configuration.effects.find(row => row.effectKey === binding.effectKey);
    return effect?.lifecycle === null ? effect.results.filter(result => result.resultType === 'RESOURCE_CHANGE'
      && result.target === 'SOURCE' && result.detail.operation === 'CONSUME' && result.lifecycleBehavior === null
      && result.spellShieldBlockScope === null && result.valueRule !== null)
      .map(result => ({ bindingKey: binding.bindingKey, effectKey: effect.effectKey, resultKey: result.resultKey })) : [];
  });
  const sourceIndex = [...snapshot.source.skillSources].sort((left, right) => {
    const identity = (source: typeof left) => simulationSkillSourceIdentity(source.origin, source.skillKey);
    return identity(left) < identity(right) ? -1 : identity(left) > identity(right) ? 1 : 0;
  }).findIndex(row => row.origin.kind === 'CHARACTER' && row.origin.characterKey === plan.origin.characterKey && row.skillKey === plan.skillKey);
  if (sourceIndex < 0) fail('selection.plannedSkills.origin', '计划技能没有真实拥有者来源');
  // 有限目标窗口的自然状态只保留一份；主动过程使用独立真实绑定，不能把tick塞进计划入口。
  const providerRef = `source_natural_skill_${sourceIndex}${finiteTargetCounterContract(complete) ? '_active' : ''}`;
  const definitionRef = `${providerRef}_definition`;
  const sceneAttributeInputs = sceneAttributeParameterInputs(snapshot, configuration, process.processKey);
  const payloadSceneValues: Record<string, number> = {};
  const sceneSource = snapshot.source.skillSources.find(source => simulationSkillSourceIdentity(source.origin, source.skillKey)
    === simulationSkillSourceIdentity(plan.origin, plan.skillKey))!;
  for (const rule of processRules) for (const action of rule.actions) if (action.actionType === 'START_PROCESS' && action.detail.processKey === process.processKey) {
    Object.assign(payloadSceneValues, sceneInitialValuesForSource(sceneInitialParameterRequirements(snapshot), sceneInputs, 'source', sceneSource,
      { ruleKey: rule.ruleKey, actionKey: action.actionKey, processKey: process.processKey }));
  }
  const adapted = adaptProcessProgram({ gameId: snapshot.gameId, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
    characterLevel: snapshot.selection.sourceLevel, process, rules: processRules, effects: configuration.effects,
    parameters: configuration.parameters, formulas: configuration.formulas, owner: 'source', ammoRecoveryAttributes: snapshot.catalogs.attributes,
    internalStates: configuration.internalStates, modifierZones: snapshot.catalogs.modifierZones, damageTypes: snapshot.catalogs.damageTypes.map(row => row.type), providerDefinitionRef: definitionRef,
    basicAttackContext, sceneAttributeInputs, payloadSceneParameterValues: payloadSceneValues, stateInitialValues: sceneInitialValuesForSource(sceneInitialParameterRequirements(snapshot), sceneInputs,
      'source', snapshot.source.skillSources.find(source => simulationSkillSourceIdentity(source.origin, source.skillKey)
        === simulationSkillSourceIdentity(plan.origin, plan.skillKey))!),
    hitContext: { statuses: snapshot.catalogs.statuses, skillCategoryKeys: configuration.skill.skillCategoryKeys,
      vampRules: snapshot.catalogs.vampRules.rules, identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      criticalBinding: (forced, path) => simulationCriticalBinding(snapshot, forced, path) },
    castCosts, ignoredCastCosts: ignoredCosts.map(({ skillKey: _skillKey, ...cost }) => cost), roundPositiveCooldownMs: true });
  if (adapted.controls.length !== plan.phaseKinds.length || plan.phaseKinds.some(phase => adapted.controls.filter(control => control.action === phase).length !== 1)) {
    fail(`${root}.triggerRules`, '每个选定阶段必须有唯一真实同源控制，取消必须沿过程取消请求与主动取消失败动作');
  }
  const providers: ProviderDefinition[] = [...adapted.providers];
  const formulas: NamedFormula[] = [...adapted.formulas];
  const types = new TypeCatalogEntries([['combatant/champion', 'combatant'], ['event/ability_started', 'event'], ['event/source_owner', 'event']]);
  for (const type of adapted.typeEntries) types.set(type.key, type.domain);
  const coverage: SimulationCoverage[] = [];
  for (const input of sceneAttributeInputs) {
    const initialAbilityIndex = adapted.provider.abilities?.findIndex(ability => ability.abilityKey === adapted.initialAbilityKey) ?? -1;
    if (initialAbilityIndex < 0) fail(`${root}.processes.${process.processKey}`, '场景属性快照缺少真实首次主动能力');
    const compiledPath = `sharedProviders[${definitionRef}].abilities[${initialAbilityIndex}].params.${input.parameterKey}`;
    coverage.push({ authorPath: `${root}.triggerRules.${input.ruleKey}.actions.${input.actionKey}.runtimeInputBindings.${input.bindingKey}`, compiledPath,
      note: `场景属性快照：${input.subject} ${input.attributeKey}；来源${input.sources.join('、')}；本次值${input.value}` });
    for (const authorPath of input.sourcePaths) coverage.push({ authorPath, compiledPath });
  }
  const operationOrigins: OperationOrigin[] = [];
  const hitCooldownReductions: PendingSkillHitCooldownReduction[] = [];
  const provider = adapted.provider;
  provider.kind = 'character';
  provider.providerKey = provider.stableId = definitionRef;
  const boundType = `ability/initial_cast/source/${providerRef}`;
  types.set(boundType, 'ability');
  const skillType = `ability/skill/${plan.skillKey}`;
  types.set(skillType, 'ability');
  const categories = configuration.skill.skillCategoryKeys.map(category => {
    if (!snapshot.catalogs.skillCategories.some(row => row.skillCategoryKey === category && row.status === 'ENABLED')) fail(`${root}.skillCategoryKeys`, '缺少真实已启用技能分类');
    const type = skillCategoryTypeKey(category);
    types.set(type, 'ability');
    return type;
  });
  for (const [abilityIndex, ability] of provider.abilities.entries()) {
    ability.skillKey = plan.skillKey;
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
  for (const [groupIndex, group] of provider.processes[0]!.momentOperations.entries()) for (const [operationIndex, operation] of group.operations.entries()) {
    if (operation.operation === 'state_change') {
      const writes = [...process.stateOperations].filter(row => row.moment.momentType === group.moment.momentType
        && row.moment.stepKey === group.moment.stepKey && (row.moment.failureReason ?? null) === group.moment.failureReason).sort((left, right) => left.sortOrder - right.sortOrder);
      const row = writes[group.operations.slice(0, operationIndex).filter(previous => previous.operation === 'state_change').length];
      if (!row || row.stateSkillKey !== plan.skillKey || row.stateKey !== operation.ref) fail(`${root}.processes.${process.processKey}`, '付款帧状态操作与作者顺序不一致');
      const authorPath = `${root}.processes.${process.processKey}.stateOperations.${row.operationKey}`;
      const compiledPath = `sharedProviders[${definitionRef}].processes[0].momentOperations[${groupIndex}].operations[${operationIndex}]`;
      coverage.push({ authorPath, compiledPath });
      if (row.value?.kind === 'FORMULA') coverage.push({ authorPath: `${root}.formulas.${row.value.formulaKey}.expression`, compiledPath: `${compiledPath}.amount`,
        note: '仅真实过程开始的自身整数计数设置，原作者公式保存在完整快照，帧状态读取有界展开为既有运算' });
    }
    if (operation.abilityRef) operation.abilityRef = operation.abilityRef.replace('self.provider[@mount]', `self.provider[${providerRef}]`);
    if (operation.operation === 'resource_change') {
      const effect = configuration.effects.find(effect => effect.results.some(result => operation.ref === `${root}.effects.${effect.effectKey}.results.${result.resultKey}`));
      const result = effect?.results.find(result => operation.ref === `${root}.effects.${effect!.effectKey}.results.${result.resultKey}`);
      const validMoment = group.moment.momentType === 'PROCESS_COMPLETE'
        || group.moment.momentType === 'PROCESS_FAILURE' && group.moment.failureReason != null;
      if (!effect || result?.resultType !== 'RESOURCE_CHANGE' || result.target !== 'SOURCE' || result.detail.operation !== 'REFUND'
        || result.detail.attributeKey !== operation.resourceKey || !validMoment || effect.lifecycle !== null
        || result.lifecycleBehavior !== null || result.spellShieldBlockScope !== null) fail(`${root}.processes.${process.processKey}`, '未明确声明为施法成本的资源改变仍是必要结果，仅完整结束时点退款可执行');
      const constant = operation.amount && tryFoldConstant(operation.amount);
      const rule = result.valueRule;
      const boundedNonNegative = rule.fixedMinValue !== null && rule.fixedMinValue >= 0
        && (rule.fixedMaxValue === null || rule.fixedMaxValue >= 0);
      if (!(typeof constant === 'number' && constant >= 0) && !boundedNonNegative) {
        fail(`${operation.ref}.valueRule`, '退款必须可静态证明非负或明确配置非负上下限，不能转为二次扣费');
      }
      const compiledPath = `sharedProviders[${definitionRef}].processes[0].momentOperations[${groupIndex}].operations[${operationIndex}]`;
      coverage.push({ authorPath: operation.ref!, compiledPath });
      operationOrigins.push({ abilityRef: `source.provider[${providerRef}].ability[${adapted.initialAbilityKey}]`, operationRef: operation.ref!,
        skillKey: plan.skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, compiledPaths: [compiledPath], providerDefinitionRef: definitionRef });
    }
    if (operation.operation === 'cooldown_change' && operation.ref) {
      const effect = configuration.effects.find(effect => effect.results.some(result => operation.ref === `${root}.effects.${effect.effectKey}.results.${result.resultKey}`));
      const result = effect?.results.find(result => operation.ref === `${root}.effects.${effect!.effectKey}.results.${result.resultKey}`);
      if (!effect || result?.resultType !== 'ATTACK_TIMER_RESET' || operation.abilityRef !== basicAttackContext?.binding.initialControlAbilityRef) fail(`${root}.processes.${process.processKey}`, '普攻重置必须关联完整作者结果与实际普攻INITIAL');
      const compiledPath = `sharedProviders[${definitionRef}].processes[0].momentOperations[${groupIndex}].operations[${operationIndex}]`;
      coverage.push({ authorPath: operation.ref, compiledPath });
      operationOrigins.push({ abilityRef: `source.provider[${providerRef}].ability[${adapted.initialAbilityKey}]`, operationRef: operation.ref,
        skillKey: plan.skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, compiledPaths: [compiledPath], providerDefinitionRef: definitionRef });
    }
    if (operation.operation === 'shield') {
      const effect = configuration.effects.find(effect => effect.results.some(result => operation.ref === `${root}.effects.${effect.effectKey}.results.${result.resultKey}`));
      const result = effect?.results.find(result => operation.ref === `${root}.effects.${effect!.effectKey}.results.${result.resultKey}`);
      if (!effect || !result || result.resultType !== 'NORMAL_SHIELD') fail(`${root}.processes.${process.processKey}`, '护盾操作必须对应真实作者普通盾');
      const compiledPath = `sharedProviders[${definitionRef}].processes[0].momentOperations[${groupIndex}].operations[${operationIndex}]`;
      coverage.push({ authorPath: operation.ref!, compiledPath }, { authorPath: `${root}.effects.${effect.effectKey}.lifecycle`, compiledPath: `sharedProviders[${operation.shieldLifecycleProviderDefinitionRef}].lifecycle` });
      operationOrigins.push({ abilityRef: `source.provider[${providerRef}].ability[${adapted.initialAbilityKey}]`, operationRef: operation.ref!,
        skillKey: plan.skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, compiledPaths: [compiledPath], providerDefinitionRef: definitionRef });
    }
    if (operation.operation === 'apply_provider') {
      const effect = configuration.effects.find(effect => operation.ref === `${root}.effects.${effect.effectKey}`
        || effect.results.some(result => operation.ref === `${root}.effects.${effect.effectKey}.results.${result.resultKey}`));
      const dynamic = providers.find(provider => provider.providerKey === operation.providerDefinitionRef);
      if (!effect || !dynamic) fail(`${root}.processes.${process.processKey}`, '有限供值操作必须对应完整真实作者结果');
      const compiledPath = `sharedProviders[${definitionRef}].processes[0].momentOperations[${groupIndex}].operations[${operationIndex}]`;
      coverage.push({ authorPath: operation.ref!, compiledPath }, { authorPath: `${root}.effects.${effect.effectKey}.lifecycle`, compiledPath: `sharedProviders[${dynamic.providerKey}].lifecycle` });
      for (const [index, modifier] of (dynamic.modifiers ?? []).entries()) {
        const result = effect.results.find(row => row.resultKey === modifier.modifierKey);
        if (!result || !['ATTRIBUTE_CHANGE', 'DAMAGE_MODIFIER', 'COOLDOWN_DURATION_MODIFIER'].includes(result.resultType)) fail(operation.ref!, '有限修正缺少同键真实作者结果');
        const resultPath = `${root}.effects.${effect.effectKey}.results.${result.resultKey}`;
        const modifierPath = `sharedProviders[${dynamic.providerKey}].modifiers[${index}]`;
        coverage.push({ authorPath: resultPath, compiledPath }, { authorPath: `${resultPath}.valueRule`, compiledPath: `${modifierPath}.value` });
        if (result.resultType === 'ATTRIBUTE_CHANGE' || result.resultType === 'DAMAGE_MODIFIER') coverage.push({ authorPath: `catalogs.modifierZones.${result.detail.modifierZoneKey}`, compiledPath: modifierPath });
        if (result.resultType === 'DAMAGE_MODIFIER') coverage.push({ authorPath: `catalogs.damageTypes.${result.detail.damageTypeKey}`, compiledPath: `${modifierPath}.condition` });
        if ((modifier.kind === 'attribute' || modifier.kind === 'resource_max') && result.resultType !== 'ATTRIBUTE_CHANGE'
          || modifier.kind === 'cooldown_duration' && result.resultType !== 'COOLDOWN_DURATION_MODIFIER') fail(operation.ref!, '持续结果与修正种类不一致');
        if (modifier.kind === 'resource_max') coverage.push({ authorPath: resultPath, compiledPath: `${modifierPath}.currentValuePolicy`, note: '生命上限独立事实与可靠累计，不作为治疗' });
        operationOrigins.push({ abilityRef: `source.provider[${providerRef}].ability[${adapted.initialAbilityKey}]`, operationRef: resultPath,
          skillKey: plan.skillKey, effectKey: effect.effectKey, resultKey: result.resultKey, compiledPaths: [compiledPath], providerDefinitionRef: definitionRef });
      }
    }
  }
  const binding: SkillActionBinding = { bindingKey: `planned_${providerRef}`, source: 'source', providerRef,
    providerDefinitionRef: definitionRef, skillKey: plan.skillKey,
    controls: adapted.controls.map(control => ({ action: control.action as SkillActionBinding['controls'][number]['action'],
      processKey: process.processKey, abilityRef: `source.provider[${providerRef}].ability[${control.abilityKey}]` })), hitBindings: [] };
  const defenses = new Map<string, ReturnType<typeof compileSimulationDamageFormula>>();
  let vampRules: ReturnType<typeof adaptHitProgram>['vampRules'];
  for (const periodic of adapted.finitePeriodic ?? []) {
    const dynamic = periodic.provider, tick = dynamic.abilities![0]!;
    if (vampRules && JSON.stringify(vampRules) !== JSON.stringify(periodic.vampRules)) fail(root, '有限周期与其它技能必须共享真实吸血规则');
    vampRules = periodic.vampRules;
    for (const type of periodic.typeEntries) types.set(type.key, type.domain);
    const effect = configuration.effects.find(row => row.effectKey === periodic.effectKey)!;
    const tickRoot = `sharedProviders[${dynamic.providerKey}].abilities[0].tickSpec`;
    coverage.push({ authorPath: `${root}.effects.${effect.effectKey}.lifecycle`, compiledPath: `sharedProviders[${dynamic.providerKey}].lifecycle` },
      { authorPath: `${root}.effects.${effect.effectKey}.lifecycle.firstPeriodicExecution`, compiledPath: `${tickRoot}.startDelayMs`, note: '明确序列化0，只有有限完整纯周期实例首次提交才立即跳；刷新保留原节拍' },
      { authorPath: `${root}.effects.${effect.effectKey}.lifecycle.periodicIntervalValue`, compiledPath: `${tickRoot}.intervalMs` });
    for (const [index, operation] of tick.tickSpec!.onTick.entries()) {
      const result = effect.results.find(row => operation.ref === `${root}.effects.${effect.effectKey}.results.${row.resultKey}`);
      if (!result || result.resultType !== 'DAMAGE' || operation.operation !== 'damage') fail(root, '有限周期必须保留每笔实际作者伤害结果');
      const compiledPath = `${tickRoot}.onTick[${index}]`, authorPath = operation.ref!;
      coverage.push({ authorPath, compiledPath }, { authorPath: `${authorPath}.valueRule`, compiledPath: `${compiledPath}.amount` });
      operationOrigins.push({ abilityRef: `source.provider[${dynamic.providerKey}].ability[${tick.abilityKey}]`,
        operationRef: authorPath, skillKey: plan.skillKey, effectKey: effect.effectKey, resultKey: result.resultKey,
        compiledPaths: [compiledPath], providerDefinitionRef: dynamic.providerKey });
      const defense = compileSimulationDamageFormula(snapshot, result.detail.damageTypeKey);
      defenses.set(operation.damageType!, defense);
    }
  }
  if (adapted.empoweredPayload && hitRules.length) fail(`${root}.triggerRules`, '强化待击结果只来自真实步骤效果挂接，不能再以技能命中监听重复执行');
  const hitStages = processSkillHitStages(plan.skillKey, process, hitRules);
  if (adapted.empoweredPayload) hitStages.push({ rules: [], abilityKey: 'selected_skill_hit', hitBindingKey: 'selected_skill_release_hit',
    moment: { momentType: 'STEP_EXECUTION', stepKey: process.steps[0]!.stepKey, failureReason: null }, authorPaths: [] });
  for (const stage of hitStages) {
    const terminal = provider.processes[0]!.steps[provider.processes[0]!.steps.length - 1]!;
    const hit = adapted.empoweredPayload?.hit ?? adaptHitProgram({ gameId: snapshot.gameId, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
      characterLevel: snapshot.selection.sourceLevel, rules: stage.rules, effects: configuration.effects,
      parameters: configuration.parameters, formulas: configuration.formulas, internalStates: configuration.internalStates, statuses: snapshot.catalogs.statuses,
      modifierZones: snapshot.catalogs.modifierZones, skillCategoryKeys: configuration.skill.skillCategoryKeys,
      vampRules: snapshot.catalogs.vampRules.rules, identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      criticalBinding: (forced, path) => simulationCriticalBinding(snapshot, forced, path),
      ...(siblingTargetCounterRead ? { siblingTargetCounterRead } : {}),
      ...(terminal.stepType === 'CHARGE' && (plan.phaseKinds.includes('CHARGE_RELEASE') || terminal.releaseAtMaximum === true)
        ? { chargeReleaseContext: { process, rules: processRules } } : {}) });
    if (!hit.skillHit.candidates.length) fail(`${root}.triggerRules`, '计划命中缺少完整必要结果');
    const hitAbilityIndex = provider.abilities.length;
    provider.abilities.push({ abilityKey: stage.abilityKey, kind: 'active', skillKey: plan.skillKey,
      types: [...new Set([...categories, skillType, ...hit.abilityTypes])], params: hit.params,
      ...(hitChain && stage.moment.stepKey === hitChain.tail.stepKey ? { castCondition: { op: 'eq' as const,
        args: [{ op: 'read' as const, path: `provider.state.${hitChain.state.stateKey}` }, { op: 'const' as const, value: 1 }] } } : {}),
      operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: hit.skillHit }] });
    const hitAbilityRef = `source.provider[${providerRef}].ability[${stage.abilityKey}]`;
    if (hitChain && stage.moment.stepKey === hitChain.tail.stepKey) for (const rule of hitChain.tailRules) coverage.push({
      authorPath: `${root}.triggerRules.${rule.ruleKey}.conditionGroups`, compiledPath: `sharedProviders[${definitionRef}].abilities[${hitAbilityIndex}].castCondition` });
    binding.hitBindings.push({ hitBindingKey: stage.hitBindingKey, processKey: process.processKey, moment: stage.moment,
      hitAbilityRef, ...(stage.requiresPriorHitBindingKey ? { requiresPriorHitBindingKey: stage.requiresPriorHitBindingKey } : {}) });
    for (const authorPath of stage.authorPaths) coverage.push({ authorPath,
      compiledPath: `rules.skillActionBindings[${binding.bindingKey}].hitBindings[${binding.hitBindings.length - 1}]` });
    for (const [index, group] of (hit.skillHit.ruleGroups ?? []).entries()) coverage.push({
      authorPath: `${root}.triggerRules.${group.ruleKey}.oncePerUse`,
      compiledPath: `sharedProviders[${definitionRef}].abilities[${hitAbilityIndex}].operations[0].skillHit.ruleGroups[${index}].oncePerUse`
    });
    providers.push(...hit.providers);
    formulas.push(...hit.formulas);
    for (const type of hit.typeEntries) types.set(type.key, type.domain);
    vampRules = hit.vampRules;
    for (const [candidateIndex, candidate] of hit.skillHit.candidates.entries()) {
      const authorPath = `${root}.effects.${candidate.effectKey}.results.${candidate.resultKey}`;
      if (candidate.semantic.resultType === 'ATTRIBUTE_CHANGE' && candidate.operations.length === 1) {
        const grouped = hit.providers.find(row => row.providerKey === candidate.operations[0]!.providerDefinitionRef);
        if (grouped?.modifiers?.length === 2 && grouped.modifiers.every(row => row.valueReadMode === 'APPLICATION_SNAPSHOT')) {
          const effect = configuration.effects.find(row => row.effectKey === candidate.effectKey)!;
          for (const [index, modifier] of grouped.modifiers.entries()) {
            if (!effect.results.some(result => result.resultKey === modifier.modifierKey)) fail(authorPath, '双端快照缺少真实完整作者结果');
            coverage.push({ authorPath: `${root}.effects.${effect.effectKey}.results.${modifier.modifierKey}`,
              compiledPath: `sharedProviders[${grouped.providerKey}].modifiers[${index}]`, note: '完整双端属性共用一次实际目标命中、实例与期限；来源不产生独立阻挡候选' });
          }
        }
      }
      for (const operation of candidate.operations) operation.ref = authorPath;
      const compiledPath = `sharedProviders[${definitionRef}].abilities[${hitAbilityIndex}].operations[0].skillHit.candidates[${candidateIndex}]`;
      coverage.push({ authorPath, compiledPath });
      const reduction = hit.cooldownReductions?.find(row => row.candidate === candidate);
      if (reduction) {
        hitCooldownReductions.push({ ...reduction, authorPath, compiledPath, hitAbilityRef });
        continue;
      }
      for (const operation of candidate.operations) if (operation.operation === 'damage' && operation.critEligible) {
        coverage.push({ authorPath: `${authorPath}.detail.critical.mode`, compiledPath: `${compiledPath}.operations[${candidate.operations.indexOf(operation)}].critChance` },
          { authorPath: `${authorPath}.detail.critical.multiplierValue`, compiledPath: `${compiledPath}.operations[${candidate.operations.indexOf(operation)}].critMultiplier` });
      }
      operationOrigins.push({ abilityRef: hitAbilityRef, operationRef: authorPath,
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
  for (const state of configuration.internalStates) {
    const compiledPath = `sharedProviders[${definitionRef}].initialStateSchema.${state.stateKey}`;
    if (provider.initialStateSchema?.[state.stateKey] === undefined) fail(`${root}.internalStates.${state.stateKey}`, '主动状态没有实际父供值器字段');
    coverage.push({ authorPath: `${root}.internalStates.${state.stateKey}`, compiledPath });
  }
  coverage.push({ authorPath: `${root}.processes.${process.processKey}`, compiledPath: `sharedProviders[${definitionRef}].processes[0]` });
  if (process.cooldown) coverage.push({ authorPath: `${root}.processes.${process.processKey}.cooldown.durationValue`,
    compiledPath: `sharedProviders[${definitionRef}].processes[0].cooldown`,
    note: '只读取作者冷却表达式；原值须为正。原生正数四舍五入且最小1毫秒，不在页面计算或重复折扣；普攻只沿攻速冷却' });
  for (const rule of processRules) coverage.push({ authorPath: `${root}.triggerRules.${rule.ruleKey}`, compiledPath: `sharedProviders[${definitionRef}].abilities` });
  for (const ruleKey of excludedRuleKeys) coverage.push({ authorPath: `${root}.triggerRules.${ruleKey}`,
    compiledPath: 'runtimeOptions.skillOrigins', note: '未计划的独立入口不执行；必要自然来源仍独立完整装配' });
  for (const effect of complete.effects) if (!configuration.effects.some(selected => selected.effectKey === effect.effectKey)) {
    coverage.push({ authorPath: `${root}.effects.${effect.effectKey}`, compiledPath: 'runtimeOptions.skillOrigins',
      note: '该作者效果没有进入本次可达挂接闭包；完整原定义仍保存在快照，不宣称效果或退款已执行，也不视作忽略费用' });
  }
  for (const cost of ignoredCosts) coverage.push({ authorPath: `${root}.effects.${cost.effectKey}.results.${cost.resultKey}`,
    compiledPath: `sharedProviders[${definitionRef}].processes[0].costs`, note: `本期忽略明确施法成本；原挂接${cost.bindingKey}保留在作者快照，不建立门槛、扣除或退款` });
  return { providers, formulas, types: [...types].map(([key, domain]) => ({ key, domain })), binding,
    origin: plan.origin, hitCooldownReductions,
    rules: { damageTypeFormulas: [...defenses.values()], ...(vampRules ? { vampRules } : {}) }, coverage, operationOrigins,
    cooldownDurationScopes: configuration.effects.flatMap(effect => effect.results.flatMap(result => result.resultType === 'COOLDOWN_DURATION_MODIFIER'
      && providers.some(provider => provider.providerKey === cooldownDurationProviderKey(definitionRef, plan.skillKey, effect.effectKey))
      ? [{ providerKey: cooldownDurationProviderKey(definitionRef, plan.skillKey, effect.effectKey), skillKeys: result.detail.affectedSkillScope.skillKeys,
        authorPath: `${root}.effects.${effect.effectKey}.results.${result.resultKey}.detail.affectedSkillScope` }] : [])),
    ignoredCastCosts: structuredClone([...ignoredCosts]) };
}
