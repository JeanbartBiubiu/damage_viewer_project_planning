import { describe, expect, it } from 'vitest';
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

describe('frozen combat-data route helpers', () => {
  it('assigns every registry resource a unique combat-data/<id> hash and frozen registry nav item', () => {
    expect(combatDataNavItems).toHaveLength(COMBAT_DATA_RESOURCE_LIST.length);

    const hashSegments = combatDataNavItems.map((item) => item.hashSegment);
    expect(new Set(hashSegments).size).toBe(hashSegments.length);

    for (const resource of COMBAT_DATA_RESOURCE_LIST) {
      const expected = `combat-data/${resource.id}`;
      expect(combatDataHashSegment(resource.id)).toBe(expected);
      expect(combatDataNavItems.some((item) => item.id === resource.id && item.hashSegment === expected)).toBe(true);
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

  it('keeps frozen registry group lookup for effect steps and entities', () => {
    expect(registryGroupIdForCombatDataResource('effect-steps')).toBe('effects');
    expect(registryGroupIdForCombatDataResource('entities')).toBe('entities');
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

  it('canonicalizes malformed filters to the query-free resource hash', () => {
    expect(buildCanonicalCombatDataHref('effect-steps')).toBe('#/combat-data/effect-steps');

    const invalid = readCombatDataLocation('#/combat-data/entities?field=notAField&value=1');
    expect(invalid.filterOk).toBe(false);
    const plan = planInvalidCombatDataFilterSync(
      '#/combat-data/entities?field=notAField&value=1',
      'entities'
    );
    expect(plan.replace).toBe(true);
    expect(plan.nextHash).toBe('#/combat-data/entities');
    expect(plan.filterPairs).toEqual([]);
  });

  it('rejects malformed percent encoding in filter queries as filterOk false', () => {
    const malformed = readCombatDataLocation('#/combat-data/entities?field=entityId&value=%ZZ');
    expect(malformed.resourceId).toBe('entities');
    expect(malformed.filterOk).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId&value=%', 'entities').ok).toBe(false);
  });

  it('still identifies unknown resources for the frozen helper default plan', () => {
    const unknown = readCombatDataLocation('#/combat-data/not-a-real-resource?field=a&value=1');
    expect(unknown.needsDefaultRedirect).toBe(true);
    expect(unknown.resourceId).toBeNull();
    expect(DEFAULT_COMBAT_DATA_RESOURCE_ID).toBe(COMBAT_DATA_RESOURCE_LIST[0].id);
    expect(`${COMBAT_DATA_HASH_PREFIX}/${DEFAULT_COMBAT_DATA_RESOURCE_ID}`).toBe(
      combatDataHashSegment(DEFAULT_COMBAT_DATA_RESOURCE_ID)
    );
  });
});
