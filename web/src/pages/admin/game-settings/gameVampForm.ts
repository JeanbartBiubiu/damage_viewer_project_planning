import type { Attribute } from '../../../types/attribute';
import { GAME_VAMP_TYPES, sortGameVampRules, type GameVampRule, type GameVampRulesResponse } from '../../../types/gameVamp';
import type { SkillCategory } from '../../../types/skillCategory';

export type GameVampRuleDraft = Omit<GameVampRule, 'defaultEfficiency'> & { defaultEfficiency: number | undefined };

export function createGameVampRuleDraft(vampType: GameVampRule['vampType']): GameVampRuleDraft {
  return { vampType, sourceAttributeKey: '', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: undefined,
    deliveryKinds: [], originKinds: [], skillCategoryKeys: [] };
}

export function validateGameVampRules(
  rules: readonly GameVampRuleDraft[],
  attributes: readonly Attribute[],
  categories: readonly SkillCategory[]
): { ok: true; value: GameVampRulesResponse } | { ok: false; message: string } {
  const seen = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const error = (message: string) => ({ ok: false as const, message: `第${index + 1}条吸血规则：${message}` });
    if (!GAME_VAMP_TYPES.includes(rule.vampType) || seen.has(rule.vampType)) return error('种类无效或重复。');
    seen.add(rule.vampType);
    if (!attributes.some((item) => item.attributeKey === rule.sourceAttributeKey && item.valueType === 'DECIMAL')) {
      return error('请选择当前游戏中现有的十进制比例属性。');
    }
    if (!['POST_DEFENSE_DAMAGE', 'ACTUAL_HP_LOSS'].includes(rule.basisOutputKind)) return error('请选择计算基数。');
    if (rule.defaultEfficiency === undefined || !Number.isFinite(rule.defaultEfficiency) || rule.defaultEfficiency < 0) {
      return error('默认效率必须明确填写为有限非负数，零值合法。');
    }
    for (const [values, allowed, label] of [
      [rule.deliveryKinds, ['SKILL', 'BASIC_ATTACK'], '伤害产生方式'],
      [rule.originKinds, ['DIRECT', 'REFLECTED'], '伤害来源性质'],
      [rule.skillCategoryKeys, categories.map((item) => item.skillCategoryKey), '技能分类']
    ] as const) {
      if (!values.length || new Set(values).size !== values.length || values.some((value) => !(allowed as readonly string[]).includes(value))) {
        return error(`${label}必须至少选择一项，且不能重复或引用缺失项目。`);
      }
    }
  }
  return { ok: true, value: { rules: sortGameVampRules(rules as GameVampRule[]) } };
}
