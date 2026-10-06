import type { SkillActionInput } from '../../engine/skillActionRequest';
import type { SimulationPlannedSkill, SimulationSkillPhase } from '../../types/simulationSnapshot';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import type { SkillConfiguration } from '../../types/skillConfiguration';

export function plannedSkillsFromActions(actions: readonly SkillActionInput[]): SimulationPlannedSkill[] {
  const plans = new Map<string, SimulationPlannedSkill>();
  if (actions.length > 64) throw new Error('本次最多64条明确技能指令');
  for (const action of actions) {
    const identity = simulationSkillSourceIdentity(action.origin, action.skillKey);
    const previous = plans.get(identity);
    if (previous && previous.skillLevel !== action.skillLevel) throw new Error('同一真实来源只能有一个技能等级');
    if (!['INITIAL', 'CHARGE_RELEASE', 'RECAST', 'CANCEL'].includes(action.phaseKind)) throw new Error('未知技能控制阶段');
    const phases = new Set<SimulationSkillPhase>(previous?.phaseKinds ?? ['INITIAL']);
    phases.add(action.phaseKind);
    plans.set(identity, { origin: action.origin, skillKey: action.skillKey, skillLevel: action.skillLevel, phaseKinds: [...phases].sort() });
  }
  if (plans.size > 16) throw new Error('本次最多16份不同真实角色来源');
  return [...plans].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, plan]) => plan);
}

export function compareSkillActions(left: SkillActionInput, right: SkillActionInput): number {
  return left.atMs - right.atMs || left.sortOrder - right.sortOrder
    || (left.instructionKey < right.instructionKey ? -1 : left.instructionKey > right.instructionKey ? 1 : 0);
}

export function skillActionParentCandidates(actions: readonly SkillActionInput[], action: SkillActionInput): SkillActionInput[] {
  const identity = simulationSkillSourceIdentity(action.origin, action.skillKey);
  return actions.filter(parent => parent.phaseKind === 'INITIAL' && parent.instructionKey !== action.instructionKey
    && Number.isSafeInteger(parent.atMs) && parent.atMs >= 0 && Number.isSafeInteger(action.atMs) && action.atMs >= 0
    && Number.isSafeInteger(parent.sortOrder) && Number.isSafeInteger(action.sortOrder)
    && parent.skillLevel === action.skillLevel && parent.targetSide === action.targetSide
    && simulationSkillSourceIdentity(parent.origin, parent.skillKey) === identity && compareSkillActions(parent, action) < 0)
    .sort(compareSkillActions);
}

export function removeSkillActionDraft(actions: readonly SkillActionInput[], instructionKey: string): SkillActionInput[] {
  return actions.filter(action => action.instructionKey !== instructionKey).map(action => action.parentInstructionKey === instructionKey
    ? { ...action, parentInstructionKey: null } : action);
}

export function skillActionPhases(configuration: SkillConfiguration | undefined): SimulationSkillPhase[] {
  if (!configuration) return ['INITIAL'];
  const phases = new Set<SimulationSkillPhase>();
  const processes = new Set(configuration.triggerRules.filter(rule => rule.eventSource.eventType === 'SKILL_USED'
    && rule.eventSource.detail.sourceSkillKey === configuration.skill.skillKey && rule.eventSource.detail.castPhase === 'INITIAL')
    .flatMap(rule => rule.actions.filter(action => action.actionType === 'START_PROCESS').map(action => action.detail.processKey)));
  for (const rule of configuration.triggerRules) {
    const event = rule.eventSource;
    if (event.eventType === 'SKILL_USED' && event.detail.sourceSkillKey === configuration.skill.skillKey && event.detail.useKind === 'ACTIVE'
      && event.detail.castPhase !== null && rule.actions.some(action => (event.detail.castPhase === 'INITIAL' ? action.actionType === 'START_PROCESS'
        : action.actionType === 'ADVANCE_PROCESS') && 'processKey' in action.detail && processes.has(action.detail.processKey))) phases.add(event.detail.castPhase);
    if (event.eventType === 'PROCESS_CANCEL_REQUESTED' && processes.has(event.detail.processKey) && rule.actions.some(action => action.actionType === 'FAIL_PROCESS'
      && action.detail.processKey === event.detail.processKey && action.detail.failureReason === 'ACTIVE_CANCELLED')) phases.add('CANCEL');
  }
  return [...phases].sort();
}
