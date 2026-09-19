import { describe, expect, it } from 'vitest';
import { allowsSkillHitEnemy, skillHitEnemyError, skillHitEnemyHelp } from './skillHitEnemyCondition';
import {
  analyzeEventSwitchImpact, applyEventSwitchCleanup, conditionSummary,
  createEmptyConditionDraft, createEmptyEventSource, createEmptyRuleDraft,
  fromDetail, switchConditionType, toCreateRequest, validateSkillTriggerDraft
} from './triggerRuleForm';

function makeDraft() {
  const rule = createEmptyRuleDraft();
  return {
    ...rule, ruleKey: 'enemy_hit', name: '命中敌方',
    eventSource: createEmptyEventSource('SKILL_HIT'),
    conditionGroups: [{
      draftId: 'enemy-group', groupKey: 'enemy', name: '命中敌方对象', sortOrder: '10',
      conditions: [createEmptyConditionDraft([], 'SKILL_HIT_TARGET_IS_ENEMY')]
    }],
    actions: [{ ...rule.actions[0], name: '执行伤害', detail: { effectKey: 'primary_hit' } }]
  };
}

describe('技能命中敌方对象的管理条件', () => {
  it('仅技能命中可选，说明未知关系不能推定为敌方', () => {
    expect(allowsSkillHitEnemy('SKILL_HIT')).toBe(true);
    expect(skillHitEnemyError('SKILL_HIT')).toBeNull();
    expect(skillHitEnemyHelp('SKILL_HIT')).toContain('自身、友方或关系未知时不匹配');
    expect(skillHitEnemyHelp('SKILL_HIT')).toContain('英雄类别或对象不同不能代替敌我关系');
    expect(allowsSkillHitEnemy('SKILL_USED')).toBe(false);
    expect(skillHitEnemyError('BASIC_ATTACK_HIT')).toContain('仅用于技能命中事件');
  });

  it('草稿、保存载荷和重开回显保持严格空明细', () => {
    const draft = makeDraft();
    expect(conditionSummary(draft.conditionGroups[0].conditions[0])).toBe('技能命中敌方对象');
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true }).ok).toBe(true);
    const request = toCreateRequest(draft);
    expect(request.conditionGroups[0].conditions[0]).toMatchObject({ conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', detail: {} });
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
  });

  it('切换条件清除原有数值字段', () => {
    const original = createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE');
    const enemy = switchConditionType(original, 'SKILL_HIT_TARGET_IS_ENEMY');
    expect(enemy.detail).toEqual({});
    expect(switchConditionType(enemy, 'STATUS_CHECK').detail).not.toHaveProperty('attributeKey');
  });

  it('事件改变会提示并移除因此为空的条件组', () => {
    const draft = makeDraft(), next = createEmptyEventSource('SKILL_USED');
    expect(analyzeEventSwitchImpact(draft, next).summary).toContain('清除技能命中敌方对象条件');
    expect(applyEventSwitchCleanup(draft, next).conditionGroups).toEqual([]);
    expect(draft.conditionGroups).toHaveLength(1);
  });

  it('清理仅移除失效条件，并拒绝未经清理的错误事件组合', () => {
    const draft = makeDraft();
    draft.conditionGroups[0].conditions.push(createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE'));
    const next = createEmptyEventSource('SKILL_USED');
    expect(applyEventSwitchCleanup(draft, next).conditionGroups[0].conditions.map(c => c.conditionType)).toEqual(['ATTRIBUTE_COMPARE']);
    expect(validateSkillTriggerDraft({ ...makeDraft(), eventSource: next }, { includeRuleKey: true }).ok).toBe(false);
  });
});
