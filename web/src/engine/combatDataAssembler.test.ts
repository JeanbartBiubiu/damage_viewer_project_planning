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
  selectorOpponent: { typeId: 20111, typeKey: 'selector/opponent', reservedTypeId: 20111 },
  selectorSelf: { typeId: 20110, typeKey: 'selector/self', reservedTypeId: 20110 },
  valuePolicyAdd: { typeId: 20170, typeKey: 'value_policy/add', reservedTypeId: 20170 },
  damagePhysical: { typeId: 20220, typeKey: 'damage/physical', reservedTypeId: 20220 },
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
});
