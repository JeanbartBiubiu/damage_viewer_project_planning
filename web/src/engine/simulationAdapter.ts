import { assembleGameAttributeDerivations, calculationConfiguration, changedAttributes, simulationCriticalBinding } from './simulationCalculationRules';
import { skillFormulaReachableInputs } from '../services/skillFormulaContract';
import { consumedApprovedFormulaValues, resetConsumedApprovedFormulaValues, collectedCommonFormulaDefinitions } from './approvedFormulaValues';
import { TypeCatalogEntries } from './typeCatalogEntries';
import { skillCategoryTypeKey } from './skillCategoryType';
import type { Attribute } from '../types/attribute';

import type {
  AbilityDefinition, AttributeSlot, BasicAttackPlan, CompileRequest, GenericFormulaExpr,
  GenericRules, OperationDefinition, ProcessDefinition, ProviderDefinition, RunRequest, SkillHitCandidate
} from '../types/genericEngine';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth, SimulationMechanicStateInput, SimulationSnapshot } from '../types/simulationSnapshot';
import {
  compileNumericValue, createNumericCompileState, finiteNumber,
  NumericAdaptationError, wrapValueRuleExpression
} from './numericAdapter';
import { adaptDamageVamp } from './vampAdapter';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationHash } from './simulationHash';
import { assembleEquipment, equipmentContribution, type EquipmentOrigin } from './simulationEquipment';
import { validateEquipmentAssumptions } from './simulationEquipmentRange';
import { assembleTriggeredEquipment, compileSimulationDamageFormula, validateConfiguration } from './simulationTriggeredEquipment';
import { assembleNaturalSkillSources, type SimulationSkillOriginTrace } from './simulationNaturalSkillSources';
import { compilePrimaryAmmo, compilePrimaryCondition, primaryConditionsExclusive, primaryMechanicRequirements, validateMechanicStateInputs } from './simulationPrimaryAttack';
import { validateSimulationAttributeDerivations } from './simulationAttributeConversion';
import { assembleActiveSkills, type SimulationCastCostRef } from './simulationActiveSkills';
import { normalizeSceneInitialParameterInputs, type SceneInitialParameterInput } from './sceneInitialParameterInput';

export const SIMULATION_ADAPTER_VERSION = 'v23-active-ammo-initial-state-and-recovery';
export const SIMULATION_SCHEMA_HASH = 'generic-basic-attack-input-v4';
const MOUNT = 'selected_basic_attack';
const DEFINITION = 'selected_basic_attack_definition';
const START_ABILITY = 'attack_start';
const HIT_ABILITY = 'attack_hit';
const KEY = /^[a-z][a-z0-9_]{0,63}$/;


export type SimulationCoverage = { authorPath: string; compiledPath: string; note?: string };
export type OperationOrigin = {
  abilityRef: string; operationRef: string; skillKey: string; effectKey: string; resultKey: string; compiledPaths: string[];
  providerDefinitionRef?: string;
};
export type BasicAttackBinding = Omit<BasicAttackPlan, 'planKey' | 'attackSpeedInputMax' | 'attackSpeedAttributeKey'> & { attackSpeedAttributeKey: string | null };
export type SimulationAttributeRequirement = {
  side: 'source' | 'target'; attribute: Attribute; storedValue: number | undefined
};

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  return value as Record<string, unknown>;
}
function exact(value: unknown, fields: string[], path: string) {
  const row = record(value, path);
  const unexpected = Object.keys(row).find(key => !fields.includes(key));
  if (unexpected) fail(`${path}.${unexpected}`, '本期未接入的字段不能被静默忽略');
}
function stableKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(path, '需要合法稳定标识');
  return value as string;
}
function ordered<T extends { sortOrder: number }>(values: T[], path: string): T[] {
  if (!Array.isArray(values)) fail(path, '需要完整数组');
  if (values.some(row => !Number.isInteger(row.sortOrder))) fail(path, '排序必须是整数');
  return values.map((value, index) => ({ value, index }))
    .sort((a, b) => a.value.sortOrder - b.value.sortOrder || a.index - b.index).map(row => row.value);
}
function ruleIsPlain(rule: SkillTriggerRuleDetail, path: string, hit = false) {
  exact(rule, ['ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse'], path);
  exact(rule.eventSource, ['eventType', 'detail'], `${path}.eventSource`);
  if (!Array.isArray(rule.conditionGroups) || !hit && rule.conditionGroups.length
    || rule.perTargetCooldown != null || rule.maxTriggersPerProcess != null || rule.oncePerUse != null) {
    fail(path, '首批普攻入口不接受未接入的条件或触发限制');
  }
  if (!['SKILL_USED', 'SKILL_HIT'].includes(rule.eventSource.eventType) && Object.keys(record(rule.eventSource.detail, `${path}.eventSource.detail`)).length) {
    fail(`${path}.eventSource.detail`, '原生普攻事件必须是空明细');
  }
}

type Program = {
  provider: ProviderDefinition | null; rules: GenericRules; formulas: CompileRequest['formulas'];
  types: CompileRequest['typeCatalog']['types']; coverage: SimulationCoverage[];
  operationOrigins: OperationOrigin[]; basicAttackBinding: BasicAttackBinding | null;
  required: Map<'source' | 'target', Set<string>>; configuration?: SkillConfiguration;
  active?: ReturnType<typeof assembleActiveSkills>;
  equipment: ReturnType<typeof assembleEquipment>;
  triggered: ReturnType<typeof assembleTriggeredEquipment>;
  natural: ReturnType<typeof assembleNaturalSkillSources>;
};

function recordCompiledEquipmentSources(natural: ReturnType<typeof assembleNaturalSkillSources>, triggered: ReturnType<typeof assembleTriggeredEquipment>) {
  for (const compiled of triggered.compiledSources) {
    const origins = natural.origins.filter(origin => origin.side === compiled.side && origin.skillKey === compiled.skillKey
      && origin.origin.kind === 'EQUIPMENT' && `${compiled.side}_${origin.origin.equipmentKey}_passive` === compiled.providerRef);
    if (origins.length !== 1) fail('skillOrigins', '实编装备程序必须对应唯一真实拥有方、装备及技能来源');
    origins[0]!.providerRef = compiled.providerRef;
    origins[0]!.definitionRef = compiled.definitionRef;
  }
}

