import type { Attribute } from '../types/attribute';
import {
  DAMAGE_TYPE_FORMULA_STAGE_KEYS, damageTypeFormulaStageFromResultKey,
  type DamageTypeFormulaNode
} from '../types/damageTypeFormula';
import type {
  AbilityDefinition, AttributeSlot, BasicAttackPlan, CompileRequest, GenericDamageTypeFormula, GenericFormulaExpr,
  GenericRules, OperationDefinition, ProcessDefinition, ProviderDefinition, RunRequest, SkillHitCandidate
} from '../types/genericEngine';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth, SimulationMechanicStateInput, SimulationSnapshot } from '../types/simulationSnapshot';
import {
  compileNumericValue, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, wrapValueRuleExpression
} from './numericAdapter';
import { adaptDamageVamp } from './vampAdapter';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationHash } from './simulationHash';
import { assembleEquipment, equipmentContribution, type EquipmentOrigin } from './simulationEquipment';
import { assembleEquipmentPassives, validateEquipmentAssumptions } from './simulationEquipmentPassives';
import { assembleTriggeredEquipment, validateConfiguration } from './simulationTriggeredEquipment';
import { assembleNaturalSkillSources, type SimulationSkillOriginTrace } from './simulationNaturalSkillSources';
import { compilePrimaryAmmo, compilePrimaryCondition, primaryConditionsExclusive, primaryMechanicRequirements, validateMechanicStateInputs } from './simulationPrimaryAttack';
import { validateSimulationAttributeDerivations } from './simulationAttributeConversion';

export const SIMULATION_ADAPTER_VERSION = 'v10-ammo-special-primary';
export const SIMULATION_SCHEMA_HASH = 'generic-basic-attack-input-v4';
const MOUNT = 'selected_basic_attack';
const DEFINITION = 'selected_basic_attack_definition';
const START_ABILITY = 'attack_start';
const HIT_ABILITY = 'attack_hit';
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const OPERATIONS: Record<string, string> = {
  ADD: 'add', SUBTRACT: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', MIN: 'min', MAX: 'max'
};

export type SimulationCoverage = { authorPath: string; compiledPath: string; note?: string };
export type OperationOrigin = {
  abilityRef: string; operationRef: string; skillKey: string; effectKey: string; resultKey: string; compiledPaths: string[];
  providerDefinitionRef?: string;
};
export type BasicAttackBinding = Omit<BasicAttackPlan, 'planKey' | 'attackSpeedInputMax'>;
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
  provider: ProviderDefinition; rules: GenericRules; formulas: CompileRequest['formulas'];
  types: CompileRequest['typeCatalog']['types']; coverage: SimulationCoverage[];
  operationOrigins: OperationOrigin[]; basicAttackBinding: BasicAttackBinding;
  required: Map<'source' | 'target', Set<string>>; configuration: SkillConfiguration;
  equipment: ReturnType<typeof assembleEquipment>;
  passives: ReturnType<typeof assembleEquipmentPassives>;
  triggered: ReturnType<typeof assembleTriggeredEquipment>;
  natural: ReturnType<typeof assembleNaturalSkillSources>;
};

