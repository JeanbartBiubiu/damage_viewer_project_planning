import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import type { AbilityDefinition, GenericFormulaExpr, OperationDefinition, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SkillEffectDamageResult, SkillEffectValueRule } from '../types/skillEffect';
import type { NumericValue } from '../types/numericValue';
import type { BasicAttackBinding, TriggeredSourceAssembly } from './simulation/model';
import { compileSimulationDamageFormula } from './simulation/compile/damageFormula';
import { compileDamage, type AuthoredHitProgram } from './hitAdapter';
import { compileNumericValue, constExpr, createNumericCompileState, NumericAdaptationError, tryFoldConstant } from './numericAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { TypeCatalogEntries } from './typeCatalogEntries';
import { skillCategoryTypeKey } from './skillCategoryType';
import { compiledTargetMark } from './targetMarkContract';
import { simulationSkillSourceIdentity } from '../services/simulationSkillSourceIdentity';
import { targetMarkAuthoringContract } from './targetMarkAuthoringContract';

export type TargetMarkAssemblyInput = {
  snapshot: SimulationSnapshot;
  source: SimulationSkillSource;
  side: 'source' | 'target';
  providerRef: string;
  definitionRef: string;
  skillActionBindings: readonly SkillActionBinding[];
  /** 总装配后的真实定义，用于逐项核验引用；本函数不修改它们。 */
  providers: readonly ProviderDefinition[];
  mounts: ReadonlyArray<{ side: 'source' | 'target'; providerRef: string; definitionRef: string }>;
  basicAttackBinding: BasicAttackBinding | null;
  configuration?: SkillConfiguration;
};
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function one<T>(rows: T[], path: string): T {
  if (rows.length !== 1) fail(path, '目标标记需要唯一实际拥有者、挂载和能力');
  return rows[0]!;
}
const refOf = (providerRef: string, abilityKey: string) => `source.provider[${providerRef}].ability[${abilityKey}]`;
function actualAbility(binding: SkillActionBinding, input: TargetMarkAssemblyInput, ref: string, path: string) {
  const providers = input.providers;
  const mount = one(input.mounts.filter(row => row.side === 'source' && row.providerRef === binding.providerRef), path);
  if (mount.definitionRef !== binding.providerDefinitionRef) fail(path, '实际挂载与初始能力定义不一致');
  const parent = one(providers.filter(provider => provider.providerKey === binding.providerDefinitionRef), path);
  const ability = one((parent.abilities ?? []).filter(row => refOf(binding.providerRef, row.abilityKey) === ref), path);
  if (parent.kind !== 'character' || parent.skillKey !== binding.skillKey || !parent.stableId || parent.lifecycle
    || binding.source !== 'source' || ability.skillKey !== binding.skillKey || ability.kind !== 'active'
    || !ability.types?.includes(`ability/skill/${binding.skillKey}`) || ability.types.includes('ability/basic_attack')) fail(path, '命中引用不能指向外来或临时来源');
  return { parent, ability };
}
function skillHit(binding: SkillActionBinding, input: TargetMarkAssemblyInput, path: string) {
  const initial = one(binding.controls.filter(control => control.action === 'INITIAL'), path);
  if (binding.controls.length !== 1) fail(path, '标记联动只接唯一首次主动过程');
  const hit = one(binding.hitBindings, path);
  if (hit.requiresPriorHitBindingKey != null || hit.processKey !== initial.processKey
    || !['STEP_EXECUTION', 'PROCESS_COMPLETE'].includes(hit.moment.momentType)) fail(path, '联动命中须属于同一首次过程的唯一真实阶段');
  const { parent, ability: start } = actualAbility(binding, input, initial.abilityRef, path);
  const { ability } = actualAbility(binding, input, hit.hitAbilityRef, path);
  const process = one((parent.processes ?? []).filter(row => row.processKey === initial.processKey && row.skillKey === binding.skillKey), path);
  if ((parent.processes?.length ?? 0) !== 1 || start.processControl?.action !== 'INITIAL'
    || start.processControl.processKey !== process.processKey || start.processControl.useRefFromEvent === true
    || (hit.moment.momentType === 'STEP_EXECUTION' ? !process.steps.some(step => step.stepKey === hit.moment.stepKey) : hit.moment.stepKey !== null)
    || ability.operations?.length !== 1 || ability.operations[0]!.operation !== 'resolve_skill_hit'
    || ability.operations[0]!.skillHit?.skillKey !== binding.skillKey) fail(path, '缺少实际首次过程或完整根接触操作');
  return { parent, hitAbilityRef: hit.hitAbilityRef };
}
function available(snapshot: SimulationSnapshot, source: SimulationSkillSource, side: 'source' | 'target') {
  const identity = simulationSkillSourceIdentity(source.origin, source.skillKey);
  const actual = one(snapshot[side].skillSources.filter(row => simulationSkillSourceIdentity(row.origin, row.skillKey) === identity), 'targetMark.source');
  if (source.origin.kind !== 'CHARACTER' || source.origin.characterKey !== snapshot[side].character.characterKey
    || actual.enabled !== source.enabled || actual.skillStatus !== source.skillStatus || actual.skillLevel !== source.skillLevel) fail('targetMark.source', '标记来源必须来自本场真实角色清单');
  const plans = snapshot.selection.plannedSkills.filter(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey) === identity);
  if (side !== 'source' || !source.enabled || source.skillStatus !== 'ENABLED' || source.skillLevel === 0 || !plans.length) return null;
  if (source.inactiveReason !== null) fail('targetMark.source', '已计划标记来源仍存在未解除的停用原因');
  const plan = one(plans, 'targetMark.plannedSkills');
  if (plan.skillLevel !== source.skillLevel || !Number.isSafeInteger(source.skillLevel) || source.skillLevel! < 1
    || plan.phaseKinds.length !== 1 || plan.phaseKinds[0] !== 'INITIAL') fail('targetMark.plannedSkills', '标记须由实际已学等级和唯一首次计划驱动');
  return plan;
}
function ruleRef(skillKey: string, ruleKey: string) { return `skills.${skillKey}.triggerRules.${ruleKey}`; }

