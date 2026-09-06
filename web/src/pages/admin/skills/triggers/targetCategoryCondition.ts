import { SKILL_TRIGGER_TARGET_CATEGORIES, type SkillTriggerEventType, type SkillTriggerTargetCategory, type SkillTriggerTargetCategoryCheckDetail } from '../../../../types/skillTriggerRule';

export const TARGET_CATEGORY_LABELS = {
  CHAMPION: '英雄',
  EPIC_MONSTER: '史诗野怪',
  MINION: '小兵',
  NON_EPIC_MONSTER: '非史诗野怪',
  STRUCTURE: '建筑'
} as const satisfies Record<SkillTriggerTargetCategory, string>;

export function allowsTargetCategoryCheck(eventType: SkillTriggerEventType): boolean {
  return eventType === 'SKILL_HIT' || eventType === 'BASIC_ATTACK_HIT';
}

export function targetCategoryConditionError(detail: SkillTriggerTargetCategoryCheckDetail, eventType: SkillTriggerEventType): string | null {
  if (!allowsTargetCategoryCheck(eventType)) return '命中目标类别仅用于技能命中或普攻命中事件。';
  if (!Array.isArray(detail.categories) || detail.categories.length === 0) return '至少选择一个命中目标类别。';
  if (new Set(detail.categories).size !== detail.categories.length
    || detail.categories.some((category) => !SKILL_TRIGGER_TARGET_CATEGORIES.includes(category))) {
    return '命中目标类别不能重复或包含未知类别。';
  }
  return null;
}
