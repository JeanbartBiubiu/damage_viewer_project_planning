import { describe, expect, it } from 'vitest';
import {
  COMBAT_DATA_RESOURCE_LIST,
  getCombatDataResource
} from './resourceRegistry';
import {
  applyMultiHopTargetFilter,
  buildCanonicalCombatDataHref,
  buildCombatDataFilterHref,
  buildCopyForm,
  buildCreateChildPrefill,
  buildDownstreamFilterPairs,
  buildFilterPairsForEdge,
  buildSavedRecordFilterPairs,
  classifyNeighborState,
  filterRecordsByPairs,
  isWellFormedCombatDataQueryEncoding,
  listDownstreamEdges,
  listMultiHopChains,
  listUpstreamEdges,
  matchRecordByFilterPairs,
  neighborStateLabel,
  parseCombatDataFilterQuery,
  planInvalidCombatDataFilterSync,
  resolveReferenceLabel,
  searchRecords,
  serializeCombatDataFilterQuery,
  splitCombatDataHash
} from './resourceRelations';

describe('resourceRelations filter query contract', () => {
  it('round-trips a single field/value pair', () => {
    const pairs = [{ field: 'entityId', value: 'hero_a' }];
    const query = serializeCombatDataFilterQuery(pairs);
    expect(query).toBe('field=entityId&value=hero_a');
    const parsed = parseCombatDataFilterQuery(query, 'entity-attributes');
    expect(parsed).toEqual({ ok: true, pairs });
    expect(buildCombatDataFilterHref('entity-attributes', pairs)).toBe(
      '#/combat-data/entity-attributes?field=entityId&value=hero_a'
    );
  });

  it('round-trips multi-pair AND filters in declaration order', () => {
    const pairs = [
      { field: 'entityId', value: 'e1' },
      { field: 'attrKey', value: 'ad' }
    ];
    const query = serializeCombatDataFilterQuery(pairs);
    expect(query).toBe('field=entityId&value=e1&field=attrKey&value=ad');
    const parsed = parseCombatDataFilterQuery(query, 'entity-attribute-stages');
    expect(parsed).toEqual({ ok: true, pairs });
  });

  it('rejects unknown field, duplicate, empty, unpaired, extra keys, and unknown resource', () => {
    expect(parseCombatDataFilterQuery('field=nope&value=1', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId&value=a&field=entityId&value=b', 'entities').ok).toBe(
      false
    );
    expect(parseCombatDataFilterQuery('field=&value=a', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId&value=', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('foo=1&bar=2', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId&value=a&extra=1', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('field=entityId&value=a', 'not-real').ok).toBe(false);
  });

  it('fail-closes on malformed percent encoding that URLSearchParams would otherwise accept', () => {
    expect(isWellFormedCombatDataQueryEncoding('%')).toBe(false);
    expect(isWellFormedCombatDataQueryEncoding('%ZZ')).toBe(false);
    expect(isWellFormedCombatDataQueryEncoding('field=entityId&value=%')).toBe(false);
    expect(isWellFormedCombatDataQueryEncoding('field=entityId&value=%A')).toBe(false);
    expect(isWellFormedCombatDataQueryEncoding('field=entityId&value=%ZZ')).toBe(false);
    // Incomplete / invalid UTF-8 multi-byte sequence
    expect(isWellFormedCombatDataQueryEncoding('field=entityId&value=%E0%80%80')).toBe(false);
    expect(isWellFormedCombatDataQueryEncoding('field=entityId&value=%80')).toBe(false);

    expect(parseCombatDataFilterQuery('field=entityId&value=%', 'entities')).toEqual({
      ok: false,
      reason: 'malformed-encoding'
    });
    expect(parseCombatDataFilterQuery('field=entityId&value=%ZZ', 'entities').ok).toBe(false);
    expect(parseCombatDataFilterQuery('field=%&value=a', 'entities').ok).toBe(false);
  });

  it('preserves valid encoded Unicode, space, slash, ampersand, equals, and literal plus', () => {
    const unicode = encodeURIComponent('青');
    const parsedUnicode = parseCombatDataFilterQuery(
      `field=entityId&value=${unicode}`,
      'entities'
    );
    expect(parsedUnicode).toEqual({ ok: true, pairs: [{ field: 'entityId', value: '青' }] });

    const special = serializeCombatDataFilterQuery([
      { field: 'providerId', value: 'p/with space&x=1+2' }
    ]);
    const parsedSpecial = parseCombatDataFilterQuery(special, 'abilities');
    expect(parsedSpecial).toEqual({
      ok: true,
      pairs: [{ field: 'providerId', value: 'p/with space&x=1+2' }]
    });

    // Literal plus when correctly percent-encoded
    expect(parseCombatDataFilterQuery('field=entityId&value=a%2Bb', 'entities')).toEqual({
      ok: true,
      pairs: [{ field: 'entityId', value: 'a+b' }]
    });
    // application/x-www-form-urlencoded space via +
    expect(parseCombatDataFilterQuery('field=entityId&value=a+b', 'entities')).toEqual({
      ok: true,
      pairs: [{ field: 'entityId', value: 'a b' }]
    });
  });

  it('encodes special characters and allows reference fields as filter keys', () => {
    const pairs = [{ field: 'providerId', value: 'p/with space' }];
    const href = buildCombatDataFilterHref('abilities', pairs);
    expect(href.startsWith('#/combat-data/abilities?')).toBe(true);
    const query = href.split('?')[1]!;
    const parsed = parseCombatDataFilterQuery(query, 'abilities');
    expect(parsed).toEqual({ ok: true, pairs });
  });

  it('canonical href is query-free', () => {
    expect(buildCanonicalCombatDataHref('effect-steps')).toBe('#/combat-data/effect-steps');
  });

  it('plans invalid-filter sync as replaceable query-free hash without relying on location.hash assignment', () => {
    const plan = planInvalidCombatDataFilterSync(
      '#/combat-data/entities?field=bad&value=1',
      'entities'
    );
    expect(plan).toEqual({
      replace: true,
      nextHash: '#/combat-data/entities',
      filterPairs: []
    });
    expect(planInvalidCombatDataFilterSync('#/combat-data/entities', 'entities').replace).toBe(false);
  });

  it('builds exact saved path-key pairs including stepId', () => {
    expect(
      buildSavedRecordFilterPairs(['entityId', 'attrKey'], { entityId: 'e1', attrKey: 'ad', baseValue: 1 })
    ).toEqual([
      { field: 'entityId', value: 'e1' },
      { field: 'attrKey', value: 'ad' }
    ]);
    expect(buildSavedRecordFilterPairs(['stepId'], { stepId: 'step_9' })).toEqual([
      { field: 'stepId', value: 'step_9' }
    ]);
  });

  it('splitCombatDataHash separates path from query', () => {
    expect(splitCombatDataHash('#/combat-data/entities?field=entityId&value=e1')).toEqual({
      segments: ['combat-data', 'entities'],
      query: 'field=entityId&value=e1'
    });
  });
});

describe('resourceRelations matching and search', () => {
  const rows = [
    { entityId: 'e1', attrKey: 'ad', value: 10 },
    { entityId: 'e1', attrKey: 'ap', value: 20 },
    { entityId: 'e2', attrKey: 'ad', value: null },
    { entityId: undefined, attrKey: 'ad', value: 1 }
  ] as Record<string, unknown>[];

  it('matches with AND and rejects null/undefined field values', () => {
    expect(
      filterRecordsByPairs(rows, [
        { field: 'entityId', value: 'e1' },
        { field: 'attrKey', value: 'ad' }
      ])
    ).toEqual([rows[0]]);
    expect(matchRecordByFilterPairs(rows[2]!, [{ field: 'value', value: 'null' }])).toBe(false);
    expect(matchRecordByFilterPairs(rows[3]!, [{ field: 'entityId', value: 'e1' }])).toBe(false);
    expect(matchRecordByFilterPairs({ entityId: 12 }, [{ field: 'entityId', value: '12' }])).toBe(true);
  });

  it('searches case-insensitively across stringified values', () => {
    expect(searchRecords(rows, 'AP')).toEqual([rows[1]]);
    expect(searchRecords(rows, '')).toEqual(rows);
  });
});

describe('resourceRelations graph and templates', () => {
  it('derives upstream edges from references and dependent references', () => {
    const upstream = listUpstreamEdges('abilities');
    expect(upstream.some((edge) => edge.toResourceId === 'providers' && edge.kind === 'reference')).toBe(
      true
    );
    const typeRel = listUpstreamEdges('type-relations');
    expect(typeRel.some((edge) => edge.kind === 'dependent' && edge.toResourceId === 'entities')).toBe(
      true
    );
  });

  it('declares compound parent edges with ordered field pairs', () => {
    const attrStages = listUpstreamEdges('entity-attribute-stages');
    const compound = attrStages.find((edge) => edge.kind === 'compound');
    expect(compound).toMatchObject({
      toResourceId: 'entity-attributes',
      fieldPairs: [
        { fromField: 'entityId', toField: 'entityId' },
        { fromField: 'attrKey', toField: 'attrKey' }
      ]
    });

    const resStages = listUpstreamEdges('entity-resource-stages');
    expect(resStages.find((edge) => edge.kind === 'compound')?.toResourceId).toBe('entity-resources');
  });

  it('exposes progression-schema as semantic context only (not a filter edge)', () => {
    const semantic = listUpstreamEdges('entity-attribute-stages').filter((edge) => edge.kind === 'semantic');
    expect(semantic).toHaveLength(1);
    expect(semantic[0]?.toResourceId).toBe('progression-schema');
    expect(semantic[0]?.fieldPairs).toEqual([]);
    expect(listDownstreamEdges('progression-schema').every((edge) => edge.kind !== 'semantic')).toBe(true);
  });

  it('builds reverse downstream edges excluding semantic', () => {
    const down = listDownstreamEdges('entities');
    expect(down.some((edge) => edge.fromResourceId === 'entity-attributes')).toBe(true);
    expect(down.every((edge) => edge.kind !== 'semantic')).toBe(true);
  });

  it('builds filter pairs, create-child prefill, and copy templates', () => {
    const edge = listUpstreamEdges('entity-attribute-stages').find((item) => item.kind === 'compound')!;
    const parent = { entityId: 'e1', attrKey: 'ad', baseValue: 3 };
    expect(buildFilterPairsForEdge(edge, { entityId: 'e1', attrKey: 'ad' })).toEqual([
      { field: 'entityId', value: 'e1' },
      { field: 'attrKey', value: 'ad' }
    ]);
    expect(buildCreateChildPrefill(edge, parent)).toEqual({ entityId: 'e1', attrKey: 'ad' });
    expect(buildDownstreamFilterPairs(edge, parent)).toEqual([
      { field: 'entityId', value: 'e1' },
      { field: 'attrKey', value: 'ad' }
    ]);

    const config = getCombatDataResource('abilities')!;
    const copy = buildCopyForm(config, {
      abilityId: 'ab_1',
      providerId: 'p_1',
      abilityKey: 'key',
      abilityKindTypeId: 1,
      displayName: 'Slash',
      castConditionFormulaKey: 'cond'
    });
    expect(copy.abilityId).toBe('');
    expect(copy.displayName).toBe('Slash');
    expect(copy.providerId).toBe('p_1');
  });

  it('resolves labels with raw ID secondary and missing flag', () => {
    const records = [{ providerId: 'p1', displayName: 'Buff' }];
    expect(resolveReferenceLabel(records, 'providerId', 'displayName', 'p1')).toEqual({
      primary: 'Buff',
      secondary: 'p1'
    });
    expect(resolveReferenceLabel(records, 'providerId', 'displayName', 'missing')).toMatchObject({
      primary: 'missing',
      missing: true
    });
    expect(resolveReferenceLabel(undefined, 'providerId', 'displayName', 'p1').primary).toBe('p1');
  });

  it('classifies neighbor states; failures are 关系未知 never zero', () => {
    expect(classifyNeighborState({ loading: true }).status).toBe('loading');
    expect(classifyNeighborState({ failed: true }).status).toBe('unknown');
    expect(neighborStateLabel({ status: 'unknown' })).toBe('关系未知');
    expect(classifyNeighborState({ upstreamEmpty: true }).status).toBe('empty-upstream');
    expect(
      classifyNeighborState({ rawValue: 'x', matchedRecords: [] }).status
    ).toBe('missing-value');
    expect(classifyNeighborState({ matchedRecords: [] }).status).toBe('zero');
    expect(classifyNeighborState({ matchedRecords: [{ a: 1 }] }).status).toBe('ready');
  });
});

describe('resourceRelations multi-hop assistance', () => {
  it('exposes exactly two multi-hop chains', () => {
    const chains = listMultiHopChains();
    expect(chains).toHaveLength(2);
    expect(chains.map((c) => c.id).sort()).toEqual(['listener-binding', 'phase-binding']);
  });

  it('filters phase-binding sequence candidates by resolved provider', () => {
    const chain = listMultiHopChains().find((item) => item.id === 'phase-binding')!;
    const result = applyMultiHopTargetFilter(
      chain,
      'phase_1',
      {
        'ability-phases': [{ phaseId: 'phase_1', abilityId: 'ab_1' }],
        abilities: [{ abilityId: 'ab_1', providerId: 'p_a' }]
      },
      [
        { sequenceId: 's1', providerId: 'p_a' },
        { sequenceId: 's2', providerId: 'p_b' }
      ]
    );
    expect(result).toEqual({
      ok: true,
      records: [{ sequenceId: 's1', providerId: 'p_a' }]
    });
  });

  it('fails closed on missing or ambiguous hops (never returns global list)', () => {
    const chain = listMultiHopChains().find((item) => item.id === 'listener-binding')!;
    const missing = applyMultiHopTargetFilter(
      chain,
      'L1',
      { 'provider-listeners': [] },
      [{ sequenceId: 's1', providerId: 'p_a' }]
    );
    expect(missing.ok).toBe(false);

    const ambiguous = applyMultiHopTargetFilter(
      chain,
      'L1',
      {
        'provider-listeners': [
          { listenerId: 'L1', providerId: 'p_a' },
          { listenerId: 'L1', providerId: 'p_b' }
        ]
      },
      [
        { sequenceId: 's1', providerId: 'p_a' },
        { sequenceId: 's2', providerId: 'p_b' }
      ]
    );
    expect(ambiguous.ok).toBe(false);
  });
});

describe('resourceRelations covers all registry resources', () => {
  it('can list edges for every resource without throwing', () => {
    expect(COMBAT_DATA_RESOURCE_LIST).toHaveLength(30);
    for (const resource of COMBAT_DATA_RESOURCE_LIST) {
      expect(() => listUpstreamEdges(resource.id)).not.toThrow();
      expect(() => listDownstreamEdges(resource.id)).not.toThrow();
    }
  });
});
