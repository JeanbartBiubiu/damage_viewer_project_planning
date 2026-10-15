import { describe, expect, it } from 'vitest';
import type { AutomaticSkillInput } from '../../engine/automaticSkillRequest';
import { automaticSkillDraftIssues, moveAutomaticSkillRule, removeAutomaticSkillRule } from './simulationAutomaticSkillDrafts';

function chain(): AutomaticSkillInput[] {
  return ['a', 'b', 'c'].map((ruleKey, index) => ({ origin: { kind: 'CHARACTER', characterKey: 'actor' }, skillKey: `skill_${ruleKey}`, skillLevel: 1,
    ruleKey, sortOrder: index, targetSide: 'target', hitPreset: 'TARGET_HIT', waitForCooldowns: index === 0 ? ['b', 'c'] : [], releaseAfterRuleKey: index === 0 ? null : ['a', 'b'][index - 1]! }));
}
describe('自动循环草稿与失效关系保护', () => {
  it('移动只改优先顺序，稳定规则引用、来源和原草稿保留', () => {
    const rules = chain();
    const original = structuredClone(rules);
    const moved = moveAutomaticSkillRule(rules, 'b', -1);
    expect(moved.map(rule => rule.ruleKey)).toEqual(['b', 'a', 'c']);
    expect(moved.map(rule => rule.sortOrder)).toEqual([0, 1, 2]);
    expect(moved.find(rule => rule.ruleKey === 'a')!.waitForCooldowns).toEqual(['b', 'c']);
    expect(rules).toEqual(original);
  });
  it('删除被引用来源明确拒绝；修正后才移除，不静默删除条件', () => {
    const rules = chain();
    expect(() => removeAutomaticSkillRule(rules, 'b')).toThrow(/请先明确修改/);
    expect(rules).toHaveLength(3);
    rules[0]!.waitForCooldowns = ['c']; rules[2]!.releaseAfterRuleKey = 'a';
    expect(removeAutomaticSkillRule(rules, 'b').map(rule => rule.ruleKey)).toEqual(['a', 'c']);
  });
  it('关闭、未学、清空等级与更换攻击方均阻止提交，草稿关系仍可修正', () => {
    const rules = chain();
    const options = rules.map(rule => ({ kind: 'skill' as const, key: rule.skillKey, name: rule.ruleKey, maxLevel: 5 }));
    const settings = rules.map(rule => ({ origin: rule.origin, skillKey: rule.skillKey, enabled: true, skillLevel: 1 }));
    expect(automaticSkillDraftIssues(rules, 'actor', options, settings, {})).toEqual([]);
    settings[1]!.enabled = false;
    expect(automaticSkillDraftIssues(rules, 'actor', options, settings, {}).join(';')).toContain('来源关闭');
    settings[1]!.enabled = true; settings[1]!.skillLevel = 0;
    expect(automaticSkillDraftIssues(rules, 'actor', options, settings, {}).join(';')).toContain('未学');
    expect(automaticSkillDraftIssues(rules, 'other', options, settings, {}).join(';')).toContain('当前攻击方');
    expect(rules[2]!.releaseAfterRuleKey).toBe('b');
    expect(rules[0]!.waitForCooldowns).toEqual(['b', 'c']);
  });
});
