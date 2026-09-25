import { describe, expect, it } from 'vitest';
import {
  createEmptyActionDraft,
  findStalePriorResultBindings,
  replaceDraftAction,
  validateDraftChildKey
} from './triggerRuleForm';

function actions() {
  const first = { ...createEmptyActionDraft([], 'EXECUTE_EFFECT'), actionKey: 'first', sortOrder: '10', detail: { effectKey: 'damage' } };
  const second = { ...createEmptyActionDraft([], 'EXECUTE_EFFECT'), actionKey: 'second', sortOrder: '20', detail: { effectKey: 'heal' }, runtimeInputBindings: [{
    bindingKey: 'prior_damage', parameterKey: 'amount', sourceType: 'PRIOR_ACTION_RESULT' as const,
    detail: { sourceActionKey: 'first', sourceResultKey: 'hit', outputKind: 'ACTUAL_HP_LOSS' as const }
  }] };
  return [first, second];
}

describe('未持久化触发子项的标识编辑', () => {
  it('确认前拒绝空、非法和重复标识，允许当前标识及未占用名称', () => {
    expect(validateDraftChildKey('  ', '动作标识', ['action_1'])).toBeTruthy();
    expect(validateDraftChildKey('bad key', '动作标识', ['action_1'])).toBeTruthy();
    expect(validateDraftChildKey(' action_2 ', '动作标识', ['action_1', 'action_2'], 'action_1')).toContain('重复');
    expect(validateDraftChildKey(' action_1 ', '动作标识', ['action_1'], 'action_1')).toBeNull();
    expect(validateDraftChildKey('apply_root', '动作标识', ['action_1'], 'action_1')).toBeNull();
    expect(validateDraftChildKey('cond_2', '条件标识', ['cond_1'], 'cond_1')).toBeNull();
  });

  it('改名原子保留后续动作的结果引用，不修改输入或其他身份', () => {
    const original = actions();
    const before = structuredClone(original);
    const next = replaceDraftAction(original, 0, { ...original[0], actionKey: 'apply_damage' });
    expect(original).toEqual(before);
    expect(next[0].actionKey).toBe('apply_damage');
    expect(next[1].runtimeInputBindings[0]).toEqual({
      ...before[1].runtimeInputBindings[0],
      detail: { ...before[1].runtimeInputBindings[0].detail, sourceActionKey: 'apply_damage' }
    });
    expect(next[1].detail).toEqual(before[1].detail);
  });

  it('后续编辑可按新键再次改名，原引用继续指向同一动作', () => {
    const first = actions();
    const next = replaceDraftAction(first, 0, { ...first[0], actionKey: 'renamed' });
    const again = replaceDraftAction(next, 0, { ...next[0], actionKey: 'final_name' });
    expect(again[1].runtimeInputBindings[0].detail).toMatchObject({sourceActionKey:'final_name'});
  });

  it('改名改变同排序动作先后时，既有引用验证能阻止失效关联', () => {
    const first = actions();
    first[1].sortOrder = '10';
    const next = replaceDraftAction(first, 0, { ...first[0], actionKey: 'zzz' });
    expect(findStalePriorResultBindings(next, new Map())).toMatchObject([
      {actionKey: 'second', bindingKeys: ['prior_damage']}
    ]);
    expect(first[1].runtimeInputBindings).toHaveLength(1);
  });
});
