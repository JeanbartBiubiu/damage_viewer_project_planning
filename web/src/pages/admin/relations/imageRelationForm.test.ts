import { describe, expect, it } from 'vitest';
import type { CachedImageRecord } from '../../../services/imageCache';
import type { ImageUsages } from '../../../types/imageRelation';
import { cachedRelationImageContent, imageSourceLabel, imageTargetIdentity, imageUsageGroups, representativeImageReplacementMessage } from './imageRelationForm';

describe('image relation choices and reverse usages', () => {
  it('keeps nine explicit groups, disabled statuses and same-key effects under their actual skill', () => {
    const usages: ImageUsages = {
      imageKey: 'image', games: [{ gameId: 'game', gameName: '游戏' }], characters: [], equipment: [],
      attributes: [{ attributeKey: 'attack', attributeName: '攻击力', attributeStatus: 'DISABLED' }], skills: [], statuses: [],
      runes: [{ runeKey: 'shard', runeName: '碎片' }], runePaths: [{ pathKey: 'shards', pathName: '碎片组' }],
      skillEffects: [
        { skillKey: 'skill/one', skillName: '技能一', effectKey: 'effect', effectName: '同名效果' },
        { skillKey: 'skill/two', skillName: '技能二', effectKey: 'effect', effectName: '同名效果' }
      ]
    };
    const groups = imageUsageGroups(usages);
    expect(groups.map((row) => row.kind)).toEqual(['game', 'character', 'attribute', 'equipment', 'rune', 'runePath', 'skill', 'skillEffect', 'status']);
    expect(groups.find(row => row.kind === 'rune')!.items[0].target).toEqual({ kind: 'rune', key: 'shard', name: '碎片' });
    expect(groups.find(row => row.kind === 'runePath')!.items[0].target).toEqual({ kind: 'runePath', key: 'shards', name: '碎片组' });
    const effects = groups.find((row) => row.kind === 'skillEffect')!.items;
    expect(effects.map((row) => row.target.skillKey)).toEqual(['skill/one', 'skill/two']);
    expect(imageTargetIdentity(effects[0].target)).not.toBe(imageTargetIdentity(effects[1].target));
    expect(imageSourceLabel(groups.find((row) => row.kind === 'attribute')!.items[0])).toBe('攻击力（attack） · 已停用');
    expect(groups.find((row) => row.kind === 'game')!.items[0].target).toEqual({ kind: 'game', key: 'game', name: '游戏' });
  });

  it('requires a visible replacement confirmation only when the source already points to another image', () => {
    const current = { imageKey: 'old', name: '旧图片', enabled: false };
    expect(representativeImageReplacementMessage(current, 'new', '角色')).toContain('旧图片');
    expect(representativeImageReplacementMessage(current, 'new', '角色')).toContain('替换');
    expect(representativeImageReplacementMessage(current, 'old', '角色')).toBeNull();
    expect(representativeImageReplacementMessage(null, 'new', '角色')).toBeNull();
  });
});

describe('cached representative image content', () => {
  const row: CachedImageRecord = { cacheKey: 'game:image', gameId: 'game', imageKey: 'image', enabled: true, imageBase64: 'data:image/png;base64,AQID', updatedAt: '2026-09-06T00:00:00Z' };

  it('uses a matching current-game cache entry', () => {
    expect(cachedRelationImageContent(row, 'game', 'image', true)).toBe(row.imageBase64);
  });

  it('never displays backend-disabled images even if an older cache still has content', () => {
    expect(cachedRelationImageContent(row, 'game', 'image', false)).toBeNull();
    expect(cachedRelationImageContent({ ...row, enabled: false }, 'game', 'image', true)).toBeNull();
  });

  it('uses a placeholder on missing cache, another game or another image', () => {
    expect(cachedRelationImageContent(null, 'game', 'image')).toBeNull();
    expect(cachedRelationImageContent(row, 'other-game', 'image')).toBeNull();
    expect(cachedRelationImageContent(row, 'game', 'other-image')).toBeNull();
  });
});
