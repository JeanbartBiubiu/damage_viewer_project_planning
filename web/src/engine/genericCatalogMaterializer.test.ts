import { describe, expect, it } from 'vitest';
import {
  assembleGenericRunRequest,
  materializeGenericScenario
} from '../engine/genericCatalogMaterializer';
import type { WasmCatalogV1 } from '../types/wasmCatalog';

function buildCatalogFixture(): WasmCatalogV1 {
  return {
    meta: {
      gameId: 'demo',
      versionCode: 'v1',
      publishedAt: '2026-01-01T00:00:00Z',
      generatedAt: '2026-01-01T00:00:01Z',
      schemaVersion: 'generic-p0',
      schemaHash: 'sha256:schema',
      rulesHash: 'sha256:rules'
    },
    typeCatalog: {
      types: [
        { key: 'ability/cast', domain: 'ability' },
        { key: 'damage/physical', domain: 'damage' }
      ],
      relations: []
    },
    combatantTemplates: [
      {
        templateKey: 'champion:source',
        displayName: 'Source',
        attributes: {
          ad: { base: 50, current: 50, max: 50, resolved: 50 },
          hp: { base: 1000, current: 1000, max: 1000, resolved: 1000 }
        },
        resources: {
          mana: { current: 100, max: 100 }
        },
        providers: [
          {
            providerRef: 'skill:ahri_q',
            definitionRef: 'provider_ahri_q',
            initialState: { rank: 1 }
          }
        ]
      },
      {
        templateKey: 'champion:target',
        displayName: 'Target',
        attributes: {
          ad: { base: 10, current: 10, max: 10, resolved: 10 },
          hp: { base: 800, current: 800, max: 800, resolved: 800 }
        },
        resources: {
          mana: { current: 50, max: 50 }
        },
        providers: []
      }
    ],
    sharedProviders: [
      {
        providerKey: 'provider_ahri_q',
        kind: 'skill',
        stableId: 'ahri_q',
        abilities: [
          {
            abilityKey: 'cast',
            kind: 'active',
            operations: [
              {
                operation: 'apply_provider',
                target: 'self',
                providerDefinitionRef: 'provider_ahri_q'
              },
              {
                operation: 'apply_provider',
                target: 'opponent',
                providerDefinitionRef: 'provider_ahri_q'
              },
              {
                operation: 'damage',
                target: 'opponent',
                amount: { op: 'ref', ref: 'dmg' },
                damageType: 'damage/physical'
              }
            ]
          },
          {
            abilityKey: 'passive_note',
            kind: 'passive_listener'
          }
        ],
        modifiers: [
          {
            modifierKey: 'ad_buff',
            kind: 'attribute',
            target: '$owner.attr.ad',
            valuePolicy: 'add',
            value: { op: 'const', value: 5 }
          },
          {
            modifierKey: 'opp_hp',
            kind: 'attribute',
            target: '$opponent.attr.hp',
            valuePolicy: 'add',
            value: { op: 'const', value: -1 }
          }
        ],
        listeners: [
          {
            listenerKey: 'on_cast',
            eventMatcher: { any: ['ability/cast'] },
            abilityRef: '$owner.provider[skill:ahri_q].ability[cast]'
          }
        ]
      },
      {
        providerKey: 'provider_unmounted',
        kind: 'item',
        stableId: 'unmounted',
        abilities: [
          {
            abilityKey: 'hidden_active',
            kind: 'active'
          }
        ]
      }
    ],
    rules: {
      operations: [],
      modifiers: [],
      listeners: [],
      triggerRules: []
    },
    formulas: [
      {
        key: 'dmg',
        expression: {
          op: 'add',
          args: [
            { op: 'read', path: '$owner.attr.ad' },
            { op: 'read', path: '$opponent.resource.mana' },
            { op: 'read', path: 'ability.param.rank' },
            { op: 'ref', ref: 'dmg' }
          ]
        }
      }
    ],
    settings: {}
  };
}

