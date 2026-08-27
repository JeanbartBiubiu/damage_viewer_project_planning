import { describe, expect, it } from 'vitest';
import { navigationGroups, navigationItems } from './navigation';

describe('product navigation', () => {
  it('exposes attribute and character management in the data-management group', () => {
    const dataGroup = navigationGroups.find((group) => group.id === 'data-management');

    expect(dataGroup?.items.map((item) => item.id)).toEqual([
      'overview',
      'attributes',
      'characters',
      'equipment',
      'skill-categories',
      'damage-types',
      'skills',
      'statuses',
      'game-settings',
      'provider-setup',
      'ability-setup',
      'effect-sequence-setup',
      'effect-step-setup',
      'direct-damage-ability',
      'workspace',
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
    expect(dataGroup?.items.find((item) => item.id === 'game-settings')).toMatchObject({
      hashSegment: 'game-settings',
      label: '游戏配置'
    });
    expect(dataGroup?.items.find((item) => item.id === 'skill-categories')).toMatchObject({
      hashSegment: 'skill-categories',
      label: '技能分类管理'
    });
    expect(dataGroup?.items.find((item) => item.id === 'damage-types')).toMatchObject({
      hashSegment: 'damage-types',
      label: '伤害类型管理'
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
  });

  it('does not expose old entity navigation, legacy combat-data groups or entity growth', () => {
    expect(navigationGroups.map((group) => group.id)).toEqual([
      'data-management',
      'wasm-validation'
    ]);
    expect(navigationGroups.some((group) => String(group.id).startsWith('combat-data'))).toBe(
      false
    );
    expect(
      navigationItems.some(
        (item) =>
          item.id === 'entity-growth' ||
          item.id === 'entity-setup' ||
          item.id === 'entity-provider-mount' ||
          item.hashSegment === 'entity-growth' ||
          item.hashSegment === 'combat-data' ||
          item.hashSegment.startsWith('combat-data/')
      )
    ).toBe(false);
  });

  it('keeps the non-legacy authoring, operations and validation entries', () => {
    expect(navigationItems.map((item) => item.id)).toEqual([
      'overview',
      'attributes',
      'characters',
      'equipment',
      'skill-categories',
      'damage-types',
      'skills',
      'statuses',
      'game-settings',
      'provider-setup',
      'ability-setup',
      'effect-sequence-setup',
      'effect-step-setup',
      'direct-damage-ability',
      'workspace',
      'images',
      'wasm-validation-generic'
    ]);
  });
});