/** 装配首批完整普攻形状，不依赖技能名称；不支持的启用入口整体拒绝。 */
function program(snapshot: SimulationSnapshot): Program {
  const natural = assembleNaturalSkillSources(snapshot);
  const triggered = assembleTriggeredEquipment(snapshot);
  const triggeredPrograms = [triggered, natural.triggered];
  const equipment = assembleEquipment(snapshot, new Set([...natural.derivationSides, ...triggered.derivationSides]),
    new Set(natural.derivations.filter(row => row.attributeKey === 'attack_speed').map(row => row.combatantKey)));
  const passives = assembleEquipmentPassives(snapshot);
  const selection = snapshot.selection;
  const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === selection.basicAttackSkillKey);
  if (!config) fail('skillConfigurations', '缺少完整所选普攻配置');
  validateConfiguration(config, snapshot.gameId, `skills.${config.skill.skillKey}`, false, selection.basicAttackLevel);
  if (config.skill.status !== 'ENABLED' || !config.skill.skillCategoryKeys.includes('basic_attack')) {
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
  const types = new Map<string, string>([
    ['ability/basic_attack', 'ability'], ['combatant/champion', 'combatant'],
    ['event/basic_attack_start', 'event'], ['event/basic_attack_hit', 'event'],
    ['event/source_owner', 'event'], ['event/attack_link_applied', 'event'], ['event/hit_link_applied', 'event']
  ]);
  const abilityTypes = config.skill.skillCategoryKeys.map(categoryKey => {
    stableKey(categoryKey, `skills.${config.skill.skillKey}.skillCategoryKeys`);
    if (!snapshot.catalogs.skillCategories.some(row => row.skillCategoryKey === categoryKey && row.status === 'ENABLED')) {
      fail(`catalogs.skillCategories.${categoryKey}`, '缺少已启用的真实技能分类');
    }
    const typeKey = `ability/${categoryKey}`;
    types.set(typeKey, 'ability');
    return typeKey;
  });
  const skillIdentity = `ability/skill/${config.skill.skillKey}`;
  types.set(skillIdentity, 'ability');
  abilityTypes.push(skillIdentity);
  const rules: GenericRules = { damageTypeFormulas: [] };
  const required = new Map<'source' | 'target', Set<string>>([
    ['source', new Set(['hp', 'attack_speed', ...equipment.required.source, ...passives.required.source])], ['target', new Set(['hp', ...equipment.required.target, ...passives.required.target])]
  ]);
  coverage.push(...equipment.coverage);
  coverage.push(...passives.coverage);
  coverage.push(...triggered.coverage);
  coverage.push(...natural.coverage);
  operationOrigins.push(...triggeredPrograms.flatMap(assembly => assembly.operationOrigins));
  for (const side of ['source', 'target'] as const) for (const key of triggered.required[side]) required.get(side)!.add(key);
  for (const side of ['source', 'target'] as const) for (const key of natural.required[side]) required.get(side)!.add(key);
  for (const type of triggeredPrograms.flatMap(assembly => assembly.types)) types.set(type.key, type.domain);
  if (passives.mounts.length || natural.mounts.length) types.set('event/source_initialized', 'event');
  if (ammo.schema) types.set('state_scope/provider', 'state_scope');
  if (equipment.derivations.length || natural.derivations.length) rules.attributeDerivations = [...equipment.derivations, ...natural.derivations];
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
    const damageType = `damage/${damageKey}`;
    types.set(damageType, 'damage');
    const vamp = adaptDamageVamp(snapshot.catalogs.vampRules.rules, {
      gameId: snapshot.gameId, skillKey: config!.skill.skillKey, skillCategoryKeys: config!.skill.skillCategoryKeys,
      skillLevel: selection.basicAttackLevel, characterLevel: selection.sourceLevel,
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
      operation.critChance = critical.mode === 'FORCED' ? constExpr(1)
        : { op: 'read', path: 'source.attr.critical_strike_chance.resolved' };
      addCoverage(`${path}.detail.critical.mode`, `${compiledPath}.critChance`);
      addCoverage(`${path}.detail.critical.multiplierValue`, `${compiledPath}.critMultiplier`);
    } else fail(`${path}.detail.critical.mode`, '未知暴击模式');
    if (!rules.damageTypeFormulas!.some(row => row.damageType === damageType)) {
      const authored = snapshot.catalogs.damageTypes.find(row => row.type.damageTypeKey === damageKey);
      if (!authored || !authored.type.formulaConfigured) fail(`catalogs.damageTypes.${damageKey}`, '缺少实际五阶段防御公式');
      const formula = {} as GenericDamageTypeFormula['formula'];
      const typeIndex = rules.damageTypeFormulas!.length;
      for (const [index, stage] of DAMAGE_TYPE_FORMULA_STAGE_KEYS.entries()) {
        const path = `damageTypes.${damageKey}.formula.${stage}`;
        formula[stage] = damageFormula(authored.formula.formula[stage], path, index);
        addCoverage(path, `rules.damageTypeFormulas[${typeIndex}].formula.${stage}`);
      }
      rules.damageTypeFormulas!.push({ damageType, formula });
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
  function damageFormula(node: DamageTypeFormulaNode, path: string, stageIndex: number, depth = 0): GenericFormulaExpr {
    if (depth > 32) fail(path, '防御公式超过最大深度');
    record(node, path);
    if (node.nodeType === 'FIXED') return constExpr(finiteNumber(node.value, path, fail));
    if (node.nodeType === 'STAGE_RESULT') {
      const prior = damageTypeFormulaStageFromResultKey(node.stageKey);
      if (!prior || DAMAGE_TYPE_FORMULA_STAGE_KEYS.indexOf(prior) >= stageIndex) fail(path, '只能引用已完成的前序防御阶段');
      return { op: 'read', path: `damage.stage.${node.stageKey}` };
    }
    if (node.nodeType === 'OPERATION') {
      if (!OPERATIONS[node.operation] || !Array.isArray(node.operands) || node.operands.length !== 2) fail(path, '未知防御运算');
      return { op: OPERATIONS[node.operation]!, args: node.operands.map((row, index) => damageFormula(row, `${path}.operands[${index}]`, stageIndex, depth + 1)) };
    }
    if (node.nodeType !== 'ATTRIBUTE' || !['SOURCE', 'TARGET'].includes(node.attributeOwner)) fail(path, '未知防御公式节点');
    const side = node.attributeOwner === 'SOURCE' ? 'source' : 'target';
    const key = stableKey(node.attributeKey, `${path}.attributeKey`);
    required.get(side)!.add(key);
    const read = (suffix: string): GenericFormulaExpr => ({ op: 'read', path: `${side}.attr.${key}.${suffix}` });
    const missing: GenericFormulaExpr = { op: 'sub', args: [read('max'), read('current')] };
    switch (node.attributeValueKind) {
      case 'BASE': return read('base');
      case 'TOTAL': return read('resolved');
      case 'CURRENT': return read('current');
      case 'BONUS': return { op: 'sub', args: [read('resolved'), read('base')] };
      case 'MISSING': return missing;
      case 'CURRENT_RATIO': return { op: 'div', args: [read('current'), read('max')] };
      case 'MISSING_RATIO': return { op: 'div', args: [missing, read('max')] };
      default: return fail(path, '未知属性取值口径');
    }
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
    steps: ordered(process.steps, `${processPath}.steps`).map(step => ({ stepKey: stableKey(step.stepKey, processPath), stepType: 'IMMEDIATE' })),
    costs: [], cooldown: {
      durationMs: value(process.cooldown.durationValue, `${processPath}.cooldown.durationValue`),
      roundPositiveMs: true,
      startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }
    }, momentOperations: []
  };
  addCoverage(`${processPath}.cooldown`, 'sharedProviders[0].processes[0].cooldown');
  for (const [index, step] of ordered(process.steps, `${processPath}.steps`).entries()) {
    exact(step, ['stepKey', 'name', 'description', 'sortOrder', 'stepType', 'detail'], `${processPath}.steps.${step.stepKey}`);
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
  const provider: ProviderDefinition = { providerKey: DEFINITION, stableId: DEFINITION, kind: 'champion', abilities, listeners, processes: [genericProcess],
    ...(ammo.schema ? { initialStateSchema: ammo.schema } : {}) };
  // 从已翻译的表达式按实际source/target收集，不把某一侧所需属性强塞给双方。
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
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
  const providerIndices = new Map([...triggered.providers, ...natural.providers].map((definition, index) => [definition.providerKey, 1 + equipment.providers.length + passives.providers.length + index]));
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
    const compiledPath = rebase(path).replace(/rules\.attributeDerivations\[conversion_(\d+)\]/,
      (_original, index: string) => `rules.attributeDerivations[${equipment.derivations.length + Number(index)}]`);
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
  return { provider, rules, formulas: [...state.namedFormulas.values(), ...triggeredPrograms.flatMap(assembly => assembly.formulas)], types: [...types].map(([key, domain]) => ({ key, domain })),
    coverage: mergedCoverage, required, configuration: config, operationOrigins: mergedOrigins, equipment, passives, triggered, natural,
    basicAttackBinding: { source: 'source', target: 'target', skillKey: config.skill.skillKey,
      startAbilityRef: `source.provider[${MOUNT}].ability[${START_ABILITY}]`,
      hitAbilityRef: `source.provider[${MOUNT}].ability[${HIT_ABILITY}]`,
      initialControlAbilityRef: `source.provider[${MOUNT}].ability[${controlKey}]`, attackSpeedAttributeKey: 'attack_speed' }
  };
}

export function inspectSimulationSnapshot(snapshot: SimulationSnapshot): {
  requirements: SimulationAttributeRequirement[]; coverage: SimulationCoverage[]; equipmentOrigins: EquipmentOrigin[];
  mechanicRequirements: ReturnType<typeof primaryMechanicRequirements>
} {
  const compiled = program(snapshot);
  const requirements: SimulationAttributeRequirement[] = [];
  for (const side of ['source', 'target'] as const) {
    for (const key of [...compiled.required.get(side)!].sort()) {
      const attribute = snapshot.catalogs.attributes.find(row => row.attributeKey === key);
      if (!attribute || attribute.status !== 'ENABLED') fail(`catalogs.attributes.${key}`, '缺少已启用的属性定义');
      requirements.push({ side, attribute, storedValue: snapshot[side].selectedLevelValues[key] });
    }
  }
  return { requirements, coverage: compiled.coverage, equipmentOrigins: compiled.equipment.origins,
    mechanicRequirements: primaryMechanicRequirements(snapshot, compiled.provider.initialStateSchema) };
}

export function assembleSimulation(
  snapshot: SimulationSnapshot, attributeInputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth,
  assumptions: readonly SimulationEquipmentAssumption[] = [], mechanicInputs: readonly SimulationMechanicStateInput[] = []
): { compileRequest: CompileRequest; coverage: SimulationCoverage[]; operationOrigins: OperationOrigin[];
  equipmentOrigins: EquipmentOrigin[]; skillOrigins: SimulationSkillOriginTrace[]; basicAttackBinding: BasicAttackBinding; snapshotDigest: string;
  attributeInputs: SimulationAttributeInputs; initialHealth: SimulationInitialHealth; equipmentAssumptions: SimulationEquipmentAssumption[];
  mechanicStateInputs: SimulationMechanicStateInput[] } {
  const compiled = program(snapshot);
  const equipmentAssumptions = validateEquipmentAssumptions(snapshot, assumptions);
  const mechanicStateInputs = validateMechanicStateInputs(primaryMechanicRequirements(snapshot, compiled.provider.initialStateSchema), mechanicInputs);
  for (const input of mechanicStateInputs) {
    const field = compiled.provider.initialStateSchema?.[input.stateKey];
    if (!field || typeof field !== 'object' || field.stateKind !== 'ammo') fail('mechanicStateInputs', '机制初值缺少真实弹药编译声明');
    compiled.provider.initialStateSchema![input.stateKey] = { ...field, defaultValue: input.value };
  }
  const { requirements } = inspectSimulationSnapshot(snapshot);
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
    const hasDerivation = compiled.rules.attributeDerivations?.some(row => row.combatantKey === side && row.attributeKey === 'attack_speed');
    if (compiled.equipment.derivations.some(row => row.combatantKey === side) && !(combined.attack_speed_ratio! > 0)) fail(`attributeInputs.${side}.attack_speed_ratio`, '装备攻速收益系数必须明确填写有限正数，不提供默认值');
    if (!Number.isFinite(hpLimit) || !(hpLimit > 0)) fail(`combatants.${side}.hp`, '初始生命上限必须是有限正数');
    const currentHp = finiteNumber(initialHealth?.[side], `initialHealth.${side}`, fail);
    if (currentHp < 0 || currentHp > hpLimit) fail(`initialHealth.${side}`, '初始当前生命须在0与含装备生命上限之间，不自动填满或夹取');
    if (side === 'source' && !hasDerivation && !(combined.attack_speed! > 0)) fail('combatants.source.attack_speed', '初始攻速必须是有限正数');
    for (const [key, raw] of Object.entries(combined)) {
      const amount = finiteNumber(raw, `combatants.${side}.attributes.${key}`, fail);
      const resolved = amount + equipmentContribution(snapshot, side, key);
      attributes[key] = { base: amount, current: key === 'hp' ? currentHp : resolved, max: resolved, resolved };
    }
    return { key: side, displayName: snapshot[side].character.name, types: ['combatant/champion'], attributes,
      resources: {}, providers: [
        ...(side === 'source' ? [{ providerRef: MOUNT, definitionRef: DEFINITION }] : []),
        ...compiled.equipment.origins.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef })),
        ...compiled.passives.mounts.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef })),
        ...compiled.triggered.mounts.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef })),
        ...compiled.natural.mounts.filter(row => row.side === side).map(({ providerRef, definitionRef }) => ({ providerRef, definitionRef }))
      ] };
  });
  return {
    compileRequest: {
      schemaVersion: 'generic-p0', schemaHash: SIMULATION_SCHEMA_HASH, rulesHash: 'pending',
      typeCatalog: { types: compiled.types, relations: [] }, combatants: actors,
      sharedProviders: [compiled.provider, ...compiled.equipment.providers, ...compiled.passives.providers, ...compiled.triggered.providers, ...compiled.natural.providers], formulas: compiled.formulas, rules: compiled.rules,
      settings: { maxEvents: 10000, maxCommandsPerEvent: 256, maxQueueEvents: 10000, maxChainDepth: 32 }
    }, coverage: compiled.coverage, operationOrigins: compiled.operationOrigins, basicAttackBinding: compiled.basicAttackBinding,
    equipmentOrigins: compiled.equipment.origins, skillOrigins: compiled.natural.origins, snapshotDigest: snapshot.snapshotDigest,
    attributeInputs: structuredClone(attributeInputs), initialHealth: structuredClone(initialHealth), equipmentAssumptions, mechanicStateInputs
  };
}

/** 摘要仅含业务输入和适配后的定义；不包含接口基址、令牌或读取时间。 */
export async function prepareSimulation(snapshot: SimulationSnapshot, inputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth,
  assumptions: readonly SimulationEquipmentAssumption[] = [], mechanicInputs: readonly SimulationMechanicStateInput[] = []) {
  const assembled = assembleSimulation(snapshot, inputs, initialHealth, assumptions, mechanicInputs);
  assembled.compileRequest.rulesHash = await simulationHash({ snapshotDigest: snapshot.snapshotDigest, adapter: SIMULATION_ADAPTER_VERSION,
    attributeInputs: inputs, initialHealth, equipmentAssumptions: assembled.equipmentAssumptions,
    mechanicStateInputs: assembled.mechanicStateInputs, request: assembled.compileRequest });
  return assembled;
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
