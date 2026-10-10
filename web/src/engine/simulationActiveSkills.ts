import { TypeCatalogEntries } from './typeCatalogEntries';
import type { NamedFormula, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SimulationPlannedSkill, SimulationSnapshot } from '../types/simulationSnapshot';
import type { OperationOrigin, SimulationCoverage } from './simulationAdapter';
import { adaptProcessProgram, type CastCostRef } from './processAdapter';
import { adaptHitProgram } from './hitAdapter';
import { NumericAdaptationError } from './numericAdapter';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { plannedSkillRuleKeys } from './simulationSkillSourceDescription';
import { selectSimulationSkillSourceClosure } from './simulationSkillSourceClosure';
import { compileSimulationDamageFormula, validateConfiguration } from './simulationTriggeredEquipment';
import { changedAttributes } from './simulationCalculationRules';

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
  if (!plans.length || plans.length > 16 || new Set(plans.map(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey))).size !== plans.length) {
    fail('selection.plannedSkills', '需要1～16份不同真实来源，每个来源只允许一个等级');
  }
  if (ignoredCosts.some(cost => !plans.some(plan => plan.skillKey === cost.skillKey))) fail('ignoredCastCosts', '费用引用必须属于本次计划技能');
  const assemblies = [...plans].sort((left, right) => simulationSkillSourceIdentity(left.origin, left.skillKey)
    .localeCompare(simulationSkillSourceIdentity(right.origin, right.skillKey), 'en')).map(plan =>
    assembleActiveSkill(snapshot, plan, ignoredCosts.filter(cost => cost.skillKey === plan.skillKey)));
  const providers = new Map<string, ProviderDefinition>();
  const formulas = new Map<string, NamedFormula>();
  const types = new TypeCatalogEntries();
  const defenses = new Map<string, ReturnType<typeof compileSimulationDamageFormula>>();
  let vampRules: ReturnType<typeof adaptHitProgram>['vampRules'];
  const changed = changedAttributes();
  const collectChanged = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collectChanged); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.operation === 'attribute_change' && typeof row.attributeKey === 'string') {
      if (row.target !== 'source' && row.target !== 'target' && row.target !== 'self') fail('active.attribute_change.target', '计划属性操作缺少明确双方映射');
      changed[row.target === 'target' ? 'target' : 'source'].add(row.attributeKey);
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

function assembleActiveSkill(snapshot: SimulationSnapshot, plan: SimulationPlannedSkill, ignoredCosts: readonly SimulationCastCostRef[]) {
  const root = `skills.${plan.skillKey}`;
  const complete = snapshot.skillConfigurations.find(row => row.skill.skillKey === plan.skillKey);
  if (!complete) fail(root, '缺少计划技能的完整作者配置');
  validateConfiguration(complete, snapshot.gameId, root, false, plan.skillLevel);
  if (plan.origin.kind !== 'CHARACTER' || plan.origin.characterKey !== snapshot.selection.sourceCharacterKey
    || complete.skill.skillCategoryKeys.includes('basic_attack') || !plan.phaseKinds.includes('INITIAL')
    || new Set(plan.phaseKinds).size !== plan.phaseKinds.length
    || plan.phaseKinds.some(phase => !['INITIAL', 'CHARGE_RELEASE', 'RECAST', 'CANCEL'].includes(phase))) {
    fail('selection.plannedSkills', '只开放攻击方真实角色主动技能，阶段必须明确且包含首次');
  }
  const roots = plannedSkillRuleKeys(complete, plan.phaseKinds);
  const { configuration, excludedRuleKeys } = selectSimulationSkillSourceClosure(complete, roots);
  if (configuration.processes.length !== 1 || configuration.internalStates.length) fail(root, '只开放唯一有限施放过程，无未支持的必要状态消费');
  const process = configuration.processes[0]!;
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
  const adapted = adaptProcessProgram({ gameId: snapshot.gameId, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
    characterLevel: snapshot.selection.sourceLevel, process, rules: processRules, effects: configuration.effects,
    parameters: configuration.parameters, formulas: configuration.formulas, owner: 'source',
    castCosts: ignoredCosts.map(({ skillKey: _skillKey, ...cost }) => cost), ignoreCastCosts: true, roundPositiveCooldownMs: true });
  if (adapted.controls.length !== plan.phaseKinds.length || plan.phaseKinds.some(phase => adapted.controls.filter(control => control.action === phase).length !== 1)) {
    fail(`${root}.triggerRules`, '每个选定阶段必须有唯一真实同源控制，取消必须沿过程取消请求与主动取消失败动作');
  }
  const providers: ProviderDefinition[] = [];
  const formulas: NamedFormula[] = [...adapted.formulas];
  const types = new TypeCatalogEntries([['combatant/champion', 'combatant'], ['event/ability_started', 'event'], ['event/source_owner', 'event']]);
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
  provider.kind = 'character';
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
  for (const group of provider.processes[0]!.momentOperations) for (const operation of group.operations) {
    if (operation.abilityRef) operation.abilityRef = operation.abilityRef.replace('self.provider[@mount]', `self.provider[${providerRef}]`);
    if (operation.operation === 'resource_change') fail(`${root}.processes.${process.processKey}`, '未明确声明为施法成本的资源改变仍是必要结果，6A不支持时严格拒绝');
  }
  const binding: SkillActionBinding = { bindingKey: `planned_${providerRef}`, source: 'source', providerRef,
    providerDefinitionRef: definitionRef, skillKey: plan.skillKey,
    controls: adapted.controls.map(control => ({ action: control.action as SkillActionBinding['controls'][number]['action'],
      processKey: process.processKey, abilityRef: `source.provider[${providerRef}].ability[${control.abilityKey}]` })), hitBindings: [] };
  const defenses = new Map<string, ReturnType<typeof compileSimulationDamageFormula>>();
  let vampRules: ReturnType<typeof adaptHitProgram>['vampRules'];
  if (hitRules.length) {
    const terminal = provider.processes[0]!.steps[provider.processes[0]!.steps.length - 1]!;
    const stepExecution = ['CHARGE', 'RECAST', 'MULTI_HIT', 'CHANNEL'].includes(terminal.stepType);
    const hit = adaptHitProgram({ gameId: snapshot.gameId, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
      characterLevel: snapshot.selection.sourceLevel, rules: hitRules, effects: configuration.effects,
      parameters: configuration.parameters, formulas: configuration.formulas, statuses: snapshot.catalogs.statuses,
      modifierZones: snapshot.catalogs.modifierZones, skillCategoryKeys: configuration.skill.skillCategoryKeys,
      vampRules: snapshot.catalogs.vampRules.rules, identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } },
      ...(terminal.stepType === 'CHARGE' && (plan.phaseKinds.includes('CHARGE_RELEASE') || terminal.releaseAtMaximum === true)
        ? { chargeReleaseContext: { process, rules: processRules } } : {}) });
    if (!hit.skillHit.candidates.length) fail(`${root}.triggerRules`, '计划命中缺少完整必要结果');
    const hitAbilityIndex = provider.abilities.length;
    provider.abilities.push({ abilityKey: 'selected_skill_hit', kind: 'active', skillKey: plan.skillKey,
      types: [...new Set([...categories, skillType, ...hit.abilityTypes])], params: hit.params,
      operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: hit.skillHit }] });
    binding.hitBindings.push({ hitBindingKey: 'selected_skill_release_hit', processKey: process.processKey,
      moment: { momentType: stepExecution ? 'STEP_EXECUTION' : 'PROCESS_COMPLETE', stepKey: stepExecution ? terminal.stepKey : null, failureReason: null },
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
    rules: { damageTypeFormulas: [...defenses.values()], ...(vampRules ? { vampRules } : {}) }, coverage, operationOrigins,
    ignoredCastCosts: structuredClone([...ignoredCosts]) };
}
