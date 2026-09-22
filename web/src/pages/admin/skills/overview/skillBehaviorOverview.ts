import {
  AUTHORING_COLLECTION_KEYS,
  type AuthoringLocation,
  type AuthoringLocationSegment
} from '../../../../types/authoringLocation';
import type { NumericValue } from '../../../../types/numericValue';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type { SkillInternalState } from '../../../../types/skillInternalState';
import type { SkillParameter } from '../../../../types/skillParameter';
import type {
  SkillProcess,
  SkillProcessEffectBinding,
  SkillProcessMoment,
  SkillProcessStateOperation
} from '../../../../types/skillProcess';
import type {
  SkillTriggerAction,
  SkillTriggerCondition,
  SkillTriggerEventSource,
  SkillTriggerRuleDetail,
  SkillTriggerRuntimeInputBinding
} from '../../../../types/skillTriggerRule';
import {
  COOLDOWN_CHANGE_OPERATION_LABELS,
  RESOURCE_CHANGE_OPERATION_LABELS,
  SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS,
  SKILL_EFFECT_RESULT_TYPE_LABELS,
  SKILL_EFFECT_TARGET_LABELS
} from '../effects/effectForm';
import {
  SKILL_INTERNAL_STATE_TYPE_LABELS
} from '../processes/internalStateForm';
import {
  PROCESS_FAILURE_REASON_ANY_LABEL,
  PROCESS_FAILURE_REASON_LABELS,
  SKILL_PROCESS_ACTIVATION_TYPE_LABELS,
  SKILL_PROCESS_MOMENT_TYPE_LABELS,
  SKILL_PROCESS_STEP_TYPE_LABELS
} from '../processes/processForm';
import {
  SKILL_TRIGGER_ACTION_TYPE_LABELS,
  SKILL_TRIGGER_CAST_PHASE_LABELS,
  SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL,
  SKILL_TRIGGER_EVENT_TYPE_LABELS,
  SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENT_LABELS,
  SKILL_TRIGGER_SOURCE_TYPE_LABELS,
  SKILL_TRIGGER_CONDITION_TYPE_LABELS,
  SKILL_TRIGGER_SUBJECT_LABELS,
  SKILL_TRIGGER_TARGET_CONTEXT_LABELS,
  bindingSummary
} from '../triggers/triggerRuleForm';
import {
  RESOURCE_DECREASE_REVIEW_NOTE,
  authoringLocationFor
} from '../authoringFocus';

export const SKILL_BEHAVIOR_GROUP_IDS = ['use', 'costCooldown', 'hit', 'effect', 'end'] as const;
export type SkillBehaviorGroupId = typeof SKILL_BEHAVIOR_GROUP_IDS[number];

export const SKILL_BEHAVIOR_GROUP_LABELS: Record<SkillBehaviorGroupId, string> = {
  use: '使用',
  costCooldown: '消耗与冷却',
  hit: '命中',
  effect: '效果',
  end: '结束'
};

export const SKILL_BEHAVIOR_SUPPLEMENT_LABEL = '补充入口';
export const SKILL_BEHAVIOR_AUXILIARY_LABEL = '参数、公式与内部状态';

export type SkillBehaviorEntry = {
  id: string;
  groups: SkillBehaviorGroupId[];
  supplement: boolean;
  auxiliary: boolean;
  sourceKindLabel: string;
  sourceName: string;
  sourceKey: string;
  momentLabel: string | null;
  targetLabel: string | null;
  valueSourceLabel: string | null;
  notes: string[];
  location: AuthoringLocation;
};

export type SkillBehaviorOverviewModel = {
  groups: Record<SkillBehaviorGroupId, SkillBehaviorEntry[]>;
  supplement: SkillBehaviorEntry[];
  auxiliary: SkillBehaviorEntry[];
};

function numericSource(value: NumericValue | null | undefined): string | null {
  if (!value) return null;
  if (value.kind === 'FIXED') return Number.isFinite(value.value) ? `固定 ${value.value}` : '固定值待填写';
  if (value.kind === 'PARAMETER') return `参数 ${value.parameterKey}`;
  return `公式 ${value.formulaKey}`;
}

