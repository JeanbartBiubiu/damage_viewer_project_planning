import type { GameVampRule } from '../types/gameVamp';
import type { NumericValue } from '../types/numericValue';
import type {
  SkillEffect, SkillEffectResult, SkillEffectValueRule
} from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillProcess, SkillProcessMoment } from '../types/skillProcess';
import type { GameStatus } from '../types/status';
import type { ModifierZone } from '../types/modifierZone';
import type {
  SkillTriggerAction, SkillTriggerCondition, SkillTriggerOncePerUse,
  SkillTriggerPriorResultOutputKind, SkillTriggerRuleDetail
} from '../types/skillTriggerRule';
import type {
  AbilityDefinition, AttackStartFact, CompileRequest, GenericFormulaExpr, GenericVampRule,
  ListenerDefinition, NamedFormula, OncePerUseLimit, OperationDefinition, ProviderDefinition,
  ProviderStateFieldSchema, SkillUseFact, UseTriggerLedgerEntry
} from '../types/genericEngine';
import {
  compileNumericValue, constExpr, createNumericCompileState, finiteNumber,
  NumericAdaptationError, type NumericCompileState, wrapValueRuleExpression
} from './numericAdapter';
import { adaptDamageVamp, type AuthoredVampDamage } from './vampAdapter';
import type { CombatantCategory, CombatantHostility, CombatantIdentityFact } from './hitAdapter';

export class TriggerAdaptationError extends NumericAdaptationError {
  constructor(path: string, message: string) {
    super(path, message);
    this.name = 'TriggerAdaptationError';
  }
}

const COMPARATORS: Record<string, string> = {
  LT: 'lt', LTE: 'lte', EQ: 'eq', NE: 'ne', GTE: 'gte', GT: 'gt'
};
const OUTPUT_KINDS = new Set<SkillTriggerPriorResultOutputKind>([
  'POST_DEFENSE_DAMAGE', 'SHIELD_ABSORBED', 'ACTUAL_HP_LOSS'
]);

export type AuthoredTriggerProgram = {
  gameId: string;
  skillKey: string;
  skillLevel: number;
  characterLevel: number;
  rules: readonly SkillTriggerRuleDetail[];
  processes: readonly SkillProcess[];
  internalStates: readonly SkillInternalState[];
  effects: readonly SkillEffect[];
  parameters?: readonly SkillParameter[];
  formulas?: readonly SkillFormula[];
  statuses: ReadonlyArray<Pick<GameStatus, 'statusKey' | 'statusKind' | 'status'>>;
  modifierZones?: ReadonlyArray<Pick<ModifierZone, 'modifierZoneKey' | 'domain' | 'calculationMode' | 'status'>>;
  identity: { source: CombatantIdentityFact; target: CombatantIdentityFact };
  skillCategoryKeys?: readonly string[];
  vampRules?: readonly GameVampRule[];
  owner?: 'source' | 'target';
};

export type AdaptedTriggerProgram = {
  provider: ProviderDefinition;
  params: Record<string, number>;
  formulas: NamedFormula[];
  requiredAttributes: string[];
  typeEntries: Array<{ key: string; domain: string }>;
  vampRules?: GenericVampRule[];
  abilityTypes: string[];
  combo: 'count_window' | 'empowered';
  oncePerUse?: OncePerUseLimit;
  initialCastAbilityType?: string;
  consumeEvent?: 'event/basic_attack_start' | 'event/basic_attack_hit' | 'event/skill_hit';
};

export type TriggerProgramBinding = {
  triggerProviderKey: string;
  authored: AuthoredTriggerProgram;
  initialCastAbilityKey?: string;
};

type HitListenEvent = 'SKILL_HIT' | 'BASIC_ATTACK_HIT' | 'BASIC_ATTACK_START';

type CountWindowCombo = {
  kind: 'count_window';
  delay: SkillProcess;
  reward: SkillProcess;
  firstRule: SkillTriggerRuleDetail;
  rewardRule: SkillTriggerRuleDetail;
  counter: Extract<SkillInternalState, { stateType: 'COUNTER' }>;
  icd: Extract<SkillInternalState, { stateType: 'INTERNAL_COOLDOWN' }>;
  delayMs: number;
  increment: number;
  eventType: 'SKILL_HIT' | 'BASIC_ATTACK_HIT';
  oncePerUse: OncePerUseLimit;
};

type EmpoweredCombo = {
  kind: 'empowered';
  process: SkillProcess;
  startRule: SkillTriggerRuleDetail;
  consumeRule: SkillTriggerRuleDetail;
  flag: Extract<SkillInternalState, { stateType: 'FLAG' }>;
  icd: Extract<SkillInternalState, { stateType: 'INTERNAL_COOLDOWN' }>;
  windowMs: number;
  consumeMoment: 'ATTACK_START' | 'ATTACK_HIT';
  eventType: 'BASIC_ATTACK_START' | 'BASIC_ATTACK_HIT';
  oncePerUse: OncePerUseLimit;
};

type Combo = CountWindowCombo | EmpoweredCombo;

type CompileCtx = {
  authored: AuthoredTriggerProgram;
  state: NumericCompileState;
  typeEntries: Map<string, string>;
  vampRules?: GenericVampRule[];
  abilityTypes: Set<string>;
  outputRefs: Map<string, string>;
};

function fail(path: string, message: string): never {
  throw new TriggerAdaptationError(path, message);
}
const finite = (value: unknown, path: string): number => finiteNumber(value, path, fail);

function catalogKey(value: string, path: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要合法标识');
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableSorted<T>(items: readonly T[], order: (item: T) => number): T[] {
  return items.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const delta = order(left.item) - order(right.item);
      return delta !== 0 ? delta : left.index - right.index;
    })
    .map((row) => row.item);
}

function combine(op: 'min' | 'max', exprs: GenericFormulaExpr[]): GenericFormulaExpr {
  if (!exprs.length) return constExpr(1);
  return exprs.reduce((left, right) => ({ op, args: [left, right] }));
}

function planPath(skillKey: string, extra: string): string {
  return `adapter.triggerPlan.skills.${skillKey}.${extra}`;
}

function numericState(authored: AuthoredTriggerProgram): NumericCompileState {
  return createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `trigger/${authored.skillKey}`, bindParameters: true, allowAttributeReads: true,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
}

export function initialCastAbilityType(skillKey: string): string {
  return `ability/skill_${catalogKey(skillKey, 'skillKey')}`;
}

function eventTypeKey(eventType: HitListenEvent): string {
  if (eventType === 'SKILL_HIT') return 'event/skill_hit';
  if (eventType === 'BASIC_ATTACK_HIT') return 'event/basic_attack_hit';
  return 'event/basic_attack_start';
}

function onceScope(scope: SkillTriggerOncePerUse['scope'], path: string): OncePerUseLimit['scope'] {
  if (scope === 'SKILL') return 'provider';
  if (scope === 'TARGET') return 'provider_target';
  return fail(path, 'oncePerUse.scope 只能是 SKILL 或 TARGET');
}

function mapOncePerUse(rule: SkillTriggerRuleDetail, skillKey: string): OncePerUseLimit {
  const path = planPath(skillKey, `rules.${rule.ruleKey}.oncePerUse`);
  if (!rule.oncePerUse) return fail(path, '本期同次使用限制必须显式提供 groupKey 与范围');
  const groupKey = catalogKey(rule.oncePerUse.groupKey, `${path}.groupKey`);
  return { groupKey, scope: onceScope(rule.oncePerUse.scope, `${path}.scope`) };
}

function isProcessStart(moment: SkillProcessMoment): boolean {
  return moment.momentType === 'PROCESS_START' && moment.stepKey === null;
}
function isProcessComplete(moment: SkillProcessMoment): boolean {
  return moment.momentType === 'PROCESS_COMPLETE' && moment.stepKey === null;
}
function isStepTimeout(moment: SkillProcessMoment): boolean {
  return moment.momentType === 'STEP_TIMEOUT';
}
function isImmediateMoment(moment: SkillProcessMoment, process: SkillProcess): boolean {
  if (isProcessStart(moment) || isProcessComplete(moment)) return true;
  if (moment.stepKey === null) return false;
  const step = process.steps.find((item) => item.stepKey === moment.stepKey);
  if (!step || step.stepType !== 'IMMEDIATE') return false;
  return moment.momentType === 'STEP_START' || moment.momentType === 'STEP_EXECUTION' || moment.momentType === 'STEP_COMPLETE';
}

