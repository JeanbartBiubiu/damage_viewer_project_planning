import type { SkillStatus } from '../../../types/skill';
import type { BuildSkillLevelMode } from '../../../types/build';
import type { SkillRelationOwnerKind } from '../../../types/skillRelation';

export type SkillRelationOption = {
  key: string;
  name: string;
  status: SkillStatus | null;
  maxLevel?: number;
  systemKey?: string;
  maxRank?: number;
};
export type SkillRelationAddDraft = {
  selectedKey: string;
  sortOrder: string;
  systemKey: string;
  activationRank: string;
  skillLevelMode: BuildSkillLevelMode;
  fixedSkillLevel: string;
};

export function emptySkillRelationDraft(): SkillRelationAddDraft {
  return { selectedKey: '', sortOrder: '0', systemKey: '', activationRank: '1', skillLevelMode: 'FIXED', fixedSkillLevel: '1' };
}

export function parseSkillRelationSortOrder(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error('排序必须是 0～2147483647 的整数。');
  const order = Number(normalized);
  if (!Number.isInteger(order) || order > 2147483647) throw new Error('排序必须是 0～2147483647 的整数。');
  return order;
}

export function skillRelationIdentity(kind: SkillRelationOwnerKind, ownerKey: string, skillKey: string, systemKey = ''): string {
  return systemKey
    ? JSON.stringify([kind, systemKey, ownerKey, skillKey])
    : JSON.stringify([kind, ownerKey, skillKey]);
}

export function skillRelationDraftIsDirty(
  drafts: Record<SkillRelationOwnerKind, SkillRelationAddDraft>,
  sortEdits: Record<string, string>
): boolean {
  return Object.values(drafts).some(draft => draft.selectedKey !== '' || draft.sortOrder !== '0'
    || draft.systemKey !== '' || draft.activationRank !== '1' || draft.skillLevelMode !== 'FIXED' || draft.fixedSkillLevel !== '1')
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
    const key = item[kind === 'buildOption' ? 'optionKey' : `${kind}Key`];
    if (item.gameId !== gameId || typeof key !== 'string' || !key.trim() || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('候选对象响应不符合接口约定。');
    }
    if (kind === 'skill' && item.status !== 'ENABLED' && item.status !== 'DISABLED') {
      throw new Error('候选技能状态不符合接口约定。');
    }
    if (kind === 'buildOption' && (typeof item.systemKey !== 'string' || !item.systemKey.trim()
      || typeof item.maxRank !== 'number' || !Number.isInteger(item.maxRank) || item.maxRank < 1)) {
      throw new Error('候选对象响应不符合接口约定。');
    }
    const identity = kind === 'buildOption' ? `${String(item.systemKey)}\n${key}` : key;
    if (keys.has(identity)) throw new Error('候选对象响应不符合接口约定。');
    keys.add(identity);
    const option: SkillRelationOption = { key, name: item.name, status: kind === 'skill' ? item.status as SkillStatus : null };
    if (kind === 'skill' && Number.isInteger(item.maxLevel)) option.maxLevel = item.maxLevel as number;
    if (kind === 'buildOption') {
      option.systemKey = item.systemKey as string;
      option.maxRank = item.maxRank as number;
    }
    return option;
  });
}
