import { describe, expect, it } from 'vitest';
import { navigationGroups, navigationItems } from './navigation';

describe('product navigation', () => {
  it('exposes only the current management entries', () => {
    const dataGroup = navigationGroups.find((group) => group.id === 'data-management');

    expect(navigationGroups.map((group) => group.id)).toEqual(['data-management']);
    expect(dataGroup?.items.map((item) => item.id)).toEqual([
      'attributes',
      'characters',
      'equipment',
      'skill-categories',
      'damage-types',
      'modifier-zones',
      'skills',
      'statuses',
      'game-settings',
      'images'
    ]);
    expect(navigationItems.map((item) => item.id)).toEqual([
      'attributes',
      'characters',
      'equipment',
      'skill-categories',
      'damage-types',
      'modifier-zones',
      'skills',
      'statuses',
      'game-settings',
      'images'
    ]);
    expect(dataGroup?.items.find((item) => item.id === 'attributes')).toMatchObject({
      hashSegment: 'attributes',
      label: '属性管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'characters')).toMatchObject({
      hashSegment: 'characters',
      label: '角色管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'equipment')).toMatchObject({
      hashSegment: 'equipment',
      label: '装备管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'skill-categories')).toMatchObject({
      hashSegment: 'skill-categories',
      label: '技能分类管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'damage-types')).toMatchObject({
      hashSegment: 'damage-types',
      label: '伤害类型管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'modifier-zones')).toMatchObject({
      hashSegment: 'modifier-zones',
      label: '乘区管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'skills')).toMatchObject({
      hashSegment: 'skills',
      label: '技能管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'statuses')).toMatchObject({
      hashSegment: 'statuses',
      label: '状态管理',
      summary: ''
    });
    expect(dataGroup?.items.find((item) => item.id === 'game-settings')).toMatchObject({
      hashSegment: 'game-settings',
      label: '游戏配置'
    });
    expect(dataGroup?.items.find((item) => item.id === 'images')).toMatchObject({
      hashSegment: 'images',
      label: '图片缓存'
    });
  });

  it('does not expose old combat-data, publish or wasm-validation entries', () => {
    expect(
      navigationItems.some((item) =>
        [
          'overview',
          'workspace',
          'wasm-validation-generic',
          'provider-setup',
          'ability-setup',
          'effect-sequence-setup',
          'effect-step-setup',
          'direct-damage-ability',
          'entity-growth',
          'entity-setup',
          'entity-provider-mount'
        ].includes(item.id)
      )
    ).toBe(false);
    expect(
      navigationItems.some(
        (item) =>
          item.hashSegment === 'overview' ||
          item.hashSegment === 'workspace' ||
          item.hashSegment === 'combat-data' ||
          item.hashSegment.startsWith('combat-data/')
      )
    ).toBe(false);
  });
});
