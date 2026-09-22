import type { SkillEffectLifecycle, SkillEffectResult, SkillEffectValueRule } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { GameStatus } from '../types/status';
import type { ModifierZone } from '../types/modifierZone';
import type { NumericValue } from '../types/numericValue';
import type {
  CompileRequest, GenericFormulaExpr, ModifierDefinition, NamedFormula,
  OperationDefinition, ProviderDefinition
} from '../types/genericEngine';
import {
  compileNumericValue, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, type NumericCompileState, tryFoldConstant, wrapValueRuleExpression
} from './numericAdapter';

export class PersistentAdaptationError extends NumericAdaptationError {
  constructor(path: string, message: string) {
    super(path, message);
    this.name = 'PersistentAdaptationError';
  }
}

export type AuthoredPersistentResult = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  effectKey: string;
  lifecycle: SkillEffectLifecycle;
  result: SkillEffectResult;
  parameters?: readonly SkillParameter[];
  formulas?: readonly SkillFormula[];
  statuses: ReadonlyArray<Pick<GameStatus, 'statusKey' | 'statusKind' | 'status'>>;
  modifierZones: ReadonlyArray<Pick<ModifierZone, 'modifierZoneKey' | 'domain' | 'calculationMode' | 'status'>>;
  source: 'source' | 'target';
  target: 'source' | 'target';
};

export type AdaptedPersistentResult = {
  provider: ProviderDefinition;
  operation: OperationDefinition;
  params: Record<string, number>;
  formulas: NamedFormula[];
  requiredAttributes: string[];
};

export type PersistentResultBinding = {
  providerKey: string;
  applyProviderKey: string;
  applyAbilityKey: string;
  authored: AuthoredPersistentResult;
};

function fail(path: string, message: string): never {
  throw new PersistentAdaptationError(path, message);
}
const finite = (value: unknown, path: string): number => finiteNumber(value, path, fail);

function catalogKey(value: string, path: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要合法标识');
  return value;
}

function providerId(value: string, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, '需要合法标识');
  return value.trim();
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function numericState(authored: AuthoredPersistentResult, bindParameters: boolean, allowAttributeReads: boolean): NumericCompileState {
  return createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `status/${authored.skillKey}`, bindParameters, allowAttributeReads,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
}

function compileLifecycleNumber(
  value: NumericValue | null,
  path: string,
  authored: AuthoredPersistentResult,
  options: { expected?: number; label: string }
): number {
  if (!value) return fail(path, `${options.label}缺失`);
  const state = numericState(authored, false, false);
  let expr: GenericFormulaExpr;
  try {
    expr = compileNumericValue(value, path, state, fail);
  } catch (error) {
    if (error instanceof NumericAdaptationError && error.message.includes('实时读取')) {
      return fail(path, `未知${options.label}`);
    }
    throw error;
  }
  const folded = tryFoldConstant(expr);
  if (folded === null) return fail(path, `未知${options.label}`);
  if (!Number.isInteger(folded) || folded <= 0) return fail(path, `${options.label}必须是正整数`);
  if (options.expected !== undefined && folded !== options.expected) {
    return fail(path, `${options.label}必须为 ${options.expected}`);
  }
  return folded;
}

function compileDuration(authored: AuthoredPersistentResult, path: string, bindState: NumericCompileState): GenericFormulaExpr {
  const value = authored.lifecycle.durationValue;
  if (!value) return fail(path, '生命周期必须有正整数时长');
  const foldedState = numericState(authored, false, false);
  try {
    const expr = compileNumericValue(value, path, foldedState, fail);
    const folded = tryFoldConstant(expr);
    if (folded === null) return fail(path, '生命周期必须有正整数时长');
    if (!Number.isInteger(folded) || folded <= 0) return fail(path, '生命周期必须是正整数时长');
    return constExpr(folded);
  } catch (error) {
    if (!(error instanceof NumericAdaptationError) || !error.message.includes('实时读取')) throw error;
  }
  return compileNumericValue(value, path, bindState, fail);
}

