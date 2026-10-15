import { validateAutomaticSkillRelations, type AutomaticSkillInput } from '../../engine/automaticSkillRequest';
import { simulationSkillSourceIdentity } from '../../services/simulationSkillSourceIdentity';
import type { SimulationSkillSetting } from '../../types/simulationSnapshot';
import type { SimulationEntityOption } from './simulationSelectionOptions';

export function moveAutomaticSkillRule(rules: readonly AutomaticSkillInput[], ruleKey: string, direction: -1 | 1): AutomaticSkillInput[] {
  const result = [...rules].sort((left, right) => left.sortOrder - right.sortOrder);
  const index = result.findIndex(rule => rule.ruleKey === ruleKey);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= result.length) return result;
  [result[index], result[destination]] = [result[destination]!, result[index]!];
  return result.map((rule, position) => ({ ...rule, sortOrder: position }));
}

export function removeAutomaticSkillRule(rules: readonly AutomaticSkillInput[], ruleKey: string): AutomaticSkillInput[] {
  const related = rules.find(rule => rule.ruleKey !== ruleKey && (rule.waitForCooldowns.includes(ruleKey) || rule.releaseAfterRuleKey === ruleKey));
  if (related) throw new Error(`automaticSkills.rules.${related.ruleKey}: 仍引用${ruleKey}，请先明确修改关联冷却或前置资格；原草稿已保留`);
  return rules.filter(rule => rule.ruleKey !== ruleKey).sort((left, right) => left.sortOrder - right.sortOrder)
    .map((rule, index) => ({ ...rule, sortOrder: index }));
}

export function automaticSkillDraftIssues(rules: readonly AutomaticSkillInput[], characterKey: string, options: readonly SimulationEntityOption[],
  settings: readonly SimulationSkillSetting[], clearedLevels: Record<string, boolean>): string[] {
  const issues: string[] = [];
  try { validateAutomaticSkillRelations(rules); } catch (cause) { issues.push(cause instanceof Error ? cause.message : String(cause)); }
  const identities = new Set<string>();
  rules.forEach((rule, index) => {
    const path = `automaticSkills.rules[${index}]`;
    const identity = simulationSkillSourceIdentity(rule.origin, rule.skillKey);
    const option = options.find(option => option.kind === 'skill' && option.key === rule.skillKey);
    const setting = settings.find(setting => simulationSkillSourceIdentity(setting.origin, setting.skillKey) === identity);
    if (rule.origin.kind !== 'CHARACTER' || rule.origin.characterKey !== characterKey || !option) issues.push(`${path}.skillKey: 来源不再是当前攻击方已绑定技能，草稿仍保留`);
    if (identities.has(identity)) issues.push(`${path}.skillKey: 同一真实来源只能有一项自动规则`);
    identities.add(identity);
    if (setting?.enabled === false || setting?.skillLevel === 0 || clearedLevels[`source:${identity}`]) issues.push(`${path}: 所选来源关闭、0级未学或等级清空，请修正后重新读取；关联条件已保留`);
    if (!Number.isSafeInteger(rule.skillLevel) || rule.skillLevel <= 0 || option?.kind === 'skill' && rule.skillLevel > option.maxLevel
      || setting?.skillLevel !== undefined && setting.skillLevel > 0 && setting.skillLevel !== rule.skillLevel) issues.push(`${path}.skillLevel: 草稿与实际已学等级不一致`);
  });
  return issues;
}