/** 装配首批完整普攻形状，不依赖技能名称；不支持的启用入口整体拒绝。 */
function program(snapshot: SimulationSnapshot, ignoredCosts: readonly SimulationCastCostRef[] = [], sceneInputs: readonly SceneInitialParameterInput[] = []): Program {
  resetConsumedApprovedFormulaValues();
  if (snapshot.selection.basicAttackSkillKey === null) return activeProgram(snapshot, ignoredCosts, sceneInputs);
  const calculation = calculationConfiguration(snapshot);
  const basicAttackCategoryKey = calculation?.basicAttackCategoryKey;
  if (!basicAttackCategoryKey) fail('catalogs.calculationRules.configuration.basicAttackCategoryKey', '所选普通攻击需要明确配置分类用途绑定');
  if (!snapshot.selection.plannedSkills.length && ignoredCosts.length) fail('ignoredCastCosts', '没有计划技能不能声明施法成本');
  const natural = assembleNaturalSkillSources(snapshot, sceneInputs);
  const triggered = assembleTriggeredEquipment(snapshot, sceneInputs);
  recordCompiledEquipmentSources(natural, triggered);
  const triggeredPrograms = [triggered, natural.triggered];
  const equipment = assembleEquipment(snapshot);
  const changed = changedAttributes();
  for (const side of ['source', 'target'] as const) for (const assembly of [equipment, natural, triggered]) {
    for (const key of assembly.changedAttributes[side]) changed[side].add(key);
  }
  const game = assembleGameAttributeDerivations(snapshot, changed, natural.derivations);
  const speedAttributeKey = calculation?.attackSpeedAttributeKey ?? null;
  const selection = snapshot.selection;
  if (selection.basicAttackLevel === null) fail('selection.basicAttackLevel', '普攻技能与等级必须配对提供');
  const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === selection.basicAttackSkillKey);
  if (!config) fail('skillConfigurations', '缺少完整所选普攻配置');
  validateConfiguration(config, snapshot.gameId, `skills.${config.skill.skillKey}`, false, selection.basicAttackLevel, null);
  if (config.skill.status !== 'ENABLED' || !config.skill.skillCategoryKeys.includes(basicAttackCategoryKey)) {
    fail('skillConfigurations[0].skill', '所选技能必须为已启用的普通攻击');
  }
  if (selection.basicAttackLevel < 1 || selection.basicAttackLevel > config.skill.maxLevel) {
    fail('selection.basicAttackLevel', '所选技能等级无效');
  }
  if (config.processes.length !== 1) fail('skillConfigurations[0].processes', '首批要求唯一的攻击过程');
  const state = createNumericCompileState({
    gameId: snapshot.gameId, skillKey: config.skill.skillKey, skillLevel: selection.basicAttackLevel,
    characterLevel: selection.sourceLevel, parameters: config.parameters, formulas: config.formulas,
    formulaNamespace: `selected/${config.skill.skillKey}`, bindParameters: true, allowAttributeReads: true,
    runtimeInputMessage: '首批普攻没有未绑定的计算时参数'
  });
  const ammo = compilePrimaryAmmo(config, state);
  const coverage: SimulationCoverage[] = [];
  const operationOrigins: OperationOrigin[] = [];
  const usedEffects = new Set<string>();
  const types = new TypeCatalogEntries([
    ['ability/basic_attack', 'ability'], ['combatant/champion', 'combatant'],
    ['event/basic_attack_start', 'event'], ['event/basic_attack_hit', 'event'],
    ['event/source_owner', 'event'], ['event/attack_link_applied', 'event'], ['event/hit_link_applied', 'event']
  ]);
  const abilityTypes = config.skill.skillCategoryKeys.map(categoryKey => {
    stableKey(categoryKey, `skills.${config.skill.skillKey}.skillCategoryKeys`);
    if (!snapshot.catalogs.skillCategories.some(row => row.skillCategoryKey === categoryKey && row.status === 'ENABLED')) {
      fail(`catalogs.skillCategories.${categoryKey}`, '缺少已启用的真实技能分类');
    }
    const typeKey = skillCategoryTypeKey(categoryKey);
    types.set(typeKey, 'ability');
    return typeKey;
  });
  const skillIdentity = `ability/skill/${config.skill.skillKey}`;
  types.set(skillIdentity, 'ability');
  abilityTypes.push('ability/basic_attack', skillIdentity);
  const rules: GenericRules = { damageTypeFormulas: [] };
  const required = new Map<'source' | 'target', Set<string>>([
    ['source', new Set(['hp', ...(speedAttributeKey ? [speedAttributeKey] : []), ...equipment.required.source, ...game.required.source])], ['target', new Set(['hp', ...equipment.required.target, ...game.required.target])]
  ]);
  coverage.push(...equipment.coverage, ...game.coverage);
  coverage.push(...triggered.coverage);
  coverage.push(...natural.coverage);
  operationOrigins.push(...triggeredPrograms.flatMap(assembly => assembly.operationOrigins));
  for (const side of ['source', 'target'] as const) for (const key of triggered.required[side]) required.get(side)!.add(key);
  for (const side of ['source', 'target'] as const) for (const key of natural.required[side]) required.get(side)!.add(key);
  for (const type of triggeredPrograms.flatMap(assembly => assembly.types)) types.set(type.key, type.domain);
  if (natural.mounts.length) types.set('event/source_initialized', 'event');
  if (ammo.schema) types.set('state_scope/provider', 'state_scope');
  if (game.derivations.length || natural.derivations.length) rules.attributeDerivations = [...game.derivations, ...natural.derivations];
  validateSimulationAttributeDerivations(rules.attributeDerivations ?? []);
  const addCoverage = (authorPath: string, compiledPath: string) => coverage.push({ authorPath, compiledPath });
  const skillPath = `skills.${config.skill.skillKey}`;
  const value = (numeric: Parameters<typeof compileNumericValue>[0], path: string) => compileNumericValue(numeric, path, state, fail);

  function effect(key: string, path: string): SkillEffect {
    const matches = config!.effects.filter(row => row.effectKey === key);
    if (matches.length !== 1) fail(path, '效果引用缺失或重复');
    const result = matches[0]!;
    exact(result, ['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt', 'lifecycle', 'results'], `${skillPath}.effects.${key}`);
    if (result.gameId !== snapshot.gameId || result.skillKey !== config!.skill.skillKey) fail(path, '主体效果归属不一致');
    if (result.lifecycle != null) fail(`${skillPath}.effects.${key}.lifecycle`, '首批只接入即时普攻结果');
    usedEffects.add(key);
    return result;
  }
  function resultOperation(result: SkillEffectResult, path: string, compiledPath: string): OperationDefinition {
    exact(result, ['resultKey', 'name', 'description', 'sortOrder', 'resultType', 'target', 'valueRule', 'detail', 'lifecycleBehavior', 'spellShieldBlockScope'], path);
    if (result.target !== 'TARGET' || result.lifecycleBehavior != null || result.spellShieldBlockScope != null) {
      fail(path, '首批结果必须为对目标的即时、无阻挡粒度结果');
    }
    stableKey(result.resultKey, `${path}.resultKey`);
    if (!result.valueRule) fail(`${path}.valueRule`, '伤害与联动必须明确数值规则');
    const amount = wrapValueRuleExpression(value(result.valueRule.value, `${path}.valueRule.value`), result.valueRule);
    if (result.resultType === 'HIT_LINK_APPLICATION' || result.resultType === 'ATTACK_LINK_APPLICATION') {
      exact(result.detail, [], `${path}.detail`);
      const operation = result.resultType === 'HIT_LINK_APPLICATION' ? 'apply_hit_link' : 'apply_attack_link';
      return { operation, target: 'target', amount, ref: path };
    }
    if (result.resultType !== 'DAMAGE') fail(`${path}.resultType`, '该并列结果尚未接入，不能丢弃后继续');
    const detail = result.detail;
    exact(detail, ['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampQualification', 'vampOverrides'], `${path}.detail`);
    if (detail.deliveryKind !== 'BASIC_ATTACK' || detail.originKind !== 'DIRECT') fail(`${path}.detail`, '首批只接受普通攻击直接伤害');
    const damageKey = stableKey(detail.damageTypeKey, `${path}.detail.damageTypeKey`);
    const damageType = damageKey;
    types.set(damageType, 'damage');
    const vamp = adaptDamageVamp(snapshot.catalogs.vampRules.rules, {
      gameId: snapshot.gameId, skillKey: config!.skill.skillKey, skillCategoryKeys: config!.skill.skillCategoryKeys,
      skillLevel: selection.basicAttackLevel!, characterLevel: selection.sourceLevel,
      detail, parameters: config!.parameters, formulas: config!.formulas
    });
    for (const [key, amount] of Object.entries(vamp.params)) {
      if (key in state.params && state.params[key] !== amount) fail(path, '数值参数重复绑定冲突');
      state.params[key] = amount;
    }
    for (const formula of vamp.formulas) state.namedFormulas.set(formula.key, formula);
    for (const type of vamp.typeEntries) types.set(type.key, type.domain);
    for (const key of vamp.requiredAttributes) required.get('source')!.add(key);
    if (rules.vampRules && JSON.stringify(rules.vampRules) !== JSON.stringify(vamp.rules)) fail(path, '吸血规则不一致');
    rules.vampRules = vamp.rules;
    const operation: OperationDefinition = { operation: 'damage', target: 'target', damageType, amount, ref: path, ...vamp.operation };
    const critical = record(detail.critical, `${path}.detail.critical`);
    if (critical.mode === 'DISALLOWED') {
      if (critical.multiplierValue != null) fail(`${path}.detail.critical.multiplierValue`, '禁止暴击不得保留倍率');
      operation.critEligible = false;
    } else if (critical.mode === 'SOURCE_CRIT_CHANCE' || critical.mode === 'FORCED') {
      if (!detail.critical.multiplierValue) fail(`${path}.detail.critical.multiplierValue`, '暴击需要原配置倍率');
      operation.critEligible = true;
      operation.critMultiplier = value(detail.critical.multiplierValue, `${path}.detail.critical.multiplierValue`);
      Object.assign(operation, simulationCriticalBinding(snapshot, critical.mode === 'FORCED', `${path}.detail.critical.mode`));
      addCoverage(`${path}.detail.critical.mode`, `${compiledPath}.critChance`);
      addCoverage(`${path}.detail.critical.multiplierValue`, `${compiledPath}.critMultiplier`);
    } else fail(`${path}.detail.critical.mode`, '未知暴击模式');
    if (!rules.damageTypeFormulas!.some(row => row.damageType === damageType)) {
      const compiled = compileSimulationDamageFormula(snapshot, damageKey);
      const typeIndex = rules.damageTypeFormulas!.length;
      addCoverage(`damageTypes.${damageKey}.formula`, `rules.damageTypeFormulas[${typeIndex}].formula`);
      for (const input of compiled.formula.inputs) {
        const binding = input.binding;
        if (binding.kind === 'attribute' && (binding.object === 'source' || binding.object === 'target')) required.get(binding.object)!.add(binding.attributeKey);
      }
      rules.damageTypeFormulas!.push(compiled);
    }
    return operation;
  }
  function operationsFor(key: string, path: string, compiledPath: (index: number) => string, abilityRef: string): OperationDefinition[] {
    const authored = effect(key, path);
    if (!authored.results.length) fail(`${skillPath}.effects.${key}.results`, '即时普攻效果不能是空操作');
    return ordered(authored.results, `${skillPath}.effects.${key}.results`).map((result, index) => {
      const resultPath = `${skillPath}.effects.${key}.results.${result.resultKey}`;
      const operation = resultOperation(result, resultPath, compiledPath(index));
      addCoverage(resultPath, compiledPath(index));
      const origin = operationOrigins.find(row => row.abilityRef === abilityRef && row.operationRef === resultPath);
      if (origin) origin.compiledPaths.push(compiledPath(index));
      else operationOrigins.push({ abilityRef, operationRef: resultPath, skillKey: config!.skill.skillKey,
        effectKey: key, resultKey: result.resultKey, compiledPaths: [compiledPath(index)] });
      return operation;
    });
  }
  const process = config.processes[0]!;
  const controlKey = `process_${process.processKey}`;
  const processPath = `${skillPath}.processes.${process.processKey}`;
  exact(process, ['gameId', 'skillKey', 'processKey', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt', 'activationType', 'steps', 'cooldown', 'effectBindings', 'stateOperations'], processPath);
  if (process.gameId !== snapshot.gameId || process.skillKey !== config.skill.skillKey) fail(processPath, '主体过程归属不一致');
  stableKey(process.processKey, `${processPath}.processKey`);
  if (process.activationType !== 'ACTIVE' || !ammo.consumption && process.stateOperations.length || !process.steps.length
    || process.steps.some(step => step.stepType !== 'IMMEDIATE' || Object.keys(record(step.detail, processPath)).length)) {
    fail(processPath, '首批只接入有界即时攻击记录过程，不把记录步骤当成命中');
  }
  if (!process.cooldown || process.cooldown.startMoment.momentType !== 'PROCESS_START'
    || process.cooldown.startMoment.stepKey != null || process.cooldown.startMoment.failureReason != null) {
    fail(`${processPath}.cooldown`, '普攻冷却须明确从过程开始起算');
  }
  const genericProcess: ProcessDefinition = {
    processKey: process.processKey, skillKey: config.skill.skillKey,
    steps: ordered(process.steps, `${processPath}.steps`).map(step => ({ stepKey: stableKey(step.stepKey, processPath), stepType: 'IMMEDIATE', occupiesAction: step.occupiesAction ?? null })),
    costs: [], cooldown: {
      durationMs: value(process.cooldown.durationValue, `${processPath}.cooldown.durationValue`),
      roundPositiveMs: true,
      startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }
    }, momentOperations: []
  };
  addCoverage(`${processPath}.cooldown`, 'sharedProviders[0].processes[0].cooldown');
  for (const [index, step] of ordered(process.steps, `${processPath}.steps`).entries()) {
    exact(step, ['stepKey', 'name', 'description', 'sortOrder', 'stepType', 'detail', 'occupiesAction'], `${processPath}.steps.${step.stepKey}`);
    if (step.occupiesAction != null && typeof step.occupiesAction !== 'boolean') fail(`${processPath}.steps.${step.stepKey}.occupiesAction`, '行动占用必须是布尔或空值');
    addCoverage(`${processPath}.steps.${step.stepKey}`, `sharedProviders[0].processes[0].steps[${index}]`);
  }
  for (const binding of ordered(process.effectBindings, `${processPath}.effectBindings`)) {
    exact(binding, ['bindingKey', 'effectKey', 'moment', 'sortOrder'], `${processPath}.effectBindings.${binding.bindingKey}`);
    if (ammo.consumption && genericProcess.momentOperations.length === ordered(process.effectBindings, `${processPath}.effectBindings`)
      .filter(row => row.sortOrder < process.stateOperations[0]!.sortOrder).length) {
      const index = genericProcess.momentOperations.length;
      genericProcess.momentOperations.push({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, operations: [ammo.consumption] });
      addCoverage(`${processPath}.stateOperations.${process.stateOperations[0]!.operationKey}`, `sharedProviders[0].processes[0].momentOperations[${index}].operations[0]`);
    }
    if (binding.moment.momentType !== 'PROCESS_START' || binding.moment.stepKey != null || binding.moment.failureReason != null) {
      fail(`${processPath}.effectBindings.${binding.bindingKey}`, '首批只接入过程开始的即时效果挂接');
    }
    const momentIndex = genericProcess.momentOperations.length;
    genericProcess.momentOperations.push({
      moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
      operations: operationsFor(binding.effectKey, `${processPath}.effectBindings.${binding.bindingKey}`,
        index => `sharedProviders[0].processes[0].momentOperations[${momentIndex}].operations[${index}]`,
        `source.provider[${MOUNT}].ability[${controlKey}]`)
    });
    addCoverage(`${processPath}.effectBindings.${binding.bindingKey}`, `sharedProviders[0].processes[0].momentOperations[${momentIndex}]`);
  }
  if (ammo.consumption && !genericProcess.momentOperations.some(row => row.operations.includes(ammo.consumption!))) {
    const index = genericProcess.momentOperations.length;
    genericProcess.momentOperations.push({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, operations: [ammo.consumption] });
    addCoverage(`${processPath}.stateOperations.${process.stateOperations[0]!.operationKey}`, `sharedProviders[0].processes[0].momentOperations[${index}].operations[0]`);
  }
  if (ammo.schema) {
    const authorPath = `${skillPath}.internalStates.${ammo.stateKey}`;
    const compiledPath = `sharedProviders[0].initialStateSchema.${ammo.stateKey}`;
    addCoverage(authorPath, compiledPath);
    for (const [field, output] of [['initialValue', 'defaultValue'], ['maxValue', 'maxValue'], ['recoveryIntervalValue', 'ammoRecovery.intervalMs'],
      ['recoveryMode', 'ammoRecovery.mode'], ['recoveryStartCondition', 'ammoRecovery.startCondition']]) {
      addCoverage(`${authorPath}.detail.${field}`, `${compiledPath}.${output}`);
    }
  }

  const listeners: NonNullable<ProviderDefinition['listeners']> = [];
  const candidates: SkillHitCandidate[] = [];
  const hitConditions: Array<GenericFormulaExpr | undefined> = [];
  let starts = 0;
  let hits = 0;
  for (const rule of ordered(config.triggerRules, `${skillPath}.triggerRules`)) {
    const rulePath = `${skillPath}.triggerRules.${rule.ruleKey}`;
    const hitRule = ['BASIC_ATTACK_HIT', 'SKILL_HIT'].includes(rule.eventSource.eventType);
    ruleIsPlain(rule, rulePath, hitRule);
    for (const action of rule.actions) exact(action, ['actionKey', 'name', 'sortOrder', 'actionType', 'targetContext', 'detail', 'runtimeInputBindings', 'resultModifiers'], `${rulePath}.actions.${action.actionKey}`);
    if (rule.eventSource.eventType === 'SKILL_USED' || rule.eventSource.eventType === 'SKILL_HIT') {
      const event = rule.eventSource;
      exact(event.detail, event.eventType === 'SKILL_USED' ? ['sourceSkillKey', 'useKind', 'castPhase'] : ['sourceSkillKey'], `${rulePath}.eventSource.detail`);
      if (event.detail.sourceSkillKey !== null && event.detail.sourceSkillKey !== config.skill.skillKey || event.eventType === 'SKILL_USED'
        && (event.detail.castPhase !== 'INITIAL' || !['ANY', 'ACTIVE'].includes(event.detail.useKind))) fail(rulePath, '主体只执行自身真实开始与命中入口');
    }
    if (!rule.actions.length) fail(`${rulePath}.actions`, '启用入口不能是空规则');
    if (rule.eventSource.eventType === 'BASIC_ATTACK_START' || rule.eventSource.eventType === 'SKILL_USED') {
      starts++;
      if (rule.actions.length !== 1) fail(`${rulePath}.actions`, '首批攻击开始入口要求唯一启动过程动作');
      const action = rule.actions[0]!;
      if (action.actionType !== 'START_PROCESS' || action.detail.processKey !== process.processKey
        || action.targetContext !== 'CURRENT_TARGET' || action.runtimeInputBindings.length || action.resultModifiers.length) {
        fail(rulePath, '攻击开始规则必须原样启动已选过程');
      }
      listeners.push({ listenerKey: rule.ruleKey, eventMatcher: { all: ['event/basic_attack_start', 'event/source_owner'] },
        abilityRef: `self.provider[${MOUNT}].ability[${controlKey}]` });
      addCoverage(rulePath, 'sharedProviders[0].listeners[0]');
      continue;
    }
    if (!hitRule) fail(`${rulePath}.eventSource`, '首批不接入此执行入口');
    hits++;
    const participationCondition = compilePrimaryCondition(snapshot, config, rule, state, statusKey => types.set(`status/${statusKey}`, 'status'));
    hitConditions.push(participationCondition);
    for (const action of ordered(rule.actions, `${rulePath}.actions`)) {
      if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
        || action.runtimeInputBindings.length || action.resultModifiers.length) fail(rulePath, '命中入口需要完整即时执行效果动作');
      const authored = effect(action.detail.effectKey, `${rulePath}.${action.actionKey}`);
      const firstCandidate = candidates.length;
      const operations = operationsFor(authored.effectKey, `${rulePath}.${action.actionKey}`,
        index => `sharedProviders[0].abilities[2].operations[0].skillHit.candidates[${firstCandidate + index}].operations[0]`,
        `source.provider[${MOUNT}].ability[${HIT_ABILITY}]`);
      const results = ordered(authored.results, `${rulePath}.results`);
      for (const [index, result] of results.entries()) {
        candidates.push({
          candidateKey: `${rule.ruleKey}:${action.actionKey}:${result.resultKey}`,
          effectOccurrenceKey: `${rule.ruleKey}:${action.actionKey}`, effectKey: authored.effectKey, resultKey: result.resultKey,
          semantic: { resultType: result.resultType as SkillHitCandidate['semantic']['resultType'], target: 'TARGET', moment: 'INSTANT' },
          spellShieldBlockScope: null, operations: [operations[index]!], ...(participationCondition ? { participationCondition } : {})
        });
      }
      addCoverage(`${rulePath}.actions.${action.actionKey}`, 'sharedProviders[0].abilities[2].operations[0].skillHit.candidates');
      if (participationCondition) addCoverage(`${rulePath}.conditionGroups`, `sharedProviders[0].abilities[2].operations[0].skillHit.candidates[${firstCandidate}].participationCondition`);
    }
    addCoverage(rulePath, 'sharedProviders[0].abilities[2].operations[0].skillHit');
  }
  if (starts !== 1 || hits < 1 || !candidates.length || hits > 1 && candidates.some(candidate => !candidate.participationCondition)) {
    fail(`${skillPath}.triggerRules`, '需要唯一攻击开始与完整命中入口；多个主体命中分支必须保留互斥条件');
  }
  for (const [index, condition] of hitConditions.entries()) for (const other of hitConditions.slice(index + 1)) {
    if (!condition || !other || !primaryConditionsExclusive(condition, other, state)) fail(`${skillPath}.triggerRules`, '多个主体命中规则未能证明条件互斥，不能重复执行本体或联动');
  }
  if (config.effects.some(row => !usedEffects.has(row.effectKey))) fail(`${skillPath}.effects`, '存在未接入的效果，不能宣称完整配置通过');
  const abilities: AbilityDefinition[] = [
    { abilityKey: START_ABILITY, kind: 'active', skillKey: config.skill.skillKey, types: [...abilityTypes], operations: [] },
    { abilityKey: controlKey, kind: 'active', skillKey: config.skill.skillKey, types: [...abilityTypes],
      processControl: { processKey: process.processKey, action: 'INITIAL', useRefFromEvent: true } },
    { abilityKey: HIT_ABILITY, kind: 'active', skillKey: config.skill.skillKey, types: [...abilityTypes],
      operations: [{ operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: config.skill.skillKey, candidates } }] }
  ];
  for (const ability of abilities) ability.params = { ...state.params };
  for (const [index, formula] of [...state.namedFormulas.values()].entries()) {
    const key = formula.key.split('/').pop()!;
    addCoverage(`${skillPath}.formulas.${key}.expression`, `formulas[${index}].expression`);
  }
  for (const key of Object.keys(state.params)) {
    addCoverage(`${skillPath}.parameters.${key}`, `sharedProviders[0].abilities[2].params.${key}`);
  }
  const provider: ProviderDefinition = { providerKey: DEFINITION, skillKey: config.skill.skillKey, stableId: DEFINITION, kind: 'champion', abilities, listeners, processes: [genericProcess],
    ...(ammo.schema ? { initialStateSchema: ammo.schema } : {}) };
  // 从已翻译的表达式按实际source/target收集，不把某一侧所需属性强塞给双方。
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (Array.isArray(row.inputs) && Array.isArray(row.stages) && typeof row.outputStageKey === 'string') {
      for (const input of skillFormulaReachableInputs(row as unknown as import('../types/formulaContract.generated').FormulaDefinition)) {
        if (input.binding.kind === 'attribute') required.get(input.binding.object as 'source' | 'target')?.add(input.binding.attributeKey);
      }
      return;
    }
    if (row.op === 'read' && typeof row.path === 'string') {
      const match = /^(source|target)\.attr\.([a-z][a-z0-9_]*)\./.exec(row.path);
      if (match) required.get(match[1] as 'source' | 'target')!.add(match[2]!);
    }
    Object.values(row).forEach(collect);
  };
  collect(provider); collect([...state.namedFormulas.values()]); collect(rules);
  for (const formula of triggeredPrograms.flatMap(assembly => assembly.rules.damageTypeFormulas ?? [])) {
    const existing = rules.damageTypeFormulas!.find(row => row.damageType === formula.damageType);
    if (existing && JSON.stringify(existing.formula) !== JSON.stringify(formula.formula)) fail('rules.damageTypeFormulas', '同一伤害类型必须使用相同的完整防御公式');
    if (!existing) rules.damageTypeFormulas!.push(formula);
  }
  for (const assembly of triggeredPrograms) if (assembly.rules.vampRules
    && JSON.stringify(assembly.rules.vampRules) !== JSON.stringify(rules.vampRules)) {
    fail('rules.vampRules', '自然来源、装备附伤与普攻必须共享本次真实游戏吸血规则');
  }
  const providerIndices = new Map([...triggered.providers, ...natural.providers].map((definition, index) => [definition.providerKey, 1 + equipment.providers.length + index]));
  const rebase = (path: string) => path.replace(/sharedProviders(?:\[([^\]]+)\]|\.([^.]+))/, (whole, bracket: string, dotted: string) => {
    const key = bracket ?? dotted;
    return providerIndices.has(key) ? `sharedProviders[${providerIndices.get(key)}]` : whole;
  });
  const mergedOrigins = operationOrigins.map(origin => ({ ...origin, compiledPaths: origin.compiledPaths.map(rebase) }));
  const defenseIndices = triggeredPrograms.map(assembly => ({ coverage: assembly.coverage,
    indices: new Map((assembly.rules.damageTypeFormulas ?? []).map((formula, index) => [index,
      rules.damageTypeFormulas!.findIndex(merged => merged.damageType === formula.damageType)])) }));
  const coverageByReference = new Map<string, { row: SimulationCoverage; notes: Set<string> }>();
  for (const row of coverage) {
    const indices = defenseIndices.find(assembly => assembly.coverage.includes(row))?.indices;
    const path = indices ? row.compiledPath.replace(/rules\.damageTypeFormulas\[(\d+)\]/,
      (original, index: string) => indices.has(Number(index)) ? `rules.damageTypeFormulas[${indices.get(Number(index))}]` : original) : row.compiledPath;
    const compiledPath = rebase(path).replace(/rules\.attributeDerivations\[game_(\d+)\]/, (_whole, index: string) => `rules.attributeDerivations[${index}]`).replace(/rules\.attributeDerivations\[conversion_(\d+)\]/,
      (_original, index: string) => `rules.attributeDerivations[${game.derivations.length + Number(index)}]`);
    const key = JSON.stringify([row.authorPath, compiledPath]);
    let entry = coverageByReference.get(key);
    if (!entry) {
      entry = { row: { ...row, compiledPath }, notes: new Set<string>() };
      coverageByReference.set(key, entry);
    }
    if (row.note) entry.notes.add(row.note);
  }
  const mergedCoverage = [...coverageByReference.values()].map(({ row, notes }) =>
    notes.size ? { ...row, note: [...notes].join('；') } : row);
  const assembled: Program = { provider, rules, formulas: [...game.formulas, ...state.namedFormulas.values(), ...triggeredPrograms.flatMap(assembly => assembly.formulas)], types: [...types].map(([key, domain]) => ({ key, domain })),
    coverage: mergedCoverage, required, configuration: config, operationOrigins: mergedOrigins, equipment, triggered, natural,
    basicAttackBinding: { source: 'source', target: 'target', skillKey: config.skill.skillKey,
      startAbilityRef: `source.provider[${MOUNT}].ability[${START_ABILITY}]`,
      hitAbilityRef: `source.provider[${MOUNT}].ability[${HIT_ABILITY}]`,
      initialControlAbilityRef: `source.provider[${MOUNT}].ability[${controlKey}]`, attackSpeedAttributeKey: speedAttributeKey }
  };
  return snapshot.selection.plannedSkills.length ? mergeActiveProgram(assembled, snapshot, ignoredCosts, sceneInputs) : mergeBasicAttackContributions(assembled);
}

