import { describe, expect, it } from 'vitest';
import {
  assembleCombatScenario,
  assembleCompileRequest,
  CombatDataAssembleError,
  domainFromTypeKey,
  DEFAULT_GENERIC_SCHEMA_VERSION
} from './combatDataAssembler';
import type { CombatDataGraph, CombatDataRowMeta } from '../types/combatData';

const META: CombatDataRowMeta = {
  gameId: 'demo',
  changeRevision: 1,
  updatedAt: '2026-07-12T00:00:00Z'
};

const TYPE = {
  operationDamage: { typeId: 20150, typeKey: 'operation/damage', reservedTypeId: 20150 },
  operationStateChange: { typeId: 20160, typeKey: 'operation/state_change', reservedTypeId: 20160 },
  selectorOpponent: { typeId: 20111, typeKey: 'selector/opponent', reservedTypeId: 20111 },
  selectorSelf: { typeId: 20110, typeKey: 'selector/self', reservedTypeId: 20110 },
  valuePolicyAdd: { typeId: 20170, typeKey: 'value_policy/add', reservedTypeId: 20170 },
  damagePhysical: { typeId: 20220, typeKey: 'damage/physical', reservedTypeId: 20220 },
  stateScopeProviderTarget: {
    typeId: 20252,
    typeKey: 'state_scope/provider_target',
    reservedTypeId: 20252
  },
  matchModeAll: { typeId: 20181, typeKey: 'match_mode/all', reservedTypeId: 20181 },
  eventBasicAttackHit: {
    typeId: 20211,
    typeKey: 'event/basic_attack_hit',
    reservedTypeId: 20211
  },
  eventSourceOwner: { typeId: 20212, typeKey: 'event/source_owner', reservedTypeId: 20212 },
  providerKindPassive: { typeId: 20120, typeKey: 'provider_kind/passive', reservedTypeId: 20120 },
  abilityKindActive: { typeId: 20130, typeKey: 'ability_kind/active', reservedTypeId: 20130 },
  abilityPhaseImpact: { typeId: 20142, typeKey: 'ability_phase/impact', reservedTypeId: 20142 },
  phaseTriggerEnter: { typeId: 20260, typeKey: 'phase_trigger/on_enter', reservedTypeId: 20260 },
  heroClass: { typeId: 30001, typeKey: 'class/mage' },
  heroRole: { typeId: 30002, typeKey: 'role/carry' }
} as const;