function location(
  skillKey: string,
  objectType: string,
  objectKey: string,
  editor: AuthoringLocation['editor'],
  fieldPath: string,
  segments: AuthoringLocationSegment[] = []
): AuthoringLocation {
  if (!editor) {
    return {
      skillKey, objectType, objectKey, fieldPath, editor: null, precision: 'NONE',
      degradeReason: 'UNKNOWN_FIELD', segments: [], formulaSnapshot: null
    };
  }
  return authoringLocationFor(skillKey, objectType, objectKey, editor, fieldPath, segments);
}

function keyed(collection: keyof typeof AUTHORING_COLLECTION_KEYS, key: string): AuthoringLocationSegment {
  return { kind: 'KEYED_CHILD', collection, keyField: AUTHORING_COLLECTION_KEYS[collection], key };
}

function momentGroups(momentType: SkillProcessMoment['momentType']): SkillBehaviorGroupId[] {
  if (momentType === 'PROCESS_START') return ['use'];
  if (momentType === 'PROCESS_COMPLETE' || momentType === 'PROCESS_FAILURE'
    || momentType === 'STEP_COMPLETE' || momentType === 'STEP_TIMEOUT') return ['end'];
  return [];
}

function eventGroups(eventSource: SkillTriggerEventSource): SkillBehaviorGroupId[] {
  switch (eventSource.eventType) {
    case 'SKILL_USED':
      return ['use'];
    case 'SKILL_HIT':
    case 'BASIC_ATTACK_HIT':
    case 'BASIC_ATTACK_START':
    case 'HIT_LINK_APPLIED':
    case 'ATTACK_LINK_APPLIED':
      return ['hit'];
    case 'PROCESS_MOMENT':
      return momentGroups(eventSource.detail.moment.momentType);
    case 'LIFECYCLE_MOMENT':
      if (eventSource.detail.moment === 'NATURAL_END' || eventSource.detail.moment === 'EARLY_REMOVE') return ['end'];
      return ['effect'];
    case 'RESULT_AVAILABLE':
      return ['effect'];
    default:
      return [];
  }
}

function eventMomentLabel(eventSource: SkillTriggerEventSource): string {
  const eventLabel = SKILL_TRIGGER_EVENT_TYPE_LABELS[eventSource.eventType];
  if (eventSource.eventType === 'SKILL_USED') {
    const phase = eventSource.detail.castPhase;
    const phaseLabel = phase ? SKILL_TRIGGER_CAST_PHASE_LABELS[phase] : SKILL_TRIGGER_CAST_PHASE_PENDING_LABEL;
    return `${eventLabel} · ${phaseLabel}`;
  }
  if (eventSource.eventType === 'PROCESS_MOMENT') {
    return `${eventLabel} · ${processMomentLabel(eventSource.detail.moment)}`;
  }
  if (eventSource.eventType === 'LIFECYCLE_MOMENT') {
    return `${eventLabel} · ${SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENT_LABELS[eventSource.detail.moment]}`;
  }
  return eventLabel;
}

function processMomentLabel(moment: SkillProcessMoment): string {
  const typeLabel = SKILL_PROCESS_MOMENT_TYPE_LABELS[moment.momentType];
  if (moment.momentType === 'PROCESS_FAILURE') {
    return `${typeLabel} / ${moment.failureReason ? PROCESS_FAILURE_REASON_LABELS[moment.failureReason] : PROCESS_FAILURE_REASON_ANY_LABEL}`;
  }
  return moment.stepKey ? `${typeLabel} / ${moment.stepKey}` : typeLabel;
}

function uniqueGroups(groups: SkillBehaviorGroupId[]): SkillBehaviorGroupId[] {
  return SKILL_BEHAVIOR_GROUP_IDS.filter((group) => groups.includes(group));
}

function push(target: SkillBehaviorEntry[], entry: SkillBehaviorEntry): void {
  target.push({ ...entry, groups: uniqueGroups(entry.groups) });
}