function activeProgram(snapshot: SimulationSnapshot, ignoredCosts: readonly SimulationCastCostRef[], sceneInputs: readonly SceneInitialParameterInput[] = []): Program {
  const natural = assembleNaturalSkillSources(snapshot, sceneInputs);
  const triggered = assembleTriggeredEquipment(snapshot, sceneInputs);
  recordCompiledEquipmentSources(natural, triggered);
  const equipment = assembleEquipment(snapshot);
  const changed = changedAttributes();
  for (const side of ['source', 'target'] as const) for (const assembly of [equipment, natural, triggered]) {
    for (const key of assembly.changedAttributes[side]) changed[side].add(key);
  }
  const game = assembleGameAttributeDerivations(snapshot, changed, natural.derivations);
  const assemblies = [triggered, natural.triggered];
  const rules: GenericRules = { damageTypeFormulas: [],
    attributeDerivations: [...game.derivations, ...natural.derivations] };
  validateSimulationAttributeDerivations(rules.attributeDerivations!);
  for (const assembly of assemblies) {
    for (const formula of assembly.rules.damageTypeFormulas ?? []) {
      const previous = rules.damageTypeFormulas!.find(row => row.damageType === formula.damageType);
      if (previous && JSON.stringify(previous) !== JSON.stringify(formula)) fail('rules.damageTypeFormulas', '同一伤害类型的防御规则冲突');
      if (!previous) rules.damageTypeFormulas!.push(formula);
    }
    if (assembly.rules.vampRules) {
      if (rules.vampRules && JSON.stringify(rules.vampRules) !== JSON.stringify(assembly.rules.vampRules)) fail('rules.vampRules', '主动与自然来源必须共享真实吸血规则');
      rules.vampRules = assembly.rules.vampRules;
    }
  }
  const types = new TypeCatalogEntries([...assemblies.flatMap(assembly => assembly.types)].map(type => [type.key, type.domain]));
  if (natural.mounts.length) types.set('event/source_initialized', 'event');
  const required = new Map<'source' | 'target', Set<string>>((['source', 'target'] as const).map(side =>
    [side, new Set(['hp', ...equipment.required[side], ...game.required[side], ...triggered.required[side], ...natural.required[side]])]));
  for (const rule of rules.vampRules ?? []) required.get('source')!.add(rule.sourceAttributeKey);
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    const read = typeof row.path === 'string' ? /^(source|target)\.attr\.([a-z][a-z0-9_]*)\./.exec(row.path) : null;
    if (row.op === 'read' && read) required.get(read[1] as 'source' | 'target')!.add(read[2]!);
    if (row.kind === 'attribute' && (row.object === 'source' || row.object === 'target') && typeof row.attributeKey === 'string') required.get(row.object)!.add(row.attributeKey);
    Object.values(row).forEach(collect);
  };
  collect(natural.providers); collect(rules);
  const providers = [...equipment.providers, ...triggered.providers, ...natural.providers];
  const providerIndices = new Map(providers.map((provider, index) => [provider.providerKey, index]));
  const rebase = (path: string) => {
    return path.replace(/sharedProviders(?:\[([^\]]+)\]|\.([^.]+))/, (original, bracket: string, dotted: string) => {
      const key = bracket ?? dotted;
      return providerIndices.has(key) ? `sharedProviders[${providerIndices.get(key)}]` : original;
    });
  };
  const coverage = [...equipment.coverage.map(row => ({ ...row, compiledPath: row.compiledPath
    .replace(/sharedProviders\[(\d+)\]/, (_original, index: string) => `sharedProviders[${Number(index) - 1}]`)
    .replace(/combatants\[0\]\.providers\[(\d+)\]/, (_original, index: string) => `combatants[0].providers[${Number(index) - 1}]`) })),
    ...game.coverage, ...triggered.coverage, ...natural.coverage];
  const mergedCoverage = coverage.map(row => ({ ...row, compiledPath: rebase(row.compiledPath).replace(/rules\.attributeDerivations\[game_(\d+)\]/, (_whole, index: string) => `rules.attributeDerivations[${index}]`).replace(/rules\.attributeDerivations\[conversion_(\d+)\]/, (_whole, index: string) => `rules.attributeDerivations[${game.derivations.length + Number(index)}]`) }));
  const origins = assemblies.flatMap(assembly => assembly.operationOrigins.map(origin => ({ ...origin,
    compiledPaths: origin.compiledPaths.map(rebase) })));
  return mergeActiveProgram({ provider: null, rules, formulas: [...game.formulas, ...assemblies.flatMap(assembly => assembly.formulas)],
    types: [...types].map(([key, domain]) => ({ key, domain })), required, equipment, triggered, natural,
    coverage: mergedCoverage,
    operationOrigins: origins, basicAttackBinding: null }, snapshot, ignoredCosts, sceneInputs);
}

