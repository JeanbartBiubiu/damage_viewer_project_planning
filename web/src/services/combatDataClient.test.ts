import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './apiClient';
import {
  formatCombatDataError,
  getAttributeDefinitions,
  getCombatDataState,
  putAttributeDefinition,
  putEffectStep
} from './combatDataClient';

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
});