function lookupState(authored: AuthoredTriggerProgram, stateKey: string, path: string): SkillInternalState {
  const matches = authored.internalStates.filter((item) => item.stateKey === stateKey);
  if (matches.length !== 1) return fail(path, '内部状态目录缺失或重复');
  const row = matches[0]!;
  if (row.gameId !== authored.gameId || row.skillKey !== authored.skillKey) return fail(path, '内部状态不属于当前游戏和技能');
  return row;
}

function lookupEffect(authored: AuthoredTriggerProgram, effectKey: string, path: string): SkillEffect {
  const matches = authored.effects.filter((item) => item.effectKey === effectKey);
  if (matches.length !== 1) return fail(path, '效果目录缺失或重复');
  const effect = matches[0]!;
  if (effect.gameId !== authored.gameId || effect.skillKey !== authored.skillKey) return fail(path, '效果不属于当前游戏和技能');
  return effect;
}

function foldPositiveInt(value: GenericFormulaExpr, path: string, label: string): number {
  if (value.op !== 'const' || typeof value.value !== 'number' || !Number.isInteger(value.value) || value.value <= 0) {
    return fail(path, `${label}必须是正整数，不能猜测窗口或补默认`);
  }
  return value.value;
}

function foldNumber(value: GenericFormulaExpr, path: string, label: string): number {
  if (value.op !== 'const' || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    return fail(path, `${label}必须是明确有限数值，不能猜测`);
  }
  return value.value;
}

function compileConstNumber(value: NumericValue, path: string, authored: AuthoredTriggerProgram, label: string): number {
  const expr = compileNumericValue(value, path, createNumericCompileState({
    gameId: authored.gameId, skillKey: authored.skillKey, skillLevel: authored.skillLevel,
    characterLevel: authored.characterLevel, parameters: authored.parameters, formulas: authored.formulas,
    formulaNamespace: `trigger/${authored.skillKey}/state`, bindParameters: false, allowAttributeReads: false,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  }), fail);
  return foldNumber(expr, path, label);
}

function assertNoExtraLimits(rule: SkillTriggerRuleDetail, skillKey: string): void {
  const root = planPath(skillKey, `rules.${rule.ruleKey}`);
  if (rule.perTargetCooldown || rule.maxTriggersPerProcess) fail(`${root}.limits`, '未支持的过程限制，按共享契约整体拒绝');
}

function assertUnitAction(action: SkillTriggerAction, path: string): void {
  if (action.resultModifiers.length) fail(`${path}.resultModifiers`, '未支持的结果修正，按共享契约整体拒绝');
  if (action.targetContext !== 'CURRENT_TARGET' && action.targetContext !== null) {
    fail(`${path}.targetContext`, '未支持的目标上下文');
  }
}

function startProcessAction(rule: SkillTriggerRuleDetail, skillKey: string, allowPriorOutput: boolean): Extract<SkillTriggerAction, { actionType: 'START_PROCESS' }> {
  const actions = stableSorted(rule.actions, (item) => item.sortOrder);
  if (actions.length !== 1 || actions[0]!.actionType !== 'START_PROCESS') {
    return fail(planPath(skillKey, `rules.${rule.ruleKey}.actions`), '本期该规则只接受单个 START_PROCESS');
  }
  const action = actions[0]!;
  assertUnitAction(action, planPath(skillKey, `rules.${rule.ruleKey}.actions.${action.actionKey}`));
  if (!allowPriorOutput && action.runtimeInputBindings.length) {
    return fail(planPath(skillKey, `rules.${rule.ruleKey}.actions.${action.actionKey}.runtimeInputBindings`), '未支持的动作依赖，按共享契约整体拒绝');
  }
  for (const binding of action.runtimeInputBindings) {
    if (binding.sourceType !== 'PRIOR_ACTION_RESULT') {
      fail(planPath(skillKey, `rules.${rule.ruleKey}.actions.${action.actionKey}.runtimeInputBindings.${binding.bindingKey}`), '未支持的动态输入，按共享契约整体拒绝');
    }
  }
  return action;
}

function startProcessKey(rule: SkillTriggerRuleDetail, skillKey: string, allowPriorOutput = false): string {
  return startProcessAction(rule, skillKey, allowPriorOutput).detail.processKey;
}

function classifyCountWindow(authored: AuthoredTriggerProgram, delay: SkillProcess, reward: SkillProcess): CountWindowCombo {
  const root = planPath(authored.skillKey, `processes.${delay.processKey}`);
  if (delay.activationType !== 'PASSIVE') fail(`${root}.activationType`, '计数窗口只接受 PASSIVE 过程');
  if (delay.cooldown) fail(`${root}.cooldown`, '窗口过程不能另带普通冷却，冷却须由内部冷却状态表达');
  if (delay.effectBindings.length) fail(`${root}.effectBindings`, 'DELAY 窗口过程不能有其他副作用');
  if (delay.steps.length !== 1 || delay.steps[0]!.stepType !== 'DELAY') {
    fail(`${root}.steps`, '计数窗口只接受单个 DELAY 步骤');
  }
  const delayMs = foldPositiveInt(
    compileNumericValue(delay.steps[0]!.detail.delayValue, `${root}.steps.${delay.steps[0]!.stepKey}.detail.delayValue`, numericState(authored), fail),
    `${root}.steps.${delay.steps[0]!.stepKey}.detail.delayValue`,
    '窗口时长'
  );
  const ops = stableSorted(delay.stateOperations, (item) => item.sortOrder);
  if (ops.length !== 2) fail(`${root}.stateOperations`, 'DELAY 窗口只接受开始增加与完成恢复默认值');
  const increase = ops.find((item) => isProcessStart(item.moment));
  const reset = ops.find((item) => isProcessComplete(item.moment));
  if (!increase || !reset || increase.operation !== 'INCREASE' || reset.operation !== 'SET' || increase.stateKey !== reset.stateKey) {
    fail(`${root}.stateOperations`, 'PROCESS_START 必须增加同一 COUNTER，PROCESS_COMPLETE 必须写回明确默认值');
  }
  const counterState = lookupState(authored, increase.stateKey, `${root}.stateOperations.${increase.operationKey}.stateKey`);
  if (counterState.stateType !== 'COUNTER') fail(`${root}.stateOperations.${increase.operationKey}.stateKey`, '窗口计数必须是 COUNTER');
  const increment = foldNumber(
    compileNumericValue(increase.value, `${root}.stateOperations.${increase.operationKey}.value`, numericState(authored), fail),
    `${root}.stateOperations.${increase.operationKey}.value`,
    '计数增量'
  );
  const resetValue = foldNumber(
    compileNumericValue(reset.value, `${root}.stateOperations.${reset.operationKey}.value`, numericState(authored), fail),
    `${root}.stateOperations.${reset.operationKey}.value`,
    '完成恢复值'
  );
  const initial = compileConstNumber(counterState.detail.initialValue, planPath(authored.skillKey, `internalStates.${counterState.stateKey}.detail.initialValue`), authored, '计数初始值');
  if (resetValue !== initial) fail(`${root}.stateOperations.${reset.operationKey}.value`, '完成恢复值必须等于计数明确默认值');

  const rewardRoot = planPath(authored.skillKey, `processes.${reward.processKey}`);
  if (reward.steps.some((step) => step.stepType !== 'IMMEDIATE')) fail(`${rewardRoot}.steps`, '奖励过程只含 IMMEDIATE 或无等待步骤');
  if (reward.cooldown) fail(`${rewardRoot}.cooldown`, '奖励冷却必须由 INTERNAL_COOLDOWN 状态表达，不能另带普通冷却');
  for (const binding of reward.effectBindings) {
    if (!isImmediateMoment(binding.moment, reward)) fail(`${rewardRoot}.effectBindings.${binding.bindingKey}.moment`, '奖励效果必须在同一即时单元');
  }
  const rewardOps = stableSorted(reward.stateOperations, (item) => item.sortOrder);
  const clear = rewardOps.find((item) => item.operation === 'SET' && item.stateKey === counterState.stateKey);
  const icdOp = rewardOps.find((item) => item.operation === 'START');
  if (!clear || clear.operation !== 'SET' || !icdOp || icdOp.operation !== 'START') {
    fail(`${rewardRoot}.stateOperations`, '奖励单元必须清零计数并启动 INTERNAL_COOLDOWN');
  }
  for (const op of rewardOps) {
    if (!isImmediateMoment(op.moment, reward)) fail(`${rewardRoot}.stateOperations.${op.operationKey}.moment`, '奖励状态操作必须在同一即时单元');
    if (op !== clear && op !== icdOp) fail(`${rewardRoot}.stateOperations.${op.operationKey}`, '未支持的奖励状态操作');
  }
  const icdState = lookupState(authored, icdOp.stateKey, `${rewardRoot}.stateOperations.${icdOp.operationKey}.stateKey`);
  if (icdState.stateType !== 'INTERNAL_COOLDOWN') fail(`${rewardRoot}.stateOperations.${icdOp.operationKey}.stateKey`, '内部冷却必须是 INTERNAL_COOLDOWN');
  foldPositiveInt(
    compileNumericValue(icdState.detail.durationValue, planPath(authored.skillKey, `internalStates.${icdState.stateKey}.detail.durationValue`), numericState(authored), fail),
    planPath(authored.skillKey, `internalStates.${icdState.stateKey}.detail.durationValue`),
    '内部冷却'
  );
  const clearValue = foldNumber(
    compileNumericValue(clear.value, `${rewardRoot}.stateOperations.${clear.operationKey}.value`, numericState(authored), fail),
    `${rewardRoot}.stateOperations.${clear.operationKey}.value`,
    '清零值'
  );
  if (clearValue !== initial) fail(`${rewardRoot}.stateOperations.${clear.operationKey}.value`, '清零必须写回计数明确默认值');

  if (authored.rules.length !== 2) fail(planPath(authored.skillKey, 'rules'), '计数窗口只接受第一击与阈值两条规则');
  const [left, right] = stableSorted([...authored.rules], (item) => item.sortOrder);
  const leftKey = startProcessKey(left!, authored.skillKey, true);
  const rightKey = startProcessKey(right!, authored.skillKey, true);
  let firstRule: SkillTriggerRuleDetail;
  let rewardRule: SkillTriggerRuleDetail;
  if (leftKey === delay.processKey && rightKey === reward.processKey) {
    firstRule = left!; rewardRule = right!;
  } else if (leftKey === reward.processKey && rightKey === delay.processKey) {
    firstRule = right!; rewardRule = left!;
  } else {
    return fail(planPath(authored.skillKey, 'rules'), '两条规则必须分别启动窗口过程与奖励过程');
  }
  assertNoExtraLimits(firstRule, authored.skillKey);
  assertNoExtraLimits(rewardRule, authored.skillKey);
  const eventType = firstRule.eventSource.eventType;
  if (eventType !== 'SKILL_HIT' && eventType !== 'BASIC_ATTACK_HIT') {
    fail(planPath(authored.skillKey, `rules.${firstRule.ruleKey}.eventSource`), '计数窗口只接受技能命中或普通攻击命中');
  }
  if (rewardRule.eventSource.eventType !== eventType) {
    fail(planPath(authored.skillKey, `rules.${rewardRule.ruleKey}.eventSource`), '两规则事件必须相同');
  }
  assertHitIdentity(firstRule, authored, eventType);
  assertHitIdentity(rewardRule, authored, eventType);
  const once = mapOncePerUse(firstRule, authored.skillKey);
  const other = mapOncePerUse(rewardRule, authored.skillKey);
  if (once.groupKey !== other.groupKey || once.scope !== other.scope) {
    fail(planPath(authored.skillKey, `rules.${rewardRule.ruleKey}.oncePerUse`), '同技能共享限制键必须同范围');
  }
  startProcessAction(firstRule, authored.skillKey, false);
  return {
    kind: 'count_window', delay, reward, firstRule, rewardRule, counter: counterState, icd: icdState,
    delayMs, increment, eventType, oncePerUse: once
  };
}

