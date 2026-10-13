/** 作者分类与引擎普攻、施放及技能身份标记分别运输，不按分类原键赋予协议身份。 */
export const SKILL_CATEGORY_TYPE_PREFIX = 'ability/skill_category/';
export function skillCategoryTypeKey(categoryKey: string): string { return `${SKILL_CATEGORY_TYPE_PREFIX}${categoryKey}`; }
