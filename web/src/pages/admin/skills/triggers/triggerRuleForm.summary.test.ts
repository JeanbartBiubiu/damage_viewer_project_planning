import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import { conditionSummary, createEmptyConditionDraft, createEmptyGroupDraft, groupConditionSummary } from './triggerRuleForm';

describe('条件比较摘要', () => {
  it.each([
    { comparisonValue: fixedValue(0), expected: '0' },
    { comparisonValue: parameterValue('minimum_stacks'), expected: 'minimum_stacks' },
    { comparisonValue: formulaValue('threshold'), expected: 'threshold' }
  ])('显示比较符和取值 $expected', ({ comparisonValue, expected }) => {
    const event = createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE');
    expect(conditionSummary({ ...event, detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue } }))
      .toBe(`事件值比较 / 技能命中被法术护盾阻挡 / 等于 / ${expected}`);

    const status = createEmptyConditionDraft([], 'STATUS_CHECK');
    for (const [checkKind, label] of [['STACKS_COMPARE', '层数比较'], ['REMAINING_MS_COMPARE', '剩余时间比较']] as const) {
      expect(conditionSummary({ ...status, detail: {
        subject: 'CURRENT_TARGET', statusKey: 'marked', checkKind,
        sourceEffectKey: 'mark_effect', sourceResultKey: 'mark_result', comparator: 'GTE', comparisonValue
      } })).toBe(`战斗状态检查 / 当前目标 / marked / ${label} / 大于等于 / ${expected}`);
    }

    const internal = createEmptyConditionDraft([], 'INTERNAL_STATE_CHECK');
    for (const [valueKind, label] of [['VALUE', '数值'], ['REMAINING_MS', '剩余毫秒']] as const) {
      expect(conditionSummary({ ...internal, detail: {
        stateKey: 'charges', valueKind, optionKey: null, expectedBoolean: null, comparator: 'LTE', comparisonValue
      } })).toBe(`技能内部状态检查 / charges / ${label} / 小于等于 / ${expected}`);
    }
  });

  it.each([['PRESENT', '存在'], ['ABSENT', '不存在']] as const)('战斗状态 %s 不显示伪比较', (checkKind, label) => {
    const status = createEmptyConditionDraft([], 'STATUS_CHECK');
    expect(conditionSummary({ ...status, detail: { ...status.detail, statusKey: 'marked', checkKind, comparator: null, comparisonValue: null } }))
      .toBe(`战斗状态检查 / 当前目标 / marked / ${label}`);
  });

  it('内部状态的选中模式不显示伪比较', () => {
    const internal = createEmptyConditionDraft([], 'INTERNAL_STATE_CHECK');
    expect(conditionSummary({ ...internal, detail: {
      stateKey: 'mode', valueKind: 'OPTION_SELECTED', optionKey: 'empowered', expectedBoolean: null, comparator: null, comparisonValue: null
    } })).toBe('技能内部状态检查 / mode / 模式是否选中');
  });

  it.each([true, false])('内部状态的准备标记 %s 不显示伪比较', (expectedBoolean) => {
    const internal = createEmptyConditionDraft([], 'INTERNAL_STATE_CHECK');
    expect(conditionSummary({ ...internal, detail: {
      stateKey: 'ready', valueKind: 'ENABLED', optionKey: null, expectedBoolean, comparator: null, comparisonValue: null
    } })).toBe('技能内部状态检查 / ready / 准备标记是否启用');
  });

  it('条件组摘要保留固定零和并且关系', () => {
    const event = createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE');
    const status = createEmptyConditionDraft([], 'STATUS_CHECK');
    expect(groupConditionSummary({ ...createEmptyGroupDraft([]), conditions: [
      { ...event, sortOrder: '10', detail: { eventValueKey: 'SKILL_HIT_SPELL_SHIELD_BLOCKED', comparator: 'EQ', comparisonValue: fixedValue(0) } },
      { ...status, sortOrder: '20', detail: { ...status.detail, statusKey: 'marked' } }
    ] })).toBe('事件值比较 / 技能命中被法术护盾阻挡 / 等于 / 0 并且 战斗状态检查 / 当前目标 / marked / 存在');
  });
});
