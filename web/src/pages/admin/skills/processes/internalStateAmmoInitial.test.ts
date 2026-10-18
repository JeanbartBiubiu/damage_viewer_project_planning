import { describe, expect, it } from 'vitest';
import { simulationActiveAmmo } from '../../../../../tests/fixtures/simulationActiveAmmo';
import { parseSkillInternalState } from '../../../../services/skillInternalStateClient';
import { parseSkillTriggerRuleDetail } from '../../../../services/skillTriggerRuleClient';
import { fromDetail, toCreateRequest, validateSkillTriggerDraft } from '../triggers/triggerRuleForm';
import { buildCreateSkillInternalStateRequest, skillInternalStateToDraft, validateSkillInternalStateDraft } from './internalStateForm';

describe('弹药作者字段与动作管理保存回环', () => {
  it('库存及余时声明读回再保存不丢字段，也不补用户实际初值', () => {
    const { stock, configuration } = simulationActiveAmmo();
    const draft = skillInternalStateToDraft(parseSkillInternalState(stock));
    const result = validateSkillInternalStateDraft(draft, { includeStateKey: true, parameters: configuration.parameters });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(buildCreateSkillInternalStateRequest(result.normalized).detail).toEqual(stock.detail);
    expect(JSON.stringify(result.normalized.detail)).not.toContain('defaultValue');
  });
  it('整数计数的真实初值声明与旧静态结构分别保持', () => {
    const { phase, frozen, configuration } = simulationActiveAmmo();
    for (const state of [phase, frozen]) {
      const result = validateSkillInternalStateDraft(skillInternalStateToDraft(state), { includeStateKey: true, parameters: configuration.parameters });
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.normalized.detail).toEqual(state.detail);
    }
  });
  it.each(['reference', 'negative', 'fraction', 'reversed', 'target', 'missing_parameter', 'default_parameter'] as const)('状态声明错误保留草稿并拒绝保存 %s', variant => {
    const { stock, configuration } = simulationActiveAmmo();
    const draft = skillInternalStateToDraft(stock);
    if (variant === 'reference') draft.initialValueBinding!.parameterKey = 'initial_phase';
    if (variant === 'negative') draft.initialValueBinding!.detail.minValue = -1;
    if (variant === 'fraction') draft.initialValueBinding!.detail.maxValue = 3.5;
    if (variant === 'reversed') draft.initialValueBinding!.detail.minValue = 5;
    if (variant === 'target') draft.scope = 'TARGET';
    if (variant === 'missing_parameter') configuration.parameters = [];
    if (variant === 'default_parameter') configuration.parameters[0]!.fixedValue = 1;
    const before = structuredClone(draft);
    expect(validateSkillInternalStateDraft(draft, { includeStateKey: true, parameters: configuration.parameters })).toMatchObject({ ok: false });
    expect(draft).toEqual(before);
  });
  it('逐枚余时声明不能在切成整匣时静默丢弃', () => {
    const { stock, configuration } = simulationActiveAmmo();
    const draft = skillInternalStateToDraft(stock);
    draft.recoveryMode = 'ALL_AT_ONCE'; draft.recoveryStartCondition = 'WHEN_EMPTY';
    expect(validateSkillInternalStateDraft(draft, { includeStateKey: true, parameters: configuration.parameters })).toMatchObject({ ok: false });
    expect(draft.initialRemainingMsBinding).toBeDefined();
  });
  it('新减时动作客户端、草稿与请求保持同一状态和金额', () => {
    const { configuration, stock } = simulationActiveAmmo();
    const rule = configuration.triggerRules.find(row => row.ruleKey === 'refund')!;
    const parsed = parseSkillTriggerRuleDetail(rule);
    const draft = fromDetail(parsed, configuration.skill.skillKey);
    expect(toCreateRequest(draft).actions).toEqual(rule.actions);
    const result = validateSkillTriggerDraft(draft, { includeRuleKey: true, skillKey: configuration.skill.skillKey,
      parameters: configuration.parameters, statesByKey: new Map([[stock.stateKey, stock]]) });
    expect(result).toMatchObject({ ok: true });
  });
  it.each(['event', 'owner', 'target', 'bindings', 'modifiers', 'missing_numeric'] as const)('减时动作不扩大其它入口 %s', variant => {
    const { configuration, stock } = simulationActiveAmmo();
    const rule = configuration.triggerRules.find(row => row.ruleKey === 'refund')!;
    const draft = fromDetail(rule, configuration.skill.skillKey);
    const action = draft.actions[0]!;
    if (action.actionType !== 'MODIFY_INTERNAL_STATE') throw new Error('独立样例失效');
    if (variant === 'event') draft.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
    if (variant === 'owner') action.detail.stateSkillKey = 'other_skill';
    if (variant === 'target') action.targetContext = 'CURRENT_TARGET';
    if (variant === 'bindings') action.runtimeInputBindings.push({ bindingKey: 'fake', parameterKey: 'initial_stock', sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue: 0, maxValue: 4 } });
    if (variant === 'modifiers') action.resultModifiers.push({ resultKey: 'fake', fixedMultiplier: 2, fixedMinValue: null, fixedMaxValue: null });
    if (variant === 'missing_numeric') action.detail.value = { kind: 'FIXED', value: Number.NaN };
    expect(validateSkillTriggerDraft(draft, { includeRuleKey: true, skillKey: configuration.skill.skillKey,
      parameters: configuration.parameters, statesByKey: new Map([[stock.stateKey, stock]]) })).toMatchObject({ ok: false });
  });
});
