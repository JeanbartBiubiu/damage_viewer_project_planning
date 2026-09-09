import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { Rune } from '../../../types/rune';
import { moveOrdered, normalizeRuneSlots, runeFieldErrors, validateRunePathDraft, type RunePathDraft } from './runeForm';
const common = { gameId: 'g', description: null, createdAt: 'now', updatedAt: 'now' };
const runes: Rune[] = [{ ...common, runeKey: 'shard', name: '碎片', category: 'SHARD' }, { ...common, runeKey: 'minor', name: '小符文', category: 'MINOR' }];
const draft: RunePathDraft = { pathKey: 'group', name: '分组', description: '', kind: 'SHARD_GROUP', sortOrder: '0', slots: [] };
describe('rune layout editing', () => {
  it('accepts empty layout, empty slot, and one shard identity reused across rows', () => {
    expect(validateRunePathDraft(draft, true, runes)).toEqual({});
    expect(validateRunePathDraft({ ...draft, slots: [{ name: '空行', category: 'SHARD', runeKeys: [] }, { name: '一', category: 'SHARD', runeKeys: ['shard'] }, { name: '二', category: 'SHARD', runeKeys: ['shard'] }] }, true, runes)).toEqual({});
  });
  it('locates duplicate row keys, missing identities, category mismatch and repeated ordinary rune', () => {
    expect(validateRunePathDraft({ ...draft, slots: [{ name: '一', category: 'SHARD', runeKeys: ['shard', 'shard', 'missing', 'minor'] }] }, true, runes)).toEqual({ 'slots[0].runeKeys[1]': '同一槽位不能重复放置同一符文。', 'slots[0].runeKeys[2]': '请选择当前游戏存在的符文。', 'slots[0].runeKeys[3]': '符文类别与槽位类别不一致。' });
    expect(validateRunePathDraft({ ...draft, kind: 'RUNE_PATH', slots: [{ name: '一', category: 'MINOR', runeKeys: ['minor'] }, { name: '二', category: 'MINOR', runeKeys: ['minor'] }] }, true, runes)).toHaveProperty('slots[1].runeKeys[0]');
  });
  it('reorders without changing the source array or duplicating identities', () => {
    const keys = ['a', 'b', 'c']; expect(moveOrdered(keys, 1, -1)).toEqual(['b', 'a', 'c']); expect(keys).toEqual(['a', 'b', 'c']);
    expect(moveOrdered(keys, 0, -1)).toEqual(keys);
    expect(normalizeRuneSlots([{ name: ' 一 ', category: 'SHARD', runeKeys: ['b', 'a'] }])).toEqual([{ name: '一', category: 'SHARD', runeKeys: ['b', 'a'] }]);
  });
  it('preserves backend array field locations for the draft', () => {
    const error = new ApiRequestError('冲突', 400, '400.INVALID_RUNE_PATH_REQUEST', { fieldIssues: [{ field: 'slots[1].runeKeys[2]', code: 'INVALID', message: '被另一分组引用' }] });
    expect(runeFieldErrors(error)).toEqual({ 'slots[1].runeKeys[2]': '被另一分组引用' });
  });
});
