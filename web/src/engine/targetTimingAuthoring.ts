import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillInternalStateCounter } from '../types/skillInternalState';
import type { SkillProcess } from '../types/skillProcess';
import type { NumericValue } from '../types/numericValue';
import { isCounterTargetTiming } from '../services/counterTargetTiming';
import { NumericAdaptationError } from './numericAdapter';
import { compileNumericValue, createNumericCompileState, tryFoldConstant } from './numericAdapter';
import type { SimulationSkillSource, SimulationSnapshot } from '../types/simulationSnapshot';
import { selectSimulationSkillSourceClosure } from './simulation/sources/closure';

export type TargetTimingDeclaration = {
  state: SkillInternalStateCounter;
  process: SkillProcess;
  intervalMs?: number;
  completionRuleKey?: string;
  reapplyProcessKey?: string;
};

/** Explicit author permission for finite target timers. No champion or state-name recognition. */
export function targetTimingDeclarations(configuration: SkillConfiguration,
  constant: (value: NumericValue, path: string, integer: boolean, minimum?: number) => number): TargetTimingDeclaration[] {
  const root = `skills.${configuration.skill.skillKey}`;
  const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
  const entries: TargetTimingDeclaration[] = [];
  const own = configuration.skill.skillKey;
  const immediate = (process: SkillProcess | undefined, path: string): SkillProcess => {
    if (!process || process.skillKey !== own || process.gameId !== configuration.skill.gameId || process.activationType !== 'PASSIVE'
      || process.cooldown !== null || process.steps.length !== 1 || process.steps[0]!.stepType !== 'IMMEDIATE'
      || process.steps[0]!.occupiesAction !== false || Object.keys(process.steps[0]!.detail).length) {
      return fail(path, '目标时序必须指向本技能无冷却、明确不占行动的单即时被动过程');
    }
    return process;
  };
  const tails = (process: SkillProcess) => configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'PROCESS_MOMENT'
    && rule.eventSource.detail.processKey === process.processKey);
  const damageBinding = (process: SkillProcess, path: string) => {
    const binding = process.effectBindings[0];
    const effect = configuration.effects.find(row => row.effectKey === binding?.effectKey);
    const damage = effect?.results[0];
    if (process.effectBindings.length !== 1 || !binding || binding.moment.momentType !== 'STEP_EXECUTION'
      || binding.moment.stepKey !== process.steps[0]!.stepKey || binding.moment.failureReason != null
      || !effect || effect.lifecycle !== null || effect.results.length !== 1 || damage?.resultType !== 'DAMAGE'
      || damage.target !== 'TARGET' || damage.spellShieldBlockScope !== null || damage.lifecycleBehavior !== null
      || damage.detail.critical.mode !== 'DISALLOWED' || damage.detail.critical.multiplierValue !== null
      || damage.detail.deliveryKind !== 'SKILL' || damage.detail.originKind !== 'DIRECT'
      || damage.detail.vampQualification !== 'RESOLVED') fail(path, '时序过程必须展开恰好一笔完整、不可暴击的即时目标技能伤害');
  };
  const stateWrites = (process: SkillProcess, anchor: string, path: string, reapply: boolean) => {
    if (reapply && process.stateOperations.length !== 2) fail(path, '存活重挂过程仅允许两条置1目标状态写');
    for (const operation of process.stateOperations) {
      const state = configuration.internalStates.find(row => row.stateKey === operation.stateKey);
      const value = operation.value && constant(operation.value, `${path}.stateOperations.${operation.operationKey}.value`, true, 0);
      if (operation.stateSkillKey !== own || state?.stateType !== 'COUNTER' || state.scope !== 'TARGET'
        || operation.optionKey !== null || operation.operation !== 'SET' || value === null
        || value > constant(state.detail.maxValue, `${path}.stateOperations.${operation.operationKey}.maxValue`, true, 0)
        || operation.stateKey === anchor && value > 0 || reapply && value !== 1) {
        fail(path, '预约只允许本技能目标计数的有界静态设置，禁止正写当前预约');
      }
    }
  };
  for (const state of configuration.internalStates) {
    if (!state.detail || !Object.prototype.hasOwnProperty.call(state.detail, 'targetTiming')) continue;
    const path = `${root}.internalStates.${state.stateKey}.detail.targetTiming`;
    if (state.stateType !== 'COUNTER' || state.scope !== 'TARGET' || !isCounterTargetTiming(state.detail.targetTiming)
      || state.detail.initialValueBinding !== undefined || !state.detail.durationValue
      || constant(state.detail.initialValue, path, true, 0) !== 0 || constant(state.detail.maxValue, path, true, 0) !== 1) {
      fail(path, '显式目标时序只接受零初值、容量1、无运行初值绑定的目标计数');
    }
    const counter = state as SkillInternalStateCounter;
    const timing = counter.detail.targetTiming!;
    constant(counter.detail.durationValue!, `${path}.durationValue`, true, 1);
    const process = immediate(configuration.processes.find(row => row.processKey === timing.processKey), path);
    damageBinding(process, path);
    if (timing.kind === 'PHASED_TICK') {
      if (process.stateOperations.length || tails(process).length) fail(path, '独立周期不得包含状态操作、条件、尾规则或隐藏调用');
      entries.push({ state: counter, process, intervalMs: constant(timing.intervalValue, `${path}.intervalValue`, true, 1) });
      continue;
    }
    stateWrites(process, counter.stateKey, path, false);
    const rules = tails(process);
    if (rules.length > 1) fail(path, '预约最多一条仅在存活时重挂的过程完成规则');
    const rule = rules[0];
    let reapply: SkillProcess | undefined;
    if (rule) {
      const condition = rule.conditionGroups[0]?.conditions[0];
      const action = rule.actions[0];
      if (rule.eventSource.eventType !== 'PROCESS_MOMENT' || rule.eventSource.detail.moment.momentType !== 'PROCESS_COMPLETE'
        || rule.eventSource.detail.moment.stepKey !== null || rule.eventSource.detail.moment.failureReason != null
        || rule.oncePerUse !== null || rule.perTargetCooldown !== null || rule.maxTriggersPerProcess !== null
        || rule.conditionGroups.length !== 1 || rule.conditionGroups[0]!.conditions.length !== 1
        || condition?.conditionType !== 'ATTRIBUTE_COMPARE' || condition.detail.subject !== 'CURRENT_TARGET'
        || condition.detail.attributeKey !== 'hp' || condition.detail.attributeValueKind !== 'CURRENT'
        || condition.detail.comparator !== 'GT' || constant(condition.detail.comparisonValue, path, true, 0) !== 0
        || rule.actions.length !== 1 || action?.actionType !== 'START_PROCESS' || action.targetContext !== 'CURRENT_TARGET'
        || action.runtimeInputBindings.length || action.resultModifiers.length) fail(path, '预约尾规则只允许完成后按当前目标生命大于0启动一次静态重挂');
      if (action?.actionType !== 'START_PROCESS') fail(path, '缺少真实重挂过程');
      const reapplyKey = action.actionType === 'START_PROCESS' ? action.detail.processKey : fail(path, '缺少真实重挂过程');
      reapply = immediate(configuration.processes.find(row => row.processKey === reapplyKey), path);
      if (reapply === process || reapply.effectBindings.length || tails(reapply).length) fail(path, '存活重挂不得含效果、尾规则或循环');
      stateWrites(reapply, counter.stateKey, path, true);
    }
    if (process.stateOperations.length + 1 + (reapply?.stateOperations.length ?? 0) > 12) fail(path, '预约展开超过12条作者叶操作');
    entries.push({ state: counter, process, ...(rule ? { completionRuleKey: rule.ruleKey, reapplyProcessKey: reapply!.processKey } : {}) });
  }
  if (entries.filter(entry => entry.state.detail.targetTiming!.kind === 'PHASED_TICK').length > 3
    || entries.filter(entry => entry.state.detail.targetTiming!.kind === 'EXPIRY_PAYLOAD').length > 1) {
    fail(root, '每真实来源最多三个独立周期锚和一个预约到期锚');
  }
  return entries;
}