describe('genericCatalogMaterializer', () => {
  it('materializes dual-slot clones, rewrites refs, and applies overrides', () => {
    const catalog = buildCatalogFixture();
    const originalProviderKey = catalog.sharedProviders[0].providerKey;

    const result = materializeGenericScenario(
      catalog,
      { sourceTemplateKey: 'champion:source', targetTemplateKey: 'champion:target' },
      {
        source: {
          attributes: { ad: { current: 77 } },
          resources: { mana: { current: 40 } }
        },
        target: {
          attributes: { hp: { base: 900, current: 900, max: 900 } }
        }
      }
    );

    expect(catalog.sharedProviders[0].providerKey).toBe(originalProviderKey);
    expect(result.compileRequest.combatants.map((item) => item.key)).toEqual(['source', 'target']);
    expect(result.compileRequest.combatants[0]).not.toHaveProperty('templateKey');
    expect(result.compileRequest.combatants[0].attributes.ad).toEqual({
      base: 50,
      current: 77,
      max: 50,
      resolved: 77
    });
    expect(result.compileRequest.combatants[0].resources.mana.current).toBe(40);
    expect(result.compileRequest.combatants[1].attributes.hp.resolved).toBe(900);

    expect(result.compileRequest.combatants[0].providers[0]).toMatchObject({
      providerRef: 'skill:ahri_q',
      definitionRef: 'source::provider_ahri_q'
    });

    const providerKeys = result.compileRequest.sharedProviders!.map((item) => item.providerKey);
    expect(providerKeys).toEqual([
      'source::provider_ahri_q',
      'target::provider_ahri_q',
      'source::provider_unmounted',
      'target::provider_unmounted'
    ]);

    const sourceProvider = result.compileRequest.sharedProviders!.find(
      (item) => item.providerKey === 'source::provider_ahri_q'
    )!;
    expect(sourceProvider.modifiers?.[0].target).toBe('source.attr.ad');
    expect(sourceProvider.modifiers?.[1].target).toBe('target.attr.hp');
    expect(sourceProvider.listeners?.[0].abilityRef).toBe(
      'source.provider[skill:ahri_q].ability[cast]'
    );

    const sourceOps = sourceProvider.abilities![0].operations!;
    expect(sourceOps[0].providerDefinitionRef).toBe('source::provider_ahri_q');
    expect(sourceOps[1].providerDefinitionRef).toBe('target::provider_ahri_q');
    expect(sourceOps[0].target).toBe('self');
    expect(sourceOps[1].target).toBe('opponent');

    const targetProvider = result.compileRequest.sharedProviders!.find(
      (item) => item.providerKey === 'target::provider_ahri_q'
    )!;
    const targetOps = targetProvider.abilities![0].operations!;
    expect(targetOps[0].providerDefinitionRef).toBe('target::provider_ahri_q');
    expect(targetOps[1].providerDefinitionRef).toBe('source::provider_ahri_q');

    const formulaKeys = result.compileRequest.formulas!.map((item) => item.key);
    expect(formulaKeys).toEqual(['source::dmg', 'target::dmg']);
    const sourceFormula = result.compileRequest.formulas![0].expression;
    expect(sourceFormula.args?.[0]).toMatchObject({ path: 'source.attr.ad' });
    expect(sourceFormula.args?.[1]).toMatchObject({ path: 'target.resource.mana' });
    expect(sourceFormula.args?.[2]).toMatchObject({ path: 'ability.param.rank' });
    expect(sourceFormula.args?.[3]).toMatchObject({ ref: 'source::dmg' });

    expect(result.initialSnapshot.timeMs).toBe(0);
    expect(result.initialSnapshot.combatants[0].providers[0]).toMatchObject({
      providerRef: 'skill:ahri_q',
      definitionRef: 'source::provider_ahri_q',
      source: 'source',
      owner: 'source',
      stacks: 1,
      expireAt: null,
      state: { rank: 1 }
    });

    const selectable = result.availableSourceAbilities.filter((item) => item.selectable);
    expect(selectable).toHaveLength(1);
    expect(selectable[0].abilityRef).toBe('source.provider[skill:ahri_q].ability[cast]');
    expect(result.availableSourceAbilities.some((item) => item.abilityKey === 'hidden_active')).toBe(
      false
    );
    expect(result.availableSourceAbilities.find((item) => item.abilityKey === 'passive_note')?.selectable).toBe(
      false
    );
  });

  it('changes sessionSignature when compile-relevant overrides change', () => {
    const catalog = buildCatalogFixture();
    const a = materializeGenericScenario(catalog, {
      sourceTemplateKey: 'champion:source',
      targetTemplateKey: 'champion:target'
    });
    const b = materializeGenericScenario(
      catalog,
      { sourceTemplateKey: 'champion:source', targetTemplateKey: 'champion:target' },
      { source: { attributes: { ad: { current: 99 } } } }
    );
    expect(a.sessionSignature).not.toBe(b.sessionSignature);
  });

  it('assembles RunRequest with required defaults and only three safetyBudget fields', () => {
    const catalog = buildCatalogFixture();
    const materialized = materializeGenericScenario(catalog, {
      sourceTemplateKey: 'champion:source',
      targetTemplateKey: 'champion:target'
    });
    const abilityRef = materialized.availableSourceAbilities.find((item) => item.selectable)!.abilityRef;

    const runRequest = assembleGenericRunRequest({
      sessionId: 'sess-1',
      catalog,
      materialized,
      driverPlan: {
        conditionRecheckIntervalMs: 100,
        entries: [
          {
            entryKey: 'cast_once',
            abilityRef,
            source: 'source',
            target: 'target',
            firstAtMs: 0,
            priority: 0
          }
        ]
      },
      safetyBudget: {
        maxChainDepth: 16,
        maxCommandsPerEvent: 128,
        maxEvents: 5000,
        ...( { maxEvidenceItems: 999 } as Record<string, number> )
      }
    });

    expect(runRequest.stopPolicy.durationMs).toBe(10_000);
    expect(runRequest.stopPolicy.stopOnTargetDeath).toBe(true);
    expect(runRequest.stopPolicy.stopWhenNoEvents).toBe(true);
    expect(runRequest.sampling).toEqual({
      sampleEveryMs: 100,
      dpsWindowMs: 1000,
      maxSeriesPoints: 5000
    });
    expect(runRequest.driverPlan.conditionRecheckIntervalMs).toBe(100);
    expect(runRequest.driverPlan.entries[0]).toMatchObject({
      abilityRef,
      source: 'source',
      target: 'target'
    });
    expect(runRequest.schemaHash).toBe(catalog.meta.schemaHash);
    expect(runRequest.rulesHash).toBe(catalog.meta.rulesHash);
    expect(runRequest.expectedRulesHash).toBe(catalog.meta.rulesHash);
    expect(runRequest.initialSnapshot.schemaHash).toBe(catalog.meta.schemaHash);
    expect(runRequest.safetyBudget).toEqual({
      maxChainDepth: 16,
      maxCommandsPerEvent: 128,
      maxEvents: 5000
    });
    expect(runRequest).not.toHaveProperty('budget');
  });
});