function mergeBasicAttackContributions(base: Program): Program {
  const attackContributions = base.natural.triggered.basicAttackContributions ?? [];
  for (const contribution of attackContributions) {
    if (!base.provider || !base.basicAttackBinding) fail(`skills.${contribution.authorSkillKey}`, '自然普攻组成需要本场真实选定的普通攻击');
    const hitAbilityRef = base.basicAttackBinding.hitAbilityRef;
    const abilityIndex = base.provider.abilities!.findIndex(row => hitAbilityRef.endsWith(`.ability[${row.abilityKey}]`));
    const ability = base.provider.abilities![abilityIndex];
    const operationIndex = ability?.operations?.findIndex(row => row.operation === 'resolve_skill_hit') ?? -1;
    const resolver = ability?.operations?.[operationIndex];
    if (!resolver?.skillHit || resolver.skillHit.skillKey !== base.provider.skillKey
      || ability?.skillKey !== base.provider.skillKey) fail(`skills.${contribution.authorSkillKey}`, '普攻组成缺少唯一真实父命中计划');
    const candidate = structuredClone(contribution.candidate);
    if (resolver.skillHit.candidates.some(row => row.candidateKey === candidate.candidateKey)) fail('skillHit.candidates', '普攻组成候选身份重复');
    const index = resolver.skillHit.candidates.length;
    resolver.skillHit.candidates.push(candidate);
    const compiledPath = `sharedProviders[0].abilities[${abilityIndex}].operations[${operationIndex}].skillHit.candidates[${index}].operations[0]`;
    const authorPath = `skills.${contribution.authorSkillKey}.effects.${candidate.effectKey}.results.${candidate.resultKey}`;
    const existingOrigin = base.operationOrigins.find(row => row.abilityRef === hitAbilityRef && row.operationRef === authorPath);
    if (existingOrigin) existingOrigin.compiledPaths.push(compiledPath);
    else base.operationOrigins.push({ abilityRef: hitAbilityRef, operationRef: authorPath, skillKey: contribution.authorSkillKey,
      effectKey: candidate.effectKey, resultKey: candidate.resultKey, providerDefinitionRef: base.provider.providerKey, compiledPaths: [compiledPath] });
    base.coverage.push({ authorPath, compiledPath, note: '自然来源的直接普攻组成，保留父使用／命中身份与原作者路径' });
    for (const lowering of contribution.lowerings) for (const mapping of lowering.value.mappings) {
      base.coverage.push({ authorPath: mapping.authorPath,
        compiledPath: `${compiledPath}.${lowering.field}${mapping.privatePath.slice('expression'.length)}`,
        note: '原作者定义参与预检；此处仅为已核静态参数和当前总属性的私有结构展开' });
    }
  }
  return base;
}

