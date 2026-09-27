import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { BuildGroup, BuildOption } from '../../../types/build';
import {
  applySlotPatch,
  buildReadbackConfirmedMissing,
  buildWriteResultIsUncertain,
  emptySelectionRulesDraft,
  emptySlotDraft,
  selectionRulesFromDraft,
  validateGrantDraft,
  validateGroupDraft,
  validateOptionDraft,
  validateSystemDraft,
  type BuildGroupDraft,
  type BuildOptionDraft,
  type BuildSystemDraft
} from './buildForm';

const time = { createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' };
const press: BuildOption = { ...time, gameId: 'g', systemKey: 'paths', optionKey: 'press', name: '强攻', description: null, maxRank: 1, rankCosts: [0] };
const systemDraft = (): BuildSystemDraft => ({
  systemKey: 'paths', name: '系', description: '', configurationMode: 'SLOT_SELECTION', sortOrder: '0',
  selectionRules: emptySelectionRulesDraft()
});

describe('build form drafts', () => {
  it('does not invent rule values for a new system or slot', () => {
    expect(systemDraft().selectionRules.maximumSource).toBe('');
    expect(emptySlotDraft()).toMatchObject({ minimumSelections: '', maximumSelections: '' });
    expect(validateSystemDraft({ ...systemDraft(), configurationMode: '' }, true, [], []).configurationMode)
      .toContain('请选择');
  });

  it('distinguishes definite validation failures from uncertain writes and confirmed missing readback', () => {
    expect(buildWriteResultIsUncertain(new TypeError('network'))).toBe(true);
    expect(buildWriteResultIsUncertain(new ApiRequestError('server', 500))).toBe(true);
    expect(buildWriteResultIsUncertain(new ApiRequestError('timeout', 408))).toBe(true);
    expect(buildWriteResultIsUncertain(new ApiRequestError('invalid', 400))).toBe(false);
    expect(buildReadbackConfirmedMissing(new ApiRequestError('missing', 404))).toBe(true);
  });

  it('keeps an existing slot key unchanged until the slot is deleted', () => {
    const slot = { ...emptySlotDraft(), slotKey: 'keystone', name: '基石', persisted: true };
    expect(applySlotPatch(slot, { slotKey: 'renamed', name: '新名称' })).toEqual(slot);
    expect(applySlotPatch({ ...slot, persisted: false }, { slotKey: 'renamed' }).slotKey).toBe('renamed');
  });

  it('rejects slot ranks above one, nonzero costs without a budget, and repeated point options', () => {
    const option: BuildOptionDraft = { optionKey: 'press', name: '强攻', description: '', maxRank: '2', rankCosts: ['0', '1'] };
    expect(validateOptionDraft(option, true, 'SLOT_SELECTION', false).maxRank).toContain('只能为 1');
    expect(validateOptionDraft({ ...option, maxRank: '1', rankCosts: ['1'] }, true, 'SLOT_SELECTION', false)['rankCosts[0]']).toContain('必须为 0');
    const group: BuildGroupDraft = {
      groupKey: 'pool', name: '池', description: '', sortOrder: '0',
      slots: [
        { ...emptySlotDraft(), slotKey: 'one', name: '一', optionKeys: ['press'] },
        { ...emptySlotDraft(), slotKey: 'two', name: '二', optionKeys: ['press'] }
      ]
    };
    const other: BuildGroup = { ...time, gameId: 'g', systemKey: 'paths', groupKey: 'other', name: '其他', description: null, sortOrder: 0, slots: [{ slotKey: 'taken', name: '已用', minimumSelections: 0, maximumSelections: 1, optionKeys: ['press'] }] };
    expect(validateGroupDraft(group, true, [press], [], 'POINT_ALLOCATION')['slots[1].optionKeys[0]']).toContain('最多出现一次');
    expect(validateGroupDraft({ ...group, slots: [group.slots[0]!] }, true, [press], [other], 'POINT_ALLOCATION')['slots[0].optionKeys[0]']).toContain('最多出现一次');
  });

  it('rejects cyclic prerequisites and does not submit a disabled budget', () => {
    const draft = systemDraft();
    draft.selectionRules.prerequisites = [
      { optionKey: 'press', minimumRank: '1', requiredOptionKey: 'other', requiredMinimumRank: '1' },
      { optionKey: 'other', minimumRank: '1', requiredOptionKey: 'press', requiredMinimumRank: '1' }
    ];
    draft.selectionRules.budgetEnabled = true;
    draft.selectionRules.budgetKey = 'points';
    draft.selectionRules.budgetName = '点数';
    draft.selectionRules.maximumSource = 'SCENARIO_INPUT';
    draft.selectionRules.fixedMaximum = '8';
    const options = [press, { ...press, optionKey: 'other', name: '其他' }];
    expect(validateSystemDraft(draft, true, [], options)['selectionRules.prerequisites']).toContain('循环');
    expect(validateSystemDraft(draft, true, [], options)['selectionRules.budget.fixedMaximum']).toContain('留空');
    draft.selectionRules.prerequisites = [];
    draft.selectionRules.budgetEnabled = false;
    draft.selectionRules.fixedMaximum = '8';
    expect(validateSystemDraft(draft, true, [], options)).toEqual({});
    expect(selectionRulesFromDraft(draft.selectionRules).budget).toBeNull();
  });

  it('keeps disabled grant semantics out of level changes and rejects slot grants that follow option rank', () => {
    expect(validateGrantDraft({
      activationRank: '1', skillLevelMode: 'SAME_AS_OPTION', fixedSkillLevel: '', sortOrder: '0', maxRank: 1, mode: 'SLOT_SELECTION', skillMaxLevel: 3
    }).skillLevelMode).toContain('固定技能等级');
    expect(validateGrantDraft({
      activationRank: '2', skillLevelMode: 'FIXED', fixedSkillLevel: '1', sortOrder: '0', maxRank: 1, mode: 'POINT_ALLOCATION', skillMaxLevel: 3
    }).activationRank).toContain('最高投入等级');
    expect(validateGrantDraft({
      activationRank: '1', skillLevelMode: 'SAME_AS_OPTION', fixedSkillLevel: '', sortOrder: '1', maxRank: 2, mode: 'POINT_ALLOCATION', skillMaxLevel: 3
    })).toEqual({});
  });
});
