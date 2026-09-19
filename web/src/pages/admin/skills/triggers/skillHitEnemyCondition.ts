import type { SkillTriggerEventType } from '../../../../types/skillTriggerRule';

export function allowsSkillHitEnemy(eventType: SkillTriggerEventType): boolean {
  return eventType === 'SKILL_HIT';
}

export function skillHitEnemyHelp(eventType: SkillTriggerEventType): string {
  return allowsSkillHitEnemy(eventType)
    ? '仅当本次命中对象明确属于技能拥有者的敌方时匹配；自身、友方或关系未知时不匹配。英雄类别或对象不同不能代替敌我关系。'
    : '只有技能命中事件可检查命中对象是否为敌方。';
}

export function skillHitEnemyError(eventType: SkillTriggerEventType): string | null {
  return allowsSkillHitEnemy(eventType)
    ? null
    : '技能命中敌方对象条件仅用于技能命中事件。';
}
