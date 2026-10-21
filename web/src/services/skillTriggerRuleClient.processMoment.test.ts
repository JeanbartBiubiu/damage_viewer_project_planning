import { describe, expect, it } from 'vitest';
import { parseSkillTriggerRuleDetail } from './skillTriggerRuleClient';

function rule() {
  return { ruleKey: 'phase_hit', name: '实际阶段命中', description: null, sortOrder: 0,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'configured_skill', processMoment: {
      processKey: 'cast', moment: { momentType: 'STEP_EXECUTION', stepKey: 'second' }, requiresPriorStepKey: 'first'
    } } }, conditionGroups: [], actions: [], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null };
}

describe('阶段实际命中协议', () => {
  it('无损解析完整阶段及明确null依赖，隐式末尾继续省略字段', () => {
    const input = rule();
    expect(parseSkillTriggerRuleDetail(input).eventSource).toEqual(input.eventSource);
    input.eventSource.detail.processMoment.requiresPriorStepKey = null as unknown as string;
    expect(parseSkillTriggerRuleDetail(input).eventSource).toEqual(input.eventSource);
    const implicit = { ...rule(), eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'configured_skill' } } };
    expect(parseSkillTriggerRuleDetail(implicit).eventSource).toEqual(implicit.eventSource);
  });

  it.each(['null', 'undefined', 'missing_prior', 'extra_moment', 'missing_process', 'bad_moment', 'null_source', 'extra_phase'])(
    '拒绝损坏的显式阶段：%s', kind => {
      const input = rule();
      const detail = input.eventSource.detail as unknown as Record<string, unknown>;
      const phase = detail.processMoment as Record<string, unknown>;
      if (kind === 'null') detail.processMoment = null;
      if (kind === 'undefined') detail.processMoment = undefined;
      if (kind === 'missing_prior') delete phase.requiresPriorStepKey;
      if (kind === 'extra_moment') (phase.moment as Record<string, unknown>).failureReason = null;
      if (kind === 'missing_process') phase.processKey = '';
      if (kind === 'bad_moment') (phase.moment as Record<string, unknown>).momentType = 'PROCESS_COMPLETE';
      if (kind === 'null_source') detail.sourceSkillKey = null;
      if (kind === 'extra_phase') phase.extra = 1;
      expect(() => parseSkillTriggerRuleDetail(input)).toThrow('processMoment');
    }
  );
});
