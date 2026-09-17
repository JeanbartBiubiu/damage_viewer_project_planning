import type { SkillTriggerEventType } from '../../../../types/skillTriggerRule';

export function allowsExplicitTargetIsSource(eventType: SkillTriggerEventType): boolean {
  return eventType === 'SKILL_USED';
}

export function explicitTargetIsSourceHelp(eventType: SkillTriggerEventType): string {
  return allowsExplicitTargetIsSource(eventType)
    ? '仅当本次技能使用确实携带显式目标，且显式目标就是来源对象时匹配；无显式目标时不匹配。'
    : '只有技能使用事件提供显式目标身份检查。';
}

export function explicitTargetIsSourceError(eventType: SkillTriggerEventType): string | null {
  return allowsExplicitTargetIsSource(eventType)
    ? null
    : '显式目标为来源对象条件仅用于技能使用事件。';
}