function mergeActiveProgram(base: Program, snapshot: SimulationSnapshot, ignoredCosts: readonly SimulationCastCostRef[], sceneInputs: readonly SceneInitialParameterInput[] = []): Program {
  mergeBasicAttackContributions(base);
  const active = assembleActiveSkills(snapshot, ignoredCosts, base.basicAttackBinding && base.provider ? {
    binding: base.basicAttackBinding, provider: base.provider,
    mount: { providerRef: MOUNT, definitionRef: base.provider.providerKey }
  } : undefined, sceneInputs);
  for (const contribution of base.natural.triggered.passiveHitContributions ?? []) {
    const binding = active.bindings.find(row => row.skillKey === contribution.sourceSkillKey);
    const provider = active.providers.find(row => row.providerKey === binding?.providerDefinitionRef);
    const hitBinding = binding?.hitBindings[0];
    const ability = provider?.abilities?.find(row => row.abilityKey === hitBinding?.hitAbilityRef.match(/\.ability\[([^\]]+)\]$/)?.[1]);
    const operation = ability?.operations?.find(row => row.operation === 'resolve_skill_hit');
    if (!binding || !provider || !hitBinding || !ability || !operation?.skillHit || binding.hitBindings.length !== 1) fail(`skills.${contribution.authorSkillKey}`, '被动控制必须进入已存在的唯一原技能命中计划，不能另发命中');
    if (provider.processes?.some(process => process.processKey === hitBinding.processKey
      && process.steps.some(step => step.stepType === 'EMPOWERED_BASIC_ATTACK'))) {
      fail(`skills.${contribution.authorSkillKey}`, '强化待击不发布独立技能命中，当前不能合并依赖该事件的被动控制贡献');
    }
    const candidate = structuredClone(contribution.candidate);
    if (operation.skillHit.candidates.some(row => row.candidateKey === candidate.candidateKey)) fail('skillHit.candidates', '被动控制候选身份重复');
    const candidateIndex = operation.skillHit.candidates.length;
    operation.skillHit.candidates.push(candidate);
    const compiledPath = `sharedProviders[${provider.providerKey}].abilities[${provider.abilities!.indexOf(ability)}].operations[${ability.operations!.indexOf(operation)}].skillHit.candidates[${candidateIndex}]`;
    const authorPath = `skills.${contribution.authorSkillKey}.effects.${candidate.effectKey}.results.${candidate.resultKey}`;
    active.coverage.push({ authorPath, compiledPath });
    active.operationOrigins.push({ abilityRef: hitBinding.hitAbilityRef, operationRef: authorPath, skillKey: contribution.authorSkillKey,
      effectKey: candidate.effectKey, resultKey: candidate.resultKey, providerDefinitionRef: provider.providerKey,
      compiledPaths: candidate.operations.map((_row, index) => `${compiledPath}.operations[${index}]`) });
  }
  const existingDerivations = base.rules.attributeDerivations ?? [];
  const extraGame = assembleGameAttributeDerivations(snapshot, active.changedAttributes, existingDerivations);
  if (extraGame.derivations.length) {
    base.rules.attributeDerivations = [...existingDerivations, ...extraGame.derivations];
    validateSimulationAttributeDerivations(base.rules.attributeDerivations);
  }
  for (const side of ['source', 'target'] as const) for (const key of extraGame.required[side]) base.required.get(side)!.add(key);
  base.coverage.push(...extraGame.coverage.map(row => ({ ...row, compiledPath: row.compiledPath.replace(/rules\.attributeDerivations\[game_(\d+)\]/,
    (_whole, index: string) => `rules.attributeDerivations[${existingDerivations.length + Number(index)}]`) })));
  const offsets = new Map<string, { abilities: number; processes: number }>();
  for (const binding of active.bindings) {
    const provider = active.providers.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const existing = base.natural.providers.find(row => row.providerKey === binding.providerDefinitionRef);
    offsets.set(binding.providerDefinitionRef, { abilities: existing?.abilities?.length ?? 0, processes: existing?.processes?.length ?? 0 });
    if (existing) {
      if (provider.abilities?.some(ability => existing.abilities?.some(previous => previous.abilityKey === ability.abilityKey))
        || provider.processes?.some(process => existing.processes?.some(previous => previous.processKey === process.processKey))) {
        fail('sharedProviders', '主动与自然来源不能重复装配同一能力或过程');
      }
      existing.abilities = [...(existing.abilities ?? []), ...(provider.abilities ?? [])];
      existing.processes = [...(existing.processes ?? []), ...(provider.processes ?? [])];
      for (const [key, field] of Object.entries(provider.initialStateSchema ?? {})) {
        const previous = existing.initialStateSchema?.[key];
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(field)) fail(`sharedProviders.${provider.providerKey}.initialStateSchema.${key}`, '主动与自然来源状态定义冲突');
        (existing.initialStateSchema ??= {})[key] = field;
      }
      active.providers = active.providers.filter(row => row !== provider);
    } else base.natural.mounts.push({ side: 'source', providerRef: binding.providerRef, definitionRef: binding.providerDefinitionRef });
  }
  active.providers = active.providers.filter(provider => {
    const existing = [...base.equipment.providers, ...base.triggered.providers, ...base.natural.providers]
      .find(row => row.providerKey === provider.providerKey);
    if (!existing) return true;
    if (JSON.stringify(existing) !== JSON.stringify(provider)) fail(`sharedProviders.${provider.providerKey}`, '主动与自然来源的关联效果定义冲突');
    return false;
  });
  base.rules.skillActionBindings = active.bindings;
  for (const formula of active.rules.damageTypeFormulas) {
    const previous = base.rules.damageTypeFormulas!.find(row => row.damageType === formula.damageType);
    if (previous && JSON.stringify(previous) !== JSON.stringify(formula)) fail('rules.damageTypeFormulas', '主动与普攻必须共享完整防御规则');
    if (!previous) base.rules.damageTypeFormulas!.push(formula);
  }
  if (active.rules.vampRules) {
    if (base.rules.vampRules && JSON.stringify(base.rules.vampRules) !== JSON.stringify(active.rules.vampRules)) fail('rules.vampRules', '主动与普攻必须共享真实吸血规则');
    base.rules.vampRules = active.rules.vampRules;
  }
  for (const rule of base.rules.vampRules ?? []) base.required.get('source')!.add(rule.sourceAttributeKey);
  const providers = [...(base.provider ? [base.provider] : []), ...base.equipment.providers,
    ...base.triggered.providers, ...base.natural.providers, ...active.providers];
  const indices = new Map(providers.map((provider, index) => [provider.providerKey, index]));
  const rebase = (path: string) => path.replace(/sharedProviders\[([^\]]+)\](.*)/, (original, definition: string, suffix: string) => {
    if (!indices.has(definition)) return original;
    const offset = offsets.get(definition);
    return `sharedProviders[${indices.get(definition)}]${suffix.replace(/\.abilities\[(\d+)\]/g,
      (_match, index: string) => `.abilities[${Number(index) + (offset?.abilities ?? 0)}]`).replace(/\.processes\[(\d+)\]/g,
      (_match, index: string) => `.processes[${Number(index) + (offset?.processes ?? 0)}]`)}`;
  });
  const types = new TypeCatalogEntries([...base.types, ...active.types].map(type => [type.key, type.domain]));
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.operation === 'apply_provider' && row.target === 'target' && typeof row.providerDefinitionRef === 'string') {
      const index = indices.get(row.providerDefinitionRef);
      for (const modifier of index === undefined ? [] : providers[index]!.modifiers ?? []) if (modifier.kind === 'attribute') {
        const attribute = /^self\.attr\.([a-z][a-z0-9_]*)$/.exec(modifier.target ?? '');
        if (attribute) base.required.get('target')!.add(attribute[1]!);
      }
    }
    const read = typeof row.path === 'string' ? /^(source|target)\.attr\.([a-z][a-z0-9_]*)\./.exec(row.path) : null;
    if (row.op === 'read' && read) base.required.get(read[1] as 'source' | 'target')!.add(read[2]!);
    if (row.kind === 'attribute' && (row.object === 'source' || row.object === 'target') && typeof row.attributeKey === 'string') base.required.get(row.object)!.add(row.attributeKey);
    Object.values(row).forEach(collect);
  };
  collect(providers); collect(active.formulas); collect(base.rules);
  return { ...base, active, types: [...types].map(([key, domain]) => ({ key, domain })), formulas: [...(base.formulas ?? []), ...extraGame.formulas, ...active.formulas],
    coverage: [...base.coverage, ...active.coverage.map(row => ({ ...row, compiledPath: rebase(row.compiledPath) }))],
    operationOrigins: [...base.operationOrigins, ...active.operationOrigins.map(origin => ({ ...origin, compiledPaths: origin.compiledPaths.map(rebase) }))] };
}

