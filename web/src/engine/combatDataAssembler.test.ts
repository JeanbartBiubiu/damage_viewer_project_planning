import { describe, expect, it } from 'vitest';
import {
  assembleCombatScenario,
  assembleCompileRequest,
  CombatDataAssembleError,
  domainFromTypeKey,
  DEFAULT_GENERIC_SCHEMA_VERSION,
  normalizeDriverPlan
} from './combatDataAssembler';
import type { CombatDataGraph, CombatDataRowMeta } from '../types/combatData';
import type { DriverPlan } from '../types/genericEngine';

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
    executeEffectDetails: [],
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

  describe('Guinsoo H+K W2 driver repeat XOR', () => {
    function basePlan(repeat: DriverPlan['entries'][number]['repeat']): DriverPlan {
      return {
        conditionRecheckIntervalMs: 100,
        entries: [
          {
            entryKey: 'entry_0',
            abilityRef: 'source.provider[passive:prov_q].ability[cast]',
            source: 'source',
            target: 'target',
            firstAtMs: 0,
            ...(repeat ? { repeat } : {})
          }
        ]
      };
    }

    it('preserves fixed intervalMs repeat and optional maxAttempts', () => {
      const normalized = normalizeDriverPlan(
        basePlan({ intervalMs: 625, maxAttempts: 10 })
      );
      expect(normalized.entries[0].repeat).toEqual({
        intervalMs: 625,
        maxAttempts: 10
      });
      expect(normalized.entries[0].repeat).not.toHaveProperty('intervalFormula');
    });

    it('preserves intervalFormula AST via deep clone without evaluating', () => {
      const formula = {
        op: 'div',
        args: [
          { op: 'const', value: 1000 },
          { op: 'read', path: 'source.attr.attack_speed.resolved' }
        ]
      };
      const plan = basePlan({ intervalFormula: formula, maxAttempts: 3 });
      const normalized = normalizeDriverPlan(plan);
      expect(normalized.entries[0].repeat).toEqual({
        intervalFormula: formula,
        maxAttempts: 3
      });
      expect(normalized.entries[0].repeat).not.toHaveProperty('intervalMs');
      // Mutating the input formula must not affect the normalized copy.
      formula.args![0].value = 999;
      expect(
        (normalized.entries[0].repeat as { intervalFormula: typeof formula }).intervalFormula.args![0]
          .value
      ).toBe(1000);
    });

    it('rejects repeat with neither intervalMs nor intervalFormula', () => {
      expect(() =>
        normalizeDriverPlan(basePlan({ maxAttempts: 2 } as never))
      ).toThrow(/exactly one of intervalMs or intervalFormula/);
    });

    it('rejects repeat with both intervalMs and intervalFormula', () => {
      expect(() =>
        normalizeDriverPlan(
          basePlan({
            intervalMs: 500,
            intervalFormula: { op: 'const', value: 500 }
          } as never)
        )
      ).toThrow(/exactly one of intervalMs or intervalFormula/);
    });

    it('rejects non-positive or non-finite intervalMs', () => {
      expect(() => normalizeDriverPlan(basePlan({ intervalMs: 0 }))).toThrow(
        /intervalMs must be a positive finite number/
      );
      expect(() => normalizeDriverPlan(basePlan({ intervalMs: -10 }))).toThrow(
        /intervalMs must be a positive finite number/
      );
      expect(() => normalizeDriverPlan(basePlan({ intervalMs: Number.NaN }))).toThrow(
        /intervalMs must be a positive finite number/
      );
    });
  });

  describe('Guinsoo H+K W1 projection', () => {
    const HK_TYPE = {
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      refreshDuration: { typeId: 20190, typeKey: 'refresh_policy/refresh_duration' },
      operationRepeat: { typeId: 20161, typeKey: 'operation/repeat' },
      repeatScopeCopyable: { typeId: 20263, typeKey: 'repeat_scope/copyable_on_hit' },
      operationExecuteThreshold: { typeId: 20162, typeKey: 'operation/execute_threshold' }
    } as const;

    function withHkTypes(graph: CombatDataGraph): CombatDataGraph {
      return {
        ...graph,
        types: [
          ...graph.types,
          ...Object.values(HK_TYPE).map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ]
      };
    }

    it('projects structured initialStateSchema with defaultValue=0; legacy fields stay bare 0', () => {
      // Backend reserved 20190 typeKey refresh_policy/refresh_duration -> Wasm refresh_on_write
      // (narrow initialStateSchema adapter; generic abiToken would yield refresh_duration).
      const graph = withHkTypes(
        buildGraphFixture({
          providerStateFields: [
            {
              ...META,
              providerId: 'prov_q',
              stateKey: 'stacks',
              valueTypeId: HK_TYPE.valueTypeNumber.typeId,
              maxValue: 4,
              durationMs: 6000,
              refreshPolicyTypeId: HK_TYPE.refreshDuration.typeId
            },
            {
              ...META,
              providerId: 'prov_q',
              stateKey: 'marker',
              valueTypeId: HK_TYPE.valueTypeNumber.typeId
            }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.initialStateSchema).toEqual({
        stacks: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 4,
          durationMs: 6000,
          refreshPolicy: 'refresh_on_write'
        },
        marker: 0
      });
      expect(typeof sourceProvider.initialStateSchema!.marker).toBe('number');
    });

    it('projects legacy silver_bolts_hits as numeric default 0', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          providerStateFields: [
            {
              ...META,
              providerId: 'prov_q',
              stateKey: 'silver_bolts_hits',
              valueTypeId: HK_TYPE.valueTypeNumber.typeId
            }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.initialStateSchema).toEqual({ silver_bolts_hits: 0 });
      expect(sourceProvider.initialStateSchema!.silver_bolts_hits).toBe(0);
    });

    it('keeps Guinsoo guinsoos_rage structured projection (maxValue/durationMs/refresh_on_write)', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          providerStateFields: [
            {
              ...META,
              providerId: 'prov_q',
              stateKey: 'guinsoos_rage',
              valueTypeId: HK_TYPE.valueTypeNumber.typeId,
              maxValue: 4,
              durationMs: 3000,
              refreshPolicyTypeId: HK_TYPE.refreshDuration.typeId
            }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.initialStateSchema).toEqual({
        guinsoos_rage: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 4,
          durationMs: 3000,
          refreshPolicy: 'refresh_on_write'
        }
      });
    });

    it('projects max-only energized_charge with durationMs=0 (untimed structured)', () => {
      // Backend omits durationMs when duration_ms=NULL; TinyGo requires explicit 0.
      const graph = withHkTypes(
        buildGraphFixture({
          providerStateFields: [
            {
              ...META,
              providerId: 'prov_q',
              stateKey: 'energized_charge',
              valueTypeId: HK_TYPE.valueTypeNumber.typeId,
              maxValue: 100
            }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.initialStateSchema).toEqual({
        energized_charge: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 100,
          durationMs: 0
        }
      });
      expect(sourceProvider.initialStateSchema!.energized_charge).not.toHaveProperty(
        'refreshPolicy'
      );
    });

    it('projects damage with ref=stepId and copyableOnHit only when true', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_copyable',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: TYPE.operationDamage.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              damageDetail: {
                amountFormulaKey: 'dmg',
                damageTypeId: TYPE.damagePhysical.typeId,
                valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
                copyableOnHit: true
              }
            }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.abilities![0].operations![0]).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_copyable',
        amount: { op: 'ref', ref: 'source::dmg' },
        damageType: 'damage/physical',
        valuePolicy: 'add',
        copyableOnHit: true
      });

      const plain = withHkTypes(buildGraphFixture());
      const plainCompile = assembleCompileRequest(plain, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const plainOp = plainCompile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!
        .abilities![0].operations![0];
      expect(plainOp.ref).toBe('step_dmg');
      expect(plainOp).not.toHaveProperty('copyableOnHit');
    });

    it('projects critEligible only when true; omits for false/undefined; coexists with copyableOnHit', () => {
      const critTrue = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_crit_eligible',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: TYPE.operationDamage.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              damageDetail: {
                amountFormulaKey: 'dmg',
                damageTypeId: TYPE.damagePhysical.typeId,
                valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
                critEligible: true
              }
            }
          ]
        })
      );
      const critTrueOp = assembleCompileRequest(critTrue, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      }).sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!.abilities![0]
        .operations![0];
      expect(critTrueOp).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_crit_eligible',
        amount: { op: 'ref', ref: 'source::dmg' },
        damageType: 'damage/physical',
        valuePolicy: 'add',
        critEligible: true
      });

      const critFalse = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_crit_false',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: TYPE.operationDamage.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              damageDetail: {
                amountFormulaKey: 'dmg',
                damageTypeId: TYPE.damagePhysical.typeId,
                valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
                critEligible: false
              }
            }
          ]
        })
      );
      const critFalseOp = assembleCompileRequest(critFalse, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      }).sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!.abilities![0]
        .operations![0];
      expect(critFalseOp.ref).toBe('step_crit_false');
      expect(critFalseOp).not.toHaveProperty('critEligible');

      const plain = withHkTypes(buildGraphFixture());
      const plainOp = assembleCompileRequest(plain, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      }).sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!.abilities![0]
        .operations![0];
      expect(plainOp.ref).toBe('step_dmg');
      expect(plainOp).not.toHaveProperty('critEligible');

      const both = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_both_flags',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: TYPE.operationDamage.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              damageDetail: {
                amountFormulaKey: 'dmg',
                damageTypeId: TYPE.damagePhysical.typeId,
                valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
                copyableOnHit: true,
                critEligible: true
              }
            }
          ]
        })
      );
      const bothOp = assembleCompileRequest(both, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      }).sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!.abilities![0]
        .operations![0];
      expect(bothOp).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_both_flags',
        amount: { op: 'ref', ref: 'source::dmg' },
        damageType: 'damage/physical',
        valuePolicy: 'add',
        copyableOnHit: true,
        critEligible: true
      });
    });

    it('projects repeatDetail with ref=stepId and ABI-tokenized repeatScope', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_repeat',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: HK_TYPE.operationRepeat.typeId,
              targetSelectorTypeId: TYPE.selectorSelf.typeId,
              repeatDetail: {
                repeatScopeTypeId: HK_TYPE.repeatScopeCopyable.typeId,
                repeatCount: 1,
                repeatTag: 'phantom_hit',
                triggerStateKey: 'stacks',
                threshold: 4
              }
            }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.abilities![0].operations![0]).toEqual({
        operation: 'repeat',
        target: 'self',
        ref: 'step_repeat',
        repeatScope: 'copyable_on_hit',
        repeatCount: 1,
        repeatTag: 'phantom_hit',
        triggerStateKey: 'stacks',
        threshold: 4
      });
    });

    it('rejects effect steps with multiple or missing detail families', () => {
      const multi = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_multi',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: TYPE.operationDamage.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              damageDetail: {
                amountFormulaKey: 'dmg',
                damageTypeId: TYPE.damagePhysical.typeId,
                valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
              },
              repeatDetail: {
                repeatScopeTypeId: HK_TYPE.repeatScopeCopyable.typeId,
                repeatCount: 1,
                repeatTag: 'phantom_hit',
                triggerStateKey: 'stacks',
                threshold: 4
              }
            } as never
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(multi, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/exactly one detail key; found 2/);

      const missing = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_missing',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: TYPE.operationDamage.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId
            } as never
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(missing, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/exactly one detail key; found 0/);
    });

    it('projects executeDetail with threshold and ref=stepId', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_execute',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: HK_TYPE.operationExecuteThreshold.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              executeDetail: { threshold: 0.25 }
            }
          ],
          executeEffectDetails: [
            { ...META, stepId: 'step_execute', threshold: 0.25 }
          ]
        })
      );

      const compile = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === 'source::prov_q')!;
      expect(sourceProvider.abilities![0].operations![0]).toEqual({
        operation: 'execute_threshold',
        target: 'opponent',
        threshold: 0.25,
        ref: 'step_execute'
      });
    });

    it('rejects executeDetail missing independent executeEffectDetail row', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_execute',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: HK_TYPE.operationExecuteThreshold.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              executeDetail: { threshold: 0.25 }
            }
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/step_execute.*missing independent executeEffectDetail/);
    });

    it('rejects duplicate executeEffectDetail rows', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_execute',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: HK_TYPE.operationExecuteThreshold.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              executeDetail: { threshold: 0.25 }
            }
          ],
          executeEffectDetails: [
            { ...META, stepId: 'step_execute', threshold: 0.25 },
            { ...META, stepId: 'step_execute', threshold: 0.25 }
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/duplicate executeEffectDetail.*step_execute/);
    });

    it('rejects orphan executeEffectDetail with no effect step', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          executeEffectDetails: [
            { ...META, stepId: 'step_missing', threshold: 0.25 }
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/orphan.*step_missing/);
    });

    it('rejects executeDetail when embedded and independent thresholds disagree', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          effectSteps: [
            {
              ...META,
              stepId: 'step_execute',
              sequenceId: 'seq_q_damage',
              stepOrder: 0,
              operationTypeId: HK_TYPE.operationExecuteThreshold.typeId,
              targetSelectorTypeId: TYPE.selectorOpponent.typeId,
              executeDetail: { threshold: 0.25 }
            }
          ],
          executeEffectDetails: [
            { ...META, stepId: 'step_execute', threshold: 0.4 }
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/step_execute.*threshold disagrees/);
    });

    it('rejects executeEffectDetail attached to a non-executeDetail step', () => {
      const graph = withHkTypes(
        buildGraphFixture({
          executeEffectDetails: [
            { ...META, stepId: 'step_dmg', threshold: 0.25 }
          ]
        })
      );
      expect(() =>
        assembleCompileRequest(graph, {
          sourceEntityId: 'entity_source',
          targetEntityId: 'entity_target'
        })
      ).toThrow(/step_dmg.*not executeDetail family/);
    });
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

  describe('ability type_relations → AbilityDefinition.types', () => {
    const abilityBasicAttack = {
      typeId: 62003,
      typeKey: 'ability/basic_attack',
      reservedTypeId: null
    };

    function withSpellbladeAbilities(base: CombatDataGraph): CombatDataGraph {
      // abilityKey deliberately NOT 'basic_attack' — classification must use types only.
      const basicAbility = {
        ...META,
        abilityId: 'abil_aa_swing',
        providerId: 'prov_q',
        abilityKey: 'aa_swing',
        abilityKindTypeId: TYPE.abilityKindActive.typeId,
        displayName: 'AA Swing'
      };
      const tumbleAbility = {
        ...META,
        abilityId: 'abil_tumble',
        providerId: 'prov_q',
        abilityKey: 'tumble',
        abilityKindTypeId: TYPE.abilityKindActive.typeId,
        displayName: 'Tumble'
      };
      return {
        ...base,
        types: [
          ...base.types,
          {
            ...META,
            typeId: abilityBasicAttack.typeId,
            typeKey: abilityBasicAttack.typeKey,
            reservedTypeId: abilityBasicAttack.reservedTypeId
          }
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: abilityBasicAttack.typeId,
            targetCategory: 'ability',
            targetId: 'abil_aa_swing'
          },
          // Duplicate relation must de-dupe into a stable single type key.
          {
            ...META,
            typeId: abilityBasicAttack.typeId,
            targetCategory: 'ability',
            targetId: 'abil_aa_swing'
          }
        ],
        abilities: [...base.abilities, basicAbility, tumbleAbility]
      };
    }

    it('projects target_category=ability onto AbilityDefinition.types (not via abilityKey)', () => {
      const graph = withSpellbladeAbilities(buildGraphFixture());
      const result = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const sourceProvider = result.compileRequest.sharedProviders!.find(
        (p) => p.providerKey === 'source::prov_q'
      )!;
      const aa = sourceProvider.abilities!.find((a) => a.abilityKey === 'aa_swing');
      const tumble = sourceProvider.abilities!.find((a) => a.abilityKey === 'tumble');
      const cast = sourceProvider.abilities!.find((a) => a.abilityKey === 'cast');

      expect(aa?.types).toEqual(['ability/basic_attack']);
      expect(tumble).toBeDefined();
      expect(tumble).not.toHaveProperty('types');
      expect(cast).toBeDefined();
      expect(cast).not.toHaveProperty('types');
    });

    it('copies AbilityDefinition.types onto availableSourceAbilities for the page', () => {
      const graph = withSpellbladeAbilities(buildGraphFixture());
      const result = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      const aaOpt = result.availableSourceAbilities.find((a) => a.abilityKey === 'aa_swing');
      const tumbleOpt = result.availableSourceAbilities.find((a) => a.abilityKey === 'tumble');

      expect(aaOpt?.types).toEqual(['ability/basic_attack']);
      expect(aaOpt?.types?.includes('ability/basic_attack')).toBe(true);
      expect(tumbleOpt).toBeDefined();
      expect(tumbleOpt).not.toHaveProperty('types');
      // Ensure page can classify without abilityKey string heuristics.
      expect(aaOpt?.abilityKey).not.toBe('basic_attack');
    });

    it('does not put target_category=ability into typeCatalog.relations', () => {
      const graph = withSpellbladeAbilities(buildGraphFixture());
      const result = assembleCompileRequest(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      });
      expect(result.typeCatalog.relations).toEqual([
        { parent: 'class/mage', child: 'role/carry' }
      ]);
      expect(
        result.typeCatalog.relations.some(
          (r) => r.parent === 'ability/basic_attack' || r.child === 'ability/basic_attack'
        )
      ).toBe(false);
      expect(result.typeCatalog.types.map((t) => t.key)).toContain('ability/basic_attack');
    });
  });

  describe('item_3100 Lich Bane Spellblade data contract', () => {
    const LICH = {
      itemId: 'item_3100',
      providerId: 'provider_item_3100_lich_bane_spellblade',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' },
      abilityBasicAttack: { typeId: 62003, typeKey: 'ability/basic_attack' },
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      refreshDuration: { typeId: 20190, typeKey: 'refresh_policy/refresh_duration' },
      valuePolicyOverride: { typeId: 20172, typeKey: 'value_policy/override' },
      valuePolicyPercentAdd: { typeId: 20173, typeKey: 'value_policy/percent_add' },
      damageMagic: { typeId: 20221, typeKey: 'damage/magic' },
      stateScopeProvider: { typeId: 20250, typeKey: 'state_scope/provider' },
      eventAbilityStarted: { typeId: 20205, typeKey: 'event/ability_started' }
    } as const;

    const PROC_DAMAGE_EXPR = {
      op: 'add',
      args: [
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.75 },
            { op: 'read', path: 'event.entry_source.attr.ad.base' }
          ]
        },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.45 },
            { op: 'read', path: 'event.entry_source.attr.ap.resolved' }
          ]
        }
      ]
    };

    const ATTACK_SPEED_EXPR = {
      op: 'mul',
      args: [
        { op: 'const', value: 0.5 },
        { op: 'read', path: 'provider.state.spellblade_ready' }
      ]
    };

    function withLichBaneSpellblade(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [
        LICH.itemTag,
        LICH.abilityBasicAttack,
        LICH.valueTypeNumber,
        LICH.refreshDuration,
        LICH.valuePolicyOverride,
        LICH.valuePolicyPercentAdd,
        LICH.damageMagic,
        LICH.stateScopeProvider,
        LICH.eventAbilityStarted
      ];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: LICH.itemTag.typeId,
            targetCategory: 'entity',
            targetId: LICH.itemId
          },
          {
            ...META,
            typeId: LICH.abilityBasicAttack.typeId,
            targetCategory: 'ability',
            targetId: 'abil_aa_swing'
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: LICH.itemId, displayName: 'Lich Bane' }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: LICH.itemId, providerId: LICH.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: LICH.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '巫妖之祸 Spellblade'
          }
        ],
        providerStateFields: [
          {
            ...META,
            providerId: LICH.providerId,
            stateKey: 'spellblade_ready',
            valueTypeId: LICH.valueTypeNumber.typeId,
            maxValue: 1,
            durationMs: 10000,
            refreshPolicyTypeId: LICH.refreshDuration.typeId
          },
          {
            ...META,
            providerId: LICH.providerId,
            stateKey: 'spellblade_icd',
            valueTypeId: LICH.valueTypeNumber.typeId,
            maxValue: 1,
            durationMs: 1500,
            refreshPolicyTypeId: LICH.refreshDuration.typeId
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_icd_available',
            expression: {
              op: 'eq',
              args: [
                { op: 'read', path: 'provider.state.spellblade_icd' },
                { op: 'const', value: 0 }
              ]
            }
          },
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_ready_arm',
            expression: { op: 'const', value: 1 }
          },
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_icd_arm',
            expression: { op: 'const', value: 1 }
          },
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_ready_armed',
            expression: {
              op: 'gte',
              args: [
                { op: 'read', path: 'provider.state.spellblade_ready' },
                { op: 'const', value: 1 }
              ]
            }
          },
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_proc_damage',
            expression: PROC_DAMAGE_EXPR
          },
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_ready_consume',
            expression: { op: 'const', value: 0 }
          },
          {
            ...META,
            providerId: LICH.providerId,
            formulaKey: 'spellblade_attack_speed',
            expression: ATTACK_SPEED_EXPR
          }
        ],
        providerModifiers: [
          {
            ...META,
            providerId: LICH.providerId,
            modifierId: 'modifier_item_3100_lich_bane_spellblade_attack_speed',
            modifierKey: 'spellblade_attack_speed',
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            targetAttrKey: 'attack_speed',
            priority: 0,
            valuePolicyTypeId: LICH.valuePolicyPercentAdd.typeId,
            valueFormulaKey: 'spellblade_attack_speed'
          }
        ],
        providerListeners: [
          {
            ...META,
            providerId: LICH.providerId,
            listenerId: 'listener_item_3100_lich_bane_spellblade_ability_started',
            listenerKey: 'spellblade_on_ability_started',
            eventTypeId: LICH.eventAbilityStarted.typeId,
            maxTriggersPerEvent: 1
          },
          {
            ...META,
            providerId: LICH.providerId,
            listenerId: 'listener_item_3100_lich_bane_spellblade_basic_attack_hit',
            listenerKey: 'spellblade_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: 'listener_item_3100_lich_bane_spellblade_ability_started',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: LICH.eventAbilityStarted.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3100_lich_bane_spellblade_ability_started',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3100_lich_bane_spellblade_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3100_lich_bane_spellblade_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_arm',
            providerId: LICH.providerId,
            sequenceKey: 'spellblade_arm'
          },
          {
            ...META,
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_proc',
            providerId: LICH.providerId,
            sequenceKey: 'spellblade_proc'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: 'step_item_3100_lich_bane_spellblade_ready_arm',
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_arm',
            stepOrder: 0,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_icd_available',
            stateDetail: {
              stateScopeTypeId: LICH.stateScopeProvider.typeId,
              stateKey: 'spellblade_ready',
              amountFormulaKey: 'spellblade_ready_arm',
              valuePolicyTypeId: LICH.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_3100_lich_bane_spellblade_icd_arm',
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_arm',
            stepOrder: 1,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_icd_available',
            stateDetail: {
              stateScopeTypeId: LICH.stateScopeProvider.typeId,
              stateKey: 'spellblade_icd',
              amountFormulaKey: 'spellblade_icd_arm',
              valuePolicyTypeId: LICH.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_3100_lich_bane_spellblade_damage',
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_proc',
            stepOrder: 0,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            damageDetail: {
              amountFormulaKey: 'spellblade_proc_damage',
              damageTypeId: LICH.damageMagic.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
              copyableOnHit: false
            }
          },
          {
            ...META,
            stepId: 'step_item_3100_lich_bane_spellblade_ready_consume',
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_proc',
            stepOrder: 1,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            stateDetail: {
              stateScopeTypeId: LICH.stateScopeProvider.typeId,
              stateKey: 'spellblade_ready',
              amountFormulaKey: 'spellblade_ready_consume',
              valuePolicyTypeId: LICH.valuePolicyOverride.typeId
            }
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: 'listener_item_3100_lich_bane_spellblade_ability_started',
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_arm'
          },
          {
            ...META,
            listenerId: 'listener_item_3100_lich_bane_spellblade_basic_attack_hit',
            sequenceId: 'sequence_item_3100_lich_bane_spellblade_proc'
          }
        ],
        // Prerequisite active cast (base abil_q) + basic_attack-tagged AA for ability_started gate.
        abilities: [
          ...base.abilities,
          {
            ...META,
            abilityId: 'abil_aa_swing',
            providerId: 'prov_q',
            abilityKey: 'aa_swing',
            abilityKindTypeId: TYPE.abilityKindActive.typeId,
            displayName: 'AA Swing'
          }
        ]
      });
    }

    it('projects namespaced Lich Bane Spellblade compile contract on source equipment only', () => {
      const graph = withLichBaneSpellblade(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [LICH.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${LICH.providerId}`;
      const targetKey = `target::${LICH.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${LICH.providerId}`
      );
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${LICH.providerId}`)
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toEqual({
        spellblade_ready: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 1,
          durationMs: 10000,
          refreshPolicy: 'refresh_on_write'
        },
        spellblade_icd: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 1,
          durationMs: 1500,
          refreshPolicy: 'refresh_on_write'
        }
      });

      expect(sourceProvider.modifiers).toEqual([
        {
          modifierKey: 'spellblade_attack_speed',
          kind: 'attribute',
          target: 'source.attr.attack_speed',
          priority: 0,
          valuePolicy: 'percent_add',
          value: { op: 'ref', ref: 'source::spellblade_attack_speed' }
        }
      ]);

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::spellblade_proc_damage']).toEqual(PROC_DAMAGE_EXPR);
      expect(formulaByKey['source::spellblade_attack_speed']).toEqual(ATTACK_SPEED_EXPR);
      expect(formulaByKey['source::spellblade_icd_available']).toMatchObject({
        op: 'eq',
        args: [{ op: 'read', path: 'provider.state.spellblade_icd' }, { op: 'const', value: 0 }]
      });

      expect(sourceProvider.listeners).toHaveLength(2);
      const armListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'spellblade_on_ability_started'
      )!;
      const procListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'spellblade_on_basic_attack_hit'
      )!;
      expect(armListener.eventMatcher).toEqual({
        all: ['event/ability_started', 'event/source_owner']
      });
      expect(armListener.maxTriggersPerEvent).toBe(1);
      expect(procListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(procListener.maxTriggersPerEvent).toBe(1);

      expect(armListener.operations).toEqual([
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::spellblade_ready_arm' },
          valuePolicy: 'override',
          ref: 'spellblade_ready',
          types: ['state_scope/provider'],
          condition: { op: 'ref', ref: 'source::spellblade_icd_available' }
        },
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::spellblade_icd_arm' },
          valuePolicy: 'override',
          ref: 'spellblade_icd',
          types: ['state_scope/provider'],
          condition: { op: 'ref', ref: 'source::spellblade_icd_available' }
        }
      ]);

      expect(procListener.operations).toHaveLength(2);
      const damageOp = procListener.operations![0];
      const consumeOp = procListener.operations![1];
      expect(damageOp).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_item_3100_lich_bane_spellblade_damage',
        amount: { op: 'ref', ref: 'source::spellblade_proc_damage' },
        damageType: 'damage/magic',
        valuePolicy: 'add',
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });
      expect(damageOp).not.toHaveProperty('copyableOnHit');
      expect(damageOp.copyableOnHit).not.toBe(true);
      expect(JSON.stringify(damageOp)).not.toContain('"copyableOnHit":true');

      expect(consumeOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::spellblade_ready_consume' },
        valuePolicy: 'override',
        ref: 'spellblade_ready',
        types: ['state_scope/provider'],
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });

      // Prerequisite active + basic_attack types remain selectable on source hero provider.
      const castOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'cast');
      const aaOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'aa_swing');
      expect(castOpt?.selectable).toBe(true);
      expect(aaOpt?.types).toEqual(['ability/basic_attack']);
    });
  });

  describe('item_3508 Essence Reaver Spellblade data contract', () => {
    const ER = {
      itemId: 'item_3508',
      providerId: 'provider_item_3508_essence_reaver_spellblade',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' },
      abilityBasicAttack: { typeId: 62003, typeKey: 'ability/basic_attack' },
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      refreshDuration: { typeId: 20190, typeKey: 'refresh_policy/refresh_duration' },
      valuePolicyOverride: { typeId: 20172, typeKey: 'value_policy/override' },
      stateScopeProvider: { typeId: 20250, typeKey: 'state_scope/provider' },
      eventAbilityStarted: { typeId: 20205, typeKey: 'event/ability_started' }
    } as const;

    /** ready=0 ∧ icd=0 via numeric mul-of-eq gate (no and/or/not). */
    const ARM_AVAILABLE_EXPR = {
      op: 'mul',
      args: [
        {
          op: 'eq',
          args: [
            { op: 'read', path: 'provider.state.spellblade_ready' },
            { op: 'const', value: 0 }
          ]
        },
        {
          op: 'eq',
          args: [
            { op: 'read', path: 'provider.state.spellblade_icd' },
            { op: 'const', value: 0 }
          ]
        }
      ]
    };

    const PROC_DAMAGE_EXPR = {
      op: 'add',
      args: [
        {
          op: 'mul',
          args: [
            { op: 'const', value: 1.25 },
            { op: 'read', path: 'event.entry_source.attr.ad.base' }
          ]
        },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 50 },
            { op: 'read', path: 'event.entry_source.attr.crit_chance.resolved' }
          ]
        }
      ]
    };

    function collectFormulaOps(expr: unknown): string[] {
      if (expr == null || typeof expr !== 'object') return [];
      const node = expr as { op?: string; args?: unknown[]; path?: string };
      const ops = typeof node.op === 'string' ? [node.op] : [];
      if (Array.isArray(node.args)) {
        for (const arg of node.args) ops.push(...collectFormulaOps(arg));
      }
      return ops;
    }

    function collectFormulaPaths(expr: unknown): string[] {
      if (expr == null || typeof expr !== 'object') return [];
      const node = expr as { op?: string; args?: unknown[]; path?: string };
      const paths = typeof node.path === 'string' ? [node.path] : [];
      if (Array.isArray(node.args)) {
        for (const arg of node.args) paths.push(...collectFormulaPaths(arg));
      }
      return paths;
    }

    function withEssenceReaverSpellblade(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [
        ER.itemTag,
        ER.abilityBasicAttack,
        ER.valueTypeNumber,
        ER.refreshDuration,
        ER.valuePolicyOverride,
        ER.stateScopeProvider,
        ER.eventAbilityStarted
      ];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: ER.itemTag.typeId,
            targetCategory: 'entity',
            targetId: ER.itemId
          },
          {
            ...META,
            typeId: ER.abilityBasicAttack.typeId,
            targetCategory: 'ability',
            targetId: 'abil_aa_swing'
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: ER.itemId, displayName: 'Essence Reaver' }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: ER.itemId, providerId: ER.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: ER.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '夺萃之镰 Spellblade'
          }
        ],
        providerStateFields: [
          {
            ...META,
            providerId: ER.providerId,
            stateKey: 'spellblade_ready',
            valueTypeId: ER.valueTypeNumber.typeId,
            maxValue: 1,
            durationMs: 10000,
            refreshPolicyTypeId: ER.refreshDuration.typeId
          },
          {
            ...META,
            providerId: ER.providerId,
            stateKey: 'spellblade_icd',
            valueTypeId: ER.valueTypeNumber.typeId,
            maxValue: 1,
            durationMs: 1500,
            refreshPolicyTypeId: ER.refreshDuration.typeId
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: ER.providerId,
            formulaKey: 'spellblade_arm_available',
            expression: ARM_AVAILABLE_EXPR
          },
          {
            ...META,
            providerId: ER.providerId,
            formulaKey: 'spellblade_ready_arm',
            expression: { op: 'const', value: 1 }
          },
          {
            ...META,
            providerId: ER.providerId,
            formulaKey: 'spellblade_icd_arm',
            expression: { op: 'const', value: 1 }
          },
          {
            ...META,
            providerId: ER.providerId,
            formulaKey: 'spellblade_ready_armed',
            expression: {
              op: 'gte',
              args: [
                { op: 'read', path: 'provider.state.spellblade_ready' },
                { op: 'const', value: 1 }
              ]
            }
          },
          {
            ...META,
            providerId: ER.providerId,
            formulaKey: 'spellblade_proc_damage',
            expression: PROC_DAMAGE_EXPR
          },
          {
            ...META,
            providerId: ER.providerId,
            formulaKey: 'spellblade_ready_consume',
            expression: { op: 'const', value: 0 }
          }
        ],
        providerModifiers: [],
        providerListeners: [
          {
            ...META,
            providerId: ER.providerId,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_ability_started',
            listenerKey: 'spellblade_on_ability_started',
            eventTypeId: ER.eventAbilityStarted.typeId,
            maxTriggersPerEvent: 1
          },
          {
            ...META,
            providerId: ER.providerId,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_basic_attack_hit',
            listenerKey: 'spellblade_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_ability_started',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: ER.eventAbilityStarted.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_ability_started',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_arm',
            providerId: ER.providerId,
            sequenceKey: 'spellblade_arm'
          },
          {
            ...META,
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_proc',
            providerId: ER.providerId,
            sequenceKey: 'spellblade_proc'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: 'step_item_3508_essence_reaver_spellblade_ready_arm',
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_arm',
            stepOrder: 0,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_arm_available',
            stateDetail: {
              stateScopeTypeId: ER.stateScopeProvider.typeId,
              stateKey: 'spellblade_ready',
              amountFormulaKey: 'spellblade_ready_arm',
              valuePolicyTypeId: ER.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_3508_essence_reaver_spellblade_damage',
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_proc',
            stepOrder: 0,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            damageDetail: {
              amountFormulaKey: 'spellblade_proc_damage',
              damageTypeId: TYPE.damagePhysical.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
              copyableOnHit: false
            }
          },
          {
            ...META,
            stepId: 'step_item_3508_essence_reaver_spellblade_icd_arm',
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_proc',
            stepOrder: 1,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            stateDetail: {
              stateScopeTypeId: ER.stateScopeProvider.typeId,
              stateKey: 'spellblade_icd',
              amountFormulaKey: 'spellblade_icd_arm',
              valuePolicyTypeId: ER.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_3508_essence_reaver_spellblade_ready_consume',
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_proc',
            stepOrder: 2,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            stateDetail: {
              stateScopeTypeId: ER.stateScopeProvider.typeId,
              stateKey: 'spellblade_ready',
              amountFormulaKey: 'spellblade_ready_consume',
              valuePolicyTypeId: ER.valuePolicyOverride.typeId
            }
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_ability_started',
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_arm'
          },
          {
            ...META,
            listenerId: 'listener_item_3508_essence_reaver_spellblade_basic_attack_hit',
            sequenceId: 'sequence_item_3508_essence_reaver_spellblade_proc'
          }
        ],
        abilities: [
          ...base.abilities,
          {
            ...META,
            abilityId: 'abil_aa_swing',
            providerId: 'prov_q',
            abilityKey: 'aa_swing',
            abilityKindTypeId: TYPE.abilityKindActive.typeId,
            displayName: 'AA Swing'
          }
        ]
      });
    }

    it('projects namespaced Essence Reaver Spellblade compile contract on source equipment only', () => {
      const graph = withEssenceReaverSpellblade(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [ER.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${ER.providerId}`;
      const targetKey = `target::${ER.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${ER.providerId}`
      );
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${ER.providerId}`)
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toEqual({
        spellblade_ready: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 1,
          durationMs: 10000,
          refreshPolicy: 'refresh_on_write'
        },
        spellblade_icd: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 1,
          durationMs: 1500,
          refreshPolicy: 'refresh_on_write'
        }
      });

      // No attack-speed modifier; mana restore is out of single-attacker DPS scope.
      expect(sourceProvider.modifiers ?? []).toEqual([]);
      expect(
        (sourceProvider.modifiers ?? []).some(
          (m) => m.target === 'source.attr.attack_speed' || m.modifierKey === 'spellblade_attack_speed'
        )
      ).toBe(false);

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::spellblade_arm_available']).toEqual(ARM_AVAILABLE_EXPR);
      expect(formulaByKey['source::spellblade_proc_damage']).toEqual(PROC_DAMAGE_EXPR);
      expect(formulaByKey['source::spellblade_ready_arm']).toEqual({ op: 'const', value: 1 });
      expect(formulaByKey['source::spellblade_icd_arm']).toEqual({ op: 'const', value: 1 });
      expect(formulaByKey['source::spellblade_ready_consume']).toEqual({ op: 'const', value: 0 });
      expect(formulaByKey['source::spellblade_ready_armed']).toEqual({
        op: 'gte',
        args: [
          { op: 'read', path: 'provider.state.spellblade_ready' },
          { op: 'const', value: 1 }
        ]
      });
      expect(formulaByKey).not.toHaveProperty('source::spellblade_attack_speed');

      const erFormulaEntries = compile.formulas!.filter((f) =>
        f.key.startsWith('source::spellblade_')
      );
      for (const formula of erFormulaEntries) {
        const ops = collectFormulaOps(formula.expression);
        expect(ops).not.toContain('and');
        expect(ops).not.toContain('or');
        expect(ops).not.toContain('not');
        const paths = collectFormulaPaths(formula.expression);
        expect(paths.some((p) => p.includes('mana'))).toBe(false);
      }
      const armGateOps = collectFormulaOps(ARM_AVAILABLE_EXPR);
      expect(armGateOps.filter((op) => op === 'mul' || op === 'eq')).toEqual(['mul', 'eq', 'eq']);
      expect(armGateOps).not.toContain('and');
      expect(armGateOps).not.toContain('or');
      expect(armGateOps).not.toContain('not');

      expect(sourceProvider.listeners).toHaveLength(2);
      const armListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'spellblade_on_ability_started'
      )!;
      const procListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'spellblade_on_basic_attack_hit'
      )!;
      expect(armListener.eventMatcher).toEqual({
        all: ['event/ability_started', 'event/source_owner']
      });
      expect(armListener.maxTriggersPerEvent).toBe(1);
      expect(procListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(procListener.maxTriggersPerEvent).toBe(1);

      // ability_started: arm ready only when both ready and icd are zero.
      expect(armListener.operations).toEqual([
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::spellblade_ready_arm' },
          valuePolicy: 'override',
          ref: 'spellblade_ready',
          types: ['state_scope/provider'],
          condition: { op: 'ref', ref: 'source::spellblade_arm_available' }
        }
      ]);

      // basic_attack_hit: damage → arm ICD → consume ready (ICD starts on empowered hit).
      expect(procListener.operations).toHaveLength(3);
      const [damageOp, icdArmOp, consumeOp] = procListener.operations!;
      expect(damageOp).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_item_3508_essence_reaver_spellblade_damage',
        amount: { op: 'ref', ref: 'source::spellblade_proc_damage' },
        damageType: 'damage/physical',
        valuePolicy: 'add',
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });
      expect(damageOp).not.toHaveProperty('copyableOnHit');
      expect(damageOp.copyableOnHit).not.toBe(true);

      expect(icdArmOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::spellblade_icd_arm' },
        valuePolicy: 'override',
        ref: 'spellblade_icd',
        types: ['state_scope/provider'],
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });

      expect(consumeOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::spellblade_ready_consume' },
        valuePolicy: 'override',
        ref: 'spellblade_ready',
        types: ['state_scope/provider'],
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });

      const allOps = [...(armListener.operations ?? []), ...(procListener.operations ?? [])];
      expect(allOps.some((op) => JSON.stringify(op).toLowerCase().includes('mana'))).toBe(false);
      expect(allOps.map((op) => op.operation)).not.toContain('resource_change');

      const castOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'cast');
      const aaOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'aa_swing');
      expect(castOpt?.selectable).toBe(true);
      expect(aaOpt?.types).toEqual(['ability/basic_attack']);
    });
  });

  describe('item_2510 Dusk and Dawn Spellblade data contract', () => {
    const DAD = {
      itemId: 'item_2510',
      providerId: 'provider_item_2510_dusk_and_dawn_spellblade',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' },
      abilityBasicAttack: { typeId: 62003, typeKey: 'ability/basic_attack' },
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      refreshDuration: { typeId: 20190, typeKey: 'refresh_policy/refresh_duration' },
      valuePolicyOverride: { typeId: 20172, typeKey: 'value_policy/override' },
      damageMagic: { typeId: 20221, typeKey: 'damage/magic' },
      stateScopeProvider: { typeId: 20250, typeKey: 'state_scope/provider' },
      eventAbilityStarted: { typeId: 20205, typeKey: 'event/ability_started' }
    } as const;

    /** ready=0 ∧ icd=0 via numeric mul-of-eq gate (no and/or/not). */
    const ARM_AVAILABLE_EXPR = {
      op: 'mul',
      args: [
        {
          op: 'eq',
          args: [
            { op: 'read', path: 'provider.state.spellblade_ready' },
            { op: 'const', value: 0 }
          ]
        },
        {
          op: 'eq',
          args: [
            { op: 'read', path: 'provider.state.spellblade_icd' },
            { op: 'const', value: 0 }
          ]
        }
      ]
    };

    const PROC_DAMAGE_EXPR = {
      op: 'add',
      args: [
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.75 },
            { op: 'read', path: 'event.entry_source.attr.ad.base' }
          ]
        },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.1 },
            { op: 'read', path: 'event.entry_source.attr.ap.resolved' }
          ]
        }
      ]
    };

    function collectFormulaOps(expr: unknown): string[] {
      if (expr == null || typeof expr !== 'object') return [];
      const node = expr as { op?: string; args?: unknown[]; path?: string };
      const ops = typeof node.op === 'string' ? [node.op] : [];
      if (Array.isArray(node.args)) {
        for (const arg of node.args) ops.push(...collectFormulaOps(arg));
      }
      return ops;
    }

    function withDuskAndDawnSpellblade(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [
        DAD.itemTag,
        DAD.abilityBasicAttack,
        DAD.valueTypeNumber,
        DAD.refreshDuration,
        DAD.valuePolicyOverride,
        DAD.damageMagic,
        DAD.stateScopeProvider,
        DAD.eventAbilityStarted
      ];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: DAD.itemTag.typeId,
            targetCategory: 'entity',
            targetId: DAD.itemId
          },
          {
            ...META,
            typeId: DAD.abilityBasicAttack.typeId,
            targetCategory: 'ability',
            targetId: 'abil_aa_swing'
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: DAD.itemId, displayName: 'Dusk and Dawn' }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: DAD.itemId, providerId: DAD.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: DAD.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '黄昏与黎明 Spellblade'
          }
        ],
        providerStateFields: [
          {
            ...META,
            providerId: DAD.providerId,
            stateKey: 'spellblade_ready',
            valueTypeId: DAD.valueTypeNumber.typeId,
            maxValue: 1,
            durationMs: 10000,
            refreshPolicyTypeId: DAD.refreshDuration.typeId
          },
          {
            ...META,
            providerId: DAD.providerId,
            stateKey: 'spellblade_icd',
            valueTypeId: DAD.valueTypeNumber.typeId,
            maxValue: 1,
            durationMs: 1500,
            refreshPolicyTypeId: DAD.refreshDuration.typeId
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: DAD.providerId,
            formulaKey: 'spellblade_arm_available',
            expression: ARM_AVAILABLE_EXPR
          },
          {
            ...META,
            providerId: DAD.providerId,
            formulaKey: 'spellblade_ready_arm',
            expression: { op: 'const', value: 1 }
          },
          {
            ...META,
            providerId: DAD.providerId,
            formulaKey: 'spellblade_icd_arm',
            expression: { op: 'const', value: 1 }
          },
          {
            ...META,
            providerId: DAD.providerId,
            formulaKey: 'spellblade_ready_armed',
            expression: {
              op: 'gte',
              args: [
                { op: 'read', path: 'provider.state.spellblade_ready' },
                { op: 'const', value: 1 }
              ]
            }
          },
          {
            ...META,
            providerId: DAD.providerId,
            formulaKey: 'spellblade_proc_damage',
            expression: PROC_DAMAGE_EXPR
          },
          {
            ...META,
            providerId: DAD.providerId,
            formulaKey: 'spellblade_ready_consume',
            expression: { op: 'const', value: 0 }
          }
        ],
        providerModifiers: [],
        providerListeners: [
          {
            ...META,
            providerId: DAD.providerId,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_ability_started',
            listenerKey: 'spellblade_on_ability_started',
            eventTypeId: DAD.eventAbilityStarted.typeId,
            maxTriggersPerEvent: 1
          },
          {
            ...META,
            providerId: DAD.providerId,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit',
            listenerKey: 'spellblade_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_ability_started',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: DAD.eventAbilityStarted.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_ability_started',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_arm',
            providerId: DAD.providerId,
            sequenceKey: 'spellblade_arm'
          },
          {
            ...META,
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            providerId: DAD.providerId,
            sequenceKey: 'spellblade_proc'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: 'step_item_2510_dusk_and_dawn_spellblade_ready_arm',
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_arm',
            stepOrder: 0,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_arm_available',
            stateDetail: {
              stateScopeTypeId: DAD.stateScopeProvider.typeId,
              stateKey: 'spellblade_ready',
              amountFormulaKey: 'spellblade_ready_arm',
              valuePolicyTypeId: DAD.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_2510_dusk_and_dawn_spellblade_damage',
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            stepOrder: 0,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            damageDetail: {
              amountFormulaKey: 'spellblade_proc_damage',
              damageTypeId: DAD.damageMagic.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
              copyableOnHit: false
            }
          },
          {
            ...META,
            stepId: 'step_item_2510_dusk_and_dawn_spellblade_icd_arm',
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            stepOrder: 1,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            stateDetail: {
              stateScopeTypeId: DAD.stateScopeProvider.typeId,
              stateKey: 'spellblade_icd',
              amountFormulaKey: 'spellblade_icd_arm',
              valuePolicyTypeId: DAD.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_2510_dusk_and_dawn_spellblade_ready_consume',
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            stepOrder: 2,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'spellblade_ready_armed',
            stateDetail: {
              stateScopeTypeId: DAD.stateScopeProvider.typeId,
              stateKey: 'spellblade_ready',
              amountFormulaKey: 'spellblade_ready_consume',
              valuePolicyTypeId: DAD.valuePolicyOverride.typeId
            }
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_ability_started',
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_arm'
          },
          {
            ...META,
            listenerId: 'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit',
            sequenceId: 'sequence_item_2510_dusk_and_dawn_spellblade_proc'
          }
        ],
        abilities: [
          ...base.abilities,
          {
            ...META,
            abilityId: 'abil_aa_swing',
            providerId: 'prov_q',
            abilityKey: 'aa_swing',
            abilityKindTypeId: TYPE.abilityKindActive.typeId,
            displayName: 'AA Swing'
          }
        ]
      });
    }

    it('projects namespaced Dusk and Dawn Spellblade compile contract on source equipment only', () => {
      const graph = withDuskAndDawnSpellblade(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [DAD.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${DAD.providerId}`;
      const targetKey = `target::${DAD.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${DAD.providerId}`
      );
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${DAD.providerId}`)
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toEqual({
        spellblade_ready: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 1,
          durationMs: 10000,
          refreshPolicy: 'refresh_on_write'
        },
        spellblade_icd: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 1,
          durationMs: 1500,
          refreshPolicy: 'refresh_on_write'
        }
      });

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::spellblade_arm_available']).toEqual(ARM_AVAILABLE_EXPR);
      expect(formulaByKey['source::spellblade_proc_damage']).toEqual(PROC_DAMAGE_EXPR);
      expect(formulaByKey['source::spellblade_ready_arm']).toEqual({ op: 'const', value: 1 });
      expect(formulaByKey['source::spellblade_icd_arm']).toEqual({ op: 'const', value: 1 });
      expect(formulaByKey['source::spellblade_ready_consume']).toEqual({ op: 'const', value: 0 });
      expect(formulaByKey['source::spellblade_ready_armed']).toEqual({
        op: 'gte',
        args: [
          { op: 'read', path: 'provider.state.spellblade_ready' },
          { op: 'const', value: 1 }
        ]
      });

      const dadFormulaEntries = compile.formulas!.filter((f) =>
        f.key.startsWith('source::spellblade_')
      );
      for (const formula of dadFormulaEntries) {
        const ops = collectFormulaOps(formula.expression);
        expect(ops).not.toContain('and');
        expect(ops).not.toContain('or');
        expect(ops).not.toContain('not');
      }
      const armGateOps = collectFormulaOps(ARM_AVAILABLE_EXPR);
      expect(armGateOps.filter((op) => op === 'mul' || op === 'eq')).toEqual(['mul', 'eq', 'eq']);
      expect(armGateOps).not.toContain('and');
      expect(armGateOps).not.toContain('or');
      expect(armGateOps).not.toContain('not');

      expect(sourceProvider.listeners).toHaveLength(2);
      const armListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'spellblade_on_ability_started'
      )!;
      const procListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'spellblade_on_basic_attack_hit'
      )!;
      expect(armListener.eventMatcher).toEqual({
        all: ['event/ability_started', 'event/source_owner']
      });
      expect(armListener.maxTriggersPerEvent).toBe(1);
      expect(procListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(procListener.maxTriggersPerEvent).toBe(1);

      // ability_started: arm ready only when both ready and icd are zero.
      expect(armListener.operations).toEqual([
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::spellblade_ready_arm' },
          valuePolicy: 'override',
          ref: 'spellblade_ready',
          types: ['state_scope/provider'],
          condition: { op: 'ref', ref: 'source::spellblade_arm_available' }
        }
      ]);

      // basic_attack_hit: damage → arm ICD → consume ready (ICD starts on empowered hit).
      expect(procListener.operations).toHaveLength(3);
      const [damageOp, icdArmOp, consumeOp] = procListener.operations!;
      expect(damageOp).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_item_2510_dusk_and_dawn_spellblade_damage',
        amount: { op: 'ref', ref: 'source::spellblade_proc_damage' },
        damageType: 'damage/magic',
        valuePolicy: 'add',
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });
      expect(damageOp).not.toHaveProperty('copyableOnHit');
      expect(damageOp.copyableOnHit).not.toBe(true);
      expect(JSON.stringify(damageOp)).not.toContain('"copyableOnHit":true');

      expect(icdArmOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::spellblade_icd_arm' },
        valuePolicy: 'override',
        ref: 'spellblade_icd',
        types: ['state_scope/provider'],
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });

      expect(consumeOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::spellblade_ready_consume' },
        valuePolicy: 'override',
        ref: 'spellblade_ready',
        types: ['state_scope/provider'],
        condition: { op: 'ref', ref: 'source::spellblade_ready_armed' }
      });

      const castOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'cast');
      const aaOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'aa_swing');
      expect(castOpt?.selectable).toBe(true);
      expect(aaOpt?.types).toEqual(['ability/basic_attack']);
    });
  });

  describe('item_3087 Statikk Shiv Energized data contract', () => {
    const SHIV = {
      itemId: 'item_3087',
      providerId: 'provider_item_3087_statikk_shiv_energized',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' },
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      valuePolicyOverride: { typeId: 20172, typeKey: 'value_policy/override' },
      damageMagic: { typeId: 20221, typeKey: 'damage/magic' },
      stateScopeProvider: { typeId: 20250, typeKey: 'state_scope/provider' }
    } as const;

    const PROC_DAMAGE_EXPR = { op: 'const', value: 60 };
    const CHARGE_CONSUME_EXPR = { op: 'const', value: 0 };
    const CHARGE_GAIN_EXPR = { op: 'const', value: 15 };
    const CHARGE_READY_EXPR = {
      op: 'gte',
      args: [
        { op: 'read', path: 'provider.state.energized_charge' },
        { op: 'const', value: 100 }
      ]
    };

    function withStatikkShivEnergized(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [
        SHIV.itemTag,
        SHIV.valueTypeNumber,
        SHIV.valuePolicyOverride,
        SHIV.damageMagic,
        SHIV.stateScopeProvider
      ];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: SHIV.itemTag.typeId,
            targetCategory: 'entity',
            targetId: SHIV.itemId
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: SHIV.itemId, displayName: 'Statikk Shiv' }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: SHIV.itemId, providerId: SHIV.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: SHIV.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '斯塔缇克电刃 Energized'
          }
        ],
        providerStateFields: [
          {
            ...META,
            providerId: SHIV.providerId,
            stateKey: 'energized_charge',
            valueTypeId: SHIV.valueTypeNumber.typeId,
            maxValue: 100
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: SHIV.providerId,
            formulaKey: 'energized_charge_ready',
            expression: CHARGE_READY_EXPR
          },
          {
            ...META,
            providerId: SHIV.providerId,
            formulaKey: 'energized_proc_damage',
            expression: PROC_DAMAGE_EXPR
          },
          {
            ...META,
            providerId: SHIV.providerId,
            formulaKey: 'energized_charge_consume',
            expression: CHARGE_CONSUME_EXPR
          },
          {
            ...META,
            providerId: SHIV.providerId,
            formulaKey: 'energized_charge_gain',
            expression: CHARGE_GAIN_EXPR
          }
        ],
        providerModifiers: [],
        providerListeners: [
          {
            ...META,
            providerId: SHIV.providerId,
            listenerId: 'listener_item_3087_statikk_shiv_energized_basic_attack_hit',
            listenerKey: 'energized_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: 'listener_item_3087_statikk_shiv_energized_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3087_statikk_shiv_energized_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: 'sequence_item_3087_statikk_shiv_energized_proc',
            providerId: SHIV.providerId,
            sequenceKey: 'energized_proc'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: 'step_item_3087_statikk_shiv_energized_damage',
            sequenceId: 'sequence_item_3087_statikk_shiv_energized_proc',
            stepOrder: 0,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            conditionFormulaKey: 'energized_charge_ready',
            damageDetail: {
              amountFormulaKey: 'energized_proc_damage',
              damageTypeId: SHIV.damageMagic.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
              copyableOnHit: false
            }
          },
          {
            ...META,
            stepId: 'step_item_3087_statikk_shiv_energized_charge_consume',
            sequenceId: 'sequence_item_3087_statikk_shiv_energized_proc',
            stepOrder: 1,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'energized_charge_ready',
            stateDetail: {
              stateScopeTypeId: SHIV.stateScopeProvider.typeId,
              stateKey: 'energized_charge',
              amountFormulaKey: 'energized_charge_consume',
              valuePolicyTypeId: SHIV.valuePolicyOverride.typeId
            }
          },
          {
            ...META,
            stepId: 'step_item_3087_statikk_shiv_energized_charge_gain',
            sequenceId: 'sequence_item_3087_statikk_shiv_energized_proc',
            stepOrder: 2,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            stateDetail: {
              stateScopeTypeId: SHIV.stateScopeProvider.typeId,
              stateKey: 'energized_charge',
              amountFormulaKey: 'energized_charge_gain',
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
            }
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: 'listener_item_3087_statikk_shiv_energized_basic_attack_hit',
            sequenceId: 'sequence_item_3087_statikk_shiv_energized_proc'
          }
        ]
      });
    }

    it('projects namespaced Statikk Shiv Energized compile contract on source equipment only', () => {
      const graph = withStatikkShivEnergized(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [SHIV.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${SHIV.providerId}`;
      const targetKey = `target::${SHIV.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${SHIV.providerId}`
      );
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${SHIV.providerId}`)
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toEqual({
        energized_charge: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 100,
          durationMs: 0
        }
      });
      expect(sourceProvider.initialStateSchema!.energized_charge).not.toHaveProperty(
        'refreshPolicy'
      );

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::energized_charge_ready']).toEqual(CHARGE_READY_EXPR);
      expect(formulaByKey['source::energized_proc_damage']).toEqual(PROC_DAMAGE_EXPR);
      expect(formulaByKey['source::energized_charge_consume']).toEqual(CHARGE_CONSUME_EXPR);
      expect(formulaByKey['source::energized_charge_gain']).toEqual(CHARGE_GAIN_EXPR);

      expect(sourceProvider.listeners).toHaveLength(1);
      const hitListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'energized_on_basic_attack_hit'
      )!;
      expect(hitListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(hitListener.maxTriggersPerEvent).toBe(1);

      // basic_attack_hit: conditional magic damage → consume charge → unconditional gain.
      expect(hitListener.operations).toHaveLength(3);
      const [damageOp, consumeOp, gainOp] = hitListener.operations!;
      expect(damageOp).toEqual({
        operation: 'damage',
        target: 'opponent',
        ref: 'step_item_3087_statikk_shiv_energized_damage',
        amount: { op: 'ref', ref: 'source::energized_proc_damage' },
        damageType: 'damage/magic',
        valuePolicy: 'add',
        condition: { op: 'ref', ref: 'source::energized_charge_ready' }
      });
      expect(damageOp).not.toHaveProperty('copyableOnHit');
      expect(damageOp.copyableOnHit).not.toBe(true);
      expect(JSON.stringify(damageOp)).not.toContain('"copyableOnHit":true');

      expect(consumeOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::energized_charge_consume' },
        valuePolicy: 'override',
        ref: 'energized_charge',
        types: ['state_scope/provider'],
        condition: { op: 'ref', ref: 'source::energized_charge_ready' }
      });

      expect(gainOp).toEqual({
        operation: 'state_change',
        target: 'self',
        amount: { op: 'ref', ref: 'source::energized_charge_gain' },
        valuePolicy: 'add',
        ref: 'energized_charge',
        types: ['state_scope/provider']
      });
      expect(gainOp).not.toHaveProperty('condition');
    });
  });

  describe('item_3032 Yun Tal Wildarrows Practice Makes Lethal data contract', () => {
    const YUN = {
      itemId: 'item_3032',
      providerId: 'provider_item_3032_yun_tal_practice_makes_lethal',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' },
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      stateScopeProvider: { typeId: 20250, typeKey: 'state_scope/provider' }
    } as const;

    const STACK_ADD_EXPR = { op: 'const', value: 1 };
    const CRIT_CHANCE_EXPR = {
      op: 'min',
      args: [
        { op: 'const', value: 0.25 },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.004 },
            { op: 'read', path: 'provider.state.practice_crit_stacks' }
          ]
        }
      ]
    };

    function withYunTalPracticeMakesLethal(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [YUN.itemTag, YUN.valueTypeNumber, YUN.stateScopeProvider];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: YUN.itemTag.typeId,
            targetCategory: 'entity',
            targetId: YUN.itemId
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: YUN.itemId, displayName: 'Yun Tal Wildarrows' }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: YUN.itemId, providerId: YUN.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: YUN.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '熟能生巧'
          }
        ],
        providerStateFields: [
          {
            ...META,
            providerId: YUN.providerId,
            stateKey: 'practice_crit_stacks',
            valueTypeId: YUN.valueTypeNumber.typeId,
            maxValue: 63
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: YUN.providerId,
            formulaKey: 'practice_crit_stacks_add',
            expression: STACK_ADD_EXPR
          },
          {
            ...META,
            providerId: YUN.providerId,
            formulaKey: 'practice_crit_chance',
            expression: CRIT_CHANCE_EXPR
          }
        ],
        providerModifiers: [
          {
            ...META,
            providerId: YUN.providerId,
            modifierId: 'modifier_item_3032_yun_tal_practice_makes_lethal_crit_chance',
            modifierKey: 'practice_crit_chance',
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            targetAttrKey: 'crit_chance',
            priority: 0,
            valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
            valueFormulaKey: 'practice_crit_chance'
          }
        ],
        providerListeners: [
          {
            ...META,
            providerId: YUN.providerId,
            listenerId: 'listener_item_3032_yun_tal_practice_makes_lethal',
            listenerKey: 'practice_makes_lethal_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: 'listener_item_3032_yun_tal_practice_makes_lethal',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3032_yun_tal_practice_makes_lethal',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: 'sequence_item_3032_yun_tal_practice_makes_lethal',
            providerId: YUN.providerId,
            sequenceKey: 'practice_makes_lethal_stack'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: 'step_item_3032_yun_tal_practice_makes_lethal_stack_add',
            sequenceId: 'sequence_item_3032_yun_tal_practice_makes_lethal',
            stepOrder: 0,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            stateDetail: {
              stateScopeTypeId: YUN.stateScopeProvider.typeId,
              stateKey: 'practice_crit_stacks',
              amountFormulaKey: 'practice_crit_stacks_add',
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
            }
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: 'listener_item_3032_yun_tal_practice_makes_lethal',
            sequenceId: 'sequence_item_3032_yun_tal_practice_makes_lethal'
          }
        ]
      });
    }

    it('projects namespaced Practice Makes Lethal compile contract on source equipment only', () => {
      const graph = withYunTalPracticeMakesLethal(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [YUN.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${YUN.providerId}`;
      const targetKey = `target::${YUN.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${YUN.providerId}`
      );
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${YUN.providerId}`)
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toEqual({
        practice_crit_stacks: {
          valueType: 'number',
          defaultValue: 0,
          maxValue: 63,
          durationMs: 0
        }
      });
      expect(sourceProvider.initialStateSchema!.practice_crit_stacks).not.toHaveProperty(
        'refreshPolicy'
      );

      expect(sourceProvider.modifiers).toEqual([
        {
          modifierKey: 'practice_crit_chance',
          kind: 'attribute',
          target: 'source.attr.crit_chance',
          priority: 0,
          valuePolicy: 'add',
          value: { op: 'ref', ref: 'source::practice_crit_chance' }
        }
      ]);

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::practice_crit_stacks_add']).toEqual(STACK_ADD_EXPR);
      expect(formulaByKey['source::practice_crit_chance']).toEqual(CRIT_CHANCE_EXPR);

      expect(sourceProvider.listeners).toHaveLength(1);
      const hitListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'practice_makes_lethal_on_basic_attack_hit'
      )!;
      expect(hitListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(hitListener.maxTriggersPerEvent).toBe(1);
      expect(hitListener.operations).toEqual([
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::practice_crit_stacks_add' },
          valuePolicy: 'add',
          ref: 'practice_crit_stacks',
          types: ['state_scope/provider']
        }
      ]);
    });
  });

  describe("item_3091 Wit's End Fray data contract", () => {
    const WIT = {
      itemId: 'item_3091',
      providerId: 'provider_item_3091_wits_end_fray',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' },
      damageMagic: { typeId: 20221, typeKey: 'damage/magic' }
    } as const;

    const FRAY_DAMAGE_EXPR = { op: 'const', value: 45 };

    function withWitsEndFray(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [WIT.itemTag, WIT.damageMagic];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: WIT.itemTag.typeId,
            targetCategory: 'entity',
            targetId: WIT.itemId
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: WIT.itemId, displayName: "Wit's End" }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: WIT.itemId, providerId: WIT.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: WIT.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '喧争'
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: WIT.providerId,
            formulaKey: 'fray_damage',
            expression: FRAY_DAMAGE_EXPR
          }
        ],
        providerListeners: [
          {
            ...META,
            providerId: WIT.providerId,
            listenerId: 'listener_item_3091_wits_end_fray_basic_attack_hit',
            listenerKey: 'fray_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: 'listener_item_3091_wits_end_fray_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: 'listener_item_3091_wits_end_fray_basic_attack_hit',
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: 'sequence_item_3091_wits_end_fray',
            providerId: WIT.providerId,
            sequenceKey: 'fray_proc'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: 'step_item_3091_wits_end_fray_damage',
            sequenceId: 'sequence_item_3091_wits_end_fray',
            stepOrder: 0,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            damageDetail: {
              amountFormulaKey: 'fray_damage',
              damageTypeId: WIT.damageMagic.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
              copyableOnHit: true
            }
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: 'listener_item_3091_wits_end_fray_basic_attack_hit',
            sequenceId: 'sequence_item_3091_wits_end_fray'
          }
        ]
      });
    }

    it('projects namespaced Wits End Fray compile contract on source equipment only', () => {
      const graph = withWitsEndFray(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [WIT.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${WIT.providerId}`;
      const targetKey = `target::${WIT.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${WIT.providerId}`
      );
      expect(
        compile.combatants[0].providers.filter((p) => p.definitionRef === sourceKey)
      ).toHaveLength(1);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${WIT.providerId}`)
      ).toBe(false);

      const withoutItem = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: []
      }).compileRequest;
      expect(withoutItem.combatants[0].providers.map((p) => p.definitionRef)).not.toContain(
        sourceKey
      );
      expect(
        withoutItem.sharedProviders!.some(
          (p) => p.providerKey === sourceKey || p.providerKey === targetKey
        )
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toBeUndefined();
      expect(sourceProvider.modifiers).toEqual([]);

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::fray_damage']).toEqual(FRAY_DAMAGE_EXPR);

      expect(sourceProvider.listeners).toHaveLength(1);
      const hitListener = sourceProvider.listeners!.find(
        (l) => l.listenerKey === 'fray_on_basic_attack_hit'
      )!;
      expect(hitListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(hitListener.maxTriggersPerEvent).toBe(1);
      expect(hitListener.operations).toHaveLength(1);
      expect(hitListener.operations).toEqual([
        {
          operation: 'damage',
          target: 'opponent',
          ref: 'step_item_3091_wits_end_fray_damage',
          amount: { op: 'ref', ref: 'source::fray_damage' },
          damageType: 'damage/magic',
          valuePolicy: 'add',
          copyableOnHit: true
        }
      ]);

      const frayOps = hitListener.operations!;
      expect(frayOps.map((op) => op.operation)).toEqual(['damage']);
      expect(frayOps.some((op) => op.operation === 'heal')).toBe(false);
      expect(frayOps.some((op) => op.operation === 'resource_change')).toBe(false);
      expect(frayOps.some((op) => op.operation === 'state_change')).toBe(false);
      const frayJson = JSON.stringify({
        provider: sourceProvider,
        formulas: compile.formulas!.filter((f) => f.key.startsWith('source::fray_'))
      });
      expect(frayJson.toLowerCase()).not.toContain('lifesteal');
      expect(frayJson.toLowerCase()).not.toContain('life_steal');
      expect(frayJson).not.toContain('"operation":"heal"');
      expect(frayJson).not.toContain('move_speed');
      expect(frayJson).not.toContain('tenacity');
    });
  });

  describe('item_3004 Manamune Awe data contract', () => {
    const MANA = {
      itemId: 'item_3004',
      providerId: 'provider_item_3004_manamune_awe',
      itemTag: { typeId: 62002, typeKey: 'tag/adc_completed_item' }
    } as const;

    const AWE_AD_EXPR = {
      op: 'mul',
      args: [{ op: 'const', value: 0.02 }, { op: 'read', path: 'source.attr.mana.max' }]
    };

    function withManamuneAwe(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [MANA.itemTag];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        typeRelations: [
          ...base.typeRelations,
          {
            ...META,
            typeId: MANA.itemTag.typeId,
            targetCategory: 'entity',
            targetId: MANA.itemId
          }
        ],
        entities: [
          ...base.entities,
          { ...META, entityId: MANA.itemId, displayName: 'Manamune' }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: MANA.itemId, providerId: MANA.providerId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: MANA.providerId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '敬畏'
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: MANA.providerId,
            formulaKey: 'awe_ad',
            expression: AWE_AD_EXPR
          }
        ],
        providerModifiers: [
          {
            ...META,
            providerId: MANA.providerId,
            modifierId: 'modifier_item_3004_manamune_awe_ad',
            modifierKey: 'awe_ad',
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            targetAttrKey: 'ad',
            priority: 0,
            valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
            valueFormulaKey: 'awe_ad'
          }
        ]
      });
    }

    it('projects namespaced Manamune Awe compile contract on source equipment only', () => {
      const graph = withManamuneAwe(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: [MANA.itemId]
      });
      const compile = scenario.compileRequest;
      const sourceKey = `source::${MANA.providerId}`;
      const targetKey = `target::${MANA.providerId}`;

      expect(compile.combatants[0].providers.map((p) => p.definitionRef)).toContain(sourceKey);
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toContain(
        `passive:${MANA.providerId}`
      );
      expect(
        compile.combatants[0].providers.filter((p) => p.definitionRef === sourceKey)
      ).toHaveLength(1);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(targetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(sourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${MANA.providerId}`)
      ).toBe(false);

      const withoutItem = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target',
        sourceEquipmentEntityIds: []
      }).compileRequest;
      expect(withoutItem.combatants[0].providers.map((p) => p.definitionRef)).not.toContain(
        sourceKey
      );
      expect(
        withoutItem.sharedProviders!.some(
          (p) => p.providerKey === sourceKey || p.providerKey === targetKey
        )
      ).toBe(false);

      const sourceProvider = compile.sharedProviders!.find((p) => p.providerKey === sourceKey)!;
      expect(sourceProvider).toBeDefined();
      expect(sourceProvider.initialStateSchema).toBeUndefined();
      expect(sourceProvider.listeners).toEqual([]);
      expect(sourceProvider.abilities).toEqual([]);
      expect(sourceProvider.modifiers).toEqual([
        {
          modifierKey: 'awe_ad',
          kind: 'attribute',
          target: 'source.attr.ad',
          priority: 0,
          valuePolicy: 'add',
          value: { op: 'ref', ref: 'source::awe_ad' }
        }
      ]);

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::awe_ad']).toEqual(AWE_AD_EXPR);

      const aweJson = JSON.stringify({
        provider: sourceProvider,
        formulas: compile.formulas!.filter((f) => f.key.startsWith('source::awe_'))
      });
      expect(aweJson.toLowerCase()).not.toContain('manaflow');
      expect(aweJson.toLowerCase()).not.toContain('muramana');
      expect(aweJson).not.toContain('"listeners":[{');
      expect(aweJson.toLowerCase()).not.toContain('on-hit');
      expect(aweJson.toLowerCase()).not.toContain('on_hit');
      expect(aweJson).not.toContain('"operation":"damage"');
      expect(aweJson).not.toContain('"operation":"resource_change"');
      expect(aweJson).not.toContain('"operation":"state_change"');
    });
  });

  describe('hero_twistedfate Stacked Deck rank-5 data contract', () => {
    const TF = {
      heroId: 'hero_twistedfate',
      baProviderId: 'provider_hero_twistedfate_basic_attack',
      baAbilityId: 'ability_hero_twistedfate_basic_attack',
      baPhaseId: 'phase_hero_twistedfate_basic_attack_impact',
      baSequenceId: 'sequence_hero_twistedfate_basic_attack_damage',
      baDamageStepId: 'step_hero_twistedfate_basic_attack_damage',
      baEmitStepId: 'step_hero_twistedfate_basic_attack_emit_hit',
      baEventRef: 'event_ref_hero_twistedfate_basic_attack_hit',
      deckProviderId: 'provider_hero_twistedfate_stacked_deck',
      deckListenerId: 'listener_hero_twistedfate_stacked_deck',
      deckSequenceId: 'sequence_hero_twistedfate_stacked_deck',
      deckHitAddStepId: 'step_hero_twistedfate_stacked_deck_hit_add',
      deckProcStepId: 'step_hero_twistedfate_stacked_deck_proc_damage',
      deckResetStepId: 'step_hero_twistedfate_stacked_deck_hit_reset',
      valueTypeNumber: { typeId: 20100, typeKey: 'value_type/number' },
      operationEmitEvent: { typeId: 20158, typeKey: 'operation/emit_event' },
      valuePolicyOverride: { typeId: 20172, typeKey: 'value_policy/override' },
      valuePolicyPercentAdd: { typeId: 20173, typeKey: 'value_policy/percent_add' },
      damageMagic: { typeId: 20221, typeKey: 'damage/magic' },
      stateScopeProvider: { typeId: 20250, typeKey: 'state_scope/provider' }
    } as const;

    const BA_DAMAGE_EXPR = { op: 'read', path: '$owner.attr.ad' };
    const HIT_ADD_EXPR = { op: 'const', value: 1 };
    const HIT_RESET_EXPR = { op: 'const', value: 0 };
    const ATTACK_SPEED_EXPR = { op: 'const', value: 0.5 };
    const PROC_CONDITION_EXPR = {
      op: 'gte',
      args: [
        { op: 'read', path: 'provider.state.stacked_deck_hits' },
        { op: 'const', value: 4 }
      ]
    };
    const PROC_DAMAGE_EXPR = {
      op: 'add',
      args: [
        { op: 'const', value: 165 },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.2 },
            {
              op: 'sub',
              args: [
                { op: 'read', path: 'event.entry_source.attr.ad.resolved' },
                { op: 'read', path: 'event.entry_source.attr.ad.base' }
              ]
            }
          ]
        },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 0.4 },
            { op: 'read', path: 'event.entry_source.attr.ap.resolved' }
          ]
        }
      ]
    };

    function withTwistedFateStackedDeck(base: CombatDataGraph): CombatDataGraph {
      const extraTypes = [
        TF.valueTypeNumber,
        TF.operationEmitEvent,
        TF.valuePolicyOverride,
        TF.valuePolicyPercentAdd,
        TF.damageMagic,
        TF.stateScopeProvider
      ];

      return buildGraphFixture({
        types: [
          ...base.types,
          ...extraTypes.map((t) => ({
            ...META,
            typeId: t.typeId,
            typeKey: t.typeKey
          }))
        ],
        entities: [
          ...base.entities,
          {
            ...META,
            entityId: TF.heroId,
            displayName: '卡牌大师'
          }
        ],
        entityAttributes: [
          ...base.entityAttributes,
          { ...META, entityId: TF.heroId, attrKey: 'hp', baseValue: 604 },
          { ...META, entityId: TF.heroId, attrKey: 'ad', baseValue: 52 },
          { ...META, entityId: TF.heroId, attrKey: 'ap', baseValue: 0 },
          { ...META, entityId: TF.heroId, attrKey: 'attack_speed', baseValue: 0.625 },
          { ...META, entityId: TF.heroId, attrKey: 'armor', baseValue: 24 },
          { ...META, entityId: TF.heroId, attrKey: 'magic_resist', baseValue: 30 }
        ],
        entityProviderMounts: [
          ...base.entityProviderMounts,
          { ...META, entityId: TF.heroId, providerId: TF.baProviderId },
          { ...META, entityId: TF.heroId, providerId: TF.deckProviderId }
        ],
        providers: [
          ...base.providers,
          {
            ...META,
            providerId: TF.baProviderId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '卡牌大师通用普攻'
          },
          {
            ...META,
            providerId: TF.deckProviderId,
            providerKindTypeId: TYPE.providerKindPassive.typeId,
            displayName: '卡牌大师 E 卡牌骗术 Stacked Deck'
          }
        ],
        providerStateFields: [
          {
            ...META,
            providerId: TF.deckProviderId,
            stateKey: 'stacked_deck_hits',
            valueTypeId: TF.valueTypeNumber.typeId
          }
        ],
        providerFormulas: [
          ...base.providerFormulas,
          {
            ...META,
            providerId: TF.baProviderId,
            formulaKey: 'basic_attack_damage',
            expression: BA_DAMAGE_EXPR
          },
          {
            ...META,
            providerId: TF.deckProviderId,
            formulaKey: 'stacked_deck_hit_add',
            expression: HIT_ADD_EXPR
          },
          {
            ...META,
            providerId: TF.deckProviderId,
            formulaKey: 'stacked_deck_proc_condition',
            expression: PROC_CONDITION_EXPR
          },
          {
            ...META,
            providerId: TF.deckProviderId,
            formulaKey: 'stacked_deck_proc_damage',
            expression: PROC_DAMAGE_EXPR
          },
          {
            ...META,
            providerId: TF.deckProviderId,
            formulaKey: 'stacked_deck_hit_reset',
            expression: HIT_RESET_EXPR
          },
          {
            ...META,
            providerId: TF.deckProviderId,
            formulaKey: 'stacked_deck_attack_speed',
            expression: ATTACK_SPEED_EXPR
          }
        ],
        providerModifiers: [
          {
            ...META,
            providerId: TF.deckProviderId,
            modifierId: 'modifier_hero_twistedfate_stacked_deck_attack_speed',
            modifierKey: 'stacked_deck_attack_speed',
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            targetAttrKey: 'attack_speed',
            priority: 0,
            valuePolicyTypeId: TF.valuePolicyPercentAdd.typeId,
            valueFormulaKey: 'stacked_deck_attack_speed'
          }
        ],
        providerListeners: [
          {
            ...META,
            providerId: TF.deckProviderId,
            listenerId: TF.deckListenerId,
            listenerKey: 'stacked_deck_on_basic_attack_hit',
            eventTypeId: TYPE.eventBasicAttackHit.typeId,
            maxTriggersPerEvent: 1
          }
        ],
        listenerMatchTypes: [
          {
            ...META,
            listenerId: TF.deckListenerId,
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventBasicAttackHit.typeId
          },
          {
            ...META,
            listenerId: TF.deckListenerId,
            matchModeTypeId: TYPE.matchModeAll.typeId,
            typeId: TYPE.eventSourceOwner.typeId
          }
        ],
        abilities: [
          ...base.abilities,
          {
            ...META,
            abilityId: TF.baAbilityId,
            providerId: TF.baProviderId,
            abilityKey: 'basic_attack',
            abilityKindTypeId: TYPE.abilityKindActive.typeId,
            displayName: '普攻'
          }
        ],
        abilityPhases: [
          ...base.abilityPhases,
          {
            ...META,
            phaseId: TF.baPhaseId,
            abilityId: TF.baAbilityId,
            phaseOrder: 0,
            phaseTypeId: TYPE.abilityPhaseImpact.typeId,
            interruptible: false
          }
        ],
        effectSequences: [
          ...base.effectSequences,
          {
            ...META,
            sequenceId: TF.baSequenceId,
            providerId: TF.baProviderId,
            sequenceKey: 'basic_attack_damage'
          },
          {
            ...META,
            sequenceId: TF.deckSequenceId,
            providerId: TF.deckProviderId,
            sequenceKey: 'stacked_deck_on_hit'
          }
        ],
        effectSteps: [
          ...base.effectSteps,
          {
            ...META,
            stepId: TF.baDamageStepId,
            sequenceId: TF.baSequenceId,
            stepOrder: 0,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            damageDetail: {
              amountFormulaKey: 'basic_attack_damage',
              damageTypeId: TYPE.damagePhysical.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
            }
          },
          {
            ...META,
            stepId: TF.baEmitStepId,
            sequenceId: TF.baSequenceId,
            stepOrder: 1,
            operationTypeId: TF.operationEmitEvent.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            eventDetail: {
              eventTypeId: TYPE.eventBasicAttackHit.typeId,
              eventRef: TF.baEventRef,
              payload: {}
            }
          },
          {
            ...META,
            stepId: TF.deckHitAddStepId,
            sequenceId: TF.deckSequenceId,
            stepOrder: 0,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            stateDetail: {
              stateScopeTypeId: TF.stateScopeProvider.typeId,
              stateKey: 'stacked_deck_hits',
              amountFormulaKey: 'stacked_deck_hit_add',
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId
            }
          },
          {
            ...META,
            stepId: TF.deckProcStepId,
            sequenceId: TF.deckSequenceId,
            stepOrder: 1,
            operationTypeId: TYPE.operationDamage.typeId,
            targetSelectorTypeId: TYPE.selectorOpponent.typeId,
            conditionFormulaKey: 'stacked_deck_proc_condition',
            damageDetail: {
              amountFormulaKey: 'stacked_deck_proc_damage',
              damageTypeId: TF.damageMagic.typeId,
              valuePolicyTypeId: TYPE.valuePolicyAdd.typeId,
              copyableOnHit: false
            }
          },
          {
            ...META,
            stepId: TF.deckResetStepId,
            sequenceId: TF.deckSequenceId,
            stepOrder: 2,
            operationTypeId: TYPE.operationStateChange.typeId,
            targetSelectorTypeId: TYPE.selectorSelf.typeId,
            conditionFormulaKey: 'stacked_deck_proc_condition',
            stateDetail: {
              stateScopeTypeId: TF.stateScopeProvider.typeId,
              stateKey: 'stacked_deck_hits',
              amountFormulaKey: 'stacked_deck_hit_reset',
              valuePolicyTypeId: TF.valuePolicyOverride.typeId
            }
          }
        ],
        abilityPhaseEffectSequences: [
          ...base.abilityPhaseEffectSequences,
          {
            ...META,
            phaseId: TF.baPhaseId,
            triggerTypeId: TYPE.phaseTriggerEnter.typeId,
            sequenceId: TF.baSequenceId
          }
        ],
        listenerEffectSequences: [
          {
            ...META,
            listenerId: TF.deckListenerId,
            sequenceId: TF.deckSequenceId
          }
        ]
      });
    }

    it('projects self-contained Twisted Fate BA + Stacked Deck rank-5 compile contract', () => {
      const graph = withTwistedFateStackedDeck(buildGraphFixture());
      const scenario = assembleCombatScenario(graph, {
        sourceEntityId: TF.heroId,
        targetEntityId: 'entity_target'
      });
      const compile = scenario.compileRequest;
      const baSourceKey = `source::${TF.baProviderId}`;
      const deckSourceKey = `source::${TF.deckProviderId}`;
      const deckTargetKey = `target::${TF.deckProviderId}`;

      expect(compile.combatants[0].attributes.ad).toEqual({
        base: 52,
        current: 52,
        max: 52,
        resolved: 52
      });
      expect(compile.combatants[0].attributes.attack_speed).toEqual({
        base: 0.625,
        current: 0.625,
        max: 0.625,
        resolved: 0.625
      });
      expect(compile.combatants[0].attributes.ap).toEqual({
        base: 0,
        current: 0,
        max: 0,
        resolved: 0
      });

      const sourceMountRefs = compile.combatants[0].providers.map((p) => p.definitionRef);
      expect(sourceMountRefs).toEqual(expect.arrayContaining([baSourceKey, deckSourceKey]));
      expect(compile.combatants[0].providers.map((p) => p.providerRef)).toEqual(
        expect.arrayContaining([`passive:${TF.baProviderId}`, `passive:${TF.deckProviderId}`])
      );
      expect(compile.combatants[0].providers.filter((p) => p.definitionRef === deckSourceKey)).toHaveLength(
        1
      );
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(deckTargetKey);
      expect(compile.combatants[1].providers.map((p) => p.definitionRef)).not.toContain(deckSourceKey);
      expect(
        compile.combatants[1].providers.some((p) => p.providerRef === `passive:${TF.deckProviderId}`)
      ).toBe(false);

      const withoutHero = assembleCombatScenario(graph, {
        sourceEntityId: 'entity_source',
        targetEntityId: 'entity_target'
      }).compileRequest;
      expect(withoutHero.combatants[0].providers.map((p) => p.definitionRef)).not.toContain(
        deckSourceKey
      );
      expect(withoutHero.combatants[0].providers.map((p) => p.definitionRef)).not.toContain(
        baSourceKey
      );
      expect(
        withoutHero.sharedProviders!.some(
          (p) =>
            p.providerKey === deckSourceKey ||
            p.providerKey === deckTargetKey ||
            p.providerKey === baSourceKey
        )
      ).toBe(false);

      const baProvider = compile.sharedProviders!.find((p) => p.providerKey === baSourceKey)!;
      expect(baProvider).toBeDefined();
      expect(baProvider.listeners).toEqual([]);
      expect(baProvider.modifiers).toEqual([]);
      expect(baProvider.initialStateSchema).toBeUndefined();
      expect(baProvider.abilities).toHaveLength(1);
      expect(baProvider.abilities![0].abilityKey).toBe('basic_attack');
      expect(baProvider.abilities![0].kind).toBe('active');
      expect(baProvider.abilities![0].operations).toEqual([
        {
          operation: 'damage',
          target: 'opponent',
          ref: TF.baDamageStepId,
          amount: { op: 'ref', ref: 'source::basic_attack_damage' },
          damageType: 'damage/physical',
          valuePolicy: 'add'
        },
        {
          operation: 'emit_event',
          target: 'opponent',
          eventType: 'event/basic_attack_hit',
          ref: TF.baEventRef,
          payload: {}
        }
      ]);
      expect(baProvider.abilities![0].operations!.map((op) => op.operation)).toEqual([
        'damage',
        'emit_event'
      ]);

      const deckProvider = compile.sharedProviders!.find((p) => p.providerKey === deckSourceKey)!;
      expect(deckProvider).toBeDefined();
      expect(deckProvider.abilities).toEqual([]);
      expect(deckProvider.initialStateSchema).toEqual({ stacked_deck_hits: 0 });
      expect(deckProvider.modifiers).toEqual([
        {
          modifierKey: 'stacked_deck_attack_speed',
          kind: 'attribute',
          target: 'source.attr.attack_speed',
          priority: 0,
          valuePolicy: 'percent_add',
          value: { op: 'ref', ref: 'source::stacked_deck_attack_speed' }
        }
      ]);

      const formulaByKey = Object.fromEntries(compile.formulas!.map((f) => [f.key, f.expression]));
      expect(formulaByKey['source::basic_attack_damage']).toEqual({
        op: 'read',
        path: 'source.attr.ad'
      });
      expect(formulaByKey['source::stacked_deck_attack_speed']).toEqual(ATTACK_SPEED_EXPR);
      expect(formulaByKey['source::stacked_deck_hit_add']).toEqual(HIT_ADD_EXPR);
      expect(formulaByKey['source::stacked_deck_hit_reset']).toEqual(HIT_RESET_EXPR);
      expect(formulaByKey['source::stacked_deck_proc_condition']).toEqual(PROC_CONDITION_EXPR);
      expect(formulaByKey['source::stacked_deck_proc_damage']).toEqual(PROC_DAMAGE_EXPR);

      expect(deckProvider.listeners).toHaveLength(1);
      const hitListener = deckProvider.listeners!.find(
        (l) => l.listenerKey === 'stacked_deck_on_basic_attack_hit'
      )!;
      expect(hitListener.eventMatcher).toEqual({
        all: ['event/basic_attack_hit', 'event/source_owner']
      });
      expect(hitListener.maxTriggersPerEvent).toBe(1);
      expect(hitListener.operations).toHaveLength(3);
      expect(hitListener.operations).toEqual([
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::stacked_deck_hit_add' },
          valuePolicy: 'add',
          ref: 'stacked_deck_hits',
          types: ['state_scope/provider']
        },
        {
          operation: 'damage',
          target: 'opponent',
          ref: TF.deckProcStepId,
          amount: { op: 'ref', ref: 'source::stacked_deck_proc_damage' },
          damageType: 'damage/magic',
          valuePolicy: 'add',
          condition: { op: 'ref', ref: 'source::stacked_deck_proc_condition' }
        },
        {
          operation: 'state_change',
          target: 'self',
          amount: { op: 'ref', ref: 'source::stacked_deck_hit_reset' },
          valuePolicy: 'override',
          ref: 'stacked_deck_hits',
          types: ['state_scope/provider'],
          condition: { op: 'ref', ref: 'source::stacked_deck_proc_condition' }
        }
      ]);

      const procDamageOp = hitListener.operations![1];
      expect(procDamageOp).not.toHaveProperty('copyableOnHit');
      expect(procDamageOp.copyableOnHit).not.toBe(true);
      expect(JSON.stringify(procDamageOp)).not.toContain('"copyableOnHit":true');

      const aaOpt = scenario.availableSourceAbilities.find((a) => a.abilityKey === 'basic_attack');
      expect(aaOpt?.selectable).toBe(true);
      expect(scenario.availableSourceAbilities.some((a) => /_[qwr]$/i.test(a.abilityKey))).toBe(
        false
      );

      const contractJson = JSON.stringify({
        baProvider,
        deckProvider,
        formulas: compile.formulas!.filter(
          (f) =>
            f.key.startsWith('source::stacked_deck_') || f.key === 'source::basic_attack_damage'
        )
      });
      expect(contractJson.toLowerCase()).not.toContain('building');
      expect(contractJson).not.toContain('建筑物');
      expect(contractJson.toLowerCase()).not.toContain('structure');
      expect(contractJson).not.toContain('ability_hero_twistedfate_q');
      expect(contractJson).not.toContain('ability_hero_twistedfate_w');
      expect(contractJson).not.toContain('ability_hero_twistedfate_r');
      expect(contractJson).not.toContain('stacked_deck_active');
      expect(contractJson).not.toContain('选牌');
      expect(contractJson).not.toContain('万能牌');
      expect(contractJson).not.toContain('命运');
      expect(contractJson.toLowerCase()).not.toContain('rank1');
      expect(contractJson.toLowerCase()).not.toContain('rank2');
      expect(contractJson.toLowerCase()).not.toContain('rank3');
      expect(contractJson.toLowerCase()).not.toContain('rank4');
      expect(Object.keys(formulaByKey).filter((k) => k.includes('stacked_deck_proc_damage'))).toEqual(
        ['source::stacked_deck_proc_damage', 'target::stacked_deck_proc_damage']
      );
    });
  });
});