function consumeEvent(moment: 'ATTACK_START' | 'ATTACK_HIT'): 'BASIC_ATTACK_START' | 'BASIC_ATTACK_HIT' {
  return moment === 'ATTACK_START' ? 'BASIC_ATTACK_START' : 'BASIC_ATTACK_HIT';
}

function classifyEmpowered(authored: AuthoredTriggerProgram, process: SkillProcess): EmpoweredCombo {
  const root = planPath(authored.skillKey, `processes.${process.processKey}`);
  if (process.steps.length !== 1 || process.steps[0]!.stepType !== 'EMPOWERED_BASIC_ATTACK') {
    fail(`${root}.steps`, '待击消费只接受单个 EMPOWERED_BASIC_ATTACK 步骤');
  }
  if (process.cooldown) fail(`${root}.cooldown`, '待击冷却必须由 INTERNAL_COOLDOWN 表达');
  const step = process.steps[0]!;
  const windowMs = foldPositiveInt(
    compileNumericValue(step.detail.windowValue, `${root}.steps.${step.stepKey}.detail.windowValue`, numericState(authored), fail),
    `${root}.steps.${step.stepKey}.detail.windowValue`,
    '待击窗口'
  );
  const consumeMoment = step.detail.consumeMoment;
  if (consumeMoment !== 'ATTACK_START' && consumeMoment !== 'ATTACK_HIT') {
    fail(`${root}.steps.${step.stepKey}.detail.consumeMoment`, '消费时点必须明确为 ATTACK_START 或 ATTACK_HIT');
  }
  const startOps = process.stateOperations.filter((item) => isProcessStart(item.moment) || (item.moment.momentType === 'STEP_START' && item.moment.stepKey === step.stepKey));
  const consumeOps = process.stateOperations.filter((item) => item.moment.momentType === 'STEP_EXECUTION' && item.moment.stepKey === step.stepKey);
  const timeoutOps = process.stateOperations.filter((item) => isStepTimeout(item.moment) && item.moment.stepKey === step.stepKey);
  if (process.stateOperations.some((item) => !startOps.includes(item) && !consumeOps.includes(item) && !timeoutOps.includes(item))) {
    fail(`${root}.stateOperations`, '无法从完整过程核定启动、消费或超时操作');
  }
  const enable = startOps.find((item) => item.operation === 'ENABLE');
  if (!enable || startOps.length !== 1) fail(`${root}.stateOperations`, '启动只接受设置待命 FLAG，重复启动或刷新无法核定时拒绝');
  const flagState = lookupState(authored, enable.stateKey, `${root}.stateOperations.${enable.operationKey}.stateKey`);
  if (flagState.stateType !== 'FLAG') fail(`${root}.stateOperations.${enable.operationKey}.stateKey`, '待命必须是 FLAG');
  if (flagState.detail.initialEnabled) fail(planPath(authored.skillKey, `internalStates.${flagState.stateKey}.detail.initialEnabled`), '待命默认必须关闭');
  const disable = consumeOps.find((item) => item.operation === 'DISABLE' && item.stateKey === flagState.stateKey);
  const icdOp = consumeOps.find((item) => item.operation === 'START');
  if (!disable || !icdOp) fail(`${root}.stateOperations`, '消费单元必须清除待命并按作者时点启动内部冷却');
  for (const op of consumeOps) {
    if (op !== disable && op !== icdOp) fail(`${root}.stateOperations.${op.operationKey}`, '未支持的消费状态操作');
  }
  const icdState = lookupState(authored, icdOp.stateKey, `${root}.stateOperations.${icdOp.operationKey}.stateKey`);
  if (icdState.stateType !== 'INTERNAL_COOLDOWN') fail(`${root}.stateOperations.${icdOp.operationKey}.stateKey`, '内部冷却必须是 INTERNAL_COOLDOWN');
  foldPositiveInt(
    compileNumericValue(icdState.detail.durationValue, planPath(authored.skillKey, `internalStates.${icdState.stateKey}.detail.durationValue`), numericState(authored), fail),
    planPath(authored.skillKey, `internalStates.${icdState.stateKey}.detail.durationValue`),
    '内部冷却'
  );
  for (const op of timeoutOps) {
    if (op.operation !== 'DISABLE' || op.stateKey !== flagState.stateKey) {
      fail(`${root}.stateOperations.${op.operationKey}`, '过程超时只结束待命，不能自动消费或启动冷却');
    }
  }
  for (const binding of process.effectBindings) {
    if (binding.moment.momentType !== 'STEP_EXECUTION' || binding.moment.stepKey !== step.stepKey) {
      fail(`${root}.effectBindings.${binding.bindingKey}.moment`, '绑定效果必须挂在明确消费时点');
    }
  }
  if (authored.rules.length !== 2) fail(planPath(authored.skillKey, 'rules'), '待击消费只接受启动规则与消费规则');
  const expectedConsume = consumeEvent(consumeMoment);
  const startRule = authored.rules.find((rule) => rule.eventSource.eventType === 'SKILL_USED');
  const consumeRule = authored.rules.find((rule) => rule.eventSource.eventType === expectedConsume);
  if (!startRule || !consumeRule) {
    fail(planPath(authored.skillKey, 'rules'), 'ATTACK_START 与 ATTACK_HIT 必须保持各自时点，启动只接已核定 INITIAL');
  }
  if (startProcessKey(startRule, authored.skillKey) !== process.processKey) {
    fail(planPath(authored.skillKey, `rules.${startRule.ruleKey}.actions`), '启动规则必须启动该待击过程');
  }
  assertInitialCast(startRule, authored);
  assertNoExtraLimits(startRule, authored.skillKey);
  assertNoExtraLimits(consumeRule, authored.skillKey);
  if (consumeRule.eventSource.eventType !== expectedConsume) {
    fail(planPath(authored.skillKey, `rules.${consumeRule.ruleKey}.eventSource`), '消费事件必须与过程消费时点一致，不能互换');
  }
  const consumeActions = stableSorted(consumeRule.actions, (item) => item.sortOrder);
  const boundKeys = stableSorted(process.effectBindings, (item) => item.sortOrder).map((item) => item.effectKey);
  const actionKeys = consumeActions.map((item) => {
    if (item.actionType !== 'EXECUTE_EFFECT') fail(planPath(authored.skillKey, `rules.${consumeRule.ruleKey}.actions.${item.actionKey}`), '消费规则只接受执行绑定效果');
    assertUnitAction(item, planPath(authored.skillKey, `rules.${consumeRule.ruleKey}.actions.${item.actionKey}`));
    return item.detail.effectKey;
  });
  if (!sameJson(actionKeys, boundKeys)) {
    fail(planPath(authored.skillKey, `rules.${consumeRule.ruleKey}.actions`), '消费规则必须按顺序执行过程绑定的全部效果，不能截取');
  }
  const once = mapOncePerUse(consumeRule, authored.skillKey);
  if (startRule.oncePerUse) fail(planPath(authored.skillKey, `rules.${startRule.ruleKey}.oncePerUse`), '普通初次启动不是 oncePerUse 事件');
  return {
    kind: 'empowered', process, startRule, consumeRule, flag: flagState, icd: icdState,
    windowMs, consumeMoment, eventType: expectedConsume, oncePerUse: once
  };
}

