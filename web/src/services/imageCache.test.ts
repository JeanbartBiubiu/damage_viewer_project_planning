import { describe, expect, it } from 'vitest';
import {
  buildFullSyncPlan,
  imageCacheDescriptor,
  latestCachedUpdate,
  summarizeCachedImages,
  toCachedImageRecord,
  toImageCacheKey,
  type CachedImageRecord
} from './imageCache';

describe('imageCache', () => {
  it('uses the breaking version 2 schema and unambiguous cache key', () => {
    expect(imageCacheDescriptor).toMatchObject({ dbName: 'image_db', dbVersion: 2, storeName: 'images' });
    expect(toImageCacheKey('lol', 'item_1001')).toBe('lol:item_1001');
  });

  it('retains disabled tombstones while clearing their image bytes', () => {
    expect(toCachedImageRecord('lol', {
      imageKey: 'disabled_icon',
      enabled: false,
      imageBase64: 'data:image/png;base64,AQID',
      updatedAt: '2026-09-05T11:00:00Z'
    })).toEqual({
      cacheKey: 'lol:disabled_icon',
      gameId: 'lol',
      imageKey: 'disabled_icon',
      enabled: false,
      imageBase64: null,
      updatedAt: '2026-09-05T11:00:00Z'
    });
  });

  it('full sync removes every current-game row but leaves other games alone', () => {
    const existing: CachedImageRecord[] = [
      { cacheKey: 'lol:old', gameId: 'lol', imageKey: 'old', enabled: true, imageBase64: 'x', updatedAt: '1' },
      { cacheKey: 'demo:keep', gameId: 'demo', imageKey: 'keep', enabled: true, imageBase64: 'y', updatedAt: '2' }
    ];
    const plan = buildFullSyncPlan(existing, 'lol', [{
      imageKey: 'new', enabled: true, imageBase64: 'data:image/png;base64,AQID', updatedAt: '3'
    }]);
    expect(plan.deleteKeys).toEqual(['lol:old']);
    expect(plan.putRows.map((row) => row.cacheKey)).toEqual(['lol:new']);
  });

  it('uses disabled records when calculating the next incremental boundary', () => {
    const rows: CachedImageRecord[] = [
      { cacheKey: 'lol:a', gameId: 'lol', imageKey: 'a', enabled: true, imageBase64: 'x', updatedAt: '2026-09-05T10:00:00Z' },
      { cacheKey: 'lol:b', gameId: 'lol', imageKey: 'b', enabled: false, imageBase64: null, updatedAt: '2026-09-05T12:00:00Z' }
    ];
    expect(latestCachedUpdate(rows)).toBe('2026-09-05T12:00:00Z');
  });

  it('compares timestamps by instant instead of textual timezone order', () => {
    const rows: CachedImageRecord[] = [
      { cacheKey: 'lol:a', gameId: 'lol', imageKey: 'a', enabled: true, imageBase64: 'x', updatedAt: '2026-09-05T12:00:00+08:00' },
      { cacheKey: 'lol:b', gameId: 'lol', imageKey: 'b', enabled: true, imageBase64: 'y', updatedAt: '2026-09-05T05:00:00Z' }
    ];
    expect(latestCachedUpdate(rows)).toBe('2026-09-05T05:00:00Z');
  });

  it('summarizes all records while only counting displayable images', () => {
    const rows: CachedImageRecord[] = [
      { cacheKey: 'lol:a', gameId: 'lol', imageKey: 'a', enabled: true, imageBase64: 'x', updatedAt: '2026-09-05T10:00:00Z' },
      { cacheKey: 'lol:b', gameId: 'lol', imageKey: 'b', enabled: false, imageBase64: null, updatedAt: '2026-09-05T12:00:00Z' }
    ];
    expect(summarizeCachedImages(rows)).toEqual({
      count: 2,
      enabledCount: 1,
      latestUpdate: '2026-09-05T12:00:00Z'
    });
  });
});
