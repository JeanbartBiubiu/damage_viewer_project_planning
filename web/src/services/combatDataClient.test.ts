import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './apiClient';
import {
  formatCombatDataError,
  getAttributeDefinitions,
  getCombatDataState,
  getExecuteEffectDetails,
  getProviderLifecycles,
  putAttributeDefinition,
  putEffectStep,
  putEntity,
  putEntityBatch,
  putDirectDamageAbilitySetup,
  putExecuteEffectDetail
} from './combatDataClient';
import type { ProviderLifecycle } from '../types/combatData';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('combatDataClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses public combat-data envelope', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/games/demo/combat-data/state');
      return jsonResponse(200, {
        gameId: 'demo',
        currentRevision: 7,
        data: {
          gameId: 'demo',
          currentRevision: 7,
          publishedRevision: 5,
          updatedAt: '2026-07-12T00:00:00Z'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCombatDataState('http://localhost:8080', 'demo');
    expect(result.status).toBe(200);
    expect(result.data.gameId).toBe('demo');
    expect(result.data.currentRevision).toBe(7);
    expect(result.data.data.publishedRevision).toBe(5);
  });

  it('parses list envelope data as array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          gameId: 'demo',
          currentRevision: 3,
          data: [{ gameId: 'demo', attrKey: 'atk', sortOrder: 1, valueKind: 'flat', changeRevision: 3, updatedAt: 't' }]
        })
      )
    );

    const result = await getAttributeDefinitions('http://localhost:8080', 'demo');
    expect(result.data.data).toHaveLength(1);
    expect(result.data.data[0].attrKey).toBe('atk');
  });

  it('preserves provider lifecycle tick-anchor omitted/null/complete pair without loss', async () => {
    const omitted: ProviderLifecycle = {
      gameId: 'demo',
      changeRevision: 1,
      updatedAt: 't',
      providerId: 'prov_omitted',
      maxStacks: 1
    };
    expect(omitted.tickAnchorScopeTypeId).toBeUndefined();
    expect(omitted.tickAnchorStateKey).toBeUndefined();

    const withNull: ProviderLifecycle = {
      gameId: 'demo',
      changeRevision: 1,
      updatedAt: 't',
      providerId: 'prov_null',
      maxStacks: 1,
      tickAnchorScopeTypeId: null,
      tickAnchorStateKey: null
    };
    expect(withNull.tickAnchorScopeTypeId).toBeNull();
    expect(withNull.tickAnchorStateKey).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain('/combat-data/provider-lifecycles');
        return jsonResponse(200, {
          gameId: 'demo',
          currentRevision: 4,
          data: [
            {
              gameId: 'demo',
              providerId: 'prov_omitted',
              maxStacks: 1,
              changeRevision: 4,
              updatedAt: 't'
            },
            {
              gameId: 'demo',
              providerId: 'prov_null',
              maxStacks: 1,
              tickAnchorScopeTypeId: null,
              tickAnchorStateKey: null,
              changeRevision: 4,
              updatedAt: 't'
            },
            {
              gameId: 'demo',
              providerId: 'prov_pair',
              maxStacks: 6,
              tickIntervalMs: 500,
              tickAnchorScopeTypeId: 20252,
              tickAnchorStateKey: 'deadly_venom_stacks',
              changeRevision: 4,
              updatedAt: 't'
            }
          ]
        });
      })
    );

    const result = await getProviderLifecycles('http://localhost:8080', 'demo');
    expect(result.data.data).toHaveLength(3);

    const [rowOmitted, rowNull, rowPair] = result.data.data;
    expect(rowOmitted).not.toHaveProperty('tickAnchorScopeTypeId');
    expect(rowOmitted).not.toHaveProperty('tickAnchorStateKey');
    expect(rowNull.tickAnchorScopeTypeId).toBeNull();
    expect(rowNull.tickAnchorStateKey).toBeNull();
    expect(rowPair.tickAnchorScopeTypeId).toBe(20252);
    expect(rowPair.tickAnchorStateKey).toBe('deadly_venom_stacks');
  });

  it('maps error envelope to ApiRequestError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(400, {
          error: {
            code: '400.INVALID_BODY',
            message: 'bad payload',
            details: { field: 'attrKey' }
          }
        })
      )
    );

    try {
      await getCombatDataState('http://localhost:8080', 'demo');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        name: 'ApiRequestError',
        status: 400,
        code: '400.INVALID_BODY',
        message: 'bad payload',
        details: { field: 'attrKey' }
      });
    }
  });

  it('admin PUT strips currentRevision from body but keeps it on response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain('/api/admin/games/demo/combat-data/attribute-definitions/atk');
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toBeTruthy();

      const body = JSON.parse(String(init?.body));
      expect(body.currentRevision).toBeUndefined();
      expect(body.changeRevision).toBeUndefined();
      expect(body.updatedAt).toBeUndefined();
      expect(body.valueKind).toBe('flat');
      expect(body.sortOrder).toBe(1);

      return jsonResponse(200, {
        gameId: 'demo',
        attrKey: 'atk',
        sortOrder: 1,
        valueKind: 'flat',
        changeRevision: 8,
        updatedAt: '2026-07-12T01:00:00Z',
        currentRevision: 8
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putAttributeDefinition(
      'http://localhost:8080',
      'demo',
      'atk',
      'token-1',
      {
        valueKind: 'flat',
        sortOrder: 1,
        currentRevision: 7,
        changeRevision: 6,
        updatedAt: 'stale'
      }
    );

    expect(result.data.currentRevision).toBe(8);
    expect(result.data.attrKey).toBe('atk');
    expect(result.data.changeRevision).toBe(8);
  });

  it('effect-step PUT asserts exactly one detail after sanitize', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.damageDetail).toEqual({
        amountFormulaKey: 'dmg',
        damageTypeId: 1,
        valuePolicyTypeId: 2
      });
      expect(body.healDetail).toBeUndefined();
      expect(body.currentRevision).toBeUndefined();

      return jsonResponse(200, {
        gameId: 'demo',
        stepId: 'step-1',
        sequenceId: 'seq-1',
        stepOrder: 1,
        operationTypeId: 1,
        targetSelectorTypeId: 1,
        damageDetail: body.damageDetail,
        changeRevision: 9,
        updatedAt: 't',
        currentRevision: 9
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putEffectStep('http://localhost:8080', 'demo', 'step-1', 'token-1', {
      sequenceId: 'seq-1',
      stepOrder: 1,
      operationTypeId: 1,
      targetSelectorTypeId: 1,
      currentRevision: 8,
      damageDetail: {
        amountFormulaKey: 'dmg',
        damageTypeId: 1,
        valuePolicyTypeId: 2
      }
    });

    expect(result.data.currentRevision).toBe(9);
    expect(result.data.stepId).toBe('step-1');
  });

  it('GET execute-effect-details uses public path and list envelope', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/games/demo/combat-data/execute-effect-details'
      );
      return jsonResponse(200, {
        gameId: 'demo',
        currentRevision: 4,
        data: [
          {
            gameId: 'demo',
            stepId: 'step-exec-1',
            threshold: 0.35,
            changeRevision: 4,
            updatedAt: '2026-07-13T00:00:00Z'
          }
        ]
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getExecuteEffectDetails('http://localhost:8080', 'demo');
    expect(result.status).toBe(200);
    expect(result.data.gameId).toBe('demo');
    expect(result.data.currentRevision).toBe(4);
    expect(result.data.data).toHaveLength(1);
    expect(result.data.data[0]).toMatchObject({
      stepId: 'step-exec-1',
      threshold: 0.35
    });
  });

  it('admin PUT execute-effect-details keeps threshold and strips revision metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/combat-data/execute-effect-details/step-exec-1'
      );
      expect(init?.method).toBe('PUT');

      const body = JSON.parse(String(init?.body));
      expect(body.threshold).toBe(0.35);
      expect(body.currentRevision).toBeUndefined();
      expect(body.changeRevision).toBeUndefined();
      expect(body.updatedAt).toBeUndefined();

      return jsonResponse(200, {
        gameId: 'demo',
        stepId: 'step-exec-1',
        threshold: 0.35,
        changeRevision: 11,
        updatedAt: '2026-07-13T01:00:00Z',
        currentRevision: 11
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putExecuteEffectDetail(
      'http://localhost:8080',
      'demo',
      'step-exec-1',
      'token-1',
      {
        threshold: 0.35,
        gameId: 'demo',
        stepId: 'step-exec-1',
        currentRevision: 10,
        changeRevision: 9,
        updatedAt: 'stale'
      }
    );

    expect(result.data.currentRevision).toBe(11);
    expect(result.data.stepId).toBe('step-exec-1');
    expect(result.data.threshold).toBe(0.35);
    expect(result.data.changeRevision).toBe(11);
  });
});

