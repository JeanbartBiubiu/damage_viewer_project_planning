import { describe, expect, it } from 'vitest';
import {
  defaultRouteForMode,
  hashForRoute,
  modeForRoute,
  navigationGroupIdForRoute,
  navigationGroups,
  navigationGroupsForMode,
  navigationItems,
  routeFromHash
} from './navigation';

describe('product navigation', () => {
  it('keeps management entries together and exposes the two simulation pages', () => {
    const dataGroup = navigationGroups.find((group) => group.id === 'data-management');
    const simulationGroup = navigationGroups.find((group) => group.id === 'simulation');

    expect(navigationGroups.map((group) => group.id)).toEqual(['data-management', 'simulation']);
    expect(dataGroup?.items.map((item) => item.id)).toEqual([
      'attributes',
      'characters',
      'equipment',
      'builds',
      'skill-categories',
      'damage-types',
      'modifier-zones',
      'skills',
      'statuses',
      'game-settings',
      'images'
    ]);
    expect(simulationGroup).toMatchObject({
      mode: 'simulation',
      items: [
        { id: 'simulation/basic-attack', hashSegment: 'simulation/basic-attack', label: '普攻模拟' },
        { id: 'simulation/combat-analysis', hashSegment: 'simulation/combat-analysis', label: '混合战斗分析' }
      ]
    });
    expect(navigationGroupsForMode('management')).toEqual([dataGroup]);
    expect(navigationGroupsForMode('simulation')).toEqual([simulationGroup]);
    expect(navigationItems.map((item) => item.id)).toEqual([
      'attributes',
      'characters',
      'equipment',
      'builds',
      'skill-categories',
      'damage-types',
      'modifier-zones',
      'skills',
      'statuses',
      'game-settings',
      'images',
      'simulation/basic-attack',
      'simulation/combat-analysis'
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
      label: '图片管理'
    });
  });

  it('derives the mode from an exact full Hash route and preserves management defaults', () => {
    expect(routeFromHash('')).toBe('attributes');
    expect(routeFromHash('#/attributes')).toBe('attributes');
    expect(routeFromHash('#/simulation/basic-attack')).toBe('simulation/basic-attack');
    expect(routeFromHash('#/simulation/basic-attack?source=direct')).toBe('simulation/basic-attack');
    expect(routeFromHash('#/simulation/combat-analysis')).toBe('simulation/combat-analysis');
    expect(routeFromHash('#/simulation/combat-analysis?source=direct')).toBe('simulation/combat-analysis');
    expect(routeFromHash('#/simulation/combat-analysis/unexpected')).toBe('attributes');
    expect(routeFromHash('#/simulation/unknown')).toBe('attributes');
    expect(routeFromHash('#/attributes/unexpected')).toBe('attributes');
    expect(hashForRoute(routeFromHash('#/simulation/basic-attack?source=direct'))).toBe('#/simulation/basic-attack');
    expect(defaultRouteForMode('management')).toBe('attributes');
    expect(defaultRouteForMode('simulation')).toBe('simulation/basic-attack');
    expect(modeForRoute('attributes')).toBe('management');
    expect(modeForRoute('simulation/basic-attack')).toBe('simulation');
    expect(modeForRoute('simulation/combat-analysis')).toBe('simulation');
    expect(navigationGroupIdForRoute('simulation/basic-attack')).toBe('simulation');
    expect(navigationGroupIdForRoute('simulation/combat-analysis')).toBe('simulation');
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