function assertHitIdentity(rule: SkillTriggerRuleDetail, authored: AuthoredTriggerProgram, eventType: HitListenEvent): void {
  const path = planPath(authored.skillKey, `rules.${rule.ruleKey}.eventSource`);
  if (eventType === 'SKILL_HIT') {
    if (rule.eventSource.eventType !== 'SKILL_HIT') fail(path, '事件类型不符');
    if (rule.eventSource.detail.sourceSkillKey) {
      fail(`${path}.detail.sourceSkillKey`, 'native 不能按来源技能过滤 skill_hit，指定技能身份不能静默略过');
    }
    return;
  }
  if (rule.eventSource.eventType !== eventType) fail(path, '事件类型不符');
}

function assertInitialCast(rule: SkillTriggerRuleDetail, authored: AuthoredTriggerProgram): void {
  const path = planPath(authored.skillKey, `rules.${rule.ruleKey}.eventSource`);
  if (rule.eventSource.eventType !== 'SKILL_USED') fail(path, '普通初次启动只接 SKILL_USED');
  const detail = rule.eventSource.detail;
  if (detail.sourceSkillKey !== authored.skillKey) {
    fail(`${path}.detail.sourceSkillKey`, '必须校验完整来源技能，缺值或其它技能不能静默略过');
  }
  if (detail.useKind !== 'ACTIVE') fail(`${path}.detail.useKind`, '普通初次启动只接受 ACTIVE，不能把消耗或任意使用当首次');
  if (detail.castPhase !== 'INITIAL') fail(`${path}.detail.castPhase`, '只接入已核定 INITIAL，不能从重施或蓄力猜测');
}

function classifyTriggerProgram(authored: AuthoredTriggerProgram): Combo {
  for (const process of authored.processes) {
    if (process.gameId !== authored.gameId || process.skillKey !== authored.skillKey) {
      fail(planPath(authored.skillKey, `processes.${process.processKey}`), '过程不属于当前游戏和技能');
    }
  }
  const empowered = authored.processes.filter((item) => item.steps.some((step) => step.stepType === 'EMPOWERED_BASIC_ATTACK'));
  const delay = authored.processes.filter((item) => item.activationType === 'PASSIVE' && item.steps.length === 1 && item.steps[0]?.stepType === 'DELAY');
  if (empowered.length === 1 && authored.processes.length === 1) return classifyEmpowered(authored, empowered[0]!);
  if (delay.length === 1 && authored.processes.length === 2) {
    const reward = authored.processes.find((item) => item.processKey !== delay[0]!.processKey)!;
    return classifyCountWindow(authored, delay[0]!, reward);
  }
  return fail(planPath(authored.skillKey, 'processes'), '只完整转换 PASSIVE 单 DELAY 计数窗口或单 EMPOWERED_BASIC_ATTACK 待击消费，其它过程整条拒绝');
}

function stateReadPath(state: SkillInternalState): string {
  return state.scope === 'TARGET' ? `provider.target_state.${state.stateKey}` : `provider.state.${state.stateKey}`;
}

function stateScopeType(state: SkillInternalState): string {
  return state.scope === 'TARGET' ? 'state_scope/provider_target' : 'state_scope/provider';
}

function compareExpr(op: string, left: GenericFormulaExpr, right: GenericFormulaExpr): GenericFormulaExpr {
  return { op, args: [left, right] };
}

function attributeRead(
  subject: 'SOURCE' | 'CURRENT_TARGET' | 'EVENT_SOURCE',
  attributeKey: string,
  kind: string,
  path: string,
  ctx: CompileCtx
): GenericFormulaExpr {
  catalogKey(attributeKey, `${path}.attributeKey`);
  ctx.state.requiredAttributes.add(attributeKey);
  const owner = subject === 'CURRENT_TARGET' ? 'target' : subject === 'EVENT_SOURCE' ? 'event.source' : 'source';
  const read = (field: string): GenericFormulaExpr => ({ op: 'read', path: `${owner}.attr.${attributeKey}.${field}` });
  const missing: GenericFormulaExpr = { op: 'sub', args: [read('max'), read('current')] };
  switch (kind) {
    case 'BASE': return read('base');
    case 'TOTAL': return read('resolved');
    case 'CURRENT': return read('current');
    case 'BONUS': return { op: 'sub', args: [read('resolved'), read('base')] };
    case 'MISSING': return missing;
    case 'CURRENT_RATIO': return { op: 'div', args: [read('current'), read('max')] };
    case 'MISSING_RATIO': return { op: 'div', args: [missing, read('max')] };
    default: return fail(`${path}.attributeValueKind`, '不支持的属性取值口径');
  }
}

