import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGames } from './apiClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('apiClient.listGames', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps gameId, gameName and nullable gameImgUrl', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://localhost:8080/api/games');
      return jsonResponse(200, [
        { gameId: 'lol', gameName: '英雄联盟', gameImgUrl: 'lol.png' },
        { gameId: 'demo', gameName: 'Demo Arena', gameImgUrl: null }
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listGames('http://localhost:8080');
    expect(result.data).toEqual([
      { gameId: 'lol', gameName: '英雄联盟', gameImgUrl: 'lol.png' },
      { gameId: 'demo', gameName: 'Demo Arena', gameImgUrl: null }
    ]);
  });

  it('drops progressionSchema and missing gameImgUrl becomes null', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, [
        {
          gameId: 'lol',
          gameName: '英雄联盟',
          progressionSchema: { progressionKind: 'LEVEL', stageMin: 1, stageMax: 18 }
        }
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listGames('http://localhost:8080');
    expect(result.data).toEqual([{ gameId: 'lol', gameName: '英雄联盟', gameImgUrl: null }]);
    expect(result.data[0]).not.toHaveProperty('progressionSchema');
  });
});
