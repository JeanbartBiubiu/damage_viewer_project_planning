import type { SkillStatus } from '../../../types/skill';
import type { SkillRelationOwnerKind } from '../../../types/skillRelation';

export type SkillRelationOption = { key: string; name: string; status: SkillStatus | null };
export type SkillRelationAddDraft = { selectedKey: string; sortOrder: string };

export function emptySkillRelationDraft(): SkillRelationAddDraft {
  return { selectedKey: '', sortOrder: '0' };
}

export function parseSkillRelationSortOrder(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error('排序必须是 0～2147483647 的整数。');
  const order = Number(normalized);
  if (!Number.isInteger(order) || order > 2147483647) throw new Error('排序必须是 0～2147483647 的整数。');
  return order;
}

export function skillRelationIdentity(kind: SkillRelationOwnerKind, ownerKey: string, skillKey: string): string {
  return JSON.stringify([kind, ownerKey, skillKey]);
}

export function skillRelationDraftIsDirty(
  drafts: Record<SkillRelationOwnerKind, SkillRelationAddDraft>,
  sortEdits: Record<string, string>
): boolean {
  return Object.values(drafts).some(draft => draft.selectedKey !== '' || draft.sortOrder !== '0')
    || Object.keys(sortEdits).length > 0;
}

export function availableSkillRelationOptions(options: SkillRelationOption[], existingKeys: string[]) {
  const existing = new Set(existingKeys);
  return options.filter(option => option.status !== 'DISABLED' && !existing.has(option.key));
}

export function skillRelationOptionMatches(option: Pick<SkillRelationOption, 'name' | 'key'>, input: string): boolean {
  const keyword = input.trim().toLocaleLowerCase();
  return option.name.toLocaleLowerCase().includes(keyword) || option.key.toLocaleLowerCase().includes(keyword);
}

export function skillRelationOptionsFromResponse(
  value: unknown, gameId: string, kind: SkillRelationOwnerKind | 'skill'
): SkillRelationOption[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('候选列表响应不符合接口约定。');
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.items) || data.total !== data.items.length) throw new Error('候选列表响应不符合接口约定。');
  const keys = new Set<string>();
  return data.items.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('候选对象响应不符合接口约定。');
    const item = value as Record<string, unknown>;
    const key = item[`${kind}Key`];
    if (item.gameId !== gameId || typeof key !== 'string' || !key.trim()
      || typeof item.name !== 'string' || !item.name.trim() || keys.has(key)) {
      throw new Error('候选对象响应不符合接口约定。');
    }
    if (kind === 'skill' && item.status !== 'ENABLED' && item.status !== 'DISABLED') {
      throw new Error('候选技能状态不符合接口约定。');
    }
    keys.add(key);
    return { key, name: item.name, status: kind === 'skill' ? item.status as SkillStatus : null };
  });
}
