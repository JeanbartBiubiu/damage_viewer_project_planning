import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import { isCounterTargetTiming } from './counterTargetTiming';
import { parseSkillInternalState } from './skillInternalStateClient';
import { parseSkillTriggerRuleDetail } from './skillTriggerRuleClient';
import { targetTimingSample } from '../../tests/fixtures/targetTiming';

const phased = () => ({ kind: 'PHASED_TICK', processKey: 'one_tick', intervalValue: fixedValue(250), phasePolicy: 'PRESERVE_ON_EXTEND' });

describe('显式目标时序作者字段的严格解析', () => {
  it('两个分支保持准确字段，不给旧普通计数补入时序', () => {
    expect(isCounterTargetTiming(phased())).toBe(true);
    expect(isCounterTargetTiming({ kind: 'EXPIRY_PAYLOAD', processKey: 'detonate' })).toBe(true);
    const { count, phases, reservation } = targetTimingSample();
    expect(parseSkillInternalState(count)).toEqual(count);
    expect(parseSkillInternalState(count).detail).not.toHaveProperty('targetTiming');
    expect(parseSkillInternalState(phases[0])).toEqual(phases[0]);
    expect(parseSkillInternalState(reservation)).toEqual(reservation);
  });

  it.each([fixedValue(250), parameterValue('period_ms'), formulaValue('period')])('保留数值来源形状：%j', intervalValue => {
    expect(isCounterTargetTiming({ ...phased(), intervalValue })).toBe(true);
  });

  it.each([
    null, undefined, [], {}, { ...phased(), kind: 'UNKNOWN' }, { ...phased(), processKey: '' },
    { ...phased(), processKey: 'Other/Process' }, { ...phased(), phasePolicy: 'RESTART' },
    { ...phased(), phasePolicy: null }, { ...phased(), extra: 1 },
    { ...phased(), intervalValue: null }, { ...phased(), intervalValue: { kind: 'FIXED', value: 250, extra: 1 } },
    ...[0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY].map(value => ({ ...phased(), intervalValue: fixedValue(value) })),
    { kind: 'EXPIRY_PAYLOAD', processKey: 'detonate', phasePolicy: 'PRESERVE_ON_EXTEND' },
    { kind: 'EXPIRY_PAYLOAD', processKey: 'detonate', intervalValue: fixedValue(250) }
  ])('拒绝空值、未知枚举、混合分支和非法静态间隔：%j', value => {
    expect(isCounterTargetTiming(value)).toBe(false);
  });

  it.each([
    { scope: 'SKILL' }, { stateType: 'FLAG' },
    { detail: { initialValue: fixedValue(1) } }, { detail: { maxValue: fixedValue(2) } },
    { detail: { durationValue: null } }, { detail: { durationValue: fixedValue(0) } },
    { detail: { durationValue: fixedValue(1.5) } }, { detail: { initialValueBinding: null } },
    { detail: { targetTiming: null } }
  ])('状态响应拒绝不具备目标零初值、有限容量条件的声明：%j', mutation => {
    const state = structuredClone(targetTimingSample().phases[0]!);
    Object.assign(state, { ...mutation, detail: { ...state.detail, ...mutation.detail } });
    expect(() => parseSkillInternalState(state)).toThrow(/目标时序|数值取值/);
  });

  it('新动作与逐伤前值可准确往返，事件上下文不能错用', () => {
    const { onHit, killed } = targetTimingSample();
    expect(parseSkillTriggerRuleDetail(onHit)).toEqual(onHit);
    expect(parseSkillTriggerRuleDetail(killed)).toEqual(killed);
    for (const eventSource of [
      { eventType: 'BASIC_ATTACK_HIT', detail: {} },
      { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'sample_active', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } }
    ]) expect(() => parseSkillTriggerRuleDetail({ ...onHit, eventSource })).toThrow();
    expect(() => parseSkillTriggerRuleDetail({ ...killed, eventSource: { eventType: 'DAMAGE_TAKEN', detail: killed.eventSource.detail } })).toThrow(/valueKind/);
    const extra = structuredClone(killed);
    Object.assign(extra.conditionGroups[0]!.conditions[0]!.detail, { unknown: 1 });
    expect(() => parseSkillTriggerRuleDetail(extra)).toThrow();
  });
});
