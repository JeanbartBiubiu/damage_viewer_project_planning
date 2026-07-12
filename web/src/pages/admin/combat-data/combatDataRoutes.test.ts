import { describe, expect, it } from 'vitest';
import {
  combatDataResourceIdFromRoute,
  createDefaultCollapsedNavigationGroups,
  ensureActiveCombatDataNavigationGroupExpanded,
  isCombatDataRouteId,
  navigationGroupIdForCombatDataResource,
  navigationGroups,
  navigationItems
} from '../../../config/navigation';
import {
  COMBAT_DATA_HASH_PREFIX,
  DEFAULT_COMBAT_DATA_RESOURCE_ID,
  combatDataHashSegment,
  combatDataNavGroups,
  combatDataNavItems,
  parseCombatDataRoute,
  registryGroupIdForCombatDataResource
} from '../combatDataNav';
import { COMBAT_DATA_RESOURCE_LIST } from './resourceRegistry';

describe('combat-data per-resource routes and navigation', () => {
  it('assigns every registry resource a unique combat-data/<id> route and nav item', () => {
    expect(combatDataNavItems).toHaveLength(COMBAT_DATA_RESOURCE_LIST.length);

    const hashSegments = combatDataNavItems.map((item) => item.hashSegment);
    expect(new Set(hashSegments).size).toBe(hashSegments.length);

    for (const resource of COMBAT_DATA_RESOURCE_LIST) {
      const expected = `combat-data/${resource.id}`;
      expect(combatDataHashSegment(resource.id)).toBe(expected);
      expect(combatDataNavItems.some((item) => item.id === resource.id && item.hashSegment === expected)).toBe(true);
      expect(navigationItems.some((item) => item.hashSegment === expected)).toBe(true);
    }
  });

  it('groups nav items by dependency domain without dropping resources', () => {
    const groupedIds = combatDataNavGroups.flatMap((group) => group.items.map((item) => item.id));
    expect(groupedIds.sort()).toEqual([...COMBAT_DATA_RESOURCE_LIST.map((r) => r.id)].sort());
    expect(combatDataNavGroups.map((g) => g.id)).toEqual([
      'basics',
      'entities',
      'providers',
      'abilities',
      'effects'
    ]);
  });

  it('parses #/combat-data/effect-steps to the effect-steps resource page', () => {
    const parsed = parseCombatDataRoute(['combat-data', 'effect-steps']);
    expect(parsed).toEqual({
      isCombatDataRoute: true,
      resourceId: 'effect-steps',
      needsDefaultRedirect: false
    });
    expect(isCombatDataRouteId('combat-data/effect-steps')).toBe(true);
    expect(combatDataResourceIdFromRoute('combat-data/effect-steps')).toBe('effect-steps');
  });

  it('treats bare #/combat-data as redirect-to-default', () => {
    const parsed = parseCombatDataRoute(['combat-data']);
    expect(parsed.isCombatDataRoute).toBe(true);
    expect(parsed.resourceId).toBeNull();
    expect(parsed.needsDefaultRedirect).toBe(true);
    expect(DEFAULT_COMBAT_DATA_RESOURCE_ID).toBe(COMBAT_DATA_RESOURCE_LIST[0].id);
    expect(combatDataHashSegment(DEFAULT_COMBAT_DATA_RESOURCE_ID)).toBe(
      `${COMBAT_DATA_HASH_PREFIX}/${DEFAULT_COMBAT_DATA_RESOURCE_ID}`
    );
  });

  it('redirects unknown resource ids to default', () => {
    const parsed = parseCombatDataRoute(['combat-data', 'not-a-real-resource']);
    expect(parsed).toEqual({
      isCombatDataRoute: true,
      resourceId: null,
      needsDefaultRedirect: true
    });
  });

  it('keeps overview / publish / images / wasm as independent top-level entries', () => {
    const dataGroup = navigationGroups.find((group) => group.id === 'data-management');
    expect(dataGroup?.items.map((item) => item.id)).toEqual(['overview', 'workspace', 'images']);
    expect(navigationItems.some((item) => item.id === 'wasm-validation-generic')).toBe(true);
    expect(dataGroup?.items.some((item) => item.id === 'combat-data')).toBe(false);
  });

  it('maps effect-steps → Effect group and entities → Entity group', () => {
    expect(registryGroupIdForCombatDataResource('effect-steps')).toBe('effects');
    expect(navigationGroupIdForCombatDataResource('effect-steps')).toBe('combat-data-effects');

    expect(registryGroupIdForCombatDataResource('entities')).toBe('entities');
    expect(navigationGroupIdForCombatDataResource('entities')).toBe('combat-data-entities');
  });

  it('defaults all combat-data groups collapsed except the active route group', () => {
    const forEffects = createDefaultCollapsedNavigationGroups('combat-data/effect-steps');
    expect(forEffects['data-management']).toBeUndefined();
    expect(forEffects['wasm-validation']).toBe(true);
    expect(forEffects['combat-data-effects']).toBe(false);
    expect(forEffects['combat-data-basics']).toBe(true);
    expect(forEffects['combat-data-entities']).toBe(true);
    expect(forEffects['combat-data-providers']).toBe(true);
    expect(forEffects['combat-data-abilities']).toBe(true);

    const forEntities = createDefaultCollapsedNavigationGroups('combat-data/entities');
    expect(forEntities['combat-data-entities']).toBe(false);
    expect(forEntities['combat-data-effects']).toBe(true);
  });

  it('expands the new active combat-data group without closing manually expanded ones', () => {
    const base = createDefaultCollapsedNavigationGroups('combat-data/effect-steps');
    // User manually opened Entity while staying on Effect.
    const withManualEntity = { ...base, 'combat-data-entities': false };

    const afterSwitch = ensureActiveCombatDataNavigationGroupExpanded(
      withManualEntity,
      'combat-data/entities'
    );
    expect(afterSwitch['combat-data-entities']).toBe(false);
    // Effect stays open because the user (or prior auto-expand) had it open.
    expect(afterSwitch['combat-data-effects']).toBe(false);

    const fromProviders = ensureActiveCombatDataNavigationGroupExpanded(
      {
        'wasm-validation': true,
        'combat-data-basics': true,
        'combat-data-entities': true,
        'combat-data-providers': true,
        'combat-data-abilities': true,
        'combat-data-effects': true
      },
      'combat-data/effect-steps'
    );
    expect(fromProviders['combat-data-effects']).toBe(false);
    expect(fromProviders['combat-data-providers']).toBe(true);
  });
});
