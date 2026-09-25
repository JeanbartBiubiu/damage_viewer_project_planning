import type { NumericValue } from '../types/numericValue';
import type {
  SkillEffect, SkillEffectResult, SkillEffectValueRule
} from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type {
  SkillProcess, SkillProcessFailureReason, SkillProcessMoment, SkillProcessStep
} from '../types/skillProcess';
import type {
  SkillTriggerAction, SkillTriggerCondition, SkillTriggerRuleDetail
} from '../types/skillTriggerRule';
import type {
  AbilityDefinition, CompileRequest, GenericFormulaExpr, ListenerDefinition, NamedFormula, OperationDefinition,
  ProcessCommandFact, ProcessControlAction, ProcessCostDefinition, ProcessDefinition,
  ProcessFailureReason, ProcessMomentDefinition, ProcessMomentType, ProcessStepDefinition
} from '../types/genericEngine';
import {
  compileNumericValue, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, tryFoldConstant, type NumericCompileState, wrapValueRuleExpression
} from './numericAdapter';

export class ProcessAdaptationError extends NumericAdaptationError {
  constructor(path: string, message: string) {
    super(path, message);
    this.name = 'ProcessAdaptationError';
  }
}

const MOUNT_TOKEN = '@mount';
const INITIAL_CAST_TYPE = `ability/initial_cast/${MOUNT_TOKEN}`;
const PROCESS_MOMENT_TYPES = new Set<ProcessMomentType>([
  'PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE',
  'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
]);
const PROCESS_LEVEL = new Set<ProcessMomentType>(['PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE']);
const FAILURE_REASONS = new Set<SkillProcessFailureReason>([
  'CONTROLLED', 'SOURCE_DIED', 'TARGET_UNTARGETABLE', 'ACTIVE_CANCELLED', 'EVENT_ABORTED'
]);

export type CastCostRef = {
  bindingKey: string;
  effectKey: string;
  resultKey: string;
};

export type AuthoredProcessProgram = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  process: SkillProcess;
  rules: readonly SkillTriggerRuleDetail[];
  effects: readonly SkillEffect[];
  parameters?: readonly SkillParameter[];
  formulas?: readonly SkillFormula[];
  owner?: 'source' | 'target';
  castCosts: readonly CastCostRef[];
};

export type AdaptedProcessControl = {
  abilityKey: string;
  action: ProcessControlAction;
  stepKey?: string;
  failureReason?: ProcessFailureReason;
};

export type AdaptedProcessProgram = {
  provider: {
    providerKey: string;
    kind: string;
    stableId: string;
    abilities: AbilityDefinition[];
    processes: ProcessDefinition[];
  };
  params: Record<string, number>;
  formulas: NamedFormula[];
  requiredAttributes: string[];
  initialAbilityKey: string;
  controls: AdaptedProcessControl[];
};

export type ProcessProgramBinding = {
  processProviderKey: string;
  authored: AuthoredProcessProgram;
};

function fail(path: string, message: string): never {
  throw new ProcessAdaptationError(path, message);
}

function catalogKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要合法标识');
  return value;
}

