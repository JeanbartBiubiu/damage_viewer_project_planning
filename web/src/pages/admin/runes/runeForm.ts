import { ApiRequestError, getErrorMessage } from '../../../services/apiClient';
import { RUNE_CATEGORIES, type Rune, type RuneCategory, type RunePathKind, type RuneSlot } from '../../../types/rune';

export type RuneDraft = { runeKey: string; name: string; description: string; category: RuneCategory };
export type RunePathDraft = { pathKey: string; name: string; description: string; kind: RunePathKind; sortOrder: string; slots: RuneSlot[] };
export type RuneFieldErrors = Record<string, string>;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

function commonErrors(draft: { name: string; description: string }, key: string, field: string, creating: boolean): RuneFieldErrors {
  const errors: RuneFieldErrors = {};
  if (creating && !KEY.test(key.trim())) errors[field] = '小写字母开头，只能包含小写字母、数字和下划线，最多64字符。';
  if (!draft.name.trim() || draft.name.trim().length > 100) errors.name = '名称须为1～100字符。';
  if (draft.description.trim().length > 2000) errors.description = '说明最多2000字符。';
  return errors;
}
export function validateRuneDraft(draft: RuneDraft, creating: boolean): RuneFieldErrors {
  const errors = commonErrors(draft, draft.runeKey, 'runeKey', creating);
  if (!RUNE_CATEGORIES.includes(draft.category)) errors.category = '请选择符文类别。';
  return errors;
}
export function validateRunePathDraft(draft: RunePathDraft, creating: boolean, runes: Rune[]): RuneFieldErrors {
  const errors = commonErrors(draft, draft.pathKey, 'pathKey', creating);
  if (draft.kind !== 'RUNE_PATH' && draft.kind !== 'SHARD_GROUP') errors.kind = '请选择分组种类。';
  if (!/^\d+$/.test(draft.sortOrder.trim()) || Number(draft.sortOrder) > 2147483647) errors.sortOrder = '排序须为0～2147483647的整数。';
  const directory = new Map(runes.map(rune => [rune.runeKey, rune]));
  const ordinaryKeys = new Set<string>();
  draft.slots.forEach((slot, index) => {
    const field = `slots[${index}]`;
    if (!slot.name.trim() || slot.name.trim().length > 100) errors[`${field}.name`] = '槽位名称须为1～100字符。';
    if (!RUNE_CATEGORIES.includes(slot.category) || (draft.kind === 'SHARD_GROUP') !== (slot.category === 'SHARD')) errors[`${field}.category`] = '槽位类别与分组种类不兼容。';
    const rowKeys = new Set<string>();
    slot.runeKeys.forEach((key, position) => {
      const keyField = `${field}.runeKeys[${position}]`;
      const rune = directory.get(key);
      if (!rune) errors[keyField] = '请选择当前游戏存在的符文。';
      else if (rune.category !== slot.category) errors[keyField] = '符文类别与槽位类别不一致。';
      else if (rowKeys.has(key)) errors[keyField] = '同一槽位不能重复放置同一符文。';
      else if (rune.category !== 'SHARD' && ordinaryKeys.has(key)) errors[keyField] = '普通符文在布局中只能出现一次。';
      rowKeys.add(key);
      if (rune?.category !== 'SHARD') ordinaryKeys.add(key);
    });
  });
  return errors;
}
export function normalizeRuneSlots(slots: RuneSlot[]): RuneSlot[] {
  return slots.map(slot => ({ name: slot.name.trim(), category: slot.category, runeKeys: [...slot.runeKeys] }));
}
export function moveOrdered<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = [...items];
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function runeFieldErrors(error: unknown): RuneFieldErrors {
  if (!(error instanceof ApiRequestError)) return {};
  const issues = error.details?.fieldIssues;
  if (!Array.isArray(issues)) return {};
  return Object.fromEntries(issues.flatMap(issue => issue && typeof issue.field === 'string' && typeof issue.message === 'string' ? [[issue.field, issue.message]] : []));
}
export function runeErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);
  if (!(error instanceof ApiRequestError) || !Array.isArray(error.details?.references)) return message;
  const locations = error.details.references.flatMap(value => value && typeof value.pathKey === 'string' && Number.isInteger(value.slotIndex) && typeof value.slotName === 'string'
    ? [`${value.pathKey} · 槽位 ${value.slotIndex + 1}「${value.slotName}」`] : []);
  return locations.length ? `${message} 占用位置：${locations.join('；')}` : message;
}