function buildGraphFixture(overrides?: Partial<CombatDataGraph>): CombatDataGraph {
  const graph: CombatDataGraph = {
    gameId: 'demo',
    currentRevision: 7,
    state: {
      gameId: 'demo',
      currentRevision: 7,
      publishedRevision: 6,
      updatedAt: '2026-07-12T00:00:00Z'
    },
    progressionSchema: null,
    attributeDefinitions: [
      {
        ...META,
        attrKey: 'ad',
        sortOrder: 1,
        valueKind: 'number'
      }
    ],
    resourceDefinitions: [
      {
        ...META,
        resourceKey: 'hp',
        displayName: 'HP',
        defaultInitialValue: 1000,
        defaultMaxValue: 1000
      }
    ],
    types: Object.values(TYPE).map((t) => ({
      ...META,
      typeId: t.typeId,
      typeKey: t.typeKey,
      ...('reservedTypeId' in t ? { reservedTypeId: t.reservedTypeId } : {})
    })),
    typeRelations: [
      {
        ...META,
        typeId: TYPE.heroClass.typeId,
        targetCategory: 'entity',
        targetId: 'entity_source'
      },
      {
        ...META,
        typeId: TYPE.heroRole.typeId,
        targetCategory: 'entity',
        targetId: 'entity_target'
      },
      {
        ...META,
        typeId: TYPE.heroClass.typeId,
        targetCategory: 'type',
        targetId: String(TYPE.heroRole.typeId)
      }
    ],
    entities: [
      {
        ...META,
        entityId: 'entity_source',
        displayName: 'Source Mage'
      },
      {
        ...META,
        entityId: 'entity_target',
        displayName: 'Target Carry'
      }
    ],
    entityAttributes: [
      { ...META, entityId: 'entity_source', attrKey: 'ad', baseValue: 50 },
      { ...META, entityId: 'entity_target', attrKey: 'ad', baseValue: 10 }
    ],
    entityAttributeStages: [],
    entityResources: [
      {
        ...META,
        entityId: 'entity_source',
        resourceKey: 'hp',
        initialValue: 1000,
        maxValue: 1000
      },
      {
        ...META,
        entityId: 'entity_target',
        resourceKey: 'hp',
        initialValue: 800,
        maxValue: 800
      }
    ],
    entityResourceStages: [],
    entityProviderMounts: [
      { ...META, entityId: 'entity_source', providerId: 'prov_q' },
      { ...META, entityId: 'entity_target', providerId: 'prov_passive' }
    ],
    providers: [
      {
        ...META,
        providerId: 'prov_q',
        providerKindTypeId: TYPE.providerKindPassive.typeId,
        displayName: 'Q Skill'
      },
      {
        ...META,
        providerId: 'prov_passive',
        providerKindTypeId: TYPE.providerKindPassive.typeId,
        displayName: 'Passive'
      }
    ],
    providerLifecycles: [],
    providerStateFields: [],
    providerFormulas: [
      {
        ...META,
        providerId: 'prov_q',
        formulaKey: 'dmg',
        expression: {
          op: 'add',
          args: [
            { op: 'read', path: '$owner.attr.ad' },
            { op: 'const', value: 10 }
          ]
        }
      }
    ],
    providerModifiers: [],
    providerListeners: [],
    listenerMatchTypes: [],
    providerTickSequences: [],
    abilities: [
      {
        ...META,
        abilityId: 'abil_q',
        providerId: 'prov_q',
        abilityKey: 'cast',
        abilityKindTypeId: TYPE.abilityKindActive.typeId,
        displayName: 'Q Cast'
      }
    ],
    abilityParameters: [],
    abilityStateFields: [],
    abilityPhases: [
      {
        ...META,
        phaseId: 'phase_impact',
        abilityId: 'abil_q',
        phaseOrder: 0,
        phaseTypeId: TYPE.abilityPhaseImpact.typeId,
        interruptible: false
      }
    ],
    abilityCosts: [],
    abilityCooldowns: [],
    effectSequences: [
      {
        ...META,
        sequenceId: 'seq_q_damage',
        providerId: 'prov_q',
        sequenceKey: 'impact_damage'
      }
    ],
    effectSteps: [
      {
        ...META,
        stepId: 'step_dmg',
        sequenceId: 'seq_q_damage',
        stepOrder: 0,
        operationTypeId: TYPE.operationDamage.typeId,
        targetSelectorTypeId: TYPE.selectorOpponent.typeId,
        damageDetail: {
          amountFormulaKey: 'dmg',
          damageTypeId: TYPE.damagePhysical.typeId,
          valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
        }
      }
    ],
    abilityPhaseEffectSequences: [
      {
        ...META,
        phaseId: 'phase_impact',
        triggerTypeId: TYPE.phaseTriggerEnter.typeId,
        sequenceId: 'seq_q_damage'
      }
    ],
    listenerEffectSequences: [],
    ...overrides
  };

  return graph;
}

