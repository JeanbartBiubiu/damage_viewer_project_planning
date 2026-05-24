import type { SkillMountsFormData, SkillMountsSearchData } from './types';

export const SKILL_MOUNT_TARGET_CATEGORY_OPTIONS = [
  { label: '英雄', value: 'hero' },
  { label: '装备', value: 'item' },
  { label: '全局', value: 'global' },
  { label: '技能', value: 'skill' },
  { label: '类型', value: 'type' }
];

export function createSkillMountsSearchData(): SkillMountsSearchData {
  return {
    targetCategory: '',
    targetId: '',
    skillId: ''
  };
}

export function createSkillMountsFormData(): SkillMountsFormData {
  return {
    targetCategory: 'hero',
    targetId: '',
    skillId: '',
    enabled: true,
    extendText: '{\n  \n}'
  };
}
