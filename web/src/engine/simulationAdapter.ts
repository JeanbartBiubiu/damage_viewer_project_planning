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
import type { SimulationAttributeInputs, SimulationInitialHealth, SimulationSnapshot } from '../types/simulationSnapshot';
import {
  compileNumericValue, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, wrapValueRuleExpression
} from './numericAdapter';
import { adaptDamageVamp } from './vampAdapter';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { simulationHash } from './simulationHash';

export const SIMULATION_ADAPTER_VERSION = 'basic-attack-input-v2';
export const SIMULATION_SCHEMA_HASH = 'generic-basic-attack-input-v2';
const MOUNT = 'selected_basic_attack';
const DEFINITION = 'selected_basic_attack_definition';
const START_ABILITY = 'attack_start';
const HIT_ABILITY = 'attack_hit';
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const OPERATIONS: Record<string, string> = {
  ADD: 'add', SUBTRACT: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', MIN: 'min', MAX: 'max'
};

export type SimulationCoverage = { authorPath: string; compiledPath: string };
export type OperationOrigin = {
  abilityRef: string; operationRef: string; skillKey: string; effectKey: string; resultKey: string; compiledPaths: string[];
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
function ruleIsPlain(rule: SkillTriggerRuleDetail, path: string) {
  if (!Array.isArray(rule.conditionGroups) || rule.conditionGroups.length
    || rule.perTargetCooldown != null || rule.maxTriggersPerProcess != null || rule.oncePerUse != null) {
    fail(path, '首批普攻入口不接受未接入的条件或触发限制');
  }
  if (Object.keys(record(rule.eventSource.detail, `${path}.eventSource.detail`)).length) {
    fail(`${path}.eventSource.detail`, '原生普攻事件必须是空明细');
  }
}

type Program = {
  provider: ProviderDefinition; rules: GenericRules; formulas: CompileRequest['formulas'];
  types: CompileRequest['typeCatalog']['types']; coverage: SimulationCoverage[];
  operationOrigins: OperationOrigin[]; basicAttackBinding: BasicAttackBinding;
  required: Map<'source' | 'target', Set<string>>; configuration: SkillConfiguration;
};

/** 装配首批完整普攻形状，不依赖技能名称；不支持的启用入口整体拒绝。 */
function program(snapshot: SimulationSnapshot): Program {
  const selection = snapshot.selection;
  const config = snapshot.skillConfigurations.find(row => row.skill.skillKey === selection.basicAttackSkillKey);
  if (!config || snapshot.skillConfigurations.length !== 1) fail('skillConfigurations', '首批只接受一份完整所选普攻配置');
  if (config.skill.status !== 'ENABLED' || !config.skill.skillCategoryKeys.includes('basic_attack')) {
    fail('skillConfigurations[0].skill', '所选技能必须为已启用的普通攻击');
  }
  if (selection.basicAttackLevel < 1 || selection.basicAttackLevel > config.skill.maxLevel) {
    fail('selection.basicAttackLevel', '所选技能等级无效');
  }
  if (config.internalStates.length) fail('skillConfigurations[0].internalStates', '首批不接入内部状态或特殊普攻');
  if (config.processes.length !== 1) fail('skillConfigurations[0].processes', '首批要求唯一的攻击过程');
  const state = createNumericCompileState({
    gameId: snapshot.gameId, skillKey: config.skill.skillKey, skillLevel: selection.basicAttackLevel,
    characterLevel: selection.sourceLevel, parameters: config.parameters, formulas: config.formulas,
    formulaNamespace: `selected/${config.skill.skillKey}`, bindParameters: true, allowAttributeReads: true,
    runtimeInputMessage: '首批普攻没有未绑定的计算时参数'
  });
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
  const rules: GenericRules = { damageTypeFormulas: [] };
  const required = new Map<'source' | 'target', Set<string>>([
    ['source', new Set(['hp', 'attack_speed'])], ['target', new Set(['hp'])]
  ]);
  const addCoverage = (authorPath: string, compiledPath: string) => coverage.push({ authorPath, compiledPath });
  const skillPath = `skills.${config.skill.skillKey}`;
  const value = (numeric: Parameters<typeof compileNumericValue>[0], path: string) => compileNumericValue(numeric, path, state, fail);

  function effect(key: string, path: string): SkillEffect {
    const matches = config!.effects.filter(row => row.effectKey === key);
    if (matches.length !== 1) fail(path, '效果引用缺失或重复');
    const result = matches[0]!;
    if (result.lifecycle != null) fail(`${skillPath}.effects.${key}.lifecycle`, '首批只接入即时普攻结果');
    usedEffects.add(key);
    return result;
  }
  function resultOperation(result: SkillEffectResult, path: string, compiledPath: string): OperationDefinition {
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
  stableKey(process.processKey, `${processPath}.processKey`);
  if (process.activationType !== 'ACTIVE' || process.stateOperations.length || !process.steps.length
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
    addCoverage(`${processPath}.steps.${step.stepKey}`, `sharedProviders[0].processes[0].steps[${index}]`);
  }
  for (const binding of ordered(process.effectBindings, `${processPath}.effectBindings`)) {
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

  const listeners: NonNullable<ProviderDefinition['listeners']> = [];
  const candidates: SkillHitCandidate[] = [];
  let starts = 0;
  let hits = 0;
  for (const rule of ordered(config.triggerRules, `${skillPath}.triggerRules`)) {
    const rulePath = `${skillPath}.triggerRules.${rule.ruleKey}`;
    ruleIsPlain(rule, rulePath);
    if (!rule.actions.length) fail(`${rulePath}.actions`, '启用入口不能是空规则');
    if (rule.eventSource.eventType === 'BASIC_ATTACK_START') {
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
    if (rule.eventSource.eventType !== 'BASIC_ATTACK_HIT') fail(`${rulePath}.eventSource`, '首批不接入此执行入口');
    hits++;
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
          spellShieldBlockScope: null, operations: [operations[index]!]
        });
      }
      addCoverage(`${rulePath}.actions.${action.actionKey}`, 'sharedProviders[0].abilities[2].operations[0].skillHit.candidates');
    }
    addCoverage(rulePath, 'sharedProviders[0].abilities[2].operations[0].skillHit');
  }
  if (starts !== 1 || hits !== 1 || !candidates.length) fail(`${skillPath}.triggerRules`, '首批需要完整的唯一攻击开始与命中入口');
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
  const provider: ProviderDefinition = { providerKey: DEFINITION, stableId: DEFINITION, kind: 'champion', abilities, listeners, processes: [genericProcess] };
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
  return { provider, rules, formulas: [...state.namedFormulas.values()], types: [...types].map(([key, domain]) => ({ key, domain })),
    coverage, required, configuration: config, operationOrigins,
    basicAttackBinding: { source: 'source', target: 'target', skillKey: config.skill.skillKey,
      startAbilityRef: `source.provider[${MOUNT}].ability[${START_ABILITY}]`,
      hitAbilityRef: `source.provider[${MOUNT}].ability[${HIT_ABILITY}]`,
      initialControlAbilityRef: `source.provider[${MOUNT}].ability[${controlKey}]`, attackSpeedAttributeKey: 'attack_speed' }
  };
}