describe('formatCombatDataError', () => {
  it('diagnoses contract-entry 404 when games already reachable as old backend / API mismatch', () => {
    const error = new ApiRequestError('Resource not found', 404, '404.NOT_FOUND');
    const message = formatCombatDataError(error, 'contract-entry', {
      apiBaseUrl: 'http://localhost:8080',
      gamesReachable: true
    });

    expect(message).toContain('当前 API 未提供 combat-data 接口');
    expect(message).toContain('旧后端');
    expect(message).toContain('http://localhost:8080');
    expect(message).toContain('404.NOT_FOUND');
    expect(message).not.toMatch(/^404\.NOT_FOUND: Resource not found$/);
  });

  it('does not rewrite ordinary entity detail 404 into old-backend hint', () => {
    const error = new ApiRequestError('Resource not found', 404, '404.NOT_FOUND');
    const message = formatCombatDataError(error, 'resource-detail', {
      apiBaseUrl: 'http://localhost:8080',
      gamesReachable: true
    });

    expect(message).toBe('404.NOT_FOUND: Resource not found');
    expect(message).not.toContain('旧后端');
  });

  it('keeps generic message when games are not reachable yet', () => {
    const error = new ApiRequestError('Resource not found', 404, '404.NOT_FOUND');
    const message = formatCombatDataError(error, 'contract-entry', {
      apiBaseUrl: 'http://localhost:8080',
      gamesReachable: false
    });

    expect(message).toBe('404.NOT_FOUND: Resource not found');
  });

  it('does not treat non-404 contract errors as old backend', () => {
    const error = new ApiRequestError('boom', 500, '500.INTERNAL');
    const message = formatCombatDataError(error, 'contract-entry', {
      apiBaseUrl: 'http://localhost:8081',
      gamesReachable: true
    });

    expect(message).toBe('500.INTERNAL: boom');
  });

  it('admin PUT preserves imageUri omit / null / blank / exact nonblank source text', async () => {
    const cases: Array<{
      label: string;
      body: Record<string, unknown>;
      assert: (parsed: Record<string, unknown>) => void;
    }> = [
      {
        label: 'omit',
        body: { displayName: 'Vayne' },
        assert: (parsed) => {
          expect(Object.prototype.hasOwnProperty.call(parsed, 'imageUri')).toBe(false);
        }
      },
      {
        label: 'null clear',
        body: { displayName: 'Vayne', imageUri: null },
        assert: (parsed) => {
          expect(parsed.imageUri).toBeNull();
        }
      },
      {
        label: 'blank clear',
        body: { displayName: 'Vayne', imageUri: '   ' },
        assert: (parsed) => {
          expect(parsed.imageUri).toBe('   ');
        }
      },
      {
        label: 'exact with whitespace',
        body: { displayName: 'Vayne', imageUri: '  character_vayne  ' },
        assert: (parsed) => {
          expect(parsed.imageUri).toBe('  character_vayne  ');
        }
      }
    ];

    for (const testCase of cases) {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        testCase.assert(parsed);
        expect(parsed.currentRevision).toBeUndefined();
        return jsonResponse(200, {
          gameId: 'demo',
          entityId: 'hero_vayne',
          displayName: 'Vayne',
          imageUri: parsed.imageUri ?? null,
          changeRevision: 2,
          updatedAt: 't',
          currentRevision: 2
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await putEntity('http://localhost:8080', 'demo', 'hero_vayne', 'token', {
        ...testCase.body,
        currentRevision: 1,
        changeRevision: 1,
        updatedAt: 'stale'
      });
      expect(fetchMock, testCase.label).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it('putEntityBatch preserves optional top-level imageUri when provided', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.imageUri).toBe('  icon_exact  ');
      expect(body.expectedCurrentRevision).toBe(5);
      return jsonResponse(200, {
        gameId: 'demo',
        entityId: 'hero_vayne',
        displayName: 'Vayne',
        imageUri: '  icon_exact  ',
        attributes: [],
        resources: [],
        providerMounts: [],
        currentRevision: 6
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putEntityBatch('http://localhost:8080', 'demo', 'hero_vayne', 'token', {
      expectedCurrentRevision: 5,
      displayName: 'Vayne',
      imageUri: '  icon_exact  '
    });
    expect(result.data.imageUri).toBe('  icon_exact  ');
  });

  it('putEntityBatch uses encoded entities/{entityId}:batch URL and keeps expectedCurrentRevision', async () => {
    const stages = Array.from({ length: 18 }, (_, index) => ({
      stage: index + 1,
      value: 100 + index
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe('http://localhost:8080/api/admin/games/demo/combat-data/entities/hero_ashe%3Abatch');
      expect(init?.method).toBe('PUT');

      const body = JSON.parse(String(init?.body));
      expect(body.expectedCurrentRevision).toBe(42);
      expect(body.displayName).toBe('Ashe');
      expect(body.description).toBe('ADC');
      expect(body.currentRevision).toBeUndefined();
      expect(body.changeRevision).toBeUndefined();
      expect(body.updatedAt).toBeUndefined();
      expect(body.providerMounts).toBeUndefined();
      expect(body.resources).toBeUndefined();
      expect(body.attributes).toEqual([
        {
          attrKey: 'ad',
          baseValue: 52,
          stages
        }
      ]);

      return jsonResponse(200, {
        gameId: 'demo',
        entityId: 'hero_ashe',
        displayName: 'Ashe',
        description: 'ADC',
        attributes: [],
        resources: [],
        providerMounts: [],
        currentRevision: 43
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putEntityBatch('http://localhost:8080', 'demo', 'hero_ashe', 'token', {
      expectedCurrentRevision: 42,
      displayName: 'Ashe',
      description: 'ADC',
      attributes: [
        {
          attrKey: 'ad',
          baseValue: 52,
          stages
        }
      ],
      // Forbidden metadata must be stripped if a caller accidentally includes them.
      currentRevision: 99,
      changeRevision: 99,
      updatedAt: 'stale'
    } as never);

    expect(result.status).toBe(200);
    expect(result.data.currentRevision).toBe(43);
    expect(result.data.entityId).toBe('hero_ashe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('putDirectDamageAbilitySetup uses encoded abilities/{abilityId}:direct-damage-setup URL and keeps expectedCurrentRevision', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe(
        'http://localhost:8080/api/admin/games/demo/combat-data/providers/provider_q/abilities/ability_q%3Adirect-damage-setup'
      );
      expect(init?.method).toBe('PUT');

      const body = JSON.parse(String(init?.body));
      expect(body.expectedCurrentRevision).toBe(42);
      expect(body.ability.abilityId).toBe('ability_q');
      expect(body.ability.providerId).toBe('provider_q');
      expect(body.currentRevision).toBeUndefined();
      expect(body.changeRevision).toBeUndefined();
      expect(body.updatedAt).toBeUndefined();

      return jsonResponse(200, {
        gameId: 'demo',
        providerId: 'provider_q',
        abilityId: 'ability_q',
        ability: body.ability,
        phase: body.phase,
        effectSequence: body.effectSequence,
        effectStep: body.effectStep,
        phaseEffectSequenceBinding: body.phaseEffectSequenceBinding,
        currentRevision: 43
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await putDirectDamageAbilitySetup(
      'http://localhost:8080',
      'demo',
      'provider_q',
      'ability_q',
      'token',
      {
        expectedCurrentRevision: 42,
        ability: {
          abilityId: 'ability_q',
          providerId: 'provider_q',
          abilityKey: 'q',
          abilityKindTypeId: 1,
          displayName: 'Q'
        },
        phase: {
          phaseId: 'phase_q_impact',
          abilityId: 'ability_q',
          phaseOrder: 0,
          phaseTypeId: 2,
          interruptible: true
        },
        effectSequence: {
          sequenceId: 'sequence_q_impact',
          providerId: 'provider_q',
          sequenceKey: 'q_impact',
          displayName: 'Q'
        },
        effectStep: {
          stepId: 'step_q_damage',
          sequenceId: 'sequence_q_impact',
          stepOrder: 0,
          operationTypeId: 3,
          targetSelectorTypeId: 4,
          damageDetail: {
            amountFormulaKey: 'dmg',
            damageTypeId: 5,
            valuePolicyTypeId: 6,
            copyableOnHit: false,
            critEligible: false
          }
        },
        phaseEffectSequenceBinding: {
          phaseId: 'phase_q_impact',
          triggerTypeId: 7,
          sequenceId: 'sequence_q_impact'
        },
        // Forbidden metadata must be stripped if a caller accidentally includes them.
        currentRevision: 99,
        changeRevision: 99,
        updatedAt: 'stale'
      } as never
    );

    expect(result.status).toBe(200);
    expect(result.data.currentRevision).toBe(43);
    expect(result.data.abilityId).toBe('ability_q');
    expect(result.data.providerId).toBe('provider_q');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