describe('combatDataAssembler', () => {
  it('assembles CompileRequest with namespaced providers and flattened operations', () => {
    const graph = buildGraphFixture();
    const result = assembleCombatScenario(graph, {
      sourceEntityId: 'entity_source',
      targetEntityId: 'entity_target'
    });

    expect(result.compileRequest.combatants).toHaveLength(2);
    expect(result.compileRequest.combatants.map((c) => c.key)).toEqual(['source', 'target']);
    expect(result.compileRequest.schemaVersion).toBe(DEFAULT_GENERIC_SCHEMA_VERSION);
    expect(result.compileRequest.schemaVersion).toBe('generic-p0');
    expect(result.compileRequest.schemaHash).toBe('rev:7');
    expect(result.compileRequest.rulesHash).toBe('rev:7');

    const providerKeys = result.compileRequest.sharedProviders!.map((p) => p.providerKey);
    expect(providerKeys).toEqual(
      expect.arrayContaining([
        'source::prov_q',
        'target::prov_q',
        'source::prov_passive',
        'target::prov_passive'
      ])
    );
    expect(providerKeys.every((key) => key.includes('::'))).toBe(true);

    const sourceProvider = result.compileRequest.sharedProviders!.find(
      (p) => p.providerKey === 'source::prov_q'
    )!;
    expect(sourceProvider.abilities).toHaveLength(1);
    expect(sourceProvider.abilities![0].abilityKey).toBe('cast');
    expect(sourceProvider.abilities![0].kind).toBe('active');
    expect(sourceProvider.abilities![0].operations).toHaveLength(1);
    expect(sourceProvider.abilities![0].operations![0]).toMatchObject({
      operation: 'damage',
      target: 'opponent',
      damageType: 'damage/physical',
      valuePolicy: 'add',
      amount: { op: 'ref', ref: 'source::dmg' }
    });
    expect(sourceProvider.abilities![0].operations![0]).not.toHaveProperty('condition');

    const catalogByKey = Object.fromEntries(
      result.compileRequest.typeCatalog.types.map((t) => [t.key, t.domain])
    );
    expect(catalogByKey['operation/damage']).toBe('operation');
    expect(catalogByKey['class/mage']).toBe('class');
    expect(result.compileRequest.typeCatalog.types.every((t) => t.domain === t.key.split('/')[0])).toBe(
      true
    );
    const typeKeys = result.compileRequest.typeCatalog.types.map((t) => t.key);
    expect(typeKeys).toContain('operation/damage');
    expect(typeKeys).toContain('class/mage');
    expect(typeKeys.every((key) => typeof key === 'string' && !/^\d+$/.test(key))).toBe(true);
    expect(result.compileRequest.typeCatalog.relations).toContainEqual({
      parent: 'class/mage',
      child: 'role/carry'
    });

    expect(result.compileRequest.combatants[0].providers[0]).toMatchObject({
      providerRef: 'passive:prov_q',
      definitionRef: 'source::prov_q'
    });
    expect(result.compileRequest.formulas!.map((f) => f.key)).toEqual(
      expect.arrayContaining(['source::dmg', 'target::dmg'])
    );
    expect(result.compileRequest.formulas!.find((f) => f.key === 'source::dmg')!.expression).toMatchObject({
      op: 'add',
      args: [{ op: 'read', path: 'source.attr.ad' }, { op: 'const', value: 10 }]
    });

    expect(result.initialSnapshot.timeMs).toBe(0);
    expect(result.initialSnapshot.combatants).toHaveLength(2);
    expect(result.availableSourceAbilities.some((a) => a.abilityKey === 'cast' && a.selectable)).toBe(
      true
    );
  });

  it('throws when selected entity is missing even if entities list can be empty', () => {
    const emptyEntitiesGraph = buildGraphFixture({ entities: [] });
    expect(emptyEntitiesGraph.entities).toEqual([]);
    expect(() =>
      assembleCompileRequest(emptyEntitiesGraph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      })
    ).toThrow(CombatDataAssembleError);
    expect(() =>
      assembleCompileRequest(emptyEntitiesGraph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      })
    ).toThrow(/entity not found: entity_source/);
  });

  it('throws for unknown entity id on a populated graph', () => {
    const graph = buildGraphFixture();
    expect(() =>
      assembleCompileRequest(graph, {
        sourceEntityId: 'missing',
        targetEntityId: 'entity_target'
      })
    ).toThrow(/entity not found: missing/);
  });

  it('derives typeCatalog domain from typeKey prefix (not reserved/game heuristic)', () => {
    expect(domainFromTypeKey('type/50001')).toBe('type');
    expect(domainFromTypeKey('event/damage_dealt')).toBe('event');

    const graph = buildGraphFixture({
      types: [
        ...Object.values(TYPE).map((t) => ({
          ...META,
          typeId: t.typeId,
          typeKey: t.typeKey,
          ...('reservedTypeId' in t ? { reservedTypeId: t.reservedTypeId } : {})
        })),
        { ...META, typeId: 50001, typeKey: 'type/50001' },
        { ...META, typeId: 90001, typeKey: 'event/on_hit', reservedTypeId: 90001 }
      ]
    });

    const compile = assembleCompileRequest(graph, {
      sourceEntityId: 'entity_source',
      targetEntityId: 'entity_target'
    });

    expect(compile.typeCatalog.types).toContainEqual({ key: 'type/50001', domain: 'type' });
    expect(compile.typeCatalog.types).toContainEqual({ key: 'event/on_hit', domain: 'event' });
    // reservedTypeId must not force domain=reserved/game
    expect(compile.typeCatalog.types.find((t) => t.key === 'operation/damage')).toEqual({
      key: 'operation/damage',
      domain: 'operation'
    });
  });

  it('fails assemble when typeKey lacks domain/name slash', () => {
    expect(() => domainFromTypeKey('noslash')).toThrow(CombatDataAssembleError);
    expect(() => domainFromTypeKey('noslash')).toThrow(/domain\/name/);

    const graph = buildGraphFixture({
      types: [
        ...Object.values(TYPE).map((t) => ({
          ...META,
          typeId: t.typeId,
          typeKey: t.typeKey,
          ...('reservedTypeId' in t ? { reservedTypeId: t.reservedTypeId } : {})
        })),
        { ...META, typeId: 77777, typeKey: 'invalidWithoutSlash' }
      ]
    });

    expect(() =>
      assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      })
    ).toThrow(/invalidWithoutSlash/);
  });

  it('projects conditionFormulaKey on damage step into operation.condition formula ref', () => {
    const graph = buildGraphFixture({
      providerFormulas: [
        {
          ...META,
          providerId: 'prov_q',
          formulaKey: 'dmg',
          expression: {
            op: 'add',
            args: [
              { op: 'read', path: '$owner.attr.ad' },
              { op: 'const', value: 10 }
            ]
          }
        },
        {
          ...META,
          providerId: 'prov_q',
          formulaKey: 'when_ad_gt',
          expression: {
            op: 'gt',
            args: [
              { op: 'read', path: '$owner.attr.ad' },
              { op: 'const', value: 0 }
            ]
          }
        }
      ],
      effectSteps: [
        {
          ...META,
          stepId: 'step_dmg',
          sequenceId: 'seq_q_damage',
          stepOrder: 0,
          operationTypeId: TYPE.operationDamage.typeId,
          targetSelectorTypeId: TYPE.selectorOpponent.typeId,
          conditionFormulaKey: 'when_ad_gt',
          damageDetail: {
            amountFormulaKey: 'dmg',
            damageTypeId: TYPE.damagePhysical.typeId,
            valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
          }
        }
      ]
    });

    const compile = assembleCompileRequest(graph, {
      sourceEntityId: 'entity_source',
      targetEntityId: 'entity_target'
    });
    const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
    expect(sourceProvider.abilities![0].operations![0]).toMatchObject({
      operation: 'damage',
      target: 'opponent',
      condition: { op: 'ref', ref: 'source::when_ad_gt' },
      amount: { op: 'ref', ref: 'source::dmg' }
    });
  });

  it('projects state_change with provider_target scope into operation fields', () => {
    const graph = buildGraphFixture({
      providerFormulas: [
        {
          ...META,
          providerId: 'prov_q',
          formulaKey: 'stack_delta',
          expression: { op: 'const', value: 1 }
        },
        {
          ...META,
          providerId: 'prov_q',
          formulaKey: 'when_ready',
          expression: { op: 'const', value: 1 }
        }
      ],
      effectSteps: [
        {
          ...META,
          stepId: 'step_state',
          sequenceId: 'seq_q_damage',
          stepOrder: 0,
          operationTypeId: TYPE.operationStateChange.typeId,
          targetSelectorTypeId: TYPE.selectorSelf.typeId,
          conditionFormulaKey: 'when_ready',
          stateDetail: {
            stateScopeTypeId: TYPE.stateScopeProviderTarget.typeId,
            stateKey: 'stacks',
            amountFormulaKey: 'stack_delta',
            valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
          }
        }
      ]
    });

    const compile = assembleCompileRequest(graph, {
      sourceEntityId: 'entity_source',
      targetEntityId: 'entity_target'
    });
    const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
    expect(sourceProvider.abilities![0].operations![0]).toEqual({
      operation: 'state_change',
      target: 'self',
      amount: { op: 'ref', ref: 'source::stack_delta' },
      valuePolicy: 'add',
      ref: 'stacks',
      types: ['state_scope/provider_target'],
      condition: { op: 'ref', ref: 'source::when_ready' }
    });
  });

  it('preserves provider listener ALL matcher with static and dynamic event types', () => {
    const graph = buildGraphFixture({
      providerListeners: [
        {
          ...META,
          providerId: 'prov_passive',
          listenerId: 'listener_on_hit',
          listenerKey: 'on_basic_hit',
          eventTypeId: TYPE.eventBasicAttackHit.typeId
        }
      ],
      listenerMatchTypes: [
        {
          ...META,
          listenerId: 'listener_on_hit',
          matchModeTypeId: TYPE.matchModeAll.typeId,
          typeId: TYPE.eventBasicAttackHit.typeId
        },
        {
          ...META,
          listenerId: 'listener_on_hit',
          matchModeTypeId: TYPE.matchModeAll.typeId,
          typeId: TYPE.eventSourceOwner.typeId
        }
      ]
    });

    const compile = assembleCompileRequest(graph, {
      sourceEntityId: 'entity_source',
      targetEntityId: 'entity_target'
    });
    const sourcePassive = compile.sharedProviders!.find(
      (p) => p.providerKey === 'source::prov_passive'
    )!;
    expect(sourcePassive.listeners).toHaveLength(1);
    expect(sourcePassive.listeners![0].eventMatcher).toEqual({
      all: ['event/basic_attack_hit', 'event/source_owner']
    });
  });

  it('omits condition when effect step has no conditionFormulaKey', () => {
    const graph = buildGraphFixture();
    const compile = assembleCompileRequest(graph, {
      sourceEntityId: 'entity_source',
      targetEntityId: 'entity_target'
    });
    const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
    const op = sourceProvider.abilities![0].operations![0];
    expect(op).not.toHaveProperty('condition');
    expect(JSON.stringify(op)).not.toContain('"condition"');
  });

  describe('source equipment static attributes', () => {
    const ITEM_TAG = {
      typeId: 62002,
      typeKey: 'tag/adc_completed_item'
    } as const;

    function withItems(graph: CombatDataGraph): CombatDataGraph {
      return buildGraphFixture({
        types: [
          ...graph.types,
          { ...META, typeId: ITEM_TAG.typeId, typeKey: ITEM_TAG.typeKey }
        ],
        typeRelations: [
          ...graph.typeRelations,
          {
            ...META,
            typeId: ITEM_TAG.typeId,
            targetCategory: 'entity',
            targetId: 'item_3153'
          },
          {
            ...META,
            typeId: ITEM_TAG.typeId,
            targetCategory: 'entity',
            targetId: 'item_3124'
          },
          {
            ...META,
            typeId: ITEM_TAG.typeId,
            targetCategory: 'entity',
            targetId: 'item_6672'
          }
        ],
        entities: [
          ...graph.entities,
          { ...META, entityId: 'item_3153', displayName: 'Blade of the Ruined King' },
          { ...META, entityId: 'item_3124', displayName: "Guinsoo's Rageblade" },
          { ...META, entityId: 'item_6672', displayName: 'Kraken Slayer' },
          { ...META, entityId: 'item_untagged', displayName: 'Not An Item' }
        ],
        entityAttributes: [
          ...graph.entityAttributes,
          { ...META, entityId: 'entity_source', attrKey: 'attack_speed', baseValue: 0.6 },
          { ...META, entityId: 'item_3153', attrKey: 'ad', baseValue: 40 },
          { ...META, entityId: 'item_3153', attrKey: 'attack_speed', baseValue: 0.25 },
          { ...META, entityId: 'item_3153', attrKey: 'life_steal', baseValue: 0.1 },
          { ...META, entityId: 'item_3124', attrKey: 'ad', baseValue: 30 },
          { ...META, entityId: 'item_3124', attrKey: 'ap', baseValue: 30 },
          { ...META, entityId: 'item_3124', attrKey: 'attack_speed', baseValue: 0.25 },
          { ...META, entityId: 'item_6672', attrKey: 'ad', baseValue: 45 },
          { ...META, entityId: 'item_6672', attrKey: 'attack_speed', baseValue: 0.4 },
          { ...META, entityId: 'item_6672', attrKey: 'ms_pct', baseValue: 0.04 }
        ],
        entityAttributeStages: [
          {
            ...META,
            entityId: 'entity_source',
            attrKey: 'ad',
            stage: 18,
            value: 100
          },
          {
            ...META,
            entityId: 'entity_source',
            attrKey: 'attack_speed',
            stage: 18,
            value: 0.75
          },
          // Deliberately different from item_3153 ad baseValue (40); loadout must ignore this.
          {
            ...META,
            entityId: 'item_3153',
            attrKey: 'ad',
            stage: 18,
            value: 999
          }
        ],
        entityProviderMounts: [
          ...graph.entityProviderMounts,
          { ...META, entityId: 'item_3153', providerId: 'prov_bork' },
          { ...META, entityId: 'item_3124', providerId: 'prov_guinsoo' },
          { ...META, entityId: 'item_6672', providerId: 'prov_kraken' },
          // Deliberate duplicate providerId shared with hero (dedupe coverage).
          { ...META, entityId: 'item_6672', providerId: 'prov_q' }
        ],
        providers: [
          ...graph.providers,
          {
            ...META,
            providerId: 'prov_bork',
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: 'BoRK On-Hit'
          },
          {
            ...META,
            providerId: 'prov_guinsoo',
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: "Guinsoo's On-Hit"
          },
          {
            ...META,
            providerId: 'prov_kraken',
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: 'Kraken Every-3'
          }
        ],
        entityResources: [
          ...graph.entityResources,
          {
            ...META,
            entityId: 'item_3153',
            resourceKey: 'mana',
            initialValue: 0,
            maxValue: 0
          }
        ]
      });
    }

    it('sums hero stage attrs with one item and creates missing life_steal slot', () => {
      const graph = withItems(buildGraphFixture());
      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceStage: 18,
        sourceEquipmentEntityIds: ['item_3153']
      });

      const source = compile.combatants[0];
      // Hero stage ad 100 + item baseValue 40 (not item stage 999).
      expect(source.attributes.ad).toEqual({
        base: 140,
        current: 140,
        max: 140,
        resolved: 140
      });
      expect(source.attributes.attack_speed).toEqual({
        base: 1,
        current: 1,
        max: 1,
        resolved: 1
      });
      expect(source.attributes.life_steal).toEqual({
        base: 0.1,
        current: 0.1,
        max: 0.1,
        resolved: 0.1
      });
      expect(compile.combatants[1].attributes.ad).toEqual({
        base: 10,
        current: 10,
        max: 10,
        resolved: 10
      });
      expect(compile.combatants[1].attributes.life_steal).toBeUndefined();
    });

    it('ignores equipment entityAttributeStages and uses only item baseValue', () => {
      const graph = withItems(buildGraphFixture());
      const itemStage = graph.entityAttributeStages.find(
        (s) => s.entityId === 'item_3153' && s.attrKey === 'ad' && s.stage === 18
      );
      expect(itemStage?.value).toBe(999);

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceStage: 18,
        sourceEquipmentEntityIds: ['item_3153']
      });

      // Hero stage still applies (100); equipment contributes baseValue 40 only.
      expect(compile.combatants[0].attributes.ad).toEqual({
        base: 140,
        current: 140,
        max: 140,
        resolved: 140
      });
    });

    it('rejects sourceEntityId tagged as adc_completed_item', () => {
      const graph = withItems(buildGraphFixture());
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'item_3153',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/source entity is tagged tag\/adc_completed_item: item_3153/);
    });

    it('rejects targetEntityId tagged as adc_completed_item', () => {
      const graph = withItems(buildGraphFixture());
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'item_3124'
        })
      ).toThrow(/target entity is tagged tag\/adc_completed_item: item_3124/);
    });

    it('sums multiple items deterministically', () => {
      const graph = withItems(buildGraphFixture());
      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: ['item_3153', 'item_3124', 'item_6672']
      });

      const source = compile.combatants[0];
      // base ad 50 + 40 + 30 + 45
      expect(source.attributes.ad).toMatchObject({ base: 165, current: 165, max: 165, resolved: 165 });
      // base as 0.6 + 0.25 + 0.25 + 0.4
      expect(source.attributes.attack_speed).toMatchObject({
        base: 1.5,
        current: 1.5,
        max: 1.5,
        resolved: 1.5
      });
      expect(source.attributes.ap).toMatchObject({ base: 30, current: 30, max: 30, resolved: 30 });
      expect(source.attributes.life_steal).toMatchObject({
        base: 0.1,
        current: 0.1,
        max: 0.1,
        resolved: 0.1
      });
      expect(source.attributes.ms_pct).toMatchObject({
        base: 0.04,
        current: 0.04,
        max: 0.04,
        resolved: 0.04
      });
    });

    it('does not merge item types or resources into source (providers are merged separately)', () => {
      const graph = withItems(buildGraphFixture());
      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: ['item_3153']
      });

      const source = compile.combatants[0];
      expect(source.types).toEqual(['class/mage']);
      expect(source.types).not.toContain('tag/adc_completed_item');
      expect(source.resources).toEqual({
        hp: { current: 1000, max: 1000 }
      });
      expect(source.resources.mana).toBeUndefined();
    });

    it('merges selected item provider mounts into source combatant and sharedProviders', () => {
      const graph = withItems(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: ['item_3153']
      });

      const source = scenario.compileRequest.combatants[0];
      expect(source.providers.map((p) => p.definitionRef)).toEqual([
        'source::prov_q',
        'source::prov_bork'
      ]);
      expect(source.providers.map((p) => p.providerRef)).toEqual([
        'passive:prov_q',
        'passive:prov_bork'
      ]);

      const providerKeys = scenario.compileRequest.sharedProviders!.map((p) => p.providerKey);
      expect(providerKeys).toEqual(
        expect.arrayContaining(['source::prov_bork', 'target::prov_bork'])
      );

      const sourceSnapshot = scenario.initialSnapshot.combatants[0];
      expect(sourceSnapshot.providers.map((p) => p.definitionRef)).toEqual([
        'source::prov_q',
        'source::prov_bork'
      ]);
      expect(sourceSnapshot.providers.map((p) => p.providerRef)).toEqual([
        'passive:prov_q',
        'passive:prov_bork'
      ]);
    });

    it('does not include unselected item providers in compile request', () => {
      const graph = withItems(buildGraphFixture());
      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: ['item_3124']
      });

      const sourceRefs = compile.combatants[0].providers.map((p) => p.definitionRef);
      expect(sourceRefs).toEqual(['source::prov_q', 'source::prov_guinsoo']);
      expect(sourceRefs).not.toContain('source::prov_bork');
      expect(sourceRefs).not.toContain('source::prov_kraken');

      const providerKeys = compile.sharedProviders!.map((p) => p.providerKey);
      expect(providerKeys).not.toContain('source::prov_bork');
      expect(providerKeys).not.toContain('source::prov_kraken');
      expect(providerKeys).toContain('source::prov_guinsoo');
    });

    it('mounts multiple item providers on source only, not target', () => {
      const graph = withItems(buildGraphFixture());
      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: ['item_3153', 'item_3124', 'item_6672']
      });

      const sourceRefs = compile.combatants[0].providers.map((p) => p.definitionRef);
      expect(sourceRefs).toEqual([
        'source::prov_q',
        'source::prov_bork',
        'source::prov_guinsoo',
        'source::prov_kraken'
      ]);

      const targetRefs = compile.combatants[1].providers.map((p) => p.definitionRef);
      expect(targetRefs).toEqual(['target::prov_passive']);
      expect(targetRefs).not.toContain('target::prov_bork');
      expect(targetRefs).not.toContain('target::prov_guinsoo');
      expect(targetRefs).not.toContain('target::prov_kraken');
    });

    it('dedupes providerId when hero and equipment share the same mount', () => {
      const graph = withItems(buildGraphFixture());
      // item_6672 mounts both prov_kraken and prov_q (same as hero).
      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: ['item_6672']
      });

      const sourceRefs = compile.combatants[0].providers.map((p) => p.definitionRef);
      expect(sourceRefs).toEqual(['source::prov_q', 'source::prov_kraken']);
      expect(sourceRefs.filter((ref) => ref === 'source::prov_q')).toHaveLength(1);

      const sourceProvQCount = compile.sharedProviders!.filter(
        (p) => p.providerKey === 'source::prov_q'
      ).length;
      expect(sourceProvQCount).toBe(1);
    });

    it('keeps numeric overrides as the final layer after equipment aggregation', () => {
      const graph = withItems(buildGraphFixture());
      const compile = assembleCompileRequest(
        graph,
        {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target',
          sourceEquipmentEntityIds: ['item_3153']
        },
        {
          source: {
            attributes: {
              ad: { base: 999, current: 999, max: 999 }
            }
          }
        }
      );
      expect(compile.combatants[0].attributes.ad).toEqual({
        base: 999,
        current: 999,
        max: 999,
        resolved: 999
      });
      expect(compile.combatants[0].attributes.life_steal).toEqual({
        base: 0.1,
        current: 0.1,
        max: 0.1,
        resolved: 0.1
      });
    });

    it('rejects duplicate equipment ids', () => {
      const graph = withItems(buildGraphFixture());
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target',
          sourceEquipmentEntityIds: ['item_3153', 'item_3153']
        })
      ).toThrow(/source equipment contains duplicate entity id: item_3153/);
    });

    it('rejects more than 6 equipment items', () => {
      const full = withItems(buildGraphFixture());
      const extraItems = ['item_a', 'item_b', 'item_c', 'item_d'].map((id) => ({
        ...META,
        entityId: id,
        displayName: id
      }));
      const extraRels = ['item_a', 'item_b', 'item_c', 'item_d'].map((id) => ({
        ...META,
        typeId: ITEM_TAG.typeId,
        targetCategory: 'entity' as const,
        targetId: id
      }));
      const graphSeven = {
        ...full,
        entities: [...full.entities, ...extraItems],
        typeRelations: [...full.typeRelations, ...extraRels]
      };
      expect(() =>
        assembleCompileRequest(graphSeven, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target',
          sourceEquipmentEntityIds: [
            'item_3153',
            'item_3124',
            'item_6672',
            'item_a',
            'item_b',
            'item_c',
            'item_d'
          ]
        })
      ).toThrow(/source equipment allows at most 6 items, got 7/);
    });

    it('rejects missing equipment entity', () => {
      const graph = withItems(buildGraphFixture());
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target',
          sourceEquipmentEntityIds: ['item_missing']
        })
      ).toThrow(/source equipment entity not found: item_missing/);
    });

    it('rejects untagged equipment entity', () => {
      const graph = withItems(buildGraphFixture());
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target',
          sourceEquipmentEntityIds: ['item_untagged']
        })
      ).toThrow(/source equipment entity is not tagged tag\/adc_completed_item: item_untagged/);
    });

    it('treats empty or undefined equipment as backward compatible no-op', () => {
      const graph = withItems(buildGraphFixture());
      const baseline = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const empty = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: []
      });
      expect(empty.combatants[0].attributes).toEqual(baseline.combatants[0].attributes);
      expect(empty.combatants[0].providers).toEqual(baseline.combatants[0].providers);
    });
  });
});
