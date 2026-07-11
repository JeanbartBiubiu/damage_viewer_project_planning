import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../services/apiClient';
import {
  isWasmCatalogEmptyError,
  loadPublishedWasmCatalogSnapshot
} from '../services/wasmCatalogSnapshot';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('loadPublishedWasmCatalogSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads current version then wasm-catalog with encoded path segments', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/versions/current')) {
        return jsonResponse(200, {
          gameId: 'game/a',
          versionCode: 'v/1',
          updatedAt: '2026-01-01T00:00:00Z'
        });
      }
      if (url.includes('/wasm-catalog')) {
        expect(url).toContain('/api/games/game%2Fa/versions/v%2F1/wasm-catalog');
        expect(url.includes('/bundle')).toBe(false);
        return jsonResponse(200, {
          meta: {
            gameId: 'game/a',
            versionCode: 'v/1',
            publishedAt: '2026-01-01T00:00:00Z',
            generatedAt: '2026-01-01T00:00:01Z',
            schemaVersion: 'generic-p0',
            schemaHash: 'sha256:s',
            rulesHash: 'sha256:r'
          },
          typeCatalog: { types: [], relations: [] },
          combatantTemplates: [],
          sharedProviders: [],
          rules: { operations: [], modifiers: [], listeners: [], triggerRules: [] },
          formulas: [],
          settings: {}
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await loadPublishedWasmCatalogSnapshot('http://localhost:8080', 'game/a');
    expect(snapshot.currentVersion.versionCode).toBe('v/1');
    expect(snapshot.catalog.meta.rulesHash).toBe('sha256:r');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/bundle'))).toBe(false);
  });

  it('treats current-version 404 as ordinary read error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(404, {
          error: { code: '404.NOT_FOUND', message: 'game missing' }
        })
      )
    );

    try {
      await loadPublishedWasmCatalogSnapshot('http://localhost:8080', 'missing');
      throw new Error('expected throw');
    } catch (error) {
      expect(isWasmCatalogEmptyError(error)).toBe(false);
      expect(error).toMatchObject({
        name: 'ApiRequestError',
        status: 404,
        code: '404.NOT_FOUND',
        message: 'game missing'
      });
    }
  });

  it('maps catalog 404.NOT_FOUND after successful current version to empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/versions/current')) {
          return jsonResponse(200, {
            gameId: 'demo',
            versionCode: 'v9',
            updatedAt: '2026-01-01T00:00:00Z'
          });
        }
        // Real backend spelling observed against lol / published versions.
        return jsonResponse(404, {
          error: { code: '404.NOT_FOUND', message: 'catalog missing' }
        });
      })
    );

    try {
      await loadPublishedWasmCatalogSnapshot('http://localhost:8080', 'demo');
      throw new Error('expected throw');
    } catch (error) {
      expect(isWasmCatalogEmptyError(error)).toBe(true);
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).status).toBe(404);
      expect((error as ApiRequestError).details).toEqual({
        kind: 'wasm_catalog_empty',
        gameId: 'demo',
        versionCode: 'v9'
      });
      // Guard must not depend on upstream code spelling (404.NOT_FOUND vs NOT_FOUND).
      expect((error as ApiRequestError).message).toBe('该发布版本尚未配置通用 Wasm catalog');
    }
  });

  it('maps catalog HTTP 404 regardless of error.code spelling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/versions/current')) {
          return jsonResponse(200, {
            gameId: 'demo',
            versionCode: 'v9',
            updatedAt: '2026-01-01T00:00:00Z'
          });
        }
        return jsonResponse(404, {
          error: { code: 'SOME_OTHER_SPELLING', message: 'gone' }
        });
      })
    );

    await expect(loadPublishedWasmCatalogSnapshot('http://localhost:8080', 'demo')).rejects.toSatisfy(
      (error: unknown) => isWasmCatalogEmptyError(error)
    );
  });

  it('isWasmCatalogEmptyError keys off status and details.kind, not code spelling', () => {
    const empty = new ApiRequestError('该发布版本尚未配置通用 Wasm catalog', 404, 'anything', {
      kind: 'wasm_catalog_empty',
      gameId: 'demo',
      versionCode: 'v9'
    });
    expect(isWasmCatalogEmptyError(empty)).toBe(true);

    const plain404 = new ApiRequestError('missing', 404, '404.NOT_FOUND');
    expect(isWasmCatalogEmptyError(plain404)).toBe(false);

    const wrongStatus = new ApiRequestError('nope', 500, 'NOT_FOUND', {
      kind: 'wasm_catalog_empty',
      gameId: 'demo',
      versionCode: 'v9'
    });
    expect(isWasmCatalogEmptyError(wrongStatus)).toBe(false);
  });
});
