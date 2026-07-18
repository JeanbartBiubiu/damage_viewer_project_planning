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
  combatDataHref,
  combatDataNavGroups,
  combatDataNavItems,
  parseCombatDataRoute,
  readCombatDataLocation,
  registryGroupIdForCombatDataResource
} from '../combatDataNav';
import { COMBAT_DATA_RESOURCE_LIST } from './resourceRegistry';
import {
  buildCanonicalCombatDataHref,
  matchRecordByFilterPairs,
  parseCombatDataFilterQuery,
  planInvalidCombatDataFilterSync
} from './resourceRelations';

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

  it('keeps overview / entity-setup / entity-growth / provider-setup / entity-provider-mount / ability-setup / effect-sequence-setup / effect-step-setup / direct-damage-ability / publish / images / wasm as independent top-level entries', () => {
    const dataGroup = navigationGroups.find((group) => group.id === 'data-management');
    expect(dataGroup?.items.map((item) => item.id)).toEqual([
      'overview',
      'entity-setup',
      'entity-growth',
      'provider-setup',
      'entity-provider-mount',
      'ability-setup',
      'effect-sequence-setup',
      'effect-step-setup',
      'direct-damage-ability',
      'workspace',
      'images'
    ]);
    expect(dataGroup?.items.filter((item) => item.id === 'entity-setup')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'entity-setup')?.hashSegment).toBe(
      'entity-setup'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'provider-setup')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'provider-setup')?.hashSegment).toBe(
      'provider-setup'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'entity-provider-mount')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'entity-provider-mount')?.hashSegment).toBe(
      'entity-provider-mount'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'entity-growth')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'entity-growth')?.hashSegment).toBe(
      'entity-growth'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'ability-setup')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'ability-setup')?.hashSegment).toBe(
      'ability-setup'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'effect-sequence-setup')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'effect-sequence-setup')?.hashSegment).toBe(
      'effect-sequence-setup'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'effect-step-setup')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'effect-step-setup')?.hashSegment).toBe(
      'effect-step-setup'
    );
    expect(dataGroup?.items.filter((item) => item.id === 'direct-damage-ability')).toHaveLength(1);
    expect(dataGroup?.items.find((item) => item.id === 'direct-damage-ability')?.hashSegment).toBe(
      'direct-damage-ability'
    );
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

describe('GUX-1 combat-data filter routes', () => {
  it('round-trips single and multi-pair filter hrefs without changing RouteId', () => {
    const single = combatDataHref('entities', [{ field: 'entityId', value: 'e1' }]);
    expect(single).toBe('#/combat-data/entities?field=entityId&value=e1');
    const location = readCombatDataLocation(single);
    expect(location).toMatchObject({
      isCombatDataRoute: true,
      resourceId: 'entities',
      filterOk: true,
      filterPairs: [{ field: 'entityId', value: 'e1' }]
    });
    expect(isCombatDataRouteId('combat-data/entities')).toBe(true);
    expect(combatDataResourceIdFromRoute('combat-data/entities')).toBe('entities');

    const multi = combatDataHref('entity-attribute-stages', [
      { field: 'entityId', value: 'e1' },
      { field: 'attrKey', value: 'ad' }
    ]);
    const multiLoc = readCombatDataLocation(multi);
    expect(multiLoc.filterOk).toBe(true);
    expect(multiLoc.filterPairs).toEqual([
      { field: 'entityId', value: 'e1' },
      { field: 'attrKey', value: 'ad' }
    ]);
    expect(
      matchRecordByFilterPairs(
        { entityId: 'e1', attrKey: 'ad' },
        multiLoc.filterPairs
      )
    ).toBe(true);
    expect(
      matchRecordByFilterPairs(
        { entityId: 'e1', attrKey: 'ap' },
        multiLoc.filterPairs
      )
    ).toBe(false);
  });

  it('marks malformed / unknown / extra-key filters as filterOk false and keeps resource id', () => {
    const badField = readCombatDataLocation('#/combat-data/entities?field=notAField&value=1');
    expect(badField.resourceId).toBe('entities');
    expect(badField.filterOk).toBe(false);
    expect(badField.filterPairs).toEqual([]);

    const extra = readCombatDataLocation('#/combat-data/entities?field=entityId&value=e1&x=1');
    expect(extra.filterOk).toBe(false);

    const unpaired = readCombatDataLocation('#/combat-data/entities?field=entityId');
    expect(unpaired.filterOk).toBe(false);

    expect(parseCombatDataFilterQuery('field=entityId&value=e1&field=entityId&value=e2', 'entities').ok).toBe(
      false
    );
  });

  it('canonicalizes to query-free resource hash while sidebar active segment stays query-free', () => {
    expect(buildCanonicalCombatDataHref('effect-steps')).toBe('#/combat-data/effect-steps');
    const routeId = 'combat-data/effect-steps';
    expect(isCombatDataRouteId(routeId)).toBe(true);
    // Sidebar compares hashSegment === route (query-free), so filtered deep links stay active.
    const navItem = navigationItems.find((item) => item.hashSegment === routeId);
    expect(navItem?.hashSegment).toBe(routeId);
    expect(navItem?.hashSegment === routeId).toBe(true);

    const invalid = readCombatDataLocation('#/combat-data/entities?field=notAField&value=1');
    expect(invalid.filterOk).toBe(false);
    const plan = planInvalidCombatDataFilterSync(
      '#/combat-data/entities?field=notAField&value=1',
      'entities'
    );
    expect(plan.replace).toBe(true);
    expect(plan.nextHash).toBe('#/combat-data/entities');
    expect(plan.filterPairs).toEqual([]);
    // Active sidebar segment remains the query-free route id.
    expect(isCombatDataRouteId('combat-data/entities')).toBe(true);
  });

  it('rejects malformed percent encoding in filter queries as filterOk false', () => {
    const malformed = readCombatDataLocation('#/combat-data/entities?field=entityId&value=%ZZ');
    expect(malformed.resourceId).toBe('entities');
    expect(malformed.filterOk).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId&value=%', 'entities').ok).toBe(false);
  });

  it('still redirects unknown resources to default and keeps nav grouping', () => {
    const unknown = readCombatDataLocation('#/combat-data/not-a-real-resource?field=a&value=1');
    expect(unknown.needsDefaultRedirect).toBe(true);
    expect(unknown.resourceId).toBeNull();
    expect(DEFAULT_COMBAT_DATA_RESOURCE_ID).toBe(COMBAT_DATA_RESOURCE_LIST[0].id);
    expect(`${COMBAT_DATA_HASH_PREFIX}/${DEFAULT_COMBAT_DATA_RESOURCE_ID}`).toBe(
      combatDataHashSegment(DEFAULT_COMBAT_DATA_RESOURCE_ID)
    );
  });
});