/**
 * 在所有主动/普攻完成装配后调用。providers只返回同父定义的补充schema/abilities，
 * 由根合并到现有定义并重定位局部数组索引；mounts为空，不能重复挂载父来源。
 */
export function assembleTargetMarkSource(input: TargetMarkAssemblyInput): TriggeredSourceAssembly | null {
  const { snapshot, source, side, providerRef, definitionRef, providers, skillActionBindings, basicAttackBinding } = input;
  if (!available(snapshot, source, side)) return null;
  const configurations = snapshot.skillConfigurations.filter(row => row.skill.skillKey === source.skillKey);
  const configuration = input.configuration ?? one(configurations, 'targetMark.configuration');
  if (configuration.skill.gameId !== snapshot.gameId || configuration.skill.skillKey !== source.skillKey
    || configuration.skill.status !== 'ENABLED' || configurations.some(row => row.baseDigest !== configuration.baseDigest)) fail('targetMark.configuration', '标记完整作者图须属于真实当前配置');
  const contract = targetMarkAuthoringContract(configuration);
  if (!contract) return null;
  const skillKey = source.skillKey, root = `skills.${skillKey}`;
  const binding = one(skillActionBindings.filter(row => row.skillKey === skillKey), `${root}.binding`);
  if (binding.providerRef !== providerRef || binding.providerDefinitionRef !== definitionRef) fail(root, '标记不得借用其它挂载');
  const own = skillHit(binding, input, root);
  if (binding.controls[0]!.processKey !== contract.cast.processKey) fail(root, '标记首次过程与真实作者过程不一致');
  const parent = own.parent;
  const ownAbility = one((parent.abilities ?? []).filter(ability => refOf(providerRef, ability.abilityKey) === own.hitAbilityRef), root);
  const ownCandidates = ownAbility.operations![0]!.skillHit!.candidates;
  if (ownCandidates.length !== 1 || ownCandidates[0]!.effectKey !== contract.rootEffect.effectKey
    || ownCandidates[0]!.resultKey !== contract.rootEffect.results[0]!.resultKey || ownCandidates[0]!.spellShieldBlockScope !== 'SKILL'
    || ownCandidates[0]!.semantic.resultType !== 'DAMAGE' || ownCandidates[0]!.semantic.target !== 'TARGET'
    || ownCandidates[0]!.operations.length !== 1 || ownCandidates[0]!.operations[0]!.operation !== 'damage'
    || !ownCandidates[0]!.operations[0]!.amount || tryFoldConstant(ownCandidates[0]!.operations[0]!.amount!) !== 0) fail(root, '标记写入须绑定真实零应用根，而不是其它主动命中');
  const numeric = createNumericCompileState({ gameId: snapshot.gameId, skillKey, skillLevel: source.skillLevel!,
    characterLevel: snapshot.selection.sourceLevel, parameters: configuration.parameters, formulas: configuration.formulas,
    formulaNamespace: `target_mark/${definitionRef}/${skillKey}`, bindParameters: true, allowAttributeReads: true,
    runtimeInputMessage: '标记伤害不得依赖引爆技能费用或未声明运行输入' });
  const required: TriggeredSourceAssembly['required'] = { source: new Set(), target: new Set() };
  const validateValue = (value: NumericValue, path: string, attributes = true) => {
    if (value.kind === 'FIXED') { if (!Number.isFinite(value.value)) fail(path, '标记数值必须有限'); return; }
    if (value.kind === 'PARAMETER') {
      const p = one(configuration.parameters.filter(row => row.parameterKey === value.parameterKey), path);
      if (p.valueMode === 'RUNTIME_INPUT') fail(path, '标记结算只读取本技能固定等级参数');
      return;
    }
    if (value.kind !== 'FORMULA') fail(path, '未支持的标记数值');
    const formula = one(configuration.formulas.filter(row => row.formulaKey === value.formulaKey), path);
    for (const declared of formula.expression.inputs) {
      const read = declared.binding;
      if (read.kind === 'parameter') {
        if (read.skillKey !== skillKey) fail(path, '标记公式不能借用引爆技能参数');
        validateValue({ kind: 'PARAMETER', parameterKey: read.parameterKey }, path, attributes);
      } else if (read.kind === 'attribute') {
        if (!attributes || read.view !== 'current_frame' || read.object !== 'source' && read.object !== 'target') fail(path, '标记只允许引爆时双方当前属性，静态值不能夹带隐藏属性');
        const attribute = one(snapshot.catalogs.attributes.filter(row => row.attributeKey === read.attributeKey && row.gameId === snapshot.gameId), path);
        if (attribute.status !== 'ENABLED') fail(path, '标记读取的真实属性必须启用');
        required[read.object].add(read.attributeKey);
      } else fail(path, '标记公式全部声明依赖均禁止事件、状态或实例时间');
    }
  };
  const constant = (value: NumericValue, path: string, minimum: number, integer: boolean) => {
    validateValue(value, path, false);
    const amount = tryFoldConstant(compileNumericValue(value, path, { ...numeric, bindParameters: false, allowAttributeReads: false }));
    if (amount === null || !Number.isFinite(amount) || amount < minimum || integer && !Number.isSafeInteger(amount)) fail(path, '标记状态须有明确静态有限整数');
    return amount;
  };
  const statePath = `${root}.internalStates.${contract.state.stateKey}`;
  if (constant(contract.state.detail.initialValue, statePath, 0, true) !== 0
    || constant(contract.state.detail.maxValue, statePath, 1, true) !== 1) fail(statePath, '目标标记仅初0上限1');
  const duration = constant(contract.state.detail.durationValue!, statePath, 1, true);
  const priorState = parent.initialStateSchema?.[contract.state.stateKey];
  if (priorState !== undefined && (typeof priorState !== 'object' || priorState.defaultValue !== 0 || priorState.maxValue !== 1
    || priorState.durationMs !== duration || priorState.refreshPolicy !== 'refresh_on_write' || priorState.stateKind !== undefined || priorState.onExpire !== undefined)) fail(statePath, '标记不得覆盖同父定义的其它状态语义');
  const types = new TypeCatalogEntries([['event/skill_hit', 'event'], ['event/source_owner', 'event'], ['state_scope/provider_target', 'state_scope']]);
  const assembly: TriggeredSourceAssembly = { providers: [], mounts: [], formulas: [], types: [], rules: { damageTypeFormulas: [] },
    coverage: [], operationOrigins: [], required, selectedSkills: new Set([skillKey]), changedAttributes: { source: new Set(), target: new Set() },
    compiledSources: [{ side, providerRef, definitionRef, skillKey }] };
  const coverValue = (value: NumericValue, compiledPath: string) => {
    if (value.kind === 'PARAMETER') assembly.coverage.push({ authorPath: `${root}.parameters.${value.parameterKey}`, compiledPath });
    if (value.kind === 'FORMULA') {
      assembly.coverage.push({ authorPath: `${root}.formulas.${value.formulaKey}.expression`, compiledPath });
      const formula = one(configuration.formulas.filter(row => row.formulaKey === value.formulaKey), root);
      for (const input of formula.expression.inputs) if (input.binding.kind === 'parameter') assembly.coverage.push({
        authorPath: `${root}.parameters.${input.binding.parameterKey}`, compiledPath });
    }
  };
  for (const [key, value] of [['defaultValue', contract.state.detail.initialValue], ['maxValue', contract.state.detail.maxValue],
    ['durationMs', contract.state.detail.durationValue!]] as const) coverValue(value, `sharedProviders[${definitionRef}].initialStateSchema.${contract.state.stateKey}.${key}`);
  const author: AuthoredHitProgram = { gameId: snapshot.gameId, skillKey, skillLevel: source.skillLevel!, characterLevel: snapshot.selection.sourceLevel,
    rules: [], effects: configuration.effects, parameters: configuration.parameters, formulas: configuration.formulas,
    statuses: snapshot.catalogs.statuses, skillCategoryKeys: configuration.skill.skillCategoryKeys, vampRules: snapshot.catalogs.vampRules.rules,
    identity: { source: { category: 'CHAMPION', hostility: 'SELF' }, target: { category: 'CHAMPION', hostility: 'ENEMY' } } };
  const categories = configuration.skill.skillCategoryKeys.map(key => {
    if (!snapshot.catalogs.skillCategories.some(row => row.skillCategoryKey === key && row.gameId === snapshot.gameId && row.status === 'ENABLED')) fail(root, '缺少真实技能分类');
    const type = skillCategoryTypeKey(key); types.set(type, 'ability'); return type;
  });
  const abilities: AbilityDefinition[] = [];
  const add = (ability: AbilityDefinition, authorPath: string) => {
    if (parent.abilities?.some(row => row.abilityKey === ability.abilityKey) || abilities.some(row => row.abilityKey === ability.abilityKey)) fail(root, '标记辅助能力与真实父来源键冲突');
    const index = abilities.length; abilities.push(ability);
    assembly.coverage.push({ authorPath, compiledPath: `sharedProviders[${definitionRef}].abilities[${index}]` });
    return index;
  };
  const applyType = `ability/skill/${skillKey}`; types.set(applyType, 'ability');
  const writerCondition: GenericFormulaExpr = { op: 'eq', args: [{ op: 'read', path: 'event.skill_hit.blocked' }, constExpr(0)] };
  const categoriesAllowed = contract.rootRule.conditionGroups.flatMap(group => group.conditions).every(condition =>
    condition.conditionType === 'TARGET_CATEGORY_CHECK' && condition.detail.categories.includes('CHAMPION'));
  const writerIndex = add({ abilityKey: 'target_mark_apply', kind: 'passive_listener', skillKey, types: categories,
    listenerSpec: { listenerKey: 'target_mark_apply', eventMatcher: { all: ['event/skill_hit', 'event/source_owner', applyType] },
      maxTriggersPerEvent: 1, condition: categoriesAllowed ? writerCondition : { op: 'min', args: [writerCondition, constExpr(0)] },
      operations: [{ operation: 'state_change', target: 'self', ref: contract.state.stateKey, valuePolicy: 'set', amount: constExpr(1), types: ['state_scope/provider_target'] }] } },
  ruleRef(skillKey, contract.applicationRule.ruleKey));
  const stateWritePath = `sharedProviders[${definitionRef}].abilities[${writerIndex}].listenerSpec.operations[0]`;
  assembly.coverage.push({ authorPath: `${root}.processes.${contract.applicationProcess.processKey}.stateOperations.${contract.applicationProcess.stateOperations[0]!.operationKey}`, compiledPath: stateWritePath },
    { authorPath: statePath, compiledPath: `sharedProviders[${definitionRef}].initialStateSchema.${contract.state.stateKey}` });
  const compilePayload = (result: SkillEffectDamageResult, effectKey: string) => {
    const path = `${root}.effects.${effectKey}.results.${result.resultKey}`;
    validateValue(result.valueRule.value, path);
    const payload = compileDamage(author, result, path, numeric, types, 'skill');
    payload.operation.ref = path;
    for (const key of payload.vamp.requiredAttributes) required.source.add(key);
    for (const formula of payload.vamp.formulas) numeric.namedFormulas.set(formula.key, formula);
    assembly.rules.vampRules = payload.vamp.rules;
    if (!assembly.rules.damageTypeFormulas!.some(row => row.damageType === payload.operation.damageType)) {
      const defense = compileSimulationDamageFormula(snapshot, result.detail.damageTypeKey);
      assembly.rules.damageTypeFormulas!.push(defense);
      for (const declaration of defense.formula.inputs) {
        const read = declaration.binding;
        if (read.kind === 'attribute' && (read.object === 'source' || read.object === 'target')) required[read.object].add(read.attributeKey);
      }
      assembly.coverage.push({ authorPath: `catalogs.damageTypes.${result.detail.damageTypeKey}.formula`, compiledPath: `rules.damageTypeFormulas[${assembly.rules.damageTypeFormulas!.length - 1}].formula` });
    }
    return payload.operation;
  };
  const addConsumer = (rule: typeof contract.attack.rule, hitAbilityRef: string, attack: boolean) => {
    const branch = attack ? contract.attack : contract.skill;
    const rulePath = ruleRef(skillKey, rule.ruleKey), action = rule.actions[0]!;
    const triggerKind = attack ? 'event/basic_attack_hit' : 'event/skill_hit';
    const triggerSkillKey = attack ? basicAttackBinding!.skillKey : (rule.eventSource.detail as { sourceSkillKey: string }).sourceSkillKey;
    const triggerType = `ability/skill/${triggerSkillKey}`;
    types.set(triggerKind, 'event');
    if (!attack) types.set(triggerType, 'ability');
    const operation: OperationDefinition = { operation: 'consume_target_mark', target: 'target', ref: `${rulePath}.actions.${action.actionKey}`,
      targetMark: { stateKey: contract.state.stateKey, stateScope: 'provider_target', triggerKind, triggerAbilityRef: hitAbilityRef,
        damageBlockScope: 'DAMAGE_INSTANCE', damage: compilePayload(branch.damage, branch.effect.effectKey) } };
    const restore = attack ? null : contract.skill.restore;
    if (restore) {
      validateValue(restore.valueRule.value, `${root}.effects.${branch.effect.effectKey}.results.${restore.resultKey}`, false);
      const amount = staticEffectAmount(restore.valueRule as SkillEffectValueRule, root, numeric);
      if (!Number.isFinite(amount) || amount < 0) fail(root, '标记恢复需要完整静态有限非负金额');
      operation.targetMark!.restore = { operation: 'resource_change', target: 'self', resourceKey: restore.detail.attributeKey,
        amount: constExpr(amount), ref: `${root}.effects.${branch.effect.effectKey}.results.${restore.resultKey}` };
      required.source.add(restore.detail.attributeKey);
    }
    compiledTargetMark(operation, rulePath);
    const abilityKey = `target_mark_consume_${abilities.length}`;
    const index = add({ abilityKey, kind: 'passive_listener', skillKey, types: categories, params: { ...numeric.params },
      listenerSpec: { listenerKey: abilityKey, eventMatcher: { all: [triggerKind, 'event/source_owner', ...(!attack ? [triggerType] : [])] }, maxTriggersPerEvent: 1,
        operations: [operation] } }, rulePath);
    const compiledPath = `sharedProviders[${definitionRef}].abilities[${index}].listenerSpec.operations[0]`;
    const abilityRef = refOf(providerRef, abilityKey);
    for (const [part, result] of [['damage', branch.damage], ...(restore ? [['restore', restore]] : [])] as Array<['damage' | 'restore', SkillEffectDamageResult | NonNullable<typeof restore>]>) {
      const authorPath = `${root}.effects.${branch.effect.effectKey}.results.${result.resultKey}`;
      const nestedPath = `${compiledPath}.targetMark.${part}`;
      assembly.operationOrigins.push({ abilityRef, operationRef: authorPath, skillKey, effectKey: branch.effect.effectKey,
        resultKey: result.resultKey, providerDefinitionRef: definitionRef, compiledPaths: [nestedPath] });
      assembly.coverage.push({ authorPath, compiledPath: nestedPath }, { authorPath: `${authorPath}.valueRule`, compiledPath: `${nestedPath}.amount` });
      coverValue(result.valueRule.value, `${nestedPath}.amount`);
    }
    assembly.coverage.push({ authorPath: `${root}.processes.${branch.process.processKey}`, compiledPath },
      { authorPath: `${root}.processes.${branch.process.processKey}.stateOperations.${branch.process.stateOperations[0]!.operationKey}`, compiledPath },
      { authorPath: `${root}.processes.${branch.process.processKey}.effectBindings.${branch.process.effectBindings[0]!.bindingKey}`, compiledPath },
      { authorPath: `${rulePath}.conditionGroups`, compiledPath });
  };
  if (!basicAttackBinding && snapshot.selection.basicAttackSkillKey !== null) fail(root, '已选择的背景普攻缺少真实装配命中绑定');
  if (basicAttackBinding) {
    if (basicAttackBinding.source !== 'source' || basicAttackBinding.target !== 'target' || basicAttackBinding.skillKey !== snapshot.selection.basicAttackSkillKey) fail(root, '普攻消费须绑定本场真实所选普攻');
    const match = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(basicAttackBinding.hitAbilityRef);
    if (!match) fail(root, '普攻命中引用不是实际来源能力');
    const mount = one(input.mounts.filter(row => row.side === 'source' && row.providerRef === match[1]), root);
    const actualParent = one(providers.filter(provider => provider.providerKey === mount.definitionRef), root);
    const matches = (actualParent.abilities ?? []).filter(ability => ability.abilityKey === match[2]).map(ability => ({ provider: actualParent, ability }));
    const hit = one(matches.filter(row => row.ability.skillKey === basicAttackBinding.skillKey), root);
    if (!['champion', 'character'].includes(hit.provider.kind) || hit.ability.kind !== 'active' || !hit.ability.types?.includes('ability/basic_attack') || hit.ability.operations?.length !== 1
      || hit.ability.operations[0]!.operation !== 'resolve_skill_hit' || hit.ability.operations[0]!.skillHit?.skillKey !== basicAttackBinding.skillKey) fail(root, '普攻消费缺少实际根接触操作');
    addConsumer(contract.attack.rule, basicAttackBinding.hitAbilityRef, true);
  }
  for (const rule of contract.skill.rules) {
    const triggerSkillKey = (rule.eventSource.detail as { sourceSkillKey: string }).sourceSkillKey;
    const actualSources = snapshot.source.skillSources.filter(row => row.skillKey === triggerSkillKey && row.origin.kind === 'CHARACTER'
      && row.origin.characterKey === snapshot.source.character.characterKey);
    const plans = snapshot.selection.plannedSkills.filter(row => row.skillKey === triggerSkillKey && row.origin.characterKey === snapshot.source.character.characterKey);
    const matches = skillActionBindings.filter(row => row.skillKey === triggerSkillKey);
    const actual = one(actualSources, root);
    if (!actual.enabled || actual.skillStatus !== 'ENABLED' || actual.skillLevel === 0 || !plans.length) {
      if (matches.length) fail(root, '关闭、未学、未拥有或未计划兄弟不得被标记图启用');
      assembly.coverage.push({ authorPath: ruleRef(skillKey, rule.ruleKey), compiledPath: 'runtimeOptions.skillOrigins', note: '本场兄弟未驱动，零匹配且不挂消费监听' });
      continue;
    }
    if (plans.length !== 1 || actual.skillLevel !== plans[0]!.skillLevel || actual.inactiveReason !== null) fail(root, '兄弟实际已学等级与计划不一致');
    const hit = skillHit(one(matches, root), input, root);
    addConsumer(rule, hit.hitAbilityRef, false);
  }
  assembly.providers.push({ providerKey: definitionRef, skillKey, stableId: parent.stableId, kind: 'character', abilities,
    initialStateSchema: { [contract.state.stateKey]: { valueType: 'integer', defaultValue: 0, maxValue: 1, durationMs: duration, refreshPolicy: 'refresh_on_write' } } });
  assembly.formulas = [...numeric.namedFormulas.values()];
  assembly.types = [...types].map(([key, domain]) => ({ key, domain }));
  for (const formula of assembly.formulas) assembly.coverage.push({ authorPath: `${root}.formulas.${formula.key.split('/').slice(-1)[0]}.expression`, compiledPath: `formulas[${formula.key}]` });
  return assembly;
}
