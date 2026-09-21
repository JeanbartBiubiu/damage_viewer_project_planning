import { SKILL_TRIGGER_TARGET_CATEGORIES, type SkillTriggerEventType, type SkillTriggerTargetCategory, type SkillTriggerTargetCategoryCheckDetail } from '../../../../types/skillTriggerRule';

export const TARGET_CATEGORY_LABELS = {
  CHAMPION: '英雄',
  EPIC_MONSTER: '史诗野怪',
  MINION: '小兵',
  NON_EPIC_MONSTER: '非史诗野怪',
  STRUCTURE: '建筑'
} as const satisfies Record<SkillTriggerTargetCategory, string>;

export function allowsTargetCategoryCheck(eventType: SkillTriggerEventType): boolean {
  return eventType === 'SKILL_HIT'
    || eventType === 'BASIC_ATTACK_HIT'
    || eventType === 'KILL'
    || eventType === 'TAKEDOWN'
    || eventType === 'DAMAGE_PENDING'
    || eventType === 'DAMAGE_DEALT'
    || eventType === 'DAMAGE_TAKEN';
}

export function targetCategoryConditionHelp(eventType: SkillTriggerEventType): string {
  switch (eventType) {
    case 'SKILL_HIT':
    case 'BASIC_ATTACK_HIT':
      return '命中事件读取本次实际命中对象；匹配所选任一类别。';
    case 'KILL':
      return '击杀事件读取本次被击杀对象；匹配所选任一类别。';
    case 'TAKEDOWN':
      return '参与击杀事件读取本次死亡对象；匹配所选任一类别。';
    case 'DAMAGE_DEALT':
      return '造成伤害事件读取本次伤害承受对象；匹配所选任一类别。';
    case 'DAMAGE_PENDING':
      return '伤害待结算事件读取本次伤害来源对象；匹配所选任一类别。';
    case 'DAMAGE_TAKEN':
      return '受到伤害事件读取本次伤害来源对象；匹配所选任一类别。';
    default:
      return '当前事件不提供事件对方类别。';
  }
}

export function targetCategoryConditionError(detail: SkillTriggerTargetCategoryCheckDetail, eventType: SkillTriggerEventType): string | null {
  if (!allowsTargetCategoryCheck(eventType)) return '事件对方类别仅用于技能命中、普攻命中、来源对象完成击杀、来源对象参与击杀、伤害待结算、来源对象造成伤害或来源对象受到伤害事件。';
  if (!Array.isArray(detail.categories) || detail.categories.length === 0) return '至少选择一个事件对方类别。';
  if (new Set(detail.categories).size !== detail.categories.length
    || detail.categories.some((category) => !SKILL_TRIGGER_TARGET_CATEGORIES.includes(category))) {
    return '事件对方类别不能重复或包含未知类别。';
  }
  return null;
}