function compileCondition(
  condition: SkillTriggerCondition,
  path: string,
  authored: AuthoredTriggerProgram,
  eventType: HitListenEvent | 'SKILL_USED',
  ctx: CompileCtx
): GenericFormulaExpr {
  if (condition.conditionType === 'INTERNAL_STATE_CHECK') {
    const state = lookupState(authored, condition.detail.stateKey, `${path}.detail.stateKey`);
    const read: GenericFormulaExpr = { op: 'read', path: stateReadPath(state) };
    if (condition.detail.valueKind === 'VALUE') {
      const comparator = COMPARATORS[condition.detail.comparator];
      if (!comparator) fail(`${path}.detail.comparator`, '未知比较运算');
      const right = compileNumericValue(condition.detail.comparisonValue, `${path}.detail.comparisonValue`, ctx.state, fail);
      return compareExpr(comparator, read, right);
    }
    if (condition.detail.valueKind === 'ENABLED') {
      if (state.stateType !== 'FLAG') fail(`${path}.detail.stateKey`, 'ENABLED 只用于 FLAG');
      return compareExpr('eq', read, constExpr(condition.detail.expectedBoolean ? 1 : 0));
    }
    return fail(`${path}.detail.valueKind`, '未支持的内部状态条件，按共享契约整体拒绝');
  }
  if (condition.conditionType === 'ATTRIBUTE_COMPARE') {
    const comparator = COMPARATORS[condition.detail.comparator];
    if (!comparator) fail(`${path}.detail.comparator`, '未知比较运算');
    const left = attributeRead(condition.detail.subject, condition.detail.attributeKey, condition.detail.attributeValueKind, `${path}.detail`, ctx);
    const right = compileNumericValue(condition.detail.comparisonValue, `${path}.detail.comparisonValue`, ctx.state, fail);
    return compareExpr(comparator, left, right);
  }
  if (condition.conditionType === 'EVENT_VALUE_COMPARE') {
    if (condition.detail.eventValueKey === 'SKILL_HIT_FIRST_CONTACT') {
      return fail(`${path}.detail.eventValueKey`, '本期监听适配不承接首次接触比较');
    }
    if (condition.detail.eventValueKey !== 'SKILL_HIT_SPELL_SHIELD_BLOCKED') {
      return fail(`${path}.detail.eventValueKey`, '未支持的事件值条件');
    }
    if (eventType !== 'SKILL_HIT') {
      return fail(`${path}.detail.eventValueKey`, 'blocked 仅普通 skill_hit 允许');
    }
    const comparator = COMPARATORS[condition.detail.comparator];
    if (!comparator) fail(`${path}.detail.comparator`, '未知比较运算');
    const right = compileNumericValue(condition.detail.comparisonValue, `${path}.detail.comparisonValue`, ctx.state, fail);
    return compareExpr(comparator, { op: 'read', path: 'event.skill_hit.blocked' }, right);
  }
  if (condition.conditionType === 'TARGET_CATEGORY_CHECK') {
    const category = authored.identity.target.category as CombatantCategory | undefined;
    if (!category) return fail(path, '目录身份及真实类别需显式事实，未知不补英雄默认');
    return constExpr(condition.detail.categories.includes(category) ? 1 : 0);
  }
  if (condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY') {
    const hostility = authored.identity.target.hostility as CombatantHostility | undefined;
    if (!hostility) return fail(path, '目录身份及真实敌我需显式事实，未知不补敌方默认');
    return constExpr(hostility === 'ENEMY' ? 1 : 0);
  }
  return fail(path, '未支持的过程、动作依赖、来源、目标或条件，按共享契约整体拒绝');
}

function compileListenerCondition(
  rule: SkillTriggerRuleDetail,
  eventType: HitListenEvent | 'SKILL_USED',
  ctx: CompileCtx
): GenericFormulaExpr | undefined {
  const root = planPath(ctx.authored.skillKey, `rules.${rule.ruleKey}`);
  const groups = stableSorted(rule.conditionGroups, (group) => group.sortOrder);
  if (!groups.length) return undefined;
  const compiled = groups.map((group) => {
    const conditions = stableSorted(group.conditions, (item) => item.sortOrder).map((condition) => (
      compileCondition(condition, `${root}.conditionGroups.${group.groupKey}.conditions.${condition.conditionKey}`, ctx.authored, eventType, ctx)
    ));
    return combine('min', conditions);
  });
  const expr = combine('max', compiled);
  if (sameJson(expr, constExpr(1))) return undefined;
  return expr;
}

function outputKey(actionKey: string, resultKey: string, path: string, ctx: CompileCtx): string {
  const ref = `${actionKey}_${resultKey}`;
  if (ref.includes('.') || ref.length > 64) fail(path, 'outputRef 必须是无点且唯一的稳定动作/结果键');
  if (ctx.outputRefs.has(ref)) fail(path, 'outputRef 碰撞，拒绝合并');
  ctx.outputRefs.set(ref, `${actionKey}.${resultKey}`);
  return ref;
}

function priorOutputExpr(
  action: SkillTriggerAction,
  path: string,
  ctx: CompileCtx
): Map<string, GenericFormulaExpr> {
  const out = new Map<string, GenericFormulaExpr>();
  for (const binding of action.runtimeInputBindings) {
    if (binding.sourceType !== 'PRIOR_ACTION_RESULT') {
      fail(`${path}.runtimeInputBindings.${binding.bindingKey}`, '未支持的动态输入，按共享契约整体拒绝');
    }
    if (!OUTPUT_KINDS.has(binding.detail.outputKind)) {
      fail(`${path}.runtimeInputBindings.${binding.bindingKey}.outputKind`, '未知伤害口径，三种输出口径必须使用同执行帧 operation.output');
    }
    const ref = `${binding.detail.sourceActionKey}_${binding.detail.sourceResultKey}`;
    if (ref.includes('.') || !ctx.outputRefs.has(ref)) {
      continue;
    }
    out.set(binding.parameterKey, { op: 'read', path: `operation.output.${ref}.${binding.detail.outputKind}` });
  }
  return out;
}

function compileBoundValue(
  rule: SkillEffectValueRule,
  path: string,
  ctx: CompileCtx,
  bindings: Map<string, GenericFormulaExpr>
): GenericFormulaExpr {
  if (rule.value.kind === 'PARAMETER' && bindings.has(rule.value.parameterKey)) {
    return wrapValueRuleExpression(bindings.get(rule.value.parameterKey)!, rule);
  }
  if (rule.value.kind === 'FORMULA' && [...bindings.keys()].length) {
    return fail(path, '前序结果绑定本期只接受直接参数，不能把动态公式当已供值');
  }
  return wrapValueRuleExpression(compileNumericValue(rule.value, `${path}.value`, ctx.state, fail), rule);
}

function compileDamage(
  result: Extract<SkillEffectResult, { resultType: 'DAMAGE' }>,
  path: string,
  ctx: CompileCtx,
  expectedDelivery: 'SKILL' | 'BASIC_ATTACK',
  outputRef?: string
): OperationDefinition {
  if (result.target !== 'TARGET') fail(`${path}.target`, '本期伤害只支持作用对象 TARGET');
  if (result.lifecycleBehavior?.moment === 'PERSISTENT') fail(`${path}.lifecycleBehavior`, 'DAMAGE moment must be INSTANT');
  if (result.detail.deliveryKind !== expectedDelivery) {
    fail(`${path}.detail.deliveryKind`, '伤害产生方式必须与事件身份一致，不能把普攻与技能口径混用');
  }
  if (result.detail.originKind !== 'DIRECT') fail(`${path}.detail.originKind`, '未支持的来源性质');
  if (result.detail.critical.mode !== 'DISALLOWED') fail(`${path}.detail.critical`, '未支持的暴击策略');
  const damageType = `damage/${catalogKey(result.detail.damageTypeKey, `${path}.detail.damageTypeKey`)}`;
  ctx.typeEntries.set(damageType, 'damage');
  if (result.detail.vampQualification === 'UNRESOLVED') fail(`${path}.detail.vampQualification`, '吸血资格尚未核定，不能运行');
  if (result.detail.vampQualification !== 'RESOLVED') fail(`${path}.detail.vampQualification`, '未知吸血资格');
  if (!ctx.authored.vampRules?.length) fail(`${path}.detail.vampQualification`, '已核定伤害缺少吸血规则，不能冒充完整正式伤害');
  const damage: AuthoredVampDamage = {
    gameId: ctx.authored.gameId, skillKey: ctx.authored.skillKey,
    skillCategoryKeys: [...(ctx.authored.skillCategoryKeys ?? [])],
    skillLevel: ctx.authored.skillLevel, characterLevel: ctx.authored.characterLevel, detail: result.detail,
    parameters: ctx.authored.parameters ? [...ctx.authored.parameters] : undefined,
    formulas: ctx.authored.formulas ? [...ctx.authored.formulas] : undefined
  };
  const adapted = adaptDamageVamp(ctx.authored.vampRules, damage);
  if (ctx.vampRules && !sameJson(ctx.vampRules, adapted.rules)) fail(path, '同一计划的游戏吸血规则不一致');
  ctx.vampRules = adapted.rules;
  for (const key of adapted.abilityTypes) ctx.abilityTypes.add(key);
  for (const [key, value] of Object.entries(adapted.params)) {
    if (key in ctx.state.params && ctx.state.params[key] !== value) fail(`${path}.params.${key}`, '参数与现有运行输入冲突');
    ctx.state.params[key] = value;
  }
  for (const formula of adapted.formulas) ctx.state.namedFormulas.set(formula.key, formula);
  for (const key of adapted.requiredAttributes) ctx.state.requiredAttributes.add(key);
  for (const entry of adapted.typeEntries) ctx.typeEntries.set(entry.key, entry.domain);
  return {
    operation: 'damage', target: 'target', damageType,
    amount: compileBoundValue(result.valueRule, `${path}.valueRule`, ctx, new Map()),
    ref: result.resultKey, critEligible: false, ...adapted.operation,
    ...(outputRef ? { outputRef } : {})
  };
}

