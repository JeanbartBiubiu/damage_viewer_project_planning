import { describe, expect, it } from 'vitest';
import { targetTimingSample } from '../../../../../tests/fixtures/targetTiming';
import { fixedValue } from '../../../../types/numericValue';
import { buildUpdateSkillInternalStateRequest, skillInternalStateToDraft, validateSkillInternalStateDraft } from './internalStateForm';

describe('目标时序管理状态往返', () => {
  it.each(['PHASED_TICK', 'EXPIRY_PAYLOAD'] as const)('准确回填并保存%s声明，不丢失过程或节拍', kind => {
    const sample = targetTimingSample();
    const state = kind === 'PHASED_TICK' ? sample.phases[0]! : sample.reservation;
    const draft = skillInternalStateToDraft(state);
    const result = validateSkillInternalStateDraft(draft, { includeStateKey: false, catalog: { formulas: [] }, parameters: sample.configuration.parameters });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const saved = buildUpdateSkillInternalStateRequest(result.normalized);
    expect(saved.detail).toEqual(state.detail);
    expect(saved.scope).toBe('TARGET');
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('拒绝非法间隔%s', value => {
    const draft = skillInternalStateToDraft(targetTimingSample().phases[0]!);
    if (draft.targetTiming?.kind !== 'PHASED_TICK') throw new Error('需要周期');
    draft.targetTiming.intervalValue = fixedValue(value);
    expect(validateSkillInternalStateDraft(draft, { includeStateKey: false, catalog: { formulas: [] }, parameters: [] }).ok).toBe(false);
  });
  it('零初值和容量不能借表单变更绕过', () => {
    const draft = skillInternalStateToDraft(targetTimingSample().phases[0]!);
    draft.initialValue = fixedValue(1);
    expect(validateSkillInternalStateDraft(draft, { includeStateKey: false, catalog: { formulas: [] }, parameters: [] }).ok).toBe(false);
    draft.initialValue = fixedValue(0); draft.maxValue = fixedValue(2);
    expect(validateSkillInternalStateDraft(draft, { includeStateKey: false, catalog: { formulas: [] }, parameters: [] }).ok).toBe(false);
  });
});