function assertParentLifecycle(authored: AuthoredPersistentResult, path: string): void {
  const lifecycle = authored.lifecycle;
  if (lifecycle.instanceScope !== 'SOURCE_TARGET') fail(`${path}.instanceScope`, '本期只支持 SOURCE_TARGET');
  if (lifecycle.reapplicationStackMode !== 'KEEP') fail(`${path}.reapplicationStackMode`, '本期只支持 KEEP');
  if (lifecycle.reapplicationDurationMode !== 'REFRESH_ALL') fail(`${path}.reapplicationDurationMode`, '本期只支持 REFRESH_ALL');
  if (lifecycle.expiryMode !== 'ALL_AT_ONCE') fail(`${path}.expiryMode`, '本期只支持 ALL_AT_ONCE');
  if (lifecycle.periodicIntervalValue !== null || lifecycle.firstPeriodicExecution !== null) {
    fail(`${path}.periodicIntervalValue`, '本期不支持周期');
  }
  compileLifecycleNumber(lifecycle.maxStacksValue, `${path}.maxStacksValue`, authored, { expected: 1, label: '层数' });
  compileLifecycleNumber(lifecycle.applicationStacksValue, `${path}.applicationStacksValue`, authored, { expected: 1, label: '层数' });
}

function assertTargetContext(authored: AuthoredPersistentResult, root: string): void {
  if (authored.source !== 'source' || authored.target !== 'target') {
    fail(`${root}.source`, '本期只支持实际来源 source、承受者 target，不能串用目标');
  }
  if (authored.result.target !== 'TARGET') {
    fail(`${root}.results.${authored.result.resultKey}.target`, '本期只支持作用对象 TARGET，不能把公式 TARGET 改指承受者');
  }
}

function assertNoUnsupportedBlock(authored: AuthoredPersistentResult, path: string): void {
  if (authored.result.spellShieldBlockScope !== null) {
    fail(`${path}.spellShieldBlockScope`, '独立持续结果入口没有实际命中判定，必须经命中处理入口执行');
  }
}

function assertPersistentBehavior(
  authored: AuthoredPersistentResult,
  path: string,
  reapplication: ReadonlyArray<string>
): void {
  const behavior = authored.result.lifecycleBehavior;
  if (!behavior || behavior.moment !== 'PERSISTENT') return fail(`${path}.lifecycleBehavior.moment`, '必须持续生效');
  if (behavior.valueReadMode !== 'APPLICATION_SNAPSHOT') return fail(`${path}.lifecycleBehavior.valueReadMode`, '未支持读取模式');
  if (behavior.stackValueMode !== 'SHARED') return fail(`${path}.lifecycleBehavior.stackValueMode`, '本期只支持 shared');
  if (!behavior.reapplicationValueMode || !reapplication.includes(behavior.reapplicationValueMode)) {
    return fail(`${path}.lifecycleBehavior.reapplicationValueMode`, '未支持的重施数值方式');
  }
  if (behavior.periodicExecutionMode !== null) return fail(`${path}.lifecycleBehavior.periodicExecutionMode`, '本期不支持周期');
}