function selectorFor(target: 'SOURCE' | 'TARGET' | 'SELF'): 'source' | 'target' | 'self' {
  if (target === 'SOURCE') return 'source';
  if (target === 'TARGET') return 'target';
  return 'self';
}

function compileResult(
  result: SkillEffectResult,
  path: string,
  ctx: CompileCtx,
  expectedDelivery: 'SKILL' | 'BASIC_ATTACK',
  bindings: Map<string, GenericFormulaExpr>,
  outputRef?: string
): OperationDefinition {
  if (result.resultType === 'DAMAGE') return compileDamage(result, path, ctx, expectedDelivery, outputRef);
  if (result.resultType === 'RESOURCE_CHANGE') {
    if (result.detail.operation !== 'RESTORE') fail(`${path}.detail.operation`, '本期资源变化只接受 RESTORE');
    return {
      operation: 'resource_change', target: selectorFor(result.target === 'SOURCE' ? 'SOURCE' : result.target),
      resourceKey: catalogKey(result.detail.attributeKey, `${path}.detail.attributeKey`),
      amount: compileBoundValue(result.valueRule, `${path}.valueRule`, ctx, bindings)
    };
  }
  if (result.resultType === 'ATTRIBUTE_CHANGE') {
    if (result.detail.modifierZoneKey !== null) fail(`${path}.detail.modifierZoneKey`, '本期属性增减不支持乘区，不能忽略配置');
    if (result.detail.operation !== 'INCREASE' && result.detail.operation !== 'DECREASE') fail(`${path}.detail.operation`, '未支持的属性操作');
    const amount = compileBoundValue(result.valueRule, `${path}.valueRule`, ctx, bindings);
    return {
      operation: 'attribute_change', target: selectorFor(result.target),
      attributeKey: catalogKey(result.detail.attributeKey, `${path}.detail.attributeKey`),
      valuePolicy: 'add',
      amount: result.detail.operation === 'DECREASE' ? { op: 'mul', args: [amount, constExpr(-1)] } : amount
    };
  }
  if (result.resultType === 'DIRECT_HEAL') {
    if (result.target !== 'SOURCE') fail(`${path}.target`, 'DIRECT_HEAL 只有 SOURCE 可译 self');
    return { operation: 'heal', target: 'self', amount: compileBoundValue(result.valueRule, `${path}.valueRule`, ctx, bindings) };
  }
  return fail(`${path}.resultType`, '未支持的效果结果，按共享契约整体拒绝');
}

function assertPriorOutputsResolved(actions: readonly SkillTriggerAction[], path: string, ctx: CompileCtx): void {
  for (const action of actions) {
    for (const binding of action.runtimeInputBindings) {
      if (binding.sourceType !== 'PRIOR_ACTION_RESULT') continue;
      const ref = `${binding.detail.sourceActionKey}_${binding.detail.sourceResultKey}`;
      if (!ctx.outputRefs.has(ref)) {
        fail(`${path}.runtimeInputBindings.${binding.bindingKey}`, '前序伤害输出不能前向引用、缺来源或带点');
      }
    }
  }
}

function neededDamageOutputs(actions: readonly SkillTriggerAction[]): Set<string> {
  const needed = new Set<string>();
  for (const action of actions) {
    for (const binding of action.runtimeInputBindings) {
      if (binding.sourceType === 'PRIOR_ACTION_RESULT') {
        needed.add(`${binding.detail.sourceActionKey}_${binding.detail.sourceResultKey}`);
      }
    }
  }
  return needed;
}

function compileEffectAction(
  action: Extract<SkillTriggerAction, { actionType: 'EXECUTE_EFFECT' }>,
  path: string,
  ctx: CompileCtx,
  expectedDelivery: 'SKILL' | 'BASIC_ATTACK',
  neededOutputs: Set<string>
): OperationDefinition[] {
  const effect = lookupEffect(ctx.authored, action.detail.effectKey, `${path}.detail.effectKey`);
  const operations: OperationDefinition[] = [];
  for (const result of stableSorted(effect.results, (item) => item.sortOrder)) {
    const resultPath = planPath(ctx.authored.skillKey, `effects.${effect.effectKey}.results.${result.resultKey}`);
    const ref = `${action.actionKey}_${result.resultKey}`;
    const outputRef = result.resultType === 'DAMAGE' && neededOutputs.has(ref)
      ? outputKey(action.actionKey, result.resultKey, resultPath, ctx)
      : undefined;
    const bindings = priorOutputExpr(action, path, ctx);
    operations.push(compileResult(result, resultPath, ctx, expectedDelivery, bindings, outputRef));
  }
  if (!operations.length) fail(path, '效果没有可执行结果');
  return operations;
}

function stateChange(state: SkillInternalState, policy: 'add' | 'set', amount: number): OperationDefinition {
  return {
    operation: 'state_change', target: 'source', ref: state.stateKey, valuePolicy: policy,
    types: [stateScopeType(state)], amount: constExpr(amount)
  };
}

function deliveryFor(eventType: HitListenEvent): 'SKILL' | 'BASIC_ATTACK' {
  return eventType === 'SKILL_HIT' ? 'SKILL' : 'BASIC_ATTACK';
}

