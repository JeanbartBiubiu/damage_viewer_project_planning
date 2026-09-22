import { describe, expect, it } from 'vitest';
import type { SkillEffect, SkillEffectResult } from '../../../../types/skillEffect';
import {
  canModifyResultValue, createEmptyActionDraft, createEmptyRuleDraft,
  hasNumericValueRule, validateSkillTriggerDraft, resultModifierTargetError
} from './triggerRuleForm';

const slow: SkillEffectResult = {
  resultKey: 'slow', name: '减速', resultType: 'STATUS_OPERATION', target: 'TARGET',
  description: null, sortOrder: 0, spellShieldBlockScope: null,
  valueRule: { value: { kind: 'FIXED', value: 0.3 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1 },
  detail: { statusKey: 'some_status', operation: 'APPLY' },
  lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
    reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }
};
const effect: SkillEffect = {
  gameId: 'lol', skillKey: 'ice', effectKey: 'slow_effect', name: '减速效果',
  description: null, sortOrder: 0, createdAt: '', updatedAt: '', lifecycle: null, results: [slow]
};

describe('普通减速触发动作约束', () => {
  it('缺失效果详情不能误报减速，详情重试成功后合法伤害修正原样通过', () => {
    const modifier = { resultKey: 'damage', fixedMultiplier: 2, fixedMinValue: null, fixedMaxValue: null };
    const before = structuredClone(modifier);
    expect(resultModifierTargetError(null, modifier.resultKey)).toBe('效果详情尚未加载或加载失败，请重试。');
    const damage: SkillEffectResult = { ...slow, resultKey: 'damage', resultType: 'DAMAGE',
      lifecycleBehavior: null, valueRule: slow.valueRule!, detail: {
        damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'DIRECT',
        critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'UNRESOLVED', vampOverrides: []
      } };
    expect(resultModifierTargetError({ ...effect, results: [damage] }, modifier.resultKey)).toBeNull();
    expect(resultModifierTargetError(effect, 'slow')).toContain('状态操作不接受额外结果修正');
    expect(modifier).toEqual(before);
  });
  it('有数值规则仍不出现在额外结果修正选项中，其他数值结果保持可选', () => {
    expect(hasNumericValueRule(slow)).toBe(true);
    expect(canModifyResultValue(slow)).toBe(false);
    expect(canModifyResultValue({ ...slow, resultType: 'DIRECT_HEAL', valueRule: slow.valueRule!, detail: {} })).toBe(true);
  });

  it('父规则保存拒绝已有草稿中的减速结果修正，删除修正后可以保存', () => {
    const draft = createEmptyRuleDraft();
    draft.ruleKey = 'apply_slow';
    draft.name = '施加减速';
    draft.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
    draft.actions = [{ ...createEmptyActionDraft([], 'EXECUTE_EFFECT'),
      actionKey: 'apply', name: '施加', detail: { effectKey: 'slow_effect' },
      resultModifiers: [{ resultKey: 'slow', fixedMultiplier: 2, fixedMinValue: null, fixedMaxValue: null }]
    }];
    const options = { includeRuleKey: true, effectsByKey: new Map([['slow_effect', effect]]) };
    const rejected = validateSkillTriggerDraft(draft, options);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.nestedErrors).toContainEqual(expect.objectContaining({
      path: 'actions[0].resultModifiers[0].resultKey', message: expect.stringContaining('状态操作不接受额外结果修正')
    }));
    draft.actions[0].resultModifiers = [];
    expect(validateSkillTriggerDraft(draft, options).ok).toBe(true);
  });
});
