import { describe, expect, it } from 'vitest';
import {
  availableSkillRelationOptions,
  emptySkillRelationDraft,
  parseSkillRelationSortOrder,
  skillRelationDraftIsDirty,
  skillRelationIdentity,
  skillRelationOptionMatches,
  skillRelationOptionsFromResponse
} from './skillRelationForm';

describe('skillRelationForm', () => {
  it.each(['', ' ', '-1', '1.5', '1e2', '2147483648', 'Infinity'])('rejects invalid sort input %j without coercing or clamping', value => {
    expect(() => parseSkillRelationSortOrder(value)).toThrow('排序必须');
  });

  it('accepts both sort boundaries', () => {
    expect(parseSkillRelationSortOrder('0')).toBe(0);
    expect(parseSkillRelationSortOrder(' 2147483647 ')).toBe(2147483647);
  });

  it('tracks all unsaved drafts including clearing an existing sort field', () => {
    const drafts = { character: emptySkillRelationDraft(), equipment: emptySkillRelationDraft() };
    expect(skillRelationDraftIsDirty(drafts, {})).toBe(false);
    expect(skillRelationDraftIsDirty({ ...drafts, equipment: { selectedKey: 'item', sortOrder: '0' } }, {})).toBe(true);
    expect(skillRelationDraftIsDirty({ ...drafts, character: { selectedKey: '', sortOrder: '4' } }, {})).toBe(true);
    expect(skillRelationDraftIsDirty(drafts, { row: '' })).toBe(true);
  });

  it('keeps composite identities distinct even when stable keys contain delimiters', () => {
    expect(skillRelationIdentity('character', 'a/b', 'c')).not.toBe(skillRelationIdentity('character', 'a', 'b/c'));
    expect(skillRelationIdentity('character', 'a', 'b')).not.toBe(skillRelationIdentity('equipment', 'a', 'b'));
  });

  it('excludes disabled skills and existing targets without deriving identity from prefixes', () => {
    expect(availableSkillRelationOptions([
      { key: 'same', name: '已挂载', status: 'ENABLED' },
      { key: 'disabled', name: '已停用', status: 'DISABLED' },
      { key: 'unusual/equipment-looking-key', name: '可用技能', status: 'ENABLED' },
      { key: 'character-without-status', name: '角色', status: null }
    ], ['same']).map(item => item.key)).toEqual(['unusual/equipment-looking-key', 'character-without-status']);
  });

  it('validates candidate game and enum values before offering a selection', () => {
    const skill = { gameId: 'g', skillKey: 's', name: '技能', status: 'ENABLED' };
    expect(skillRelationOptionsFromResponse({ items: [skill], total: 1 }, 'g', 'skill'))
      .toEqual([{ key: 's', name: '技能', status: 'ENABLED' }]);
    expect(() => skillRelationOptionsFromResponse({ items: [skill], total: 1 }, 'other', 'skill')).toThrow('接口约定');
    expect(() => skillRelationOptionsFromResponse({ items: [{ ...skill, status: 'UNKNOWN' }], total: 1 }, 'g', 'skill')).toThrow('接口约定');
    expect(() => skillRelationOptionsFromResponse({ items: [skill, skill], total: 2 }, 'g', 'skill')).toThrow('接口约定');
    expect(() => skillRelationOptionsFromResponse({ items: [skill], total: 100 }, 'g', 'skill')).toThrow('接口约定');
  });

  it('searches displayed Chinese names and stable keys without case sensitivity', () => {
    const option = { key: 'stage9_live_skill', name: '阶段九实测技能' };
    expect(skillRelationOptionMatches(option, ' 实测技能 ')).toBe(true);
    expect(skillRelationOptionMatches(option, 'STAGE9_LIVE')).toBe(true);
    expect(skillRelationOptionMatches(option, '不存在')).toBe(false);
  });
});