function compileCountWindow(combo: CountWindowCombo, ctx: CompileCtx): { abilities: AbilityDefinition[]; schema: Record<string, ProviderStateFieldSchema> } {
  const firstCondition = compileListenerCondition(combo.firstRule, combo.eventType, ctx);
  const rewardCondition = compileListenerCondition(combo.rewardRule, combo.eventType, ctx);
  const matcher = { all: [eventTypeKey(combo.eventType), 'event/source_owner'] };
  ctx.typeEntries.set(eventTypeKey(combo.eventType), 'event');
  ctx.typeEntries.set('event/source_owner', 'event');
  if (combo.eventType !== 'SKILL_HIT') ctx.typeEntries.set('ability/basic_attack', 'ability');
  ctx.typeEntries.set(stateScopeType(combo.counter), 'state_scope');
  ctx.typeEntries.set(stateScopeType(combo.icd), 'state_scope');
  const firstOps = [stateChange(combo.counter, 'add', combo.increment)];
  const rewardStart = startProcessAction(combo.rewardRule, ctx.authored.skillKey, true);
  const needed = neededDamageOutputs([rewardStart, ...combo.rewardRule.actions]);
  const rewardOps: OperationDefinition[] = [];
  const scheduled: Array<{ sortOrder: number; ops: OperationDefinition[] }> = [];
  for (const binding of stableSorted(combo.reward.effectBindings, (item) => item.sortOrder)) {
    const action: Extract<SkillTriggerAction, { actionType: 'EXECUTE_EFFECT' }> = {
      actionKey: binding.bindingKey, name: binding.bindingKey, actionType: 'EXECUTE_EFFECT', sortOrder: binding.sortOrder,
      targetContext: 'CURRENT_TARGET', detail: { effectKey: binding.effectKey }, runtimeInputBindings: [], resultModifiers: []
    };
    action.runtimeInputBindings = [...rewardStart.runtimeInputBindings];
    scheduled.push({
      sortOrder: binding.sortOrder,
      ops: compileEffectAction(action, planPath(ctx.authored.skillKey, `processes.${combo.reward.processKey}.effectBindings.${binding.bindingKey}`), ctx, deliveryFor(combo.eventType), needed)
    });
  }
  for (const op of stableSorted(combo.reward.stateOperations, (item) => item.sortOrder)) {
    if (op.operation === 'SET' && op.stateKey === combo.counter.stateKey) {
      const initial = compileConstNumber(combo.counter.detail.initialValue, planPath(ctx.authored.skillKey, `internalStates.${combo.counter.stateKey}.detail.initialValue`), ctx.authored, '计数初始值');
      scheduled.push({ sortOrder: op.sortOrder, ops: [stateChange(combo.counter, 'set', initial)] });
    } else if (op.operation === 'START') {
      scheduled.push({ sortOrder: op.sortOrder, ops: [stateChange(combo.icd, 'set', 1)] });
    }
  }
  for (const row of stableSorted(scheduled, (item) => item.sortOrder)) rewardOps.push(...row.ops);
  assertPriorOutputsResolved([rewardStart], planPath(ctx.authored.skillKey, `rules.${combo.rewardRule.ruleKey}.actions.${rewardStart.actionKey}`), ctx);
  const first = listenerAbility(`listen_${combo.firstRule.ruleKey}`, combo.firstRule.ruleKey, matcher, firstOps, ctx, combo.oncePerUse, firstCondition);
  const reward = listenerAbility(`listen_${combo.rewardRule.ruleKey}`, combo.rewardRule.ruleKey, matcher, rewardOps, ctx, combo.oncePerUse, rewardCondition);
  const counterMax = compileConstNumber(combo.counter.detail.maxValue, planPath(ctx.authored.skillKey, `internalStates.${combo.counter.stateKey}.detail.maxValue`), ctx.authored, '计数上限');
  const initial = compileConstNumber(combo.counter.detail.initialValue, planPath(ctx.authored.skillKey, `internalStates.${combo.counter.stateKey}.detail.initialValue`), ctx.authored, '计数初始值');
  const icdMs = foldPositiveInt(
    compileNumericValue(combo.icd.detail.durationValue, planPath(ctx.authored.skillKey, `internalStates.${combo.icd.stateKey}.detail.durationValue`), numericState(ctx.authored), fail),
    planPath(ctx.authored.skillKey, `internalStates.${combo.icd.stateKey}.detail.durationValue`),
    '内部冷却'
  );
  return {
    abilities: [first, reward],
    schema: {
      [combo.counter.stateKey]: {
        valueType: 'number', defaultValue: initial, maxValue: counterMax, durationMs: combo.delayMs, refreshPolicy: 'start_on_first_write'
      },
      [combo.icd.stateKey]: {
        valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: icdMs, refreshPolicy: 'start_on_first_write'
      }
    }
  };
}

function compileEmpowered(combo: EmpoweredCombo, ctx: CompileCtx): { abilities: AbilityDefinition[]; schema: Record<string, ProviderStateFieldSchema> } {
  const startCondition = compileListenerCondition(combo.startRule, 'SKILL_USED', ctx);
  const consumeCondition = compileListenerCondition(combo.consumeRule, combo.eventType, ctx);
  ctx.typeEntries.set('event/ability_started', 'event');
  ctx.typeEntries.set(eventTypeKey(combo.eventType), 'event');
  ctx.typeEntries.set('event/source_owner', 'event');
  ctx.typeEntries.set(initialCastAbilityType(ctx.authored.skillKey), 'ability');
  ctx.typeEntries.set('ability/basic_attack', 'ability');
  ctx.typeEntries.set(stateScopeType(combo.flag), 'state_scope');
  ctx.typeEntries.set(stateScopeType(combo.icd), 'state_scope');
  const startOps = [stateChange(combo.flag, 'set', 1)];
  const needed = neededDamageOutputs(combo.consumeRule.actions);
  const scheduled: Array<{ sortOrder: number; ops: OperationDefinition[] }> = [];
  for (const action of stableSorted(combo.consumeRule.actions, (item) => item.sortOrder)) {
    if (action.actionType !== 'EXECUTE_EFFECT') continue;
    scheduled.push({
      sortOrder: action.sortOrder,
      ops: compileEffectAction(action, planPath(ctx.authored.skillKey, `rules.${combo.consumeRule.ruleKey}.actions.${action.actionKey}`), ctx, 'BASIC_ATTACK', needed)
    });
  }
  for (const op of stableSorted(combo.process.stateOperations, (item) => item.sortOrder)) {
    if (op.moment.momentType !== 'STEP_EXECUTION') continue;
    if (op.operation === 'DISABLE' && op.stateKey === combo.flag.stateKey) {
      scheduled.push({ sortOrder: op.sortOrder, ops: [stateChange(combo.flag, 'set', 0)] });
    } else if (op.operation === 'START' && op.stateKey === combo.icd.stateKey) {
      scheduled.push({ sortOrder: op.sortOrder, ops: [stateChange(combo.icd, 'set', 1)] });
    }
  }
  const consumeOps: OperationDefinition[] = [];
  for (const row of stableSorted(scheduled, (item) => item.sortOrder)) consumeOps.push(...row.ops);
  assertPriorOutputsResolved(combo.consumeRule.actions, planPath(ctx.authored.skillKey, `rules.${combo.consumeRule.ruleKey}`), ctx);
  const castType = initialCastAbilityType(ctx.authored.skillKey);
  const start = listenerAbility(
    `listen_${combo.startRule.ruleKey}`, combo.startRule.ruleKey,
    { all: ['event/ability_started', castType, 'event/source_owner'] },
    startOps, ctx, undefined, startCondition
  );
  const consume = listenerAbility(
    `listen_${combo.consumeRule.ruleKey}`, combo.consumeRule.ruleKey,
    { all: [eventTypeKey(combo.eventType), 'event/source_owner'] },
    consumeOps, ctx, combo.oncePerUse, consumeCondition
  );
  const icdMs = foldPositiveInt(
    compileNumericValue(combo.icd.detail.durationValue, planPath(ctx.authored.skillKey, `internalStates.${combo.icd.stateKey}.detail.durationValue`), numericState(ctx.authored), fail),
    planPath(ctx.authored.skillKey, `internalStates.${combo.icd.stateKey}.detail.durationValue`),
    '内部冷却'
  );
  return {
    abilities: [start, consume],
    schema: {
      [combo.flag.stateKey]: {
        valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: combo.windowMs, refreshPolicy: 'start_on_first_write'
      },
      [combo.icd.stateKey]: {
        valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: icdMs, refreshPolicy: 'start_on_first_write'
      }
    }
  };
}

function listenerAbility(
  abilityKey: string,
  listenerKey: string,
  matcher: ListenerDefinition['eventMatcher'],
  operations: OperationDefinition[],
  ctx: CompileCtx,
  oncePerUse?: OncePerUseLimit,
  condition?: GenericFormulaExpr
): AbilityDefinition {
  if (oncePerUse && operations.some((operation) => operation.condition)) {
    fail(planPath(ctx.authored.skillKey, `rules.${listenerKey}`), '新 oncePerUse 不得 operation.condition');
  }
  const types = [...ctx.abilityTypes];
  const hasVampDamage = operations.some((operation) => operation.operation === 'damage' && operation.vampQualification === 'RESOLVED');
  if (hasVampDamage && !types.length) {
    fail(planPath(ctx.authored.skillKey, `rules.${listenerKey}`), '吸血伤害必须保留技能分类，不能用空 ability 绕过');
  }
  const listener: ListenerDefinition = {
    listenerKey,
    eventMatcher: matcher,
    operations,
    ...(condition ? { condition } : {}),
    ...(oncePerUse ? { oncePerUse } : {})
  };
  return {
    abilityKey, kind: 'passive_listener',
    ...(types.length ? { types } : {}),
    ...(Object.keys(ctx.state.params).length ? { params: { ...ctx.state.params } } : {}),
    listenerSpec: listener
  };
}

