import { describe, expect, it } from 'vitest';
import {
  buildAttributeImageUri,
  buildHeroImageUri,
  buildItemImageUri,
  buildOwnerImageUri,
  imageAssetUriValidationMessage,
  normalizeImageAssetUri,
  prepareResourceImageAssetUpload
} from './resourceImage';

describe('resourceImage URI builders', () => {
  it('builds deterministic hero / item / attribute URIs', () => {
    expect(buildHeroImageUri('vayne')).toBe('character_vayne');
    expect(buildHeroImageUri('  vayne  ')).toBe('character_vayne');
    expect(buildHeroImageUri('')).toBeNull();
    expect(buildHeroImageUri('   ')).toBeNull();

    expect(buildItemImageUri('2510')).toBe('item_2510');
    expect(buildItemImageUri('  2510  ')).toBe('item_2510');
    expect(buildItemImageUri('')).toBeNull();

    expect(buildAttributeImageUri('atk')).toBe('attribute_atk');
    expect(buildAttributeImageUri('  atk  ')).toBe('attribute_atk');
    expect(buildAttributeImageUri('')).toBeNull();
  });

  it('builds owner URIs only for hero/item owners', () => {
    expect(buildOwnerImageUri('hero', 'vayne')).toBe('character_vayne');
    expect(buildOwnerImageUri('item', '2510')).toBe('item_2510');
    expect(buildOwnerImageUri('skill', 'q')).toBeNull();
    expect(buildOwnerImageUri('hero', '')).toBeNull();
    expect(buildOwnerImageUri('', 'vayne')).toBeNull();
    expect(buildOwnerImageUri(null, 'vayne')).toBeNull();
  });
});

describe('normalizeImageAssetUri', () => {
  it('accepts trimmed opaque URI boundaries', () => {
    expect(normalizeImageAssetUri('a')).toBe('a');
    expect(normalizeImageAssetUri('A')).toBe('A');
    expect(normalizeImageAssetUri('0')).toBe('0');
    expect(normalizeImageAssetUri('  character_vayne  ')).toBe('character_vayne');
    expect(normalizeImageAssetUri('item.2510_test-1')).toBe('item.2510_test-1');
    expect(normalizeImageAssetUri(`x${'.'.repeat(126)}`)).toBe(`x${'.'.repeat(126)}`);
    expect(normalizeImageAssetUri(`y${'_'.repeat(127)}`)).toBe(`y${'_'.repeat(127)}`);
  });

  it('rejects blank, slash, and other invalid values', () => {
    expect(normalizeImageAssetUri('')).toBeNull();
    expect(normalizeImageAssetUri('   ')).toBeNull();
    expect(normalizeImageAssetUri('foo/bar')).toBeNull();
    expect(normalizeImageAssetUri('/leading')).toBeNull();
    expect(normalizeImageAssetUri('trail/')).toBeNull();
    expect(normalizeImageAssetUri('has\\slash')).toBeNull();
    expect(normalizeImageAssetUri('_leading')).toBeNull();
    expect(normalizeImageAssetUri('.leading')).toBeNull();
    expect(normalizeImageAssetUri('-leading')).toBeNull();
    expect(normalizeImageAssetUri('has space')).toBeNull();
    expect(normalizeImageAssetUri('has:colon')).toBeNull();
    expect(normalizeImageAssetUri(`z${'a'.repeat(128)}`)).toBeNull();

    expect(imageAssetUriValidationMessage('')).toBe('请输入图片 URI。');
    expect(imageAssetUriValidationMessage('   ')).toBe('请输入图片 URI。');
    expect(imageAssetUriValidationMessage('foo/bar')).toContain('路径分隔符');
    expect(imageAssetUriValidationMessage('_bad')).toContain('稳定单段标识');
    expect(imageAssetUriValidationMessage('character_vayne')).toBeNull();
  });

  it('prepareResourceImageAssetUpload rejects invalid route URIs before reading the file', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(prepareResourceImageAssetUpload('has space', file)).rejects.toThrow(/稳定单段标识|路径分隔符|请输入/);
    await expect(prepareResourceImageAssetUpload('', file)).rejects.toThrow('请输入图片 URI');
  });
});