function compileValueRule(
  rule: SkillEffectValueRule,
  path: string,
  state: NumericCompileState
): GenericFormulaExpr {
  return wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.value`, state, fail), rule);
}

function adaptMovementSlow(
  authored: AuthoredPersistentResult,
  providerKey: string,
  root: string,
  resultPath: string
): AdaptedPersistentResult {
  if (authored.result.resultType !== 'STATUS_OPERATION') {
    return fail(`${resultPath}.resultType`, '不是状态操作');
  }
  const result = authored.result;
  const detail = result.detail;
  const status = authored.statuses.filter((item) => item.statusKey === detail.statusKey);
  if (status.length !== 1) return fail(`${resultPath}.detail.statusKey`, '状态目录缺失或重复');
  if (status[0]!.statusKind !== 'MOVEMENT_SLOW') return fail(`${resultPath}.detail.statusKey`, '不是普通移动减速');
  if (detail.operation !== 'APPLY') return fail(`${resultPath}.detail.operation`, '本期只支持 APPLY');
  assertPersistentBehavior(authored, resultPath, ['REPLACE']);
  if (!result.valueRule) return fail(`${resultPath}.valueRule`, '减速强度缺失');
  const bindState = numericState(authored, true, true);
  const duration = compileDuration(authored, `${root}.lifecycle.durationValue`, bindState);
  const strength = compileValueRule(result.valueRule, `${resultPath}.valueRule`, bindState);
  return {
    provider: {
      providerKey, kind: 'status', stableId: providerKey,
      lifecycle: {
        durationMs: duration, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target'
      },
      statusContributions: [{
        resultRef: authored.result.resultKey, statusKey: detail.statusKey,
        statusKind: 'movement_slow', strength
      }]
    },
    operation: { operation: 'apply_provider', target: 'target', providerDefinitionRef: providerKey },
    params: bindState.params, formulas: [...bindState.namedFormulas.values()],
    requiredAttributes: [...bindState.requiredAttributes]
  };
}

function adaptHealingRatioMax(
  authored: AuthoredPersistentResult,
  providerKey: string,
  root: string,
  resultPath: string
): AdaptedPersistentResult {
  if (authored.result.resultType !== 'HEALING_MODIFIER') {
    return fail(`${resultPath}.resultType`, '不是治疗修正');
  }
  const result = authored.result;
  const detail = result.detail;
  const zones = authored.modifierZones.filter((item) => item.modifierZoneKey === detail.modifierZoneKey);
  if (zones.length !== 1) return fail(`${resultPath}.detail.modifierZoneKey`, '乘区目录缺失或重复');
  const zone = zones[0]!;
  if (zone.domain !== 'HEALING' || zone.calculationMode !== 'RATIO_MAX') {
    return fail(`${resultPath}.detail.modifierZoneKey`, '本期只适配真实目录中的比例减少取强乘区，不能按名称推断');
  }
  if (detail.direction !== 'RECEIVED') return fail(`${resultPath}.detail.direction`, '比例减少取强只允许受到治疗方向');
  if (detail.operation !== 'DECREASE') return fail(`${resultPath}.detail.operation`, '比例减少取强只允许降低操作');
  if (detail.healingKind !== 'ANY' && detail.healingKind !== 'DIRECT' && detail.healingKind !== 'VAMP') {
    return fail(`${resultPath}.detail.healingKind`, '治疗种类未知');
  }
  assertPersistentBehavior(authored, resultPath, ['KEEP', 'REPLACE']);
  const foldState = numericState(authored, false, false);
  const positive = compileValueRule(result.valueRule, `${resultPath}.valueRule`, foldState);
  const folded = tryFoldConstant(positive);
  if (folded === null) {
    return fail(`${resultPath}.valueRule`, '不能把依赖施加时属性的 APPLICATION_SNAPSHOT 公式改成治疗时实时读取');
  }
  if (!Number.isFinite(folded) || folded < 0 || folded > 1) {
    return fail(`${resultPath}.valueRule`, '有效减少比例必须有限且位于0到1之间');
  }
  const duration = compileDuration(authored, `${root}.lifecycle.durationValue`, numericState(authored, false, false));
  const modifier: ModifierDefinition = {
    modifierKey: `${authored.result.resultKey}-heal`, kind: 'pipeline', command: 'heal',
    healDirection: 'RECEIVED', healCategory: detail.healingKind as 'ANY' | 'DIRECT' | 'VAMP',
    healGroupKey: zone.modifierZoneKey,
    healGroupCalculationMode: 'ratio_max', valuePolicy: 'add_percent', value: constExpr(-folded)
  };
  return {
    provider: {
      providerKey, kind: 'status', stableId: providerKey,
      lifecycle: {
        durationMs: duration, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target'
      },
      modifiers: [modifier]
    },
    operation: { operation: 'apply_provider', target: 'target', providerDefinitionRef: providerKey },
    params: {}, formulas: [], requiredAttributes: []
  };
}

export function adaptPersistentResult(authored: AuthoredPersistentResult, providerKey: string): AdaptedPersistentResult {
  catalogKey(authored.gameId, 'gameId');
  catalogKey(authored.skillKey, 'skillKey');
  catalogKey(authored.effectKey, 'effectKey');
  providerId(providerKey, 'providerKey');
  catalogKey(authored.result.resultKey, 'resultKey');
  if (!Number.isInteger(authored.skillLevel) || authored.skillLevel < 1) fail('skillLevel', '本次等级必须明确且有效');
  if (!Number.isInteger(authored.characterLevel) || authored.characterLevel < 1) fail('characterLevel', '本次等级必须明确且有效');
  const root = `skills.${authored.skillKey}.effects.${authored.effectKey}`;
  const resultPath = `${root}.results.${authored.result.resultKey}`;
  assertTargetContext(authored, root);
  assertParentLifecycle(authored, `${root}.lifecycle`);
  assertNoUnsupportedBlock(authored, resultPath);
  if (authored.result.resultType === 'STATUS_OPERATION') {
    return adaptMovementSlow(authored, providerKey, root, resultPath);
  }
  if (authored.result.resultType === 'HEALING_MODIFIER') {
    return adaptHealingRatioMax(authored, providerKey, root, resultPath);
  }
  return fail(`${resultPath}.resultType`, '本期只支持普通移动减速施加和受到治疗降低 RATIO_MAX');
}

function noteHealGroupMode(
  modes: Map<string, { mode: string; path: string }>,
  groupKey: string | undefined,
  mode: string | undefined,
  path: string
): void {
  if (!groupKey) return;
  const normalized = mode || 'ratio_add';
  const previous = modes.get(groupKey);
  if (previous && previous.mode !== normalized) {
    fail(`${previous.path}|${path}.healGroupCalculationMode`, 'healGroupKey calculationMode conflict');
  }
  if (!previous) modes.set(groupKey, { mode: normalized, path });
}

export function withPersistentResults(
  input: CompileRequest,
  bindings: readonly PersistentResultBinding[],
  options: { rulesHash: string }
): CompileRequest {
  if (!options.rulesHash.trim() || options.rulesHash === input.rulesHash) fail('rulesHash', '接入规则后必须提供新的配置摘要');
  if (!bindings.length) fail('bindings', '没有选择要适配的完整持续结果');
  if (bindings.some((binding) => binding.authored.gameId !== bindings[0]!.authored.gameId)) {
    fail('bindings', '同一请求不能混用不同游戏的配置');
  }
  const request = structuredClone(input);
  request.rulesHash = options.rulesHash;
  request.sharedProviders ??= [];
  request.formulas ??= [];
  const seenBindings = new Set<string>();
  const healModes = new Map<string, { mode: string; path: string }>();
  for (const provider of request.sharedProviders) {
    for (const [index, modifier] of (provider.modifiers ?? []).entries()) {
      noteHealGroupMode(healModes, modifier.healGroupKey, modifier.healGroupCalculationMode,
        `sharedProviders.${provider.providerKey}.modifiers[${index}]`);
    }
  }
  for (const [index, modifier] of (request.rules.modifiers ?? []).entries()) {
    noteHealGroupMode(healModes, modifier.healGroupKey, modifier.healGroupCalculationMode, `rules.modifiers[${index}]`);
  }
  for (const binding of bindings) {
    providerId(binding.providerKey, 'providerKey');
    providerId(binding.applyProviderKey, 'applyProviderKey');
    providerId(binding.applyAbilityKey, 'applyAbilityKey');
    const bindingKey = `${binding.providerKey}/${binding.applyProviderKey}/${binding.applyAbilityKey}/${binding.authored.result.resultKey}`;
    if (seenBindings.has(bindingKey)) fail('bindings', '同一持续结果重复绑定');
    seenBindings.add(bindingKey);
    if (binding.authored.gameId !== bindings[0]!.authored.gameId) fail('bindings', '同一请求不能混用不同游戏的配置');
    const adapted = adaptPersistentResult(binding.authored, binding.providerKey);
    const existing = request.sharedProviders.find((row) => row.providerKey === binding.providerKey);
    if (existing && !sameJson(existing, adapted.provider)) fail(`sharedProviders.${binding.providerKey}`, 'provider 与现有定义冲突');
    if (!existing) request.sharedProviders.push(adapted.provider);
    for (const [index, modifier] of (adapted.provider.modifiers ?? []).entries()) {
      noteHealGroupMode(healModes, modifier.healGroupKey, modifier.healGroupCalculationMode,
        `sharedProviders.${binding.providerKey}.modifiers[${index}]`);
    }
    const provider = request.sharedProviders.find((row) => row.providerKey === binding.applyProviderKey);
    const ability = provider?.abilities?.find((row) => row.abilityKey === binding.applyAbilityKey);
    if (!ability) return fail('bindings', '绑定必须指向已有施加能力');
    ability.params ??= {};
    for (const [key, value] of Object.entries(adapted.params)) {
      if (key in ability.params && ability.params[key] !== value) fail(`ability.params.${key}`, '参数与现有运行输入冲突');
      ability.params[key] = value;
    }
    ability.operations ??= [];
    if (ability.operations.some((operation) => operation.operation === 'apply_provider'
      && operation.providerDefinitionRef === binding.providerKey
      && operation.target === adapted.operation.target)) {
      fail('bindings', '同一能力重复挂载该供值器');
    }
    ability.operations.push(adapted.operation);
    for (const formula of adapted.formulas) {
      const old = request.formulas.find((row) => row.key === formula.key);
      if (old && JSON.stringify(old.expression) !== JSON.stringify(formula.expression)) fail('formulas', '具名公式与现有输入冲突');
      if (!old) request.formulas.push(formula);
    }
    for (const actor of request.combatants) {
      for (const key of adapted.requiredAttributes) {
        const slot = actor.attributes[key];
        if (!slot) fail(`combatants.${actor.key}.attributes.${key}`, '缺少明确的运行属性，不能自动补零');
        for (const field of ['base', 'current', 'max', 'resolved'] as const) {
          finite(slot[field], `combatants.${actor.key}.attributes.${key}.${field}`);
        }
      }
    }
  }
  return request;
}