export function adaptTriggerProgram(authored: AuthoredTriggerProgram): AdaptedTriggerProgram {
  catalogKey(authored.gameId, 'gameId');
  catalogKey(authored.skillKey, 'skillKey');
  if (!Number.isInteger(authored.skillLevel) || authored.skillLevel < 1) fail('skillLevel', '本次等级必须明确且有效');
  if (!Number.isInteger(authored.characterLevel) || authored.characterLevel < 1) fail('characterLevel', '本次等级必须明确且有效');
  const combo = classifyTriggerProgram(authored);
  const ctx: CompileCtx = {
    authored, state: numericState(authored), typeEntries: new Map(), abilityTypes: new Set(), outputRefs: new Map()
  };
  const compiled = combo.kind === 'count_window' ? compileCountWindow(combo, ctx) : compileEmpowered(combo, ctx);
  const providerKey = `trigger:${authored.skillKey}`;
  const provider: ProviderDefinition = {
    providerKey, kind: 'item', stableId: providerKey,
    abilities: compiled.abilities,
    initialStateSchema: compiled.schema
  };
  return {
    provider, params: ctx.state.params, formulas: [...ctx.state.namedFormulas.values()],
    requiredAttributes: [...ctx.state.requiredAttributes],
    typeEntries: [...ctx.typeEntries].map(([key, domain]) => ({ key, domain })),
    vampRules: ctx.vampRules, abilityTypes: [...ctx.abilityTypes], combo: combo.kind,
    oncePerUse: combo.oncePerUse,
    initialCastAbilityType: combo.kind === 'empowered' ? initialCastAbilityType(authored.skillKey) : undefined,
    consumeEvent: eventTypeKey(combo.eventType) as AdaptedTriggerProgram['consumeEvent']
  };
}

function addType(request: CompileRequest, key: string, domain: string, path: string): void {
  const old = request.typeCatalog.types.find((row) => row.key === key);
  if (old && old.domain !== domain) fail(path, `类型域冲突：${key}`);
  if (!old) request.typeCatalog.types.push({ key, domain });
}

export function withTriggerProgram(
  input: CompileRequest,
  binding: TriggerProgramBinding,
  options: { rulesHash: string }
): CompileRequest {
  if (!options.rulesHash.trim() || options.rulesHash === input.rulesHash) fail('rulesHash', '接入规则后必须提供新的配置摘要');
  const adapted = adaptTriggerProgram(binding.authored);
  const request = structuredClone(input);
  request.rulesHash = options.rulesHash;
  request.sharedProviders ??= [];
  request.formulas ??= [];
  for (const entry of adapted.typeEntries) addType(request, entry.key, entry.domain, 'typeCatalog');
  adapted.provider.providerKey = binding.triggerProviderKey;
  adapted.provider.stableId = binding.triggerProviderKey;
  const existing = request.sharedProviders.find((row) => row.providerKey === binding.triggerProviderKey);
  if (existing && !sameJson(existing, adapted.provider)) {
    fail(`sharedProviders.${binding.triggerProviderKey}`, 'provider 与现有定义冲突');
  }
  if (!existing) request.sharedProviders.push(adapted.provider);
  else Object.assign(existing, adapted.provider);
  if (adapted.vampRules) {
    if (request.combatants.length !== 2 || !request.combatants.some((actor) => actor.key === 'source')
      || !request.combatants.some((actor) => actor.key === 'target')
      || request.combatants.some((actor) => binding.authored.identity[actor.key as 'source' | 'target']?.category !== 'CHAMPION')) {
      fail('combatants', '吸血首期仅接受身份已核验的两个英雄对象');
    }
    if (request.rules.vampRules?.length && !sameJson(request.rules.vampRules, adapted.vampRules)) {
      fail('rules.vampRules', '已有游戏吸血规则与触发计划冲突');
    }
    request.rules.vampRules = adapted.vampRules;
    for (const actor of request.combatants) actor.types = [...new Set([...(actor.types ?? []), 'combatant/champion'])];
  }
  if (binding.initialCastAbilityKey && adapted.initialCastAbilityType) {
    const provider = request.sharedProviders.find((row) => row.abilities?.some((ability) => ability.abilityKey === binding.initialCastAbilityKey));
    const ability = provider?.abilities?.find((row) => row.abilityKey === binding.initialCastAbilityKey);
    if (!ability) fail('bindings.initialCastAbilityKey', '启动能力必须已存在');
    ability.skillKey = binding.authored.skillKey;
    ability.types = [...new Set([...(ability.types ?? []), adapted.initialCastAbilityType])];
  }
  for (const formula of adapted.formulas) {
    const old = request.formulas.find((row) => row.key === formula.key);
    if (old && JSON.stringify(old.expression) !== JSON.stringify(formula.expression)) fail('formulas', '具名公式与现有输入冲突');
    if (!old) request.formulas.push(formula);
  }
  const owner = binding.authored.owner ?? 'source';
  const actor = request.combatants.find((row) => row.key === owner);
  if (!actor) fail(`combatants.${owner}`, '监听器拥有者必须是实际对象');
  if (!actor.providers.some((row) => row.providerRef === binding.triggerProviderKey)) {
    actor.providers.push({ providerRef: binding.triggerProviderKey, definitionRef: binding.triggerProviderKey });
  }
  for (const combatant of request.combatants) {
    for (const key of adapted.requiredAttributes) {
      const slot = combatant.attributes[key];
      if (!slot) fail(`combatants.${combatant.key}.attributes.${key}`, '缺少明确的运行属性，不能自动补零');
      for (const field of ['base', 'current', 'max', 'resolved'] as const) finite(slot[field], `combatants.${combatant.key}.attributes.${key}.${field}`);
    }
  }
  return request;
}

export function basicAttackStartAbility(input: {
  abilityKey: string; skillKey: string;
  cost?: AbilityDefinition['cost']; cooldown?: AbilityDefinition['cooldown'];
}): AbilityDefinition {
  catalogKey(input.abilityKey, 'abilityKey');
  catalogKey(input.skillKey, 'skillKey');
  return {
    abilityKey: input.abilityKey, kind: 'active', skillKey: input.skillKey, types: ['ability/basic_attack'],
    ...(input.cost ? { cost: input.cost } : {}),
    ...(input.cooldown ? { cooldown: input.cooldown } : {}),
    operations: []
  };
}

export function basicAttackHitAbility(input: { abilityKey: string; skillKey: string }): AbilityDefinition {
  catalogKey(input.abilityKey, 'abilityKey');
  catalogKey(input.skillKey, 'skillKey');
  return {
    abilityKey: input.abilityKey, kind: 'active', skillKey: input.skillKey, types: ['ability/basic_attack'],
    operations: [{
      operation: 'resolve_skill_hit', target: 'target',
      skillHit: { skillKey: input.skillKey, candidates: [] }
    }]
  };
}

export function attackStartFact(driverEntryKey: string, useRef: string): AttackStartFact {
  if (!driverEntryKey.trim()) fail('attackStartFacts.driverEntryKey', '需要明确的单次入口');
  catalogKey(useRef, 'attackStartFacts.useRef');
  return { driverEntryKey, useRef };
}

export function useTriggerLedgerEntry(input: Omit<UseTriggerLedgerEntry, 'target'> & { target?: string | null }): UseTriggerLedgerEntry {
  catalogKey(input.groupKey, 'useTriggerLedger.groupKey');
  if (input.scope !== 'provider' && input.scope !== 'provider_target') fail('useTriggerLedger.scope', 'scope 必须是 provider 或 provider_target');
  if (input.scope === 'provider_target' && !input.target) fail('useTriggerLedger.target', 'provider_target 必须有实际命中目标');
  if (input.scope === 'provider' && input.target) fail('useTriggerLedger.target', 'provider 范围不能携带 target');
  return {
    owner: input.owner, providerRef: input.providerRef, groupKey: input.groupKey, scope: input.scope,
    useSource: input.useSource, useSkillKey: input.useSkillKey, useKey: input.useKey,
    target: input.scope === 'provider_target' ? input.target! : null
  };
}

export function triggerProviderStateSnapshot(input: {
  state: Record<string, number>;
  expireAt?: Record<string, number>;
  targetState?: { target: string; values: Record<string, number>; expireAt?: Record<string, number> };
}): Record<string, unknown> {
  return {
    state: { ...input.state },
    expireAt: { ...(input.expireAt ?? {}) },
    ...(input.targetState ? {
      targetState: {
        target: input.targetState.target,
        values: { ...input.targetState.values },
        expireAt: { ...(input.targetState.expireAt ?? {}) }
      }
    } : {})
  };
}

export function provenTriggerUse(input: { useKey: string; source: 'source' | 'target'; skillKey: string }): SkillUseFact {
  catalogKey(input.useKey, 'skillUses.useKey');
  catalogKey(input.skillKey, 'skillUses.skillKey');
  return { useKey: input.useKey, source: input.source, skillKey: input.skillKey, historyState: 'complete' };
}