export function inspectSimulationSnapshot(snapshot: SimulationSnapshot): {
  requirements: SimulationAttributeRequirement[]; coverage: SimulationCoverage[]
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
  return { requirements, coverage: compiled.coverage };
}

export function assembleSimulation(
  snapshot: SimulationSnapshot, attributeInputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth
): { compileRequest: CompileRequest; coverage: SimulationCoverage[]; operationOrigins: OperationOrigin[];
  basicAttackBinding: BasicAttackBinding; snapshotDigest: string; attributeInputs: SimulationAttributeInputs; initialHealth: SimulationInitialHealth } {
  const compiled = program(snapshot);
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
    }
    if (!(combined.hp! > 0)) fail(`combatants.${side}.hp`, '初始生命上限必须是有限正数');
    const currentHp = finiteNumber(initialHealth?.[side], `initialHealth.${side}`, fail);
    if (currentHp < 0 || currentHp > combined.hp!) fail(`initialHealth.${side}`, '初始当前生命须在0与真实生命上限之间');
    if (side === 'source' && !(combined.attack_speed! > 0)) fail('combatants.source.attack_speed', '初始攻速必须是有限正数');
    for (const [key, raw] of Object.entries(combined)) {
      const amount = finiteNumber(raw, `combatants.${side}.attributes.${key}`, fail);
      attributes[key] = { base: amount, current: key === 'hp' ? currentHp : amount, max: amount, resolved: amount };
    }
    return { key: side, displayName: snapshot[side].character.name, types: ['combatant/champion'], attributes,
      resources: {}, providers: side === 'source' ? [{ providerRef: MOUNT, definitionRef: DEFINITION }] : [] };
  });
  return {
    compileRequest: {
      schemaVersion: 'generic-p0', schemaHash: SIMULATION_SCHEMA_HASH, rulesHash: 'pending',
      typeCatalog: { types: compiled.types, relations: [] }, combatants: actors,
      sharedProviders: [compiled.provider], formulas: compiled.formulas, rules: compiled.rules,
      settings: { maxEvents: 10000, maxCommandsPerEvent: 256, maxQueueEvents: 10000, maxChainDepth: 32 }
    }, coverage: compiled.coverage, operationOrigins: compiled.operationOrigins, basicAttackBinding: compiled.basicAttackBinding,
    snapshotDigest: snapshot.snapshotDigest,
    attributeInputs: structuredClone(attributeInputs), initialHealth: structuredClone(initialHealth)
  };
}

/** 摘要仅含业务输入和适配后的定义；不包含接口基址、令牌或读取时间。 */
export async function prepareSimulation(snapshot: SimulationSnapshot, inputs: SimulationAttributeInputs, initialHealth: SimulationInitialHealth) {
  const assembled = assembleSimulation(snapshot, inputs, initialHealth);
  assembled.compileRequest.rulesHash = await simulationHash({ snapshotDigest: snapshot.snapshotDigest, adapter: SIMULATION_ADAPTER_VERSION,
    attributeInputs: inputs, initialHealth, request: assembled.compileRequest });
  return assembled;
}

/** 单次入口保持一次真实开始与命中，不重复调度。 */
export function singleAttackRequest(input: CompileRequest, sessionId: string): RunRequest {
  const skillKey = input.sharedProviders![0]!.abilities![0]!.skillKey!;
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
