import type { SkillProcess } from '../../../../types/skillProcess';
import type { SkillTriggerEventSource, SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';

export type ChargeHitContext = {
  skillKey: string;
  processes: readonly SkillProcess[];
  rules: readonly SkillTriggerRuleDetail[];
};

export function allowsChargeHitValue(eventSource: SkillTriggerEventSource, context: ChargeHitContext | undefined): boolean {
  if (!context || eventSource.eventType !== 'SKILL_HIT' || eventSource.detail.sourceSkillKey !== context.skillKey) return false;
  return context.processes.some(process => {
    if (process.skillKey !== context.skillKey || process.activationType !== 'ACTIVE') return false;
    const initial = context.rules.some(rule => rule.eventSource.eventType === 'SKILL_USED'
      && rule.eventSource.detail.sourceSkillKey === context.skillKey && rule.eventSource.detail.useKind === 'ACTIVE'
      && rule.eventSource.detail.castPhase === 'INITIAL' && rule.actions.some(action => action.actionType === 'START_PROCESS'
        && action.detail.processKey === process.processKey));
    return initial && process.steps.some(step => step.stepType === 'CHARGE' && (step.detail.releaseAtMaximum === true
      || context.rules.some(rule => rule.eventSource.eventType === 'SKILL_USED' && rule.eventSource.detail.sourceSkillKey === context.skillKey
        && rule.eventSource.detail.useKind === 'ACTIVE' && rule.eventSource.detail.castPhase === 'CHARGE_RELEASE'
        && rule.actions.some(action => action.actionType === 'ADVANCE_PROCESS' && action.detail.processKey === process.processKey
          && action.detail.stepKey === step.stepKey))));
  });
}