function resultEntries(skillKey: string, effect: SkillEffect): SkillBehaviorEntry[] {
  return effect.results.map((result) => {
    const groups: SkillBehaviorGroupId[] = ['effect'];
    const notes: string[] = [];
    if (result.resultType === 'RESOURCE_CHANGE') {
      groups.push('costCooldown');
      if (result.detail.operation === 'CONSUME') notes.push(RESOURCE_DECREASE_REVIEW_NOTE);
    }
    if (result.resultType === 'COOLDOWN_CHANGE') groups.push('costCooldown');
    if (result.resultType === 'HIT_LINK_APPLICATION' || result.resultType === 'ATTACK_LINK_APPLICATION') {
      groups.push('hit');
    }
    const moment = result.lifecycleBehavior?.moment;
    if (moment === 'NATURAL_END' || moment === 'EARLY_REMOVE') groups.push('end');
    const value = 'valueRule' in result ? result.valueRule?.value ?? null : null;
    return {
      id: `effect:${effect.effectKey}:result:${result.resultKey}`,
      groups,
      supplement: false,
      auxiliary: false,
      sourceKindLabel: '效果结果',
      sourceName: `${effect.name} / ${result.name}`,
      sourceKey: `${effect.effectKey} / ${result.resultKey}`,
      momentLabel: moment ? SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS[moment] : null,
      targetLabel: SKILL_EFFECT_TARGET_LABELS[result.target],
      valueSourceLabel: valueSourceForResult(result, value),
      notes,
      location: location(skillKey, 'EFFECT', effect.effectKey, 'EFFECT', `results[resultKey=${result.resultKey}]`, [
        keyed('results', result.resultKey)
      ])
    };
  });
}

function valueSourceForResult(result: SkillEffectResult, value: NumericValue | null): string {
  const typeLabel = SKILL_EFFECT_RESULT_TYPE_LABELS[result.resultType];
  if (result.resultType === 'RESOURCE_CHANGE') {
    return `${typeLabel} · ${RESOURCE_CHANGE_OPERATION_LABELS[result.detail.operation]}${numericSource(value) ? ` · ${numericSource(value)}` : ''}`;
  }
  if (result.resultType === 'COOLDOWN_CHANGE') {
    const operation = COOLDOWN_CHANGE_OPERATION_LABELS[result.detail.operation];
    const source = numericSource(value);
    return source ? `${typeLabel} · ${operation} · ${source}` : `${typeLabel} · ${operation}`;
  }
  const source = numericSource(value);
  return source ? `${typeLabel} · ${source}` : typeLabel;
}

function processBindingEntry(
  skillKey: string,
  process: SkillProcess,
  binding: SkillProcessEffectBinding,
  effects: readonly SkillEffect[]
): SkillBehaviorEntry {
  const effect = effects.find((item) => item.effectKey === binding.effectKey);
  const groups: SkillBehaviorGroupId[] = [...momentGroups(binding.moment.momentType), 'effect'];
  return {
    id: `process:${process.processKey}:binding:${binding.bindingKey}`,
    groups,
    supplement: groups.length === 1,
    auxiliary: false,
    sourceKindLabel: '过程效果挂接',
    sourceName: `${process.name} → ${effect?.name ?? '未读取到名称'}（${binding.effectKey}）`,
    sourceKey: `${process.processKey} / ${binding.bindingKey}`,
    momentLabel: processMomentLabel(binding.moment),
    targetLabel: effectTargets(effect),
    valueSourceLabel: null,
    notes: [],
    location: location(skillKey, 'PROCESS', process.processKey, 'PROCESS', `effectBindings[bindingKey=${binding.bindingKey}]`, [
      keyed('effectBindings', binding.bindingKey)
    ])
  };
}

