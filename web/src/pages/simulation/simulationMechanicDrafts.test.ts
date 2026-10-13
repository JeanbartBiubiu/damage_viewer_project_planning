import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mechanicStateIdentity, type SimulationMechanicRequirement } from '../../engine/simulationPrimaryAttack';
import { SimulationMechanicInputs } from './SimulationMechanicInputs';
import { mechanicDraftIssues, mechanicDraftValue, mechanicInputsFromDrafts } from './simulationMechanicDrafts';

const requirement: SimulationMechanicRequirement = { side: 'source', origin: { kind: 'CHARACTER', characterKey: 'authored_owner' },
  skillKey: 'authored_primary', stateKey: 'inventory', initialValue: 4, maxValue: 4, skillName: '配置普攻', name: '弹药' };
describe('机制初值草稿与页面', () => {
  it('未编辑显示声明初值但不增加显式覆盖；清空保留缺输入而不回4', () => {
    const key = mechanicStateIdentity(requirement);
    expect(mechanicDraftValue(requirement, {})).toBe(4);
    expect(mechanicInputsFromDrafts([requirement], {})).toEqual([]);
    const cleared = { [key]: undefined };
    expect(mechanicDraftValue(requirement, cleared)).toBeUndefined();
    expect(mechanicDraftIssues([requirement], cleared)).toHaveLength(1);
    expect(() => mechanicInputsFromDrafts([requirement], cleared)).toThrow(/清空/);
    expect(mechanicDraftValue({ ...requirement, initialValue: 1 }, cleared)).toBeUndefined();
  });
  it.each([0, 1, 4])('明确%d不当成缺值，进入完整来源身份覆盖', value => {
    const drafts = { [mechanicStateIdentity(requirement)]: value };
    expect(mechanicDraftIssues([requirement], drafts)).toEqual([]);
    expect(mechanicInputsFromDrafts([requirement], drafts)).toEqual([{ side: requirement.side, origin: requirement.origin,
      skillKey: requirement.skillKey, stateKey: requirement.stateKey, value }]);
  });
  it('旧来源草稿不套用新英雄、技能或状态；禁用后不提交旧覆盖，返回时保留草稿', () => {
    const drafts = { [mechanicStateIdentity(requirement)]: 1 };
    for (const other of [{ ...requirement, side: 'target' as const }, { ...requirement, skillKey: 'other' },
      { ...requirement, origin: { kind: 'CHARACTER' as const, characterKey: 'other' } }, { ...requirement, stateKey: 'other' }]) {
      expect(mechanicDraftValue(other, drafts)).toBe(4);
      expect(mechanicInputsFromDrafts([other], drafts)).toEqual([]);
    }
    expect(mechanicInputsFromDrafts([], drafts)).toEqual([]);
    expect(mechanicDraftValue(requirement, drafts)).toBe(1);
  });
  it('真实输入组件只显示声明弹药，并明确0、清空与容量含义', () => {
    expect(renderToStaticMarkup(createElement(SimulationMechanicInputs, { requirements: [], drafts: {}, disabled: false, onChange: () => {} }))).toBe('');
    const markup = renderToStaticMarkup(createElement(SimulationMechanicInputs, { requirements: [requirement],
      drafts: { [mechanicStateIdentity(requirement)]: 0 }, disabled: false, onChange: () => {} }));
    expect(markup).toContain('aria-label="机制初值"'); expect(markup).toContain('value="0"');
    expect(markup).toContain('0表示空弹'); expect(markup).toContain('不自动补满');
  });
});
