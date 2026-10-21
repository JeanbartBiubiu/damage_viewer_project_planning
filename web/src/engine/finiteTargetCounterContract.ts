import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillProcess } from '../types/skillProcess';
import type { SkillTriggerAction, SkillTriggerCondition, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import type { NumericValue } from '../types/numericValue';
import { NumericAdaptationError } from './numericAdapter';

type Counter = Extract<SkillInternalState, { stateType: 'COUNTER' }>;
export type FiniteTargetCounterContract = {
  window: Counter;
  counter: Counter;
  parameterKey: string;
  expiryRuleKey: string;
  fullRuleKey: string;
  applicationRuleKey: string;
  stackRuleKeys: string[];
};

const fixed = (value: NumericValue | null | undefined, expected: number) => value?.kind === 'FIXED' && value.value === expected;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const conditions = (rule: SkillTriggerRuleDetail) => rule.conditionGroups.length === 1 ? rule.conditionGroups[0]!.conditions : [];
function stateCondition(condition: SkillTriggerCondition, skillKey: string, stateKey: string, comparator: string, value: NumericValue) {
  if (condition.conditionType !== 'INTERNAL_STATE_CHECK') return false;
  const d = condition.detail;
  return d.stateSkillKey === skillKey && d.stateKey === stateKey && d.valueKind === 'VALUE'
    && d.optionKey === null && d.expectedBoolean === null && d.comparator === comparator && same(d.comparisonValue, value);
}
function eventCondition(condition: SkillTriggerCondition, key: string, value: number) {
  return condition.conditionType === 'EVENT_VALUE_COMPARE' && condition.detail.eventValueKey === key
    && condition.detail.comparator === 'EQ' && fixed(condition.detail.comparisonValue, value);
}
function passive(process: SkillProcess | undefined): process is SkillProcess {
  return !!process && process.activationType === 'PASSIVE' && process.cooldown === null && process.effectBindings.length === 0
    && process.steps.length === 1 && process.steps[0]!.stepType === 'IMMEDIATE' && process.steps[0]!.occupiesAction === false;
}
function start(actions: SkillTriggerAction[], processKey: string) {
  return actions.length === 1 && actions[0]!.actionType === 'START_PROCESS' && actions[0]!.detail.processKey === processKey
    && actions[0]!.targetContext === 'CURRENT_TARGET' && actions[0]!.runtimeInputBindings.length === 0 && actions[0]!.resultModifiers.length === 0;
}

/** 只接入完整的目标计数窗口因果图；不把任意状态变更监听当成已实现。 */
export function finiteTargetCounterContract(configuration: SkillConfiguration): FiniteTargetCounterContract | null {
  const tails = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'INTERNAL_STATE_CHANGED');
  if (!tails.length) return null;
  const skillKey = configuration.skill.skillKey;
  const fail = (message: string): never => { throw new NumericAdaptationError(`skills.${skillKey}.triggerRules`, message); };
  if (tails.length !== 1) return null;
  const expiry = tails[0]!;
  if (expiry.eventSource.eventType !== 'INTERNAL_STATE_CHANGED') return null;
  const expiryEvent = expiry.eventSource;
  const window = configuration.internalStates.find(state => state.stateKey === expiryEvent.detail.stateKey);
  if (window?.stateType !== 'COUNTER' || window.scope !== 'TARGET' || window.detail.durationValue == null) return null;
  // 普通有期目标状态也可引用未实现的state-changed尾规则，先识别本机制的组合特征再给出专属错误。
  // 不匹配者仍由原闭包和通用适配校验，不能借此被当作有限窗口休眠。
  if (configuration.internalStates.length !== 2 || !configuration.internalStates.some(state => state !== window
      && state.stateType === 'COUNTER' && state.scope === 'TARGET' && state.detail.durationValue == null)
    || !expiry.actions.some(action => action.actionType === 'EXECUTE_EFFECT'
      && action.runtimeInputBindings.some(binding => binding.sourceType === 'INTERNAL_STATE'))
    || !configuration.triggerRules.some(rule => rule.eventSource.eventType === 'PROCESS_MOMENT')
    || !configuration.triggerRules.some(rule => rule.eventSource.eventType === 'SKILL_HIT'
      && rule.eventSource.detail.sourceSkillKey === skillKey && rule.actions.some(action => action.actionType === 'START_PROCESS'))) return null;
  if (expiry.eventSource.detail.stateSkillKey !== skillKey || expiry.eventSource.detail.changeKind !== 'VALUE_CHANGED'
    || !fixed(window.detail.initialValue, 0) || !fixed(window.detail.maxValue, 1) || window.detail.initialValueBinding !== undefined) fail('有限目标窗口需要同技能、明确零初值和单层目标计数');
  if (configuration.internalStates.length !== 2) fail('有限目标窗口只接一项窗口和一项独立目标计数');
  const counterCandidate = configuration.internalStates.find(state => state !== window);
  if (counterCandidate?.stateType !== 'COUNTER' || counterCandidate.scope !== 'TARGET' || counterCandidate.gameId !== configuration.skill.gameId
    || counterCandidate.skillKey !== skillKey || !fixed(counterCandidate.detail.initialValue, 0) || counterCandidate.detail.durationValue != null
    || counterCandidate.detail.initialValueBinding !== undefined) return fail('结算计数需要同技能零初值、无独立到期的目标计数');
  const counter = counterCandidate;
  const explosion = expiry.actions[0];
  if (expiry.actions.length !== 1 || explosion?.actionType !== 'EXECUTE_EFFECT'
    || explosion.targetContext !== 'CURRENT_TARGET' || explosion.resultModifiers.length
    || explosion.runtimeInputBindings.length !== 1) return fail('自然终点必须完整结算后清除同一窗口');
  const binding = explosion.runtimeInputBindings[0]!;
  if (binding.sourceType !== 'INTERNAL_STATE' || binding.detail.stateSkillKey !== skillKey || binding.detail.stateKey !== counter.stateKey
    || binding.detail.valueKind !== 'VALUE' || binding.detail.optionKey !== null) fail('结算参数只允许读取实际同技能目标计数');
  const parameter = configuration.parameters.find(row => row.parameterKey === binding.parameterKey);
  if (!parameter || parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'INTEGER' || parameter.fixedValue !== null
    || parameter.levelValues !== null) fail('计数绑定需要无默认整数参数');
  const checkExpiry = conditions(expiry);
  if (checkExpiry.length !== 3 || !checkExpiry.some(c => eventCondition(c, 'STATE_BEFORE', 1))
    || !checkExpiry.some(c => eventCondition(c, 'STATE_AFTER', 0))
    || !checkExpiry.some(c => stateCondition(c, skillKey, counter.stateKey, 'LT', counter.detail.maxValue))) fail('自然终点仅接窗口1到0且未满层的完整判断');
  const fullRules = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'PROCESS_MOMENT'
    && conditions(rule).length === 1 && stateCondition(conditions(rule)[0]!, skillKey, counter.stateKey, 'EQ', counter.detail.maxValue));
  if (fullRules.length !== 1) fail('目标计数必须有唯一满层结算尾规则');
  const full = fullRules[0]!;
  const clear = full.actions[1];
  if (full.eventSource.eventType !== 'PROCESS_MOMENT' || full.actions.length !== 2 || !same(full.actions[0], explosion)
    || clear?.actionType !== 'START_PROCESS' || clear.targetContext !== 'CURRENT_TARGET'
    || clear.runtimeInputBindings.length || clear.resultModifiers.length) return fail('满层必须结算与到期相同的真实结果，再清除窗口');
  const clearKey = clear.detail.processKey;
  const clearProcess = configuration.processes.find(row => row.processKey === clearKey);
  if (!passive(clearProcess) || clearProcess.stateOperations.length !== 1) return fail('窗口清除必须是完整即时被动过程');
  const clears = clearProcess.stateOperations[0]!;
  if (clears.stateSkillKey !== skillKey || clears.stateKey !== window.stateKey || clears.operation !== 'SET' || !fixed(clears.value, 0)
    || clears.optionKey !== null || clears.moment.momentType !== 'PROCESS_START' || clears.moment.stepKey !== null) fail('清除过程只能将实际目标窗口置零');
  const fullEvent = full.eventSource;
  const stackProcess = configuration.processes.find(row => row.processKey === fullEvent.detail.processKey);
  if (!passive(stackProcess) || stackProcess.stateOperations.length !== 1
    || fullEvent.detail.moment.momentType !== 'STEP_EXECUTION' || fullEvent.detail.moment.stepKey !== stackProcess.steps[0]!.stepKey) return fail('满层尾规则只接同一次即时叠层过程的执行时点');
  const increment = stackProcess.stateOperations[0]!;
  if (increment.stateSkillKey !== skillKey || increment.stateKey !== counter.stateKey || increment.operation !== 'INCREASE'
    || !fixed(increment.value, 1) || increment.optionKey !== null || increment.moment.momentType !== 'PROCESS_START'
    || increment.moment.stepKey !== null) fail('每次真实命中只能增加一次目标计数');
  const stackRules = configuration.triggerRules.filter(rule => start(rule.actions, stackProcess.processKey));
  if (!stackRules.length || stackRules.some(rule => {
    const event = rule.eventSource;
    const checks = conditions(rule);
    const hit = event.eventType === 'SKILL_HIT';
    return !(event.eventType === 'BASIC_ATTACK_HIT' || hit && event.detail.sourceSkillKey !== null && event.detail.sourceSkillKey !== skillKey)
      || checks.length !== (hit ? 3 : 2) || !checks.some(c => stateCondition(c, skillKey, window.stateKey, 'EQ', { kind: 'FIXED', value: 1 }))
      || !checks.some(c => stateCondition(c, skillKey, counter.stateKey, 'LT', counter.detail.maxValue))
      || hit && !checks.some(c => eventCondition(c, 'SKILL_HIT_SPELL_SHIELD_BLOCKED', 0));
  })) fail('叠层只允许完整窗口判断的真实自身普攻或实际兄弟技能命中');
  const stackSources = stackRules.map(rule => rule.eventSource.eventType === 'SKILL_HIT'
    ? `SKILL_HIT/${rule.eventSource.detail.sourceSkillKey}` : 'BASIC_ATTACK_HIT');
  if (new Set(stackSources).size !== stackSources.length) fail('同一真实命中不能有重复叠层分支');
  const applications = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT'
    && rule.eventSource.detail.sourceSkillKey === skillKey && rule.actions.length === 1 && rule.actions[0]!.actionType === 'START_PROCESS');
  if (applications.length !== 1) fail('目标窗口必须由唯一真实本技能应用命中开启');
  const application = applications[0]!;
  const action = application.actions[0]!;
  if (action.actionType !== 'START_PROCESS' || !start(application.actions, action.detail.processKey)
    || conditions(application).length !== 1 || !eventCondition(conditions(application)[0]!, 'SKILL_HIT_SPELL_SHIELD_BLOCKED', 0)) return fail('挂窗口必须先核对同次真实命中未被法术盾阻挡');
  const markKey = action.detail.processKey;
  const mark = configuration.processes.find(row => row.processKey === markKey);
  if (!passive(mark) || mark.stateOperations.length !== 2) return fail('应用过程必须完整重置计数并开启目标窗口');
  const operations = [...mark.stateOperations].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!operations.every(op => op.stateSkillKey === skillKey && op.operation === 'SET' && op.optionKey === null
    && op.moment.momentType === 'PROCESS_START' && op.moment.stepKey === null)
    || operations[0]!.stateKey !== counter.stateKey || !fixed(operations[0]!.value, 0)
    || operations[1]!.stateKey !== window.stateKey || !fixed(operations[1]!.value, 1)
    || operations[0]!.sortOrder >= operations[1]!.sortOrder) fail('真实应用必须先重置计数，再开启完整期限');
  const known = new Set([expiry, full, application, ...stackRules].map(rule => rule.ruleKey));
  const castRoots = configuration.triggerRules.filter(rule => !known.has(rule.ruleKey) && rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === skillKey && rule.eventSource.detail.useKind === 'ACTIVE'
    && rule.eventSource.detail.castPhase === 'INITIAL');
  if (castRoots.length !== 1) return fail('有限目标计数需要唯一真实首次主动入口');
  const castRoot = castRoots[0]!, castAction = castRoot.actions[0];
  const cast = castAction?.actionType === 'START_PROCESS' ? configuration.processes.find(row => row.processKey === castAction.detail.processKey) : undefined;
  if (castRoot.conditionGroups.length || !cast || !start(castRoot.actions, cast.processKey) || cast.activationType !== 'ACTIVE'
    || cast.stateOperations.length) return fail('首次主动入口不能独立修改或消耗目标状态');
  const hitRoots = configuration.triggerRules.filter(rule => !known.has(rule.ruleKey) && rule.eventSource.eventType === 'SKILL_HIT'
    && rule.eventSource.detail.sourceSkillKey === skillKey);
  if (hitRoots.length !== 1) return fail('有限目标计数需要唯一真实零伤害应用根');
  const hitRoot = hitRoots[0]!, hitAction = hitRoot.actions[0];
  if (hitRoot.conditionGroups.length || hitRoot.actions.length !== 1 || hitAction?.actionType !== 'EXECUTE_EFFECT'
    || hitAction.targetContext !== 'CURRENT_TARGET' || hitAction.runtimeInputBindings.length || hitAction.resultModifiers.length) return fail('应用根只能执行明确的零伤害结果');
  const effect = configuration.effects.find(row => row.effectKey === hitAction.detail.effectKey), result = effect?.results[0];
  if (!effect || effect.lifecycle !== null || effect.results.length !== 1 || result?.resultType !== 'DAMAGE'
    || result.target !== 'TARGET' || result.spellShieldBlockScope !== 'SKILL' || !result.valueRule || !fixed(result.valueRule.value, 0)
    || result.detail.critical.mode !== 'DISALLOWED' || result.detail.deliveryKind !== 'SKILL' || result.detail.originKind !== 'DIRECT'
    || result.detail.vampQualification !== 'RESOLVED') return fail('挂窗应用需要明确法术盾范围的真实零伤害命中');
  known.add(castRoot.ruleKey); known.add(hitRoot.ruleKey);
  if (known.size !== configuration.triggerRules.length || configuration.triggerRules.some(rule => !known.has(rule.ruleKey))) fail('有限目标窗口不能吞掉额外自然或主动根');
  const ownedProcesses = new Set([cast.processKey, mark.processKey, stackProcess.processKey, clearProcess.processKey]);
  if (ownedProcesses.size !== 4 || configuration.processes.some(process => !ownedProcesses.has(process.processKey)
    && process.stateOperations.some(op => op.stateSkillKey === skillKey && [window.stateKey, counter.stateKey].includes(op.stateKey)))) fail('有限目标窗口不能忽略其它过程对同一状态的写入或消费');
  for (const rule of configuration.triggerRules) if (rule.oncePerUse !== null || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null) fail('有限目标计数不能忽略额外触发额度');
  return { window, counter, parameterKey: binding.parameterKey, expiryRuleKey: expiry.ruleKey, fullRuleKey: full.ruleKey,
    applicationRuleKey: application.ruleKey, stackRuleKeys: stackRules.map(rule => rule.ruleKey) };
}

export function isFiniteTargetCounterPostHitRule(configuration: SkillConfiguration, rule: SkillTriggerRuleDetail) {
  if (rule.eventSource.eventType !== 'SKILL_HIT' || !rule.actions.some(action => action.actionType === 'START_PROCESS')) return false;
  const contract = finiteTargetCounterContract(configuration);
  return contract?.applicationRuleKey === rule.ruleKey || contract?.stackRuleKeys.includes(rule.ruleKey) === true;
}