function processOperationEntry(
  skillKey: string,
  process: SkillProcess,
  operation: SkillProcessStateOperation,
  internalStates: readonly SkillInternalState[]
): SkillBehaviorEntry {
  const groups = momentGroups(operation.moment.momentType);
  if (operation.operation === 'START') groups.push('costCooldown');
  return {
    id: `process:${process.processKey}:operation:${operation.operationKey}`,
    groups,
    supplement: groups.length === 0,
    auxiliary: false,
    sourceKindLabel: '过程状态操作',
    sourceName: `${process.name} / ${operation.name}`,
    sourceKey: `${process.processKey} / ${operation.operationKey}`,
    momentLabel: processMomentLabel(operation.moment),
    targetLabel: `内部状态：${internalStates.find((item) => item.stateKey === operation.stateKey)?.name ?? '未读取到名称'}（${operation.stateKey}）`,
    valueSourceLabel: numericSource(operation.value),
    notes: [],
    location: location(skillKey, 'PROCESS', process.processKey, 'PROCESS', `stateOperations[operationKey=${operation.operationKey}]`, [
      keyed('stateOperations', operation.operationKey)
    ])
  };
}

function actionGroups(action: SkillTriggerAction): SkillBehaviorGroupId[] {
  if (action.actionType === 'START_PROCESS' || action.actionType === 'ADVANCE_PROCESS') return ['use'];
  if (action.actionType === 'EXECUTE_EFFECT') return ['effect'];
  return ['end'];
}

function effectTargets(effect: SkillEffect | undefined): string {
  if (!effect) return '效果详情未读取';
  return [...new Set(effect.results.map((result) => SKILL_EFFECT_TARGET_LABELS[result.target]))].join('、') || '无结果';
}

function conditionSubject(condition: SkillTriggerCondition): string | null {
  if ('subject' in condition.detail && condition.detail.subject) return SKILL_TRIGGER_SUBJECT_LABELS[condition.detail.subject];
  if (condition.conditionType === 'SKILL_HIT_TARGET_IS_ENEMY' || condition.conditionType === 'TARGET_CATEGORY_CHECK') return '事件对方';
  if (condition.conditionType === 'EXPLICIT_TARGET_IS_SOURCE') return '显式施法目标';
  return null;
}

function bindingAddsCost(binding: SkillTriggerRuntimeInputBinding): boolean {
  return binding.sourceType === 'SOURCE_CAST_RESOURCE_COST';
}

function startedProcessKeys(rules: readonly SkillTriggerRuleDetail[]): Set<string> {
  const keys = new Set<string>();
  for (const rule of rules) {
    for (const action of rule.actions) {
      if (action.actionType === 'START_PROCESS') keys.add(action.detail.processKey);
    }
  }
  return keys;
}

function attachedEffectKeys(rules: readonly SkillTriggerRuleDetail[], processes: readonly SkillProcess[]): Set<string> {
  const keys = new Set<string>();
  for (const rule of rules) {
    for (const action of rule.actions) {
      if (action.actionType === 'EXECUTE_EFFECT') keys.add(action.detail.effectKey);
    }
  }
  for (const process of processes) {
    for (const binding of process.effectBindings) keys.add(binding.effectKey);
  }
  return keys;
}