export function inspectSimulationSnapshot(snapshot: SimulationSnapshot, ignoredCosts: readonly SimulationCastCostRef[] = [],
  sceneInputs: readonly SceneInitialParameterInput[] = []): {
  requirements: SimulationAttributeRequirement[]; coverage: SimulationCoverage[]; equipmentOrigins: EquipmentOrigin[];
  mechanicRequirements: ReturnType<typeof primaryMechanicRequirements>
} {
  const normalized = normalizeSceneInitialParameterInputs(snapshot, sceneInputs);
  const compiled = program(snapshot, ignoredCosts, normalized);
  const requirements: SimulationAttributeRequirement[] = [];
  for (const side of ['source', 'target'] as const) {
    for (const key of [...compiled.required.get(side)!].sort()) {
      const attribute = snapshot.catalogs.attributes.find(row => row.attributeKey === key);
      if (!attribute || attribute.status !== 'ENABLED') fail(`catalogs.attributes.${key}`, '缺少已启用的属性定义');
      requirements.push({ side, attribute, storedValue: snapshot[side].selectedLevelValues[key] });
    }
  }
  return { requirements, coverage: compiled.coverage, equipmentOrigins: compiled.equipment.origins,
    mechanicRequirements: compiled.provider ? primaryMechanicRequirements(snapshot, compiled.provider.initialStateSchema) : [] };
}

