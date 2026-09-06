import type { CachedImageRecord } from '../../../services/imageCache';
import type { ImageRelationTarget, ImageSourceStatus, ImageUsages, RepresentativeImage } from '../../../types/imageRelation';

export const IMAGE_SOURCE_KINDS: Array<{ value: ImageRelationTarget['kind']; label: string }> = [
  { value: 'game', label: '游戏' }, { value: 'character', label: '角色' },
  { value: 'attribute', label: '属性' }, { value: 'equipment', label: '装备' },
  { value: 'skill', label: '技能' }, { value: 'skillEffect', label: '技能效果' },
  { value: 'status', label: '状态' }
];

export type ImageSourceOption = { target: ImageRelationTarget; status?: ImageSourceStatus; skillName?: string };
export type ImageUsageGroup = { kind: ImageRelationTarget['kind']; label: string; items: ImageSourceOption[] };

export function imageTargetIdentity(target: ImageRelationTarget): string {
  return JSON.stringify([target.kind, target.skillKey ?? '', target.key]);
}

export function imageSourceLabel(source: ImageSourceOption): string {
  const status = source.status === 'DISABLED' ? ' · 已停用' : source.status === 'ENABLED' ? ' · 已启用' : '';
  return `${source.target.name}（${source.target.key}）${status}`;
}

export function imageUsageGroups(usages: ImageUsages): ImageUsageGroup[] {
  const groups: Record<ImageRelationTarget['kind'], ImageSourceOption[]> = {
    game: usages.games.map((row) => ({ target: { kind: 'game', key: row.gameId, name: row.gameName } })),
    character: usages.characters.map((row) => ({ target: { kind: 'character', key: row.characterKey, name: row.characterName } })),
    attribute: usages.attributes.map((row) => ({ target: { kind: 'attribute', key: row.attributeKey, name: row.attributeName }, status: row.attributeStatus })),
    equipment: usages.equipment.map((row) => ({ target: { kind: 'equipment', key: row.equipmentKey, name: row.equipmentName } })),
    skill: usages.skills.map((row) => ({ target: { kind: 'skill', key: row.skillKey, name: row.skillName }, status: row.skillStatus })),
    skillEffect: usages.skillEffects.map((row) => ({ target: { kind: 'skillEffect', key: row.effectKey, name: row.effectName, skillKey: row.skillKey }, skillName: row.skillName })),
    status: usages.statuses.map((row) => ({ target: { kind: 'status', key: row.statusKey, name: row.statusName }, status: row.statusStatus }))
  };
  return IMAGE_SOURCE_KINDS.map(({ value, label }) => ({ kind: value, label, items: groups[value] }));
}

export function representativeImageReplacementMessage(current: RepresentativeImage | null, imageKey: string, sourceName: string): string | null {
  if (!current || current.imageKey === imageKey) return null;
  return `“${sourceName}”已设置代表图片“${current.name}”（${current.imageKey}），确定替换为当前图片吗？`;
}

export function cachedRelationImageContent(record: CachedImageRecord | null, gameId: string, imageKey: string, enabled = true): string | null {
  return enabled && record?.enabled && record.gameId === gameId && record.imageKey === imageKey
    ? record.imageBase64
    : null;
}