export function buildSkillBehaviorOverview(input: {
  skillKey: string;
  skillName: string;
  parameters: readonly SkillParameter[];
  formulas: readonly SkillFormulaSummary[];
  effects: readonly SkillEffect[];
  processes: readonly SkillProcess[];
  internalStates: readonly SkillInternalState[];
  rules: readonly SkillTriggerRuleDetail[];
  detailsComplete: boolean;
}): SkillBehaviorOverviewModel {
  const collected: SkillBehaviorEntry[] = [];
  const started = startedProcessKeys(input.rules);
  const attached = attachedEffectKeys(input.rules, input.processes);

  for (const effect of input.effects) {
    for (const entry of resultEntries(input.skillKey, effect)) push(collected, entry);
    if (input.detailsComplete && !attached.has(effect.effectKey)) {
      push(collected, {
        id: `effect:${effect.effectKey}:unattached`,
        groups: [],
        supplement: true,
        auxiliary: false,
        sourceKindLabel: '未挂接效果',
        sourceName: effect.name,
        sourceKey: effect.effectKey,
        momentLabel: null,
        targetLabel: null,
        valueSourceLabel: effect.results.length ? `${effect.results.length} 条结果` : '无结果',
        notes: ['没有执行效果动作或过程挂接引用该效果'],
        location: location(input.skillKey, 'EFFECT', effect.effectKey, 'EFFECT', 'effectKey')
      });
    }
  }

  for (const process of input.processes) {
    const processEntries: SkillBehaviorEntry[] = [];
    if (process.cooldown) {
      processEntries.push({
        id: `process:${process.processKey}:cooldown`,
        groups: ['costCooldown'],
        supplement: false,
        auxiliary: false,
        sourceKindLabel: '过程冷却',
        sourceName: process.name,
        sourceKey: process.processKey,
        momentLabel: processMomentLabel(process.cooldown.startMoment),
        targetLabel: null,
        valueSourceLabel: numericSource(process.cooldown.durationValue),
        notes: [],
        location: location(input.skillKey, 'PROCESS', process.processKey, 'PROCESS', 'cooldown', [
          { kind: 'FIELD', field: 'cooldown' }
        ])
      });
    }
    for (const step of process.steps) {
      processEntries.push({
        id: `process:${process.processKey}:step:${step.stepKey}`,
        groups: [],
        supplement: false,
        auxiliary: false,
        sourceKindLabel: '过程步骤',
        sourceName: `${process.name} / ${step.name}`,
        sourceKey: `${process.processKey} / ${step.stepKey}`,
        momentLabel: SKILL_PROCESS_STEP_TYPE_LABELS[step.stepType],
        targetLabel: null,
        valueSourceLabel: null,
        notes: [],
        location: location(input.skillKey, 'PROCESS', process.processKey, 'PROCESS', `steps[stepKey=${step.stepKey}]`, [
          keyed('steps', step.stepKey)
        ])
      });
    }
    for (const binding of process.effectBindings) processEntries.push(processBindingEntry(input.skillKey, process, binding, input.effects));
    for (const operation of process.stateOperations) processEntries.push(processOperationEntry(input.skillKey, process, operation, input.internalStates));
    const covered = processEntries.some((entry) => entry.groups.length > 0);
    const unstartedPassive = (process.activationType === 'PASSIVE' || process.activationType === 'CONSUMABLE')
      && !started.has(process.processKey);
    if (input.detailsComplete && (!covered || unstartedPassive)) {
      processEntries.push({
        id: `process:${process.processKey}:uncovered`,
        groups: [],
        supplement: true,
        auxiliary: false,
        sourceKindLabel: unstartedPassive ? '未启动过程' : '未覆盖过程',
        sourceName: process.name,
        sourceKey: process.processKey,
        momentLabel: SKILL_PROCESS_ACTIVATION_TYPE_LABELS[process.activationType],
        targetLabel: null,
        valueSourceLabel: null,
        notes: unstartedPassive
          ? [`${SKILL_PROCESS_ACTIVATION_TYPE_LABELS[process.activationType]}过程没有启动动作`]
          : ['该过程没有归入使用、消耗与冷却、命中、效果或结束五组的配置'],
        location: location(input.skillKey, 'PROCESS', process.processKey, 'PROCESS', 'processKey')
      });
    }
    for (const entry of processEntries) {
      if (entry.groups.length === 0 && !entry.supplement) {
        push(collected, { ...entry, supplement: true });
      } else {
        push(collected, entry);
      }
    }
  }

  for (const rule of input.rules) {
    const groups = [...eventGroups(rule.eventSource)];
    if (rule.perTargetCooldown) groups.push('costCooldown');
    const actionGroupList = rule.actions.flatMap(actionGroups);
    const costBinding = rule.actions.some((action) => action.runtimeInputBindings.some(bindingAddsCost));
    if (costBinding) groups.push('costCooldown');
    const combined = uniqueGroups([...groups, ...actionGroupList]);
    push(collected, {
      id: `rule:${rule.ruleKey}`,
      groups: combined,
      supplement: combined.length === 0,
      auxiliary: false,
      sourceKindLabel: '触发规则',
      sourceName: rule.name,
      sourceKey: rule.ruleKey,
      momentLabel: eventMomentLabel(rule.eventSource),
      targetLabel: null,
      valueSourceLabel: rule.actions.map((action) => SKILL_TRIGGER_ACTION_TYPE_LABELS[action.actionType]).join('、') || null,
      notes: costBinding ? [SKILL_TRIGGER_SOURCE_TYPE_LABELS.SOURCE_CAST_RESOURCE_COST] : [],
      location: location(input.skillKey, 'TRIGGER', rule.ruleKey, 'TRIGGER_RULE', 'eventSource')
    });
    for (const group of rule.conditionGroups) {
      for (const condition of group.conditions) {
        push(collected, {
          id: `rule:${rule.ruleKey}:condition:${condition.conditionKey}`,
          groups: combined,
          supplement: combined.length === 0,
          auxiliary: false,
          sourceKindLabel: '触发条件',
          sourceName: `${rule.name} / ${group.name}`,
          sourceKey: `${rule.ruleKey} / ${condition.conditionKey}`,
          momentLabel: eventMomentLabel(rule.eventSource),
          targetLabel: conditionSubject(condition),
          valueSourceLabel: null,
          notes: [SKILL_TRIGGER_CONDITION_TYPE_LABELS[condition.conditionType]],
          location: location(input.skillKey, 'TRIGGER', rule.ruleKey, 'TRIGGER_RULE', `conditionGroups[groupKey=${group.groupKey}].conditions[conditionKey=${condition.conditionKey}]`, [
            keyed('conditionGroups', group.groupKey),
            keyed('conditions', condition.conditionKey)
          ])
        });
      }
    }
    for (const action of rule.actions) {
      const groupsForAction = uniqueGroups([...eventGroups(rule.eventSource), ...actionGroups(action)]);
      push(collected, {
        id: `rule:${rule.ruleKey}:action:${action.actionKey}`,
        groups: groupsForAction,
        supplement: groupsForAction.length === 0,
        auxiliary: false,
        sourceKindLabel: '触发动作',
        sourceName: `${rule.name} / ${action.name}`,
        sourceKey: `${rule.ruleKey} / ${action.actionKey}`,
        momentLabel: eventMomentLabel(rule.eventSource),
        targetLabel: action.targetContext ? `动作目标：${SKILL_TRIGGER_TARGET_CONTEXT_LABELS[action.targetContext]}` : null,
        valueSourceLabel: action.actionType === 'EXECUTE_EFFECT' ? `效果：${input.effects.find((item) => item.effectKey === action.detail.effectKey)?.name ?? '目录缺失'}（${action.detail.effectKey}）`
          : action.actionType === 'START_PROCESS' || action.actionType === 'FAIL_PROCESS' || action.actionType === 'ADVANCE_PROCESS'
            ? `过程：${input.processes.find((item) => item.processKey === action.detail.processKey)?.name ?? '目录缺失'}（${action.detail.processKey}）` : null,
        notes: [SKILL_TRIGGER_ACTION_TYPE_LABELS[action.actionType]],
        location: location(input.skillKey, 'TRIGGER', rule.ruleKey, 'TRIGGER_RULE', `actions[actionKey=${action.actionKey}]`, [
          keyed('actions', action.actionKey)
        ])
      });
      for (const binding of action.runtimeInputBindings) {
        const bindingGroups = uniqueGroups([
          ...groupsForAction,
          ...(bindingAddsCost(binding) ? ['costCooldown' as const] : [])
        ]);
        push(collected, {
          id: `rule:${rule.ruleKey}:binding:${binding.bindingKey}`,
          groups: bindingGroups,
          supplement: bindingGroups.length === 0,
          auxiliary: false,
          sourceKindLabel: '动态绑定',
          sourceName: `${action.name} / ${binding.parameterKey}`,
          sourceKey: `${action.actionKey} / ${binding.bindingKey}`,
          momentLabel: eventMomentLabel(rule.eventSource),
          targetLabel: `参数：${input.parameters.find((item) => item.parameterKey === binding.parameterKey)?.name ?? '目录缺失'}（${binding.parameterKey}）`,
          valueSourceLabel: bindingSummary(binding),
          notes: bindingAddsCost(binding) ? [RESOURCE_DECREASE_REVIEW_NOTE] : [],
          location: location(input.skillKey, 'TRIGGER', rule.ruleKey, 'TRIGGER_RULE', `actions[actionKey=${action.actionKey}].runtimeInputBindings[bindingKey=${binding.bindingKey}]`, [
            keyed('actions', action.actionKey),
            keyed('runtimeInputBindings', binding.bindingKey)
          ])
        });
      }
    }
  }

  for (const parameter of input.parameters) {
    collected.push({
      id: `parameter:${parameter.parameterKey}`,
      groups: [],
      supplement: false,
      auxiliary: true,
      sourceKindLabel: '参数',
      sourceName: parameter.name,
      sourceKey: parameter.parameterKey,
      momentLabel: null,
      targetLabel: null,
      valueSourceLabel: parameter.valueMode === 'FIXED' && parameter.fixedValue !== null
        ? `固定 ${parameter.fixedValue}` : parameter.valueMode,
      notes: [],
      location: location(input.skillKey, 'PARAMETER', parameter.parameterKey, 'PARAMETER', 'parameterKey')
    });
  }
  for (const formula of input.formulas) {
    collected.push({
      id: `formula:${formula.formulaKey}`,
      groups: [],
      supplement: false,
      auxiliary: true,
      sourceKindLabel: '公式',
      sourceName: formula.name,
      sourceKey: formula.formulaKey,
      momentLabel: null,
      targetLabel: null,
      valueSourceLabel: '已保存表达式',
      notes: ['公式只展示来源，不执行动态计算'],
      location: location(input.skillKey, 'FORMULA', formula.formulaKey, 'FORMULA', 'expression', [
        { kind: 'FIELD', field: 'expression' }
      ])
    });
  }
  for (const state of input.internalStates) {
    collected.push({
      id: `state:${state.stateKey}`,
      groups: [],
      supplement: false,
      auxiliary: true,
      sourceKindLabel: '内部状态',
      sourceName: state.name,
      sourceKey: state.stateKey,
      momentLabel: SKILL_INTERNAL_STATE_TYPE_LABELS[state.stateType],
      targetLabel: null,
      valueSourceLabel: state.stateType === 'MODE'
        ? `${state.detail.options.length} 个模式选项` : null,
      notes: [],
      location: location(input.skillKey, 'STATE', state.stateKey, 'INTERNAL_STATE', 'stateKey')
    });
    if (state.stateType === 'MODE') {
      for (const option of state.detail.options) {
        collected.push({
          id: `state:${state.stateKey}:option:${option.optionKey}`,
          groups: [],
          supplement: false,
          auxiliary: true,
          sourceKindLabel: '模式选项',
          sourceName: `${state.name} / ${option.name}`,
          sourceKey: `${state.stateKey} / ${option.optionKey}`,
          momentLabel: option.initial ? '初始选项' : null,
          targetLabel: null,
          valueSourceLabel: null,
          notes: [],
          location: location(input.skillKey, 'STATE', state.stateKey, 'INTERNAL_STATE', `detail.options[optionKey=${option.optionKey}]`, [
            { kind: 'FIELD', field: 'detail' },
            keyed('options', option.optionKey)
          ])
        });
      }
    }
  }

  const groups = {
    use: collected.filter((entry) => entry.groups.includes('use')),
    costCooldown: collected.filter((entry) => entry.groups.includes('costCooldown')),
    hit: collected.filter((entry) => entry.groups.includes('hit')),
    effect: collected.filter((entry) => entry.groups.includes('effect')),
    end: collected.filter((entry) => entry.groups.includes('end'))
  };
  return {
    groups,
    supplement: collected.filter((entry) => entry.supplement),
    auxiliary: collected.filter((entry) => entry.auxiliary)
  };
}