export function assembleSimulation(
  snapshot: SimulationSnapshot, attributeInputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth,
  assumptions: readonly SimulationEquipmentAssumption[] = [], mechanicInputs: readonly SimulationMechanicStateInput[] = [],
  ignoredCosts: readonly SimulationCastCostRef[] = [], sceneInputs: readonly SceneInitialParameterInput[] = []
): { compileRequest: CompileRequest; coverage: SimulationCoverage[]; operationOrigins: OperationOrigin[];
  equipmentOrigins: EquipmentOrigin[]; skillOrigins: SimulationSkillOriginTrace[]; basicAttackBinding: BasicAttackBinding | null; snapshotDigest: string;
  attributeInputs: SimulationAttributeInputs; initialHealth: SimulationInitialHealth; equipmentAssumptions: SimulationEquipmentAssumption[];
  mechanicStateInputs: SimulationMechanicStateInput[]; ignoredCastCosts: SimulationCastCostRef[]; sceneParameterInputs: SceneInitialParameterInput[] } {
  const sceneParameterInputs = normalizeSceneInitialParameterInputs(snapshot, sceneInputs);
  const compiled = program(snapshot, ignoredCosts, sceneParameterInputs);
  const equipmentAssumptions = validateEquipmentAssumptions(snapshot, assumptions);
  const mechanicStateInputs = validateMechanicStateInputs(compiled.provider ? primaryMechanicRequirements(snapshot, compiled.provider.initialStateSchema) : [], mechanicInputs);
  for (const input of mechanicStateInputs) {
    const field = compiled.provider?.initialStateSchema?.[input.stateKey];
    if (!field || typeof field !== 'object' || field.stateKind !== 'ammo') fail('mechanicStateInputs', '机制初值缺少真实弹药编译声明');
    compiled.provider!.initialStateSchema![input.stateKey] = { ...field, defaultValue: input.value };
  }
  const { requirements } = inspectSimulationSnapshot(snapshot, ignoredCosts, sceneParameterInputs);
  const actors = (['source', 'target'] as const).map(side => {
    const attributes: Record<string, AttributeSlot> = {};
    const combined = { ...snapshot[side].selectedLevelValues };
    for (const [key, value] of Object.entries(attributeInputs[side])) {
      if (Object.prototype.hasOwnProperty.call(combined, key)) fail(`attributeInputs.${side}.${key}`, '场景补充值不能覆盖真实固有属性');
      if (!requirements.some(row => row.side === side && row.attribute.attributeKey === key)) fail(`attributeInputs.${side}.${key}`, '不是本次所需属性');
      combined[key] = finiteNumber(value, `attributeInputs.${side}.${key}`, fail);
    }
    for (const { attribute } of requirements.filter(row => row.side === side)) {
      const key = attribute.attributeKey;
      const value = finiteNumber(combined[key], `attributeInputs.${side}.${key}`, fail);
      if ((attribute.valueType === 'INTEGER' && !Number.isInteger(value))
        || (attribute.minValue !== null && value < attribute.minValue)
        || (attribute.maxValue !== null && value > attribute.maxValue)) fail(`attributeInputs.${side}.${key}`, '违反属性类型或范围');
      const resolved = value + equipmentContribution(snapshot, side, key);
      if (!Number.isFinite(resolved) || (attribute.minValue !== null && resolved < attribute.minValue)
        || (attribute.maxValue !== null && resolved > attribute.maxValue)) fail(`combatants.${side}.attributes.${key}`, '装备平加后的属性违反真实范围');
    }
    const hpLimit = combined.hp! + equipmentContribution(snapshot, side, 'hp');
    if (!Number.isFinite(hpLimit) || !(hpLimit > 0)) fail(`combatants.${side}.hp`, '初始生命上限必须是有限正数');
    const currentHp = finiteNumber(initialHealth?.[side], `initialHealth.${side}`, fail);
    if (currentHp < 0 || currentHp > hpLimit) fail(`initialHealth.${side}`, '初始当前生命须在0与含装备生命上限之间，不自动填满或夹取');
    for (const [key, raw] of Object.entries(combined)) {
      const amount = finiteNumber(raw, `combatants.${side}.attributes.${key}`, fail);
      const resolved = amount + equipmentContribution(snapshot, side, key);
      attributes[key] = { base: amount, current: key === 'hp' ? currentHp : resolved, max: resolved, resolved };
    }
    return { key: side, displayName: snapshot[side].character.name, types: ['combatant/champion'], attributes,
      resources: {}, providers: [
        ...(side === 'source' && compiled.basicAttackBinding ? [{ providerRef: MOUNT, definitionRef: DEFINITION }] : []),
        ...compiled.equipment.origins.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef })),
        ...compiled.triggered.mounts.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef })),
        ...compiled.natural.mounts.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef }))
      ] };
  });
  return {
    compileRequest: {
      schemaVersion: 'generic-p0', schemaHash: SIMULATION_SCHEMA_HASH, rulesHash: 'pending',
      typeCatalog: { types: [...compiled.types, ...snapshot.catalogs.attributes.map(attribute => ({ key: attribute.attributeKey, domain: 'attribute' }))], relations: [] }, combatants: actors,
      sharedProviders: [...(compiled.provider ? [compiled.provider] : []), ...compiled.equipment.providers, ...compiled.triggered.providers, ...compiled.natural.providers, ...(compiled.active?.providers ?? [])], formulas: [...new Map([...(compiled.formulas ?? []), ...collectedCommonFormulaDefinitions()].map(formula => [formula.key, formula])).values()], rules: compiled.rules,
      settings: { maxEvents: 10000, maxCommandsPerEvent: 256, maxQueueEvents: 10000, maxChainDepth: 32 }
    }, coverage: compiled.coverage, operationOrigins: compiled.operationOrigins, basicAttackBinding: compiled.basicAttackBinding,
    equipmentOrigins: compiled.equipment.origins, skillOrigins: compiled.natural.origins, snapshotDigest: snapshot.snapshotDigest,
    attributeInputs: structuredClone(attributeInputs), initialHealth: structuredClone(initialHealth), equipmentAssumptions, mechanicStateInputs,
    ignoredCastCosts: compiled.active?.ignoredCastCosts ?? [], sceneParameterInputs
  };
}

