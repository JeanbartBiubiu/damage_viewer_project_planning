import { describe, expect, it } from 'vitest';
import type { SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';
import { simulationEmpoweredSample } from '../../../../../tests/fixtures/simulationMixedSkills';
import { fromDetail, isTriggerRuleDraftDirty, toUpdateRequest } from './triggerRuleForm';

describe('真实条件状态归属的完整保存', () => {
  it('已存空归属不自动填当前技能，明确填写必须产生真正差异并发送归属', () => {
    const snapshot = simulationEmpoweredSample();
    const configuration = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'item_1043_passive')!;
    const detail = structuredClone(configuration.triggerRules[0]!) as SkillTriggerRuleDetail;
    Object.assign(detail.conditionGroups[0]!.conditions[0]!.detail, { stateSkillKey: null });
    const baseline = fromDetail(detail, configuration.skill.skillKey);
    expect((baseline.conditionGroups[0]!.conditions[0]!.detail as { stateSkillKey: string | null }).stateSkillKey).toBeNull();
    const draft = structuredClone(baseline);
    Object.assign(draft.conditionGroups[0]!.conditions[0]!.detail, { stateSkillKey: configuration.skill.skillKey });
    expect(isTriggerRuleDraftDirty(draft, baseline)).toBe(true);
    expect(toUpdateRequest(draft).conditionGroups[0]!.conditions[0]!.detail).toMatchObject({ stateSkillKey: configuration.skill.skillKey });
    expect(detail.conditionGroups[0]!.conditions[0]!.detail).toMatchObject({ stateSkillKey: null });
  });
});