function exactKeys(value: unknown, allowed: readonly string[], path: string): void {
  if (!isRecord(value)) fail(path, '需要对象');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, `未支持的字段 ${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function planPath(skillKey: string, extra: string): string {
  return `adapter.processPlan.skills.${skillKey}.${extra}`;
}

function stableSorted<T>(items: readonly T[], order: (item: T) => number): T[] {
  return items.map((item, index) => ({ item, index }))
    .sort((left, right) => order(left.item) - order(right.item) || left.index - right.index)
    .map((row) => row.item);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function numericState(authored: AuthoredProcessProgram): NumericCompileState {
  if (authored.parameters !== undefined && !Array.isArray(authored.parameters)) fail('parameters', '参数必须是数组');
  for (const parameter of authored.parameters ?? []) {
    const path = planPath(authored.skillKey, `parameters.${parameter.parameterKey}`);
    exactKeys(parameter, ['gameId', 'skillKey', 'parameterKey', 'name', 'valueType', 'valueMode',
      'fixedValue', 'levelValues', 'description', 'sortOrder', 'createdAt', 'updatedAt'], path);
  }
  if (authored.formulas !== undefined && !Array.isArray(authored.formulas)) fail('formulas', '公式必须是数组');
  for (const formula of authored.formulas ?? []) {
    const path = planPath(authored.skillKey, `formulas.${formula.formulaKey}`);
    exactKeys(formula, ['gameId', 'skillKey', 'formulaKey', 'name', 'description', 'sortOrder', 'createdAt', 'updatedAt', 'expression'], path);
    assertFormulaShape(formula.expression, `${path}.expression`);
  }
  return createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `process/${authored.skillKey}`, bindParameters: true, allowAttributeReads: true,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
}

function scratchState(state: NumericCompileState, message: string, allowAttributeReads: boolean): NumericCompileState {
  return createNumericCompileState({
    gameId: state.gameId, skillKey: state.skillKey, skillLevel: state.skillLevel,
    characterLevel: state.characterLevel, parameters: state.parameters, formulas: state.formulas,
    formulaNamespace: state.formulaNamespace, bindParameters: false, allowAttributeReads,
    runtimeInputMessage: message, runtimeInputReads: state.runtimeInputReads
  });
}

function assertFormulaShape(node: unknown, path: string, depth = 0): void {
  if (depth > 32) fail(path, '公式深度超过限制');
  if (!isRecord(node)) fail(path, '公式节点必须是对象');
  if (node.nodeType === 'PARAMETER') {
    exactKeys(node, ['nodeType', 'parameterKey'], path);
    catalogKey(node.parameterKey, `${path}.parameterKey`);
  } else if (node.nodeType === 'ATTRIBUTE') {
    exactKeys(node, ['nodeType', 'attributeOwner', 'attributeKey', 'attributeValueKind'], path);
  } else if (node.nodeType === 'OPERATION') {
    exactKeys(node, ['nodeType', 'operation', 'operands'], path);
    if (!Array.isArray(node.operands) || node.operands.length !== 2) fail(`${path}.operands`, '公式运算必须有两个操作数');
    node.operands.forEach((operand, index) => assertFormulaShape(operand, `${path}.operands[${index}]`, depth + 1));
  } else fail(`${path}.nodeType`, '不支持的公式节点');
}

function assertNumericShape(value: NumericValue, path: string): void {
  if (!isRecord(value)) fail(path, '数值必须是对象');
  if (value.kind === 'FIXED') {
    exactKeys(value, ['kind', 'value'], path);
    finiteNumber(value.value, `${path}.value`, fail);
  } else if (value.kind === 'PARAMETER') {
    exactKeys(value, ['kind', 'parameterKey'], path);
    catalogKey(value.parameterKey, `${path}.parameterKey`);
  } else if (value.kind === 'FORMULA') {
    exactKeys(value, ['kind', 'formulaKey'], path);
    catalogKey(value.formulaKey, `${path}.formulaKey`);
  } else fail(`${path}.kind`, '不支持的数值来源');
}

function compileFoldable(value: NumericValue, path: string, state: NumericCompileState, message: string): GenericFormulaExpr {
  assertNumericShape(value, path);
  const folded = tryFoldConstant(compileNumericValue(value, path, scratchState(state, message, true), fail));
  if (folded !== null) return constExpr(finiteNumber(folded, path, fail));
  return compileNumericValue(value, path, state, fail);
}

function assertValueRule(rule: SkillEffectValueRule | null, path: string): asserts rule is SkillEffectValueRule {
  if (!rule || !isRecord(rule)) fail(path, '缺少数值规则');
  exactKeys(rule, ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'], path);
  if (typeof rule.fixedMultiplier !== 'number' || !Number.isFinite(rule.fixedMultiplier)) fail(`${path}.fixedMultiplier`, '倍率必须是有限数值');
  for (const field of ['fixedMinValue', 'fixedMaxValue'] as const) {
    const bound = rule[field];
    if (bound !== null && (typeof bound !== 'number' || !Number.isFinite(bound))) fail(`${path}.${field}`, '上下限必须是有限数值或明确为空');
  }
}

function compileScaled(rule: SkillEffectValueRule, path: string, state: NumericCompileState): GenericFormulaExpr {
  assertValueRule(rule, path);
  const expression = wrapValueRuleExpression(compileFoldable(rule.value, `${path}.value`, state, state.runtimeInputMessage), rule);
  if (expression.op === 'const') finiteNumber(expression.value, path, fail);
  return expression;
}

function assertTime(value: number, path: string, mode: 'positive' | 'nonNegative'): void {
  if (!Number.isSafeInteger(value)) fail(path, '时间必须是整数毫秒，不能截断非整数');
  if (mode === 'positive' && value <= 0) fail(path, '时间必须为正整数毫秒');
  if (value < 0) fail(path, '时间必须是非负整数毫秒');
}

function compileTime(value: NumericValue, path: string, state: NumericCompileState, mode: 'positive' | 'nonNegative'): GenericFormulaExpr {
  const expr = compileFoldable(value, path, state, '时间不能使用未供值的计算时输入');
  const folded = tryFoldConstant(expr);
  if (folded !== null) {
    assertTime(folded, path, mode);
    return constExpr(folded);
  }
  return expr;
}

function negate(amount: GenericFormulaExpr): GenericFormulaExpr {
  const signed: GenericFormulaExpr = { op: 'mul', args: [amount, constExpr(-1)] };
  const folded = tryFoldConstant(signed);
  return folded === null ? signed : constExpr(folded);
}

function readMoment(value: SkillProcessMoment, path: string): ProcessMomentDefinition {
  if (!isRecord(value)) fail(path, '时点必须是对象');
  exactKeys(value, ['momentType', 'stepKey', 'failureReason'], path);
  if (typeof value.momentType !== 'string' || !PROCESS_MOMENT_TYPES.has(value.momentType as ProcessMomentType)) {
    fail(`${path}.momentType`, '未知时点');
  }
  const momentType = value.momentType as ProcessMomentType;
  const stepKey = value.stepKey ?? null;
  const failureReason = value.failureReason ?? null;
  if (failureReason !== null && !FAILURE_REASONS.has(failureReason)) fail(`${path}.failureReason`, '未知失败原因');
  if (PROCESS_LEVEL.has(momentType)) {
    if (stepKey !== null) fail(`${path}.stepKey`, '过程时点不能携带步骤');
    if (failureReason !== null && momentType !== 'PROCESS_FAILURE') fail(`${path}.failureReason`, '只有失败时点可以筛选原因');
    return { momentType, stepKey: null, failureReason };
  }
  if (typeof stepKey !== 'string') fail(`${path}.stepKey`, '步骤时点必须明确步骤');
  if (failureReason !== null) fail(`${path}.failureReason`, '步骤时点不能筛选失败原因');
  return { momentType, stepKey: catalogKey(stepKey, `${path}.stepKey`), failureReason: null };
}

function stepAllows(step: SkillProcessStep, momentType: ProcessMomentType): boolean {
  if (step.stepType === 'IMMEDIATE' || step.stepType === 'DELAY') {
    return momentType === 'STEP_START' || momentType === 'STEP_EXECUTION' || momentType === 'STEP_COMPLETE';
  }
  if (step.stepType === 'CHARGE' || step.stepType === 'RECAST') {
    return momentType === 'STEP_START' || momentType === 'STEP_EXECUTION' || momentType === 'STEP_TIMEOUT' || momentType === 'STEP_COMPLETE';
  }
  return false;
}

function assertMomentFits(moment: ProcessMomentDefinition, steps: readonly SkillProcessStep[], path: string): void {
  if (PROCESS_LEVEL.has(moment.momentType)) return;
  const step = steps.find((item) => item.stepKey === moment.stepKey);
  if (!step) fail(path, '时点指向不存在的步骤');
  if (!stepAllows(step, moment.momentType)) fail(path, '该步骤不支持此时点');
}

function compileSteps(process: SkillProcess, state: NumericCompileState): ProcessStepDefinition[] {
  const root = planPath(process.skillKey, `processes.${process.processKey}.steps`);
  if (!Array.isArray(process.steps)) fail(root, '步骤必须是数组');
  if (!process.steps.length) fail(root, '过程缺少步骤');
  const ordered = stableSorted(process.steps, (step) => {
    if (typeof step.sortOrder !== 'number' || !Number.isFinite(step.sortOrder)) fail(`${root}.sortOrder`, '步骤排序必须是有限数值');
    return step.sortOrder;
  });
  const seen = new Set<string>();
  let terminal = false;
  const steps: ProcessStepDefinition[] = [];
  for (const step of ordered) {
    const path = `${root}.${step.stepKey || 'missing'}`;
    exactKeys(step, ['stepKey', 'name', 'description', 'sortOrder', 'stepType', 'detail'], path);
    const stepKey = catalogKey(step.stepKey, `${path}.stepKey`);
    if (seen.has(stepKey)) fail(`${path}.stepKey`, '步骤标识重复');
    seen.add(stepKey);
    if (!isRecord(step.detail)) fail(`${path}.detail`, '步骤明细必须是对象');
    if (terminal) fail(path, '蓄力或重施只能位于末尾');
    if (step.stepType === 'IMMEDIATE') {
      exactKeys(step.detail, [], `${path}.detail`);
      steps.push({ stepKey, stepType: 'IMMEDIATE' });
    } else if (step.stepType === 'DELAY') {
      exactKeys(step.detail, ['delayValue'], `${path}.detail`);
      steps.push({ stepKey, stepType: 'DELAY', delayMs: compileTime(step.detail.delayValue, `${path}.detail.delayValue`, state, 'positive') });
    } else if (step.stepType === 'CHARGE') {
      exactKeys(step.detail, ['minimumChargeValue', 'maximumChargeValue', 'releaseAtMaximum'], `${path}.detail`);
      if (typeof step.detail.releaseAtMaximum !== 'boolean') fail(`${path}.detail.releaseAtMaximum`, '释放到最大值必须明确');
      const minimumChargeMs = compileTime(step.detail.minimumChargeValue, `${path}.detail.minimumChargeValue`, state, 'nonNegative');
      const maximumChargeMs = compileTime(step.detail.maximumChargeValue, `${path}.detail.maximumChargeValue`, state, 'positive');
      const minimum = tryFoldConstant(minimumChargeMs);
      const maximum = tryFoldConstant(maximumChargeMs);
      if (minimum !== null && maximum !== null && minimum > maximum) fail(`${path}.detail.minimumChargeValue`, '最短蓄力不能超过最长蓄力');
      terminal = true;
      steps.push({ stepKey, stepType: 'CHARGE', minimumChargeMs, maximumChargeMs, releaseAtMaximum: step.detail.releaseAtMaximum });
    } else if (step.stepType === 'RECAST') {
      exactKeys(step.detail, ['windowValue', 'maximumRecastCountValue'], `${path}.detail`);
      assertNumericShape(step.detail.maximumRecastCountValue, `${path}.detail.maximumRecastCountValue`);
      const count = tryFoldConstant(compileNumericValue(
        step.detail.maximumRecastCountValue, `${path}.detail.maximumRecastCountValue`, scratchState(state, '重施次数必须为 1', false), fail
      ));
      if (count !== 1) fail(`${path}.detail.maximumRecastCountValue`, '重施次数必须为 1');
      terminal = true;
      steps.push({ stepKey, stepType: 'RECAST', windowMs: compileTime(step.detail.windowValue, `${path}.detail.windowValue`, state, 'positive') });
    } else fail(`${path}.stepType`, '本期只接受 IMMEDIATE、DELAY，以及末尾至多一个 CHARGE 或单次 RECAST');
  }
  return steps;
}

function lookupEffect(authored: AuthoredProcessProgram, effectKey: string, path: string): SkillEffect {
  const matches = authored.effects.filter((item) => item.effectKey === effectKey);
  if (matches.length !== 1) fail(path, '效果目录缺失或重复');
  const effect = matches[0]!;
  if (effect.gameId !== authored.gameId || effect.skillKey !== authored.skillKey) fail(path, '效果跨技能或不属于当前游戏');
  const effectPath = planPath(authored.skillKey, `effects.${effect.effectKey}`);
  exactKeys(effect, ['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results', 'createdAt', 'updatedAt'], effectPath);
  if (!Array.isArray(effect.results)) fail(`${effectPath}.results`, '结果必须是数组');
  for (const result of effect.results) {
    const resultPath = `${effectPath}.results.${result.resultKey}`;
    exactKeys(result, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder',
      'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], resultPath);
    if (!isRecord(result.detail)) fail(`${resultPath}.detail`, '结果明细必须是对象');
  }
  return effect;
}

function compileResourceAmount(
  result: Extract<SkillEffectResult, { resultType: 'RESOURCE_CHANGE' }>,
  path: string,
  state: NumericCompileState
): GenericFormulaExpr {
  if (result.target !== 'SOURCE') fail(`${path}.target`, '本期资源变化只接受自身');
  if (result.detail.operation !== 'CONSUME' && result.detail.operation !== 'RESTORE' && result.detail.operation !== 'REFUND') {
    fail(`${path}.detail.operation`, '未支持的资源操作');
  }
  exactKeys(result.detail, ['attributeKey', 'operation'], `${path}.detail`);
  return compileScaled(result.valueRule, `${path}.valueRule`, state);
}

function compileResult(
  result: SkillEffectResult,
  path: string,
  moment: ProcessMomentDefinition,
  state: NumericCompileState,
  initialAbilityKey: string
): OperationDefinition {
  if (result.spellShieldBlockScope !== null || result.resultType === 'SPELL_SHIELD') {
    fail(`${path}.spellShieldBlockScope`, '法术护盾资格不能绕过');
  }
  if (result.lifecycleBehavior !== null) fail(`${path}.lifecycleBehavior`, '本期过程不能丢弃结果生效时点');
  if (result.resultType === 'DAMAGE') {
    if (result.detail.vampQualification !== 'RESOLVED') fail(`${path}.detail.vampQualification`, '尚未核定的伤害不能绕过');
    fail(`${path}.resultType`, '本期过程不能编译伤害结果');
  }
  if (result.resultType === 'RESOURCE_CHANGE') {
    if (moment.momentType === 'PROCESS_FAILURE' && moment.failureReason === null && result.detail.operation === 'REFUND') {
      fail(`${path}.detail.operation`, '失败退款必须明确失败原因');
    }
    const amount = compileResourceAmount(result, path, state);
    return {
      operation: 'resource_change', target: 'source',
      resourceKey: catalogKey(result.detail.attributeKey, `${path}.detail.attributeKey`),
      amount: result.detail.operation === 'CONSUME' ? negate(amount) : amount
    };
  }
  if (result.resultType === 'COOLDOWN_CHANGE') {
    if (result.target !== 'SOURCE') fail(`${path}.target`, '本期冷却变化只接受自身');
    if (result.detail.operation !== 'SET_REMAINING' || result.valueRule === null) {
      fail(`${path}.detail.operation`, '本期冷却变化只接受设置剩余时间');
    }
    exactKeys(result.detail, ['affectedSkillScope', 'operation'], `${path}.detail`);
    const scope = result.detail.affectedSkillScope;
    exactKeys(scope, ['mode', 'skillKeys', 'skillCategoryKeys'], `${path}.detail.affectedSkillScope`);
    if (scope.mode !== 'SKILLS' || scope.skillKeys.length !== 1 || scope.skillKeys[0] !== state.skillKey || scope.skillCategoryKeys.length !== 0) {
      fail(`${path}.detail.affectedSkillScope`, '设置剩余冷却只接受明确的本技能');
    }
    const amount = compileScaled(result.valueRule, `${path}.valueRule`, state);
    const folded = tryFoldConstant(amount);
    if (folded !== null) assertTime(folded, `${path}.valueRule`, 'nonNegative');
    return {
      operation: 'cooldown_change', target: 'source', valuePolicy: 'set_remaining',
      abilityRef: `self.provider[${MOUNT_TOKEN}].ability[${initialAbilityKey}]`,
      amount: folded === null ? amount : constExpr(folded)
    };
  }
  return fail(`${path}.resultType`, '未支持的效果结果');
}

function compileEffectResults(
  effect: SkillEffect,
  moment: ProcessMomentDefinition,
  state: NumericCompileState,
  initialAbilityKey: string,
  skip: ReadonlySet<string>
): OperationDefinition[] {
  const path = planPath(effect.skillKey, `effects.${effect.effectKey}`);
  if (effect.lifecycle !== null) fail(`${path}.lifecycle`, '本期过程不能丢弃效果生命周期');
  if (!effect.results.length) fail(`${path}.results`, '效果没有可执行结果');
  const operations: OperationDefinition[] = [];
  for (const result of stableSorted(effect.results, (item) => item.sortOrder)) {
    if (skip.has(result.resultKey)) continue;
    operations.push(compileResult(result, `${path}.results.${result.resultKey}`, moment, state, initialAbilityKey));
  }
  return operations;
}

type CostPlan = {
  costs: ProcessCostDefinition[];
  resources: Set<string>;
  skipByEffect: Map<string, Set<string>>;
};

function compileCosts(authored: AuthoredProcessProgram, process: SkillProcess, state: NumericCompileState): CostPlan {
  const root = planPath(authored.skillKey, 'castCosts');
  if (!Array.isArray(authored.castCosts)) fail(root, '施放成本必须是显式数组，未声明时使用空数组');
  const costs: ProcessCostDefinition[] = [];
  const resources = new Set<string>();
  const seen = new Set<string>();
  const skipByEffect = new Map<string, Set<string>>();
  authored.castCosts.forEach((ref, index) => {
    const path = `${root}[${index}]`;
    if (!isRecord(ref)) fail(path, '成本引用必须是对象');
    exactKeys(ref, ['bindingKey', 'effectKey', 'resultKey'], path);
    const bindingKey = catalogKey(ref.bindingKey, `${path}.bindingKey`);
    const effectKey = catalogKey(ref.effectKey, `${path}.effectKey`);
    const resultKey = catalogKey(ref.resultKey, `${path}.resultKey`);
    const identity = `${bindingKey}\0${effectKey}\0${resultKey}`;
    if (seen.has(identity)) fail(path, '重复的成本引用');
    seen.add(identity);
    const bindings = process.effectBindings.filter((item) => item.bindingKey === bindingKey);
    if (bindings.length !== 1) fail(path, '成本引用无法定位到唯一效果挂接');
    const binding = bindings[0]!;
    if (binding.effectKey !== effectKey) fail(path, '成本引用的效果与挂接不一致');
    const moment = readMoment(binding.moment, `${path}.moment`);
    assertMomentFits(moment, process.steps, `${path}.moment`);
    if (moment.momentType !== 'PROCESS_START') fail(path, '成本必须指向过程开始');
    const effect = lookupEffect(authored, effectKey, `${path}.effectKey`);
    if (effect.lifecycle !== null) fail(`${path}.effectKey`, '成本效果不能带生命周期');
    const results = effect.results.filter((item) => item.resultKey === resultKey);
    if (results.length !== 1) fail(path, '成本引用的结果缺失或重复');
    const result = results[0]!;
    const resultPath = planPath(authored.skillKey, `effects.${effectKey}.results.${resultKey}`);
    if (result.spellShieldBlockScope !== null) fail(`${resultPath}.spellShieldBlockScope`, '法术护盾资格不能绕过');
    if (result.lifecycleBehavior !== null) fail(`${resultPath}.lifecycleBehavior`, '成本必须是即时结果');
    if (result.resultType !== 'RESOURCE_CHANGE' || result.detail.operation !== 'CONSUME') {
      fail(resultPath, '成本必须是自身即时 RESOURCE_CHANGE/CONSUME，不能凭名称或符号推断');
    }
    const resourceKey = catalogKey(result.detail.attributeKey, `${resultPath}.detail.attributeKey`);
    const amount = compileResourceAmount(result, resultPath, state);
    const folded = tryFoldConstant(amount);
    if (folded !== null && (!Number.isFinite(folded) || folded < 0)) fail(`${resultPath}.valueRule`, '施放成本必须是有限非负数值');
    // 原生逐笔验证后再按资源汇总，不能让正负成本在宿主提前抵消。
    costs.push({ resourceKey, amount });
    resources.add(resourceKey);
    const skipped = skipByEffect.get(effectKey) ?? new Set<string>();
    skipped.add(resultKey);
    skipByEffect.set(effectKey, skipped);
  });
  return {
    costs,
    resources,
    skipByEffect
  };
}

function assertNoReplay(rule: SkillTriggerRuleDetail, path: string): void {
  exactKeys(rule, [
    'ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'conditionGroups', 'actions',
    'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse'
  ], path);
  if (!Array.isArray(rule.conditionGroups)) fail(`${path}.conditionGroups`, '条件组必须是数组');
  if (rule.perTargetCooldown || rule.maxTriggersPerProcess || rule.oncePerUse) fail(`${path}.oncePerUse`, '未支持的重放限制');
}

function assertNoConditions(rule: SkillTriggerRuleDetail, path: string): void {
  if (rule.conditionGroups.length) fail(`${path}.conditionGroups`, '过程控制与过程时点不接受条件');
}

const ATTRIBUTE_COMPARATORS: Record<string, string> = {
  EQ: 'eq', NE: 'ne', LT: 'lt', LTE: 'lte', GT: 'gt', GTE: 'gte'
};

function sourceAttribute(condition: SkillTriggerCondition, path: string, state: NumericCompileState): GenericFormulaExpr {
  exactKeys(condition, ['conditionKey', 'conditionType', 'sortOrder', 'detail'], path);
  catalogKey(condition.conditionKey, `${path}.conditionKey`);
  finiteNumber(condition.sortOrder, `${path}.sortOrder`, fail);
  if (condition.conditionType !== 'ATTRIBUTE_COMPARE') fail(`${path}.conditionType`, '首次效果只接受来源属性比较');
  exactKeys(condition.detail, ['subject', 'attributeKey', 'attributeValueKind', 'comparator', 'comparisonValue'], `${path}.detail`);
  if (condition.detail.subject !== 'SOURCE') fail(`${path}.detail.subject`, '首次效果只接受来源属性');
  const attributeKey = catalogKey(condition.detail.attributeKey, `${path}.detail.attributeKey`);
  const read = (field: string): GenericFormulaExpr => ({ op: 'read', path: `source.attr.${attributeKey}.${field}` });
  const missing: GenericFormulaExpr = { op: 'sub', args: [read('max'), read('current')] };
  let left: GenericFormulaExpr;
  switch (condition.detail.attributeValueKind) {
    case 'BASE': left = read('base'); break;
    case 'TOTAL': left = read('resolved'); break;
    case 'CURRENT': left = read('current'); break;
    case 'BONUS': left = { op: 'sub', args: [read('resolved'), read('base')] }; break;
    case 'MISSING': left = missing; break;
    case 'CURRENT_RATIO': left = { op: 'div', args: [read('current'), read('max')] }; break;
    case 'MISSING_RATIO': left = { op: 'div', args: [missing, read('max')] }; break;
    default: return fail(`${path}.detail.attributeValueKind`, '不支持的属性取值口径');
  }
  const comparator = ATTRIBUTE_COMPARATORS[condition.detail.comparator];
  if (!comparator) fail(`${path}.detail.comparator`, '未知比较运算');
  const rightPath = `${path}.detail.comparisonValue`;
  assertNumericShape(condition.detail.comparisonValue, rightPath);
  const right = compileNumericValue(condition.detail.comparisonValue, rightPath,
    scratchState(state, '条件比较不能使用未供值的计算时输入', false), fail);
  state.requiredAttributes.add(attributeKey);
  return { op: comparator, args: [left, right] };
}

function combine(op: 'min' | 'max', expressions: GenericFormulaExpr[]): GenericFormulaExpr {
  return expressions.reduce((left, right) => ({ op, args: [left, right] }));
}

function firstEffectCondition(rule: SkillTriggerRuleDetail, state: NumericCompileState): GenericFormulaExpr {
  const root = planPath(state.skillKey, `rules.${rule.ruleKey}.conditionGroups`);
  if (!rule.conditionGroups.length) fail(root, '首次效果必须明确来源属性条件');
  const seen = new Set<string>();
  const groups = stableSorted(rule.conditionGroups, (group) => {
    if (!isRecord(group)) fail(root, '条件组必须是对象');
    finiteNumber(group.sortOrder, `${root}.${group.groupKey}.sortOrder`, fail);
    return group.sortOrder;
  }).map((group) => {
    const path = `${root}.${group.groupKey || 'missing'}`;
    exactKeys(group, ['groupKey', 'name', 'sortOrder', 'conditions'], path);
    const key = catalogKey(group.groupKey, `${path}.groupKey`);
    if (typeof group.name !== 'string') fail(`${path}.name`, '条件组名称必须明确');
    if (seen.has(key)) fail(`${path}.groupKey`, '条件组标识重复');
    seen.add(key);
    if (!Array.isArray(group.conditions) || !group.conditions.length) fail(`${path}.conditions`, '条件组必须有来源属性比较');
    const conditionKeys = new Set<string>();
    const conditions = stableSorted(group.conditions, (item) => {
      if (!isRecord(item)) fail(`${path}.conditions`, '条件必须是对象');
      return item.sortOrder;
    }).map((condition) => {
      const conditionPath = `${path}.conditions.${condition.conditionKey || 'missing'}`;
      if (conditionKeys.has(condition.conditionKey)) fail(`${conditionPath}.conditionKey`, '条件标识重复');
      conditionKeys.add(condition.conditionKey);
      return sourceAttribute(condition, conditionPath, state);
    });
    return combine('min', conditions);
  });
  return combine('max', groups);
}

function firstHealOperations(authored: AuthoredProcessProgram, rule: SkillTriggerRuleDetail, state: NumericCompileState): OperationDefinition[] {
  const action = rule.actions[0]!;
  const actionPath = planPath(state.skillKey, `rules.${rule.ruleKey}.actions.${action.actionKey}`);
  if (action.actionType !== 'EXECUTE_EFFECT') fail(actionPath, '首次效果只接受执行效果');
  exactKeys(action.detail, ['effectKey'], `${actionPath}.detail`);
  const effectKey = catalogKey(action.detail.effectKey, `${actionPath}.detail.effectKey`);
  const effect = lookupEffect(authored, effectKey, `${actionPath}.detail.effectKey`);
  const effectPath = planPath(state.skillKey, `effects.${effectKey}`);
  if (effect.lifecycle !== null) fail(`${effectPath}.lifecycle`, '首次自身治疗不能有生命周期');
  if (!effect.results.length) fail(`${effectPath}.results`, '效果没有可执行结果');
  return stableSorted(effect.results, (result) => {
    finiteNumber(result.sortOrder, `${effectPath}.results.${result.resultKey}.sortOrder`, fail);
    return result.sortOrder;
  }).map((result) => {
    const path = `${effectPath}.results.${result.resultKey}`;
    if (result.resultType !== 'DIRECT_HEAL') fail(`${path}.resultType`, '首次效果只接受直接治疗');
    if (result.target !== 'SOURCE') fail(`${path}.target`, '首次效果只接受自身治疗');
    if (result.lifecycleBehavior !== null) fail(`${path}.lifecycleBehavior`, '首次自身治疗不能有结果生命周期');
    if (result.spellShieldBlockScope !== null) fail(`${path}.spellShieldBlockScope`, '首次自身治疗不能有法术护盾资格');
    exactKeys(result.detail, [], `${path}.detail`);
    const inlineState = scratchState(state, '首次自身治疗不能使用未供值的计算时输入', true);
    const amount = compileScaled(result.valueRule, `${path}.valueRule`, inlineState);
    for (const key of inlineState.requiredAttributes) state.requiredAttributes.add(key);
    return { operation: 'heal', target: 'self', amount };
  });
}

function assertIdleAction(action: SkillTriggerAction, path: string): void {
  if (!Array.isArray(action.runtimeInputBindings) || action.runtimeInputBindings.length) {
    fail(`${path}.runtimeInputBindings`, '该动作不能携带动态输入');
  }
  if (!Array.isArray(action.resultModifiers) || action.resultModifiers.length) fail(`${path}.resultModifiers`, '未支持的结果修正');
}

function skillUsedPhase(rule: SkillTriggerRuleDetail, path: string, skillKey: string): 'INITIAL' | 'RECAST' | 'CHARGE_RELEASE' {
  if (rule.eventSource.eventType !== 'SKILL_USED') fail(path, '阶段入口必须是技能使用事件');
  const detail = rule.eventSource.detail;
  if (!isRecord(detail)) fail(`${path}.detail`, '技能使用明细必须是对象');
  exactKeys(detail, ['sourceSkillKey', 'useKind', 'castPhase'], `${path}.detail`);
  if (detail.castPhase == null) fail(`${path}.detail.castPhase`, '缺少施放阶段');
  if (detail.sourceSkillKey == null) fail(`${path}.detail.sourceSkillKey`, '必须明确本技能，不能用空来源表示任意技能');
  if (detail.sourceSkillKey !== skillKey) fail(`${path}.detail.sourceSkillKey`, '跨技能');
  if (detail.useKind !== 'ACTIVE') fail(`${path}.detail.useKind`, '只接受主动使用');
  if (detail.castPhase !== 'INITIAL' && detail.castPhase !== 'RECAST' && detail.castPhase !== 'CHARGE_RELEASE') {
    fail(`${path}.detail.castPhase`, '未知施放阶段');
  }
  return detail.castPhase;
}

type ControlPlan = {
  initial: AdaptedProcessControl;
  advances: AdaptedProcessControl[];
  cancel?: AdaptedProcessControl;
  momentRules: SkillTriggerRuleDetail[];
  firstEffectRules: SkillTriggerRuleDetail[];
};

function compileControls(authored: AuthoredProcessProgram, steps: ProcessStepDefinition[]): ControlPlan {
  const root = planPath(authored.skillKey, 'rules');
  if (!Array.isArray(authored.rules)) fail(root, '规则必须是数组');
  for (const rule of authored.rules) {
    if (!isRecord(rule)) fail(root, '规则必须是对象');
    finiteNumber(rule.sortOrder, `${root}.${rule.ruleKey || 'missing'}.sortOrder`, fail);
  }
  const terminal = steps[steps.length - 1];
  const terminalStep = terminal && (terminal.stepType === 'CHARGE' || terminal.stepType === 'RECAST') ? terminal : undefined;
  let initial: AdaptedProcessControl | undefined;
  const advances: AdaptedProcessControl[] = [];
  let cancel: AdaptedProcessControl | undefined;
  const momentRules: SkillTriggerRuleDetail[] = [];
  const firstEffectRules: SkillTriggerRuleDetail[] = [];
  const seenRules = new Set<string>();
  for (const rule of stableSorted(authored.rules, (item) => item.sortOrder)) {
    const path = `${root}.${rule.ruleKey || 'missing'}`;
    catalogKey(rule.ruleKey, `${path}.ruleKey`);
    if (seenRules.has(rule.ruleKey)) fail(`${path}.ruleKey`, '规则标识重复');
    seenRules.add(rule.ruleKey);
    assertNoReplay(rule, path);
    if (!isRecord(rule.eventSource)) fail(`${path}.eventSource`, '事件来源必须是对象');
    exactKeys(rule.eventSource, ['eventType', 'detail'], `${path}.eventSource`);
    if (!Array.isArray(rule.actions)) fail(`${path}.actions`, '动作必须是数组');
    if (!rule.actions.length) fail(`${path}.actions`, '规则缺少动作');
    const eventType = rule.eventSource.eventType;
    if (eventType === 'CONTROL_RECEIVED' || eventType === 'ENTITY_DIED' || eventType === 'ENTITY_UNTARGETABLE') {
      fail(`${path}.eventSource`, '不能宣称自动控制判定');
    }
    if (eventType === 'PROCESS_MOMENT') {
      assertNoConditions(rule, path);
      const detail = rule.eventSource.detail;
      if (!isRecord(detail)) fail(`${path}.eventSource.detail`, '过程时点明细必须是对象');
      exactKeys(detail, ['processKey', 'moment'], `${path}.eventSource.detail`);
      if (detail.processKey !== authored.process.processKey) fail(`${path}.eventSource.detail.processKey`, '跨过程');
      readMoment(detail.moment as SkillProcessMoment, `${path}.eventSource.detail.moment`);
      for (const action of rule.actions) {
        if (action.actionType !== 'EXECUTE_EFFECT') fail(`${path}.actions.${action.actionKey}`, '过程时点只接受执行效果');
      }
      momentRules.push(rule);
      continue;
    }
    if (rule.actions.length !== 1) fail(`${path}.actions`, '控制规则只接受一个动作');
    const action = rule.actions[0]!;
    const actionPath = `${path}.actions.${action.actionKey || 'missing'}`;
    catalogKey(action.actionKey, `${actionPath}.actionKey`);
    exactKeys(action, ['actionKey', 'name', 'actionType', 'sortOrder', 'targetContext', 'detail', 'runtimeInputBindings', 'resultModifiers'], actionPath);
    assertIdleAction(action, actionPath);
    if (action.actionType === 'FAIL_PROCESS' && action.detail.failureReason === 'SOURCE_DIED') {
      fail(`${actionPath}.detail.failureReason`, '来源死亡由原生在停机前终结');
    }
    if (eventType === 'SKILL_USED' && action.actionType === 'START_PROCESS') {
      assertNoConditions(rule, path);
      if (skillUsedPhase(rule, `${path}.eventSource`, authored.skillKey) !== 'INITIAL') {
        fail(`${path}.eventSource.detail.castPhase`, '首次施放只接受 INITIAL');
      }
      exactKeys(action.detail, ['processKey'], `${actionPath}.detail`);
      if (action.detail.processKey !== authored.process.processKey) fail(`${actionPath}.detail.processKey`, '跨过程');
      if (action.targetContext !== 'CURRENT_TARGET') fail(`${actionPath}.targetContext`, '首次施放必须明确当前目标');
      if (initial) fail(path, '重复首次入口');
      initial = { abilityKey: action.actionKey, action: 'INITIAL' };
      continue;
    }
    if (eventType === 'SKILL_USED' && action.actionType === 'EXECUTE_EFFECT') {
      if (skillUsedPhase(rule, `${path}.eventSource`, authored.skillKey) !== 'INITIAL') {
        fail(`${path}.eventSource.detail.castPhase`, '首次效果只接受 INITIAL');
      }
      if (action.targetContext !== 'CURRENT_TARGET') fail(`${actionPath}.targetContext`, '首次效果必须明确当前目标上下文');
      if (typeof action.name !== 'string') fail(`${actionPath}.name`, '动作名称必须明确');
      finiteNumber(action.sortOrder, `${actionPath}.sortOrder`, fail);
      exactKeys(action.detail, ['effectKey'], `${actionPath}.detail`);
      firstEffectRules.push(rule);
      continue;
    }
    if (eventType === 'SKILL_USED' && action.actionType === 'ADVANCE_PROCESS') {
      assertNoConditions(rule, path);
      const phase = skillUsedPhase(rule, `${path}.eventSource`, authored.skillKey);
      exactKeys(action.detail, ['processKey', 'stepKey'], `${actionPath}.detail`);
      if (action.detail.processKey !== authored.process.processKey) fail(`${actionPath}.detail.processKey`, '跨过程');
      if (action.targetContext !== null) fail(`${actionPath}.targetContext`, '推进不能改写目标');
      if (!terminalStep || action.detail.stepKey !== terminalStep.stepKey) fail(`${actionPath}.detail.stepKey`, '推进步骤与过程末尾阶段不一致');
      const expected = terminalStep.stepType === 'RECAST' ? 'RECAST' : 'CHARGE_RELEASE';
      if (phase !== expected) fail(`${path}.eventSource.detail.castPhase`, '错误阶段');
      if (advances.some((item) => item.stepKey === terminalStep.stepKey)) fail(path, '重复推进入口');
      advances.push({ abilityKey: action.actionKey, action: expected, stepKey: terminalStep.stepKey });
      continue;
    }
    if (eventType === 'PROCESS_CANCEL_REQUESTED' && action.actionType === 'FAIL_PROCESS') {
      assertNoConditions(rule, path);
      const detail = rule.eventSource.detail;
      if (!isRecord(detail)) fail(`${path}.eventSource.detail`, '取消请求明细必须是对象');
      exactKeys(detail, ['processKey'], `${path}.eventSource.detail`);
      if (detail.processKey !== authored.process.processKey) fail(`${path}.eventSource.detail.processKey`, '跨过程');
      exactKeys(action.detail, ['processKey', 'failureReason'], `${actionPath}.detail`);
      if (action.detail.processKey !== authored.process.processKey) fail(`${actionPath}.detail.processKey`, '跨过程');
      if (action.detail.failureReason !== 'ACTIVE_CANCELLED') {
        fail(`${actionPath}.detail.failureReason`, '取消固定为 ACTIVE_CANCELLED，不能伪装其他原因');
      }
      if (action.targetContext !== null) fail(`${actionPath}.targetContext`, '取消不能改写目标');
      if (cancel) fail(path, '重复取消入口');
      cancel = { abilityKey: action.actionKey, action: 'CANCEL', failureReason: 'ACTIVE_CANCELLED' };
      continue;
    }
    if (action.actionType === 'FAIL_PROCESS' && isRecord(action.detail) && action.detail.failureReason === 'ACTIVE_CANCELLED') {
      fail(path, '取消只由已匹配的取消请求生成');
    }
    fail(`${path}.eventSource.eventType`, '未支持的事件或动作，不能静默略过');
  }
  if (!initial) fail(root, '缺少首次施放入口');
  return { initial, advances, cancel, momentRules, firstEffectRules };
}

function momentKey(moment: ProcessMomentDefinition): string {
  return `${moment.momentType}|${moment.stepKey ?? ''}|${moment.failureReason ?? ''}`;
}

function momentOperationsFor(
  authored: AuthoredProcessProgram,
  process: SkillProcess,
  costs: CostPlan,
  controls: ControlPlan,
  state: NumericCompileState
): ProcessDefinition['momentOperations'] {
  const groups: ProcessDefinition['momentOperations'] = [];
  const add = (moment: ProcessMomentDefinition, operations: OperationDefinition[]) => {
    if (!operations.length) return;
    const existing = groups[groups.length - 1];
    if (existing && momentKey(existing.moment) === momentKey(moment)) existing.operations.push(...operations);
    else groups.push({ moment, operations: [...operations] });
  };
  for (const binding of stableSorted(process.effectBindings, (item) => item.sortOrder)) {
    const path = planPath(authored.skillKey, `processes.${process.processKey}.effectBindings.${binding.bindingKey}`);
    exactKeys(binding, ['bindingKey', 'effectKey', 'moment', 'sortOrder'], path);
    const moment = readMoment(binding.moment, `${path}.moment`);
    assertMomentFits(moment, process.steps, `${path}.moment`);
    const effect = lookupEffect(authored, binding.effectKey, `${path}.effectKey`);
    add(moment, compileEffectResults(effect, moment, state, controls.initial.abilityKey, costs.skipByEffect.get(effect.effectKey) ?? new Set()));
  }
  for (const rule of controls.momentRules) {
    const path = planPath(authored.skillKey, `rules.${rule.ruleKey}`);
    if (rule.eventSource.eventType !== 'PROCESS_MOMENT') fail(path, '过程时点缺失');
    const moment = readMoment(rule.eventSource.detail.moment, `${path}.eventSource.detail.moment`);
    assertMomentFits(moment, process.steps, `${path}.eventSource.detail.moment`);
    for (const action of stableSorted(rule.actions, (item) => item.sortOrder)) {
      const actionPath = `${path}.actions.${action.actionKey}`;
      if (action.actionType !== 'EXECUTE_EFFECT') fail(actionPath, '过程时点只接受执行效果');
      exactKeys(action, ['actionKey', 'name', 'actionType', 'sortOrder', 'targetContext', 'detail', 'runtimeInputBindings', 'resultModifiers'], actionPath);
      if (!Array.isArray(action.resultModifiers) || action.resultModifiers.length) fail(`${actionPath}.resultModifiers`, '未支持的结果修正');
      if (!Array.isArray(action.runtimeInputBindings)) fail(`${actionPath}.runtimeInputBindings`, '动态输入绑定必须是数组');
      if (action.targetContext !== 'CURRENT_TARGET') fail(`${actionPath}.targetContext`, '执行效果必须明确当前目标');
      exactKeys(action.detail, ['effectKey'], `${actionPath}.detail`);
      const reads: Record<string, GenericFormulaExpr> = Object.create(null);
      for (const binding of action.runtimeInputBindings) {
        const bindingPath = `${actionPath}.runtimeInputBindings.${binding.bindingKey || 'missing'}`;
        exactKeys(binding, ['bindingKey', 'parameterKey', 'sourceType', 'detail'], bindingPath);
        if (binding.sourceType !== 'SOURCE_CAST_RESOURCE_COST') fail(`${bindingPath}.sourceType`, '本期过程只接受来源施放资源消耗');
        const allowed = moment.momentType === 'PROCESS_COMPLETE' || (moment.momentType === 'PROCESS_FAILURE' && moment.failureReason !== null);
        if (!allowed) fail(bindingPath, '施放成本只能在过程完成或带明确失败原因的失败时点读取');
        exactKeys(binding.detail, ['attributeKey'], `${bindingPath}.detail`);
        const resourceKey = catalogKey(binding.detail.attributeKey, `${bindingPath}.detail.attributeKey`);
        if (!costs.resources.has(resourceKey)) fail(bindingPath, '未绑定或不存在的成本不能补 0');
        const matches = authored.parameters?.filter((item) => item.parameterKey === binding.parameterKey) ?? [];
        if (matches.length !== 1 || matches[0]!.gameId !== authored.gameId || matches[0]!.skillKey !== authored.skillKey
          || matches[0]!.valueMode !== 'RUNTIME_INPUT' || matches[0]!.valueType !== 'DECIMAL') {
          fail(`${bindingPath}.parameterKey`, '施放成本只能绑定本技能已有的计算时十进制参数');
        }
        if (Object.prototype.hasOwnProperty.call(reads, binding.parameterKey)) fail(bindingPath, '同一动作不能重复绑定同一参数');
        reads[binding.parameterKey] = { op: 'read', path: `process.actual_cost.${resourceKey}` };
      }
      const effect = lookupEffect(authored, action.detail.effectKey, `${actionPath}.detail.effectKey`);
      const previous = state.runtimeInputReads;
      const previousNamespace = state.formulaNamespace;
      state.runtimeInputReads = Object.keys(reads).length ? reads : undefined;
      state.formulaNamespace = `${previousNamespace}/rules/${rule.ruleKey}/actions/${action.actionKey}`;
      try {
        add(moment, compileEffectResults(effect, moment, state, controls.initial.abilityKey, costs.skipByEffect.get(effect.effectKey) ?? new Set()));
      } finally {
        state.runtimeInputReads = previous;
        state.formulaNamespace = previousNamespace;
      }
    }
  }
  return groups;
}

function controlAbility(control: AdaptedProcessControl, processKey: string, skillKey: string, params: Record<string, number>): AbilityDefinition {
  return {
    abilityKey: control.abilityKey,
    kind: 'active',
    skillKey,
    processControl: {
      processKey,
      action: control.action,
      ...(control.stepKey ? { stepKey: control.stepKey } : {}),
      ...(control.failureReason ? { failureReason: control.failureReason } : {})
    },
    ...(Object.keys(params).length ? { params: { ...params } } : {})
  };
}

export function adaptProcessProgram(authored: AuthoredProcessProgram): AdaptedProcessProgram {
  if (!isRecord(authored)) fail('adapter.processPlan', '过程程序必须是对象');
  exactKeys(authored, [
    'gameId', 'skillKey', 'skillLevel', 'characterLevel', 'process', 'rules', 'effects',
    'parameters', 'formulas', 'owner', 'castCosts'
  ], 'adapter.processPlan');
  const gameId = catalogKey(authored.gameId, 'gameId');
  const skillKey = catalogKey(authored.skillKey, 'skillKey');
  if (!Number.isInteger(authored.skillLevel) || authored.skillLevel < 1) fail('skillLevel', '本次等级必须明确且有效');
  if (!Number.isInteger(authored.characterLevel) || authored.characterLevel < 1) fail('characterLevel', '本次等级必须明确且有效');
  if (authored.owner !== undefined && authored.owner !== 'source' && authored.owner !== 'target') fail('owner', '过程拥有者只能是 source 或 target');
  if (!Array.isArray(authored.effects)) fail('effects', '效果必须是数组');
  const process = authored.process;
  const processPath = planPath(skillKey, `processes.${process?.processKey ?? 'missing'}`);
  if (!isRecord(process)) fail(processPath, '过程必须是对象');
  exactKeys(process, [
    'gameId', 'skillKey', 'processKey', 'name', 'activationType', 'description', 'sortOrder',
    'cooldown', 'steps', 'effectBindings', 'stateOperations', 'createdAt', 'updatedAt'
  ], processPath);
  if (process.gameId !== gameId || process.skillKey !== skillKey) fail(processPath, '过程跨技能或不属于当前游戏');
  catalogKey(process.processKey, `${processPath}.processKey`);
  if (process.activationType !== 'ACTIVE') fail(`${processPath}.activationType`, '本期只接受单个 ACTIVE 过程');
  if (!Array.isArray(process.stateOperations)) fail(`${processPath}.stateOperations`, '内部状态操作必须是数组');
  if (process.stateOperations.length) fail(`${processPath}.stateOperations`, '本期不编译内部状态操作');
  if (!Array.isArray(process.effectBindings)) fail(`${processPath}.effectBindings`, '效果挂接必须是数组');
  const state = numericState(authored);
  const steps = compileSteps(process, state);
  const controls = compileControls(authored, steps);
  const costs = compileCosts(authored, process, state);
  let cooldown: ProcessDefinition['cooldown'] = null;
  if (process.cooldown !== null) {
    const cooldownPath = `${processPath}.cooldown`;
    if (!isRecord(process.cooldown)) fail(cooldownPath, '普通冷却必须是对象或空');
    exactKeys(process.cooldown, ['durationValue', 'startMoment'], cooldownPath);
    const startMoment = readMoment(process.cooldown.startMoment, `${cooldownPath}.startMoment`);
    assertMomentFits(startMoment, process.steps, `${cooldownPath}.startMoment`);
    cooldown = {
      durationMs: compileTime(process.cooldown.durationValue, `${cooldownPath}.durationValue`, state, 'nonNegative'),
      startMoment
    };
  }
  const controlRows: AdaptedProcessControl[] = [
    controls.initial, ...controls.advances, ...(controls.cancel ? [controls.cancel] : [])
  ];
  const seenAbilities = new Set<string>();
  for (const control of controlRows) {
    if (seenAbilities.has(control.abilityKey)) fail(planPath(skillKey, `abilities.${control.abilityKey}`), '控制能力标识重复');
    seenAbilities.add(control.abilityKey);
  }
  const momentOperations = momentOperationsFor(authored, process, costs, controls, state);
  const firstEffects = controls.firstEffectRules.map((rule): AbilityDefinition => {
    const abilityKey = `listen_${rule.ruleKey}`;
    if (seenAbilities.has(abilityKey)) fail(planPath(skillKey, `rules.${rule.ruleKey}.ruleKey`), '监听能力与控制能力标识重复');
    seenAbilities.add(abilityKey);
    const condition = firstEffectCondition(rule, state);
    const operations = firstHealOperations(authored, rule, state);
    const listenerSpec: ListenerDefinition = {
      listenerKey: rule.ruleKey,
      eventMatcher: { all: ['event/ability_started', INITIAL_CAST_TYPE, 'event/source_owner'] },
      condition, operations
    };
    return { abilityKey, kind: 'passive_listener', listenerSpec };
  });
  const params = { ...state.params };
  const abilities = controlRows.map((control) => ({
    ...controlAbility(control, process.processKey, skillKey, params),
    ...(firstEffects.length && control.action === 'INITIAL' ? { types: [INITIAL_CAST_TYPE] } : {})
  })).concat(firstEffects);
  const providerKey = `process_${skillKey}`;
  return {
    provider: {
      providerKey, kind: 'champion', stableId: providerKey, abilities,
      processes: [{ processKey: process.processKey, skillKey, steps, costs: costs.costs, cooldown, momentOperations }]
    },
    params, formulas: [...state.namedFormulas.values()], requiredAttributes: [...state.requiredAttributes],
    initialAbilityKey: controls.initial.abilityKey, controls: controlRows
  };
}

function rewriteMount(provider: AdaptedProcessProgram['provider'], providerRef: string): void {
  const from = `self.provider[${MOUNT_TOKEN}].ability[`;
  const to = `self.provider[${providerRef}].ability[`;
  for (const process of provider.processes) {
    for (const group of process.momentOperations) {
      for (const operation of group.operations) {
        if (operation.abilityRef?.startsWith(from)) operation.abilityRef = to + operation.abilityRef.slice(from.length);
      }
    }
  }
}

export function withProcessProgram(
  input: CompileRequest,
  binding: ProcessProgramBinding,
  options: { rulesHash: string }
): CompileRequest {
  if (!options.rulesHash.trim() || options.rulesHash === input.rulesHash) fail('rulesHash', '接入规则后必须提供新的配置摘要');
  const owner = binding.authored.owner ?? 'source';
  const providerRef = catalogKey(binding.processProviderKey, 'processProviderKey');
  const adapted = adaptProcessProgram(binding.authored);
  const request = structuredClone(input);
  request.rulesHash = options.rulesHash;
  request.sharedProviders ??= [];
  request.formulas ??= [];
  const definitionKey = `process_${owner}_${providerRef}`;
  const provider = structuredClone(adapted.provider);
  provider.providerKey = definitionKey;
  provider.stableId = definitionKey;
  const hasFirstHealListeners = provider.abilities.some((ability) => ability.kind === 'passive_listener');
  if (hasFirstHealListeners) {
    const boundType = `ability/initial_cast/${owner}/${encodeURIComponent(providerRef)}`;
    for (const ability of provider.abilities) {
      if (ability.types) ability.types = ability.types.map((type) => type === INITIAL_CAST_TYPE ? boundType : type);
      const matcher = ability.listenerSpec?.eventMatcher;
      if (matcher?.all) matcher.all = matcher.all.map((type) => type === INITIAL_CAST_TYPE ? boundType : type);
    }
    for (const [key, domain] of [
      ['ability/basic_attack', 'ability'], ['event/ability_started', 'event'],
      ['event/source_owner', 'event'], [boundType, 'ability']
    ]) {
      const existingType = request.typeCatalog.types.find((item) => item.key === key);
      if (existingType && existingType.domain !== domain) fail(`typeCatalog.types.${key}`, '已有类型目录与过程监听冲突');
      if (!existingType) request.typeCatalog.types.push({ key, domain });
    }
  }
  rewriteMount(provider, providerRef);
  const existing = request.sharedProviders.find((row) => row.providerKey === definitionKey);
  if (existing && !sameJson(existing, provider)) fail(`sharedProviders.${definitionKey}`, 'provider 与现有定义冲突');
  if (!existing) request.sharedProviders.push(provider);
  const actor = request.combatants.find((row) => row.key === owner);
  if (!actor) fail(`combatants.${owner}`, '过程拥有者必须是实际对象');
  const ownedMounts = actor.providers.filter((row) => row.providerRef === providerRef);
  if (hasFirstHealListeners && ownedMounts.length > 1) {
    fail(`combatants.${owner}.providers.${providerRef}`, '首次治疗生成定义只能有一个指定挂载');
  }
  const mounted = ownedMounts[0];
  if (mounted && mounted.definitionRef !== definitionKey) fail(`combatants.${owner}.providers`, '已有挂载指向不同定义');
  if (!mounted) actor.providers.push({ providerRef, definitionRef: definitionKey });
  if (hasFirstHealListeners) {
    let designatedMounts = 0;
    for (const combatant of request.combatants) {
      for (const mount of combatant.providers) {
        if (mount.definitionRef !== definitionKey) continue;
        if (combatant.key !== owner || mount.providerRef !== providerRef) {
          fail(`combatants.${combatant.key}.providers.${mount.providerRef}.definitionRef`, '首次治疗生成定义只能由指定拥有者与挂载引用');
        }
        designatedMounts += 1;
        if (designatedMounts > 1) {
          fail(`combatants.${combatant.key}.providers.${mount.providerRef}.definitionRef`, '首次治疗生成定义的指定挂载不能重复');
        }
      }
    }
  }
  const process = provider.processes[0]!;
  for (const cost of process.costs) {
    const path = `combatants.${owner}.resources.${cost.resourceKey}`;
    const slot = actor.resources[cost.resourceKey];
    if (!slot) fail(path, '施放成本必须有明确资源槽，不能自动补零');
    finiteNumber(slot.current, `${path}.current`, fail);
    finiteNumber(slot.max, `${path}.max`, fail);
  }
  for (const group of process.momentOperations) {
    for (const operation of group.operations) {
      if (operation.operation !== 'resource_change' || !operation.resourceKey) continue;
      const path = `combatants.${owner}.resources.${operation.resourceKey}`;
      const slot = actor.resources[operation.resourceKey];
      if (!slot) fail(path, '资源变化必须有明确资源槽，不能自动创建');
      finiteNumber(slot.current, `${path}.current`, fail);
      finiteNumber(slot.max, `${path}.max`, fail);
    }
  }
  for (const formula of adapted.formulas) {
    const old = request.formulas.find((row) => row.key === formula.key);
    if (old && JSON.stringify(old.expression) !== JSON.stringify(formula.expression)) fail('formulas', '具名公式与现有输入冲突');
    if (!old) request.formulas.push(formula);
  }
  for (const combatant of request.combatants) {
    for (const key of adapted.requiredAttributes) {
      const path = `combatants.${combatant.key}.attributes.${key}`;
      const slot = combatant.attributes[key];
      if (!slot) fail(path, '缺少明确的运行属性，不能自动补零');
      for (const field of ['base', 'current', 'max', 'resolved'] as const) finiteNumber(slot[field], `${path}.${field}`, fail);
    }
  }
  return request;
}

export function processCommandFact(driverEntryKey: string, useRef: string): ProcessCommandFact {
  if (typeof driverEntryKey !== 'string' || !driverEntryKey.trim()) fail('processCommandFacts.driverEntryKey', '需要明确的单次驱动条目');
  catalogKey(useRef, 'processCommandFacts.useRef');
  return { driverEntryKey, useRef };
}

export function explicitProcessInterrupt(input: {
  abilityKey: string;
  skillKey: string;
  processKey: string;
  failureReason: ProcessFailureReason;
}): AbilityDefinition {
  exactKeys(input, ['abilityKey', 'skillKey', 'processKey', 'failureReason'], 'processInterrupt');
  const abilityKey = catalogKey(input.abilityKey, 'abilityKey');
  const skillKey = catalogKey(input.skillKey, 'skillKey');
  const processKey = catalogKey(input.processKey, 'processKey');
  if (input.failureReason !== 'CONTROLLED' && input.failureReason !== 'TARGET_UNTARGETABLE' && input.failureReason !== 'EVENT_ABORTED') {
    fail('failureReason', '中断原因必须是 CONTROLLED、TARGET_UNTARGETABLE 或 EVENT_ABORTED，不能伪装取消或代替来源死亡');
  }
  return {
    abilityKey, kind: 'active', skillKey,
    processControl: { processKey, action: 'INTERRUPT', failureReason: input.failureReason }
  };
}