/** 摘要仅含业务输入和适配后的定义；不包含接口基址、令牌或读取时间。 */
export async function prepareSimulation(snapshot: SimulationSnapshot, inputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth,
  assumptions: readonly SimulationEquipmentAssumption[] = [], mechanicInputs: readonly SimulationMechanicStateInput[] = [], ignoredCosts: readonly SimulationCastCostRef[] = [],
  sceneInputs: readonly SceneInitialParameterInput[] = []) {
  const assembled = assembleSimulation(snapshot, inputs, initialHealth, assumptions, mechanicInputs, ignoredCosts, sceneInputs);
  const approvedFormulaValues = consumedApprovedFormulaValues();
  assembled.compileRequest.formulas ??= [];
  for (const row of approvedFormulaValues) {
    const previous = assembled.compileRequest.formulas.find(formula => formula.key === row.formula.key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row.formula)) fail('formulas', '已消费静态公式与最终程序身份冲突');
    if (!previous) assembled.compileRequest.formulas.push(row.formula);
  }
  assembled.compileRequest.rulesHash = await simulationHash({ snapshotDigest: snapshot.snapshotDigest, adapter: SIMULATION_ADAPTER_VERSION,
    attributeInputs: inputs, initialHealth, equipmentAssumptions: assembled.equipmentAssumptions,
    mechanicStateInputs: assembled.mechanicStateInputs, sceneParameterInputs: assembled.sceneParameterInputs, request: assembled.compileRequest });
  return { ...assembled, approvedFormulaValues };
}

/** 单次入口保持一次真实开始与命中，不重复调度。 */
export function singleAttackRequest(input: CompileRequest, sessionId: string): RunRequest {
  const startRef = `source.provider[${MOUNT}].ability[${START_ABILITY}]`;
  const hitRef = `source.provider[${MOUNT}].ability[${HIT_ABILITY}]`;
  const start = simulationAbility(input, startRef);
  const hit = simulationAbility(input, hitRef);
  if (Object.values(start?.provider.initialStateSchema ?? {}).some(field => typeof field === 'object' && field.stateKind === 'ammo')) {
    fail('single.basicAttack', '弹药主体需要原生连续计划的攻击许可、开始值冻结与恢复唤醒；单次外部事件入口尚未支持，请使用连续普攻');
  }
  const skillKey = start?.ability.skillKey;
  if (!skillKey || hit?.ability.skillKey !== skillKey || hit.mount.providerRef !== start!.mount.providerRef) {
    fail('single.basicAttack', '实际开始与命中引用必须属于同一完整普攻挂载');
  }
  const useRef = 'first_attack_use';
  return {
    sessionId, expectedRulesHash: input.rulesHash, schemaVersion: input.schemaVersion,
    schemaHash: input.schemaHash, rulesHash: input.rulesHash,
    initialSnapshot: simulationInitialSnapshot(input),
    driverPlan: { conditionRecheckIntervalMs: 100, entries: [
      { entryKey: 'first_attack_start', abilityRef: `source.provider[${MOUNT}].ability[${START_ABILITY}]`, source: 'source', target: 'target', firstAtMs: 0, priority: 0 },
      { entryKey: 'first_attack_hit', abilityRef: `source.provider[${MOUNT}].ability[${HIT_ABILITY}]`, source: 'source', target: 'target', firstAtMs: 0, priority: 1 }
    ] },
    skillUses: [{ useKey: useRef, source: 'source', skillKey, historyState: 'complete', priorQualifiedContacts: [] }],
    attackStartFacts: [{ driverEntryKey: 'first_attack_start', useRef }],
    skillHitFacts: [{ driverEntryKey: 'first_attack_hit', useRef, sequence: 1 }],
    stopPolicy: { durationMs: 1, stopOnTargetDeath: true, stopWhenNoEvents: true },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 100, maxSeriesPoints: 10 }
  };
}

export function simulationAbility(input: CompileRequest, ref: string) {
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
  if (!match) return undefined;
  const actors = input.combatants.filter(actor => actor.key === match[1]);
  if (actors.length !== 1) return undefined;
  const mounts = actors[0]!.providers.filter(mount => mount.providerRef === match[2]);
  if (mounts.length !== 1) return undefined;
  const providers = input.sharedProviders?.filter(provider => provider.providerKey === mounts[0]!.definitionRef);
  if (providers?.length !== 1) return undefined;
  const abilities = providers[0]!.abilities?.filter(ability => ability.abilityKey === match[3]);
  if (abilities?.length !== 1) return undefined;
  return { mount: mounts[0]!, provider: providers[0]!, ability: abilities[0]! };
}