/** Dormancy is a whole explicit graph decision; it cannot keep a refund root without its producers. */
export function isUndrivenTargetTimingSource(snapshot: SimulationSnapshot, configuration: SkillConfiguration,
  side: 'source' | 'target', source?: SimulationSkillSource): boolean {
  if (!configuration.internalStates.some(state => state.detail && Object.prototype.hasOwnProperty.call(state.detail, 'targetTiming'))) return false;
  const fail = (path: string, message: string): never => { throw new NumericAdaptationError(path, message); };
  const state = createNumericCompileState({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey,
    skillLevel: source?.skillLevel ?? 1, characterLevel: snapshot.selection[`${side}Level`], parameters: configuration.parameters,
    formulas: configuration.formulas, formulaNamespace: `timing_dormancy/${configuration.skill.skillKey}`,
    bindParameters: false, allowAttributeReads: false, runtimeInputMessage: '目标时序不接受运行输入' });
  const declarations = targetTimingDeclarations(configuration, (value, path, _integer, minimum = 0) => {
    const number = tryFoldConstant(compileNumericValue(value, path, state, fail));
    if (number === null || !Number.isSafeInteger(number) || number < minimum) return fail(path, '目标时序依赖必须完整静态求值为安全整数');
    return number;
  });
  const hits = configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_HIT');
  if (!declarations.length || !hits.length || configuration.triggerRules.some(rule => !['SKILL_HIT', 'DAMAGE_DEALT', 'PROCESS_MOMENT'].includes(rule.eventSource.eventType))) return false;
  if (hits.some(rule => rule.eventSource.eventType !== 'SKILL_HIT' || !rule.eventSource.detail.sourceSkillKey)) return false;
  const hitSkillKeys = new Set(hits.flatMap(rule => rule.eventSource.eventType === 'SKILL_HIT' && rule.eventSource.detail.sourceSkillKey ? [rule.eventSource.detail.sourceSkillKey] : []));
  const roots = configuration.triggerRules.filter(rule => rule.eventSource.eventType !== 'PROCESS_MOMENT');
  // Resolve the complete graph before any dormant shortcut, including references in an otherwise unreachable action.
  const closure = selectSimulationSkillSourceClosure(configuration, roots.map(rule => rule.ruleKey));
  if (closure.excludedRuleKeys.length || configuration.processes.some(process => !closure.configuration.processes.some(row => row.processKey === process.processKey))
    || configuration.effects.some(effect => !closure.configuration.effects.some(row => row.effectKey === effect.effectKey))) return false;
  for (const rule of roots) if (rule.eventSource.eventType === 'DAMAGE_DEALT') {
    const source = rule.eventSource.detail;
    if (!rule.conditionGroups.length || rule.conditionGroups.some(group => {
      const killed = group.conditions.some(condition => condition.conditionType === 'EVENT_VALUE_COMPARE'
        && condition.detail.eventValueKey === 'KILLED' && condition.detail.comparator === 'EQ'
        && condition.detail.comparisonValue.kind === 'FIXED' && condition.detail.comparisonValue.value === 1);
      const before = group.conditions.filter(condition => condition.conditionType === 'INTERNAL_STATE_CHECK'
        && condition.detail.valueKind === 'DAMAGE_BEFORE_VALUE' && condition.detail.stateSkillKey === configuration.skill.skillKey);
      return !killed || before.length !== 1 || before.some(condition => {
        if (condition.conditionType !== 'INTERNAL_STATE_CHECK') return true;
        const detail = condition.detail;
        const state = configuration.internalStates.find(row => row.stateKey === detail.stateKey);
        if (state?.stateType !== 'COUNTER' || state.scope !== 'TARGET' || state.detail.targetTiming !== undefined
          || !detail.comparisonValue || detail.comparisonValue.kind !== 'FIXED') return true;
        const n = detail.comparisonValue.value;
        if (detail.comparator === 'GT' && n === 0 || detail.comparator === 'GTE' && n === 1) return false;
        return !(detail.comparator === 'EQ' && n === 0 && source.deliveryKind === 'SKILL' && source.originKind === 'DIRECT'
          && source.sourceSkillKey !== null && (source.sourceSkillKey === configuration.skill.skillKey || hitSkillKeys.has(source.sourceSkillKey)));
      });
    })) return false;
  }
  return side === 'target' || !hits.some(rule => {
    const event = rule.eventSource;
    return event.eventType === 'SKILL_HIT' && snapshot.selection.plannedSkills.some(plan => plan.skillKey === event.detail.sourceSkillKey && plan.phaseKinds.includes('INITIAL'));
  });
}
